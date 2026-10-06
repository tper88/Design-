/* ==========================================================================
   TB RUNTIME v1.1 — silnik wygenerowanego trackera.

   Interfejs jest po angielsku; komentarze zostają po polsku, bo to kod
   do utrzymania, nie produkt.

   Źródłem prawdy jest PLIK .data.json na dysku użytkownika; IndexedDB jest
   szybkim cache'em lokalnym. Taki podział, bo przy otwarciu przez file://
   magazyn przeglądarki jest kluczowany po ŚCIEŻCE pliku — zmiana nazwy albo
   przeniesienie tracker.html wyglądałaby jak utrata wszystkich danych.

   Target: Chrome i Edge. Bez File System Access albo IndexedDB tracker
   pokazuje bramę, zamiast udawać, że zapisuje.

   Moduły: cfg · fmt · data · agg · store · profile · alerts · sel · render
           · crud · menu · io · shell · boot
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = document;
  var TB = {};
  global.TB = TB;

  /* ====================================================================== cfg */

  var CFG = null;
  var DS = {};
  var COL = {};
  var PREVIEW = false;

  function parseConfig() {
    var node = doc.getElementById('tb-config');
    var raw = node ? node.textContent : '';
    var cfg;
    try {
      cfg = JSON.parse(raw);
    } catch (e) {
      throw new Error('Could not read the tracker configuration: ' + e.message);
    }
    cfg.meta = cfg.meta || {};
    cfg.datasets = cfg.datasets || [];
    cfg.tabs = cfg.tabs || [];
    cfg.alerts = cfg.alerts || [];
    cfg.datasets.forEach(function (ds) {
      ds.columns = ds.columns || [];
      DS[ds.id] = ds;
      COL[ds.id] = {};
      ds.columns.forEach(function (c) { COL[ds.id][c.id] = c; });
    });
    PREVIEW = !!cfg.meta.preview;
    return cfg;
  }

  function column(dsId, colId) { return (COL[dsId] || {})[colId]; }

  TB.config = function () { return CFG; };

  /* ====================================================================== fmt */

  var fmt = {};
  var dtf = {};

  fmt.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function locale() { return (CFG && CFG.meta.locale) || 'en-GB'; }
  function currency() { return (CFG && CFG.meta.currency) || 'PLN'; }

  fmt.nf = function (v, d) {
    return (+v).toLocaleString(locale(),
      { maximumFractionDigits: d == null ? 1 : d, minimumFractionDigits: d == null ? 0 : d });
  };

  fmt.number = function (v, format, decimals) {
    if (v == null || v === '' || isNaN(v)) return '';
    switch (format) {
      case 'currency':
        return (+v).toLocaleString(locale(),
          { style: 'currency', currency: currency(), maximumFractionDigits: 2 });
      case 'percent': return fmt.nf(v, decimals == null ? 1 : decimals) + '%';
      case 'integer': return fmt.nf(Math.round(v), 0);
      case 'compact': return TBCharts.fmt.compact(v);
      default: return fmt.nf(v, decimals == null ? 2 : decimals);
    }
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  fmt.todayISO = function () {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  fmt.parseISO = function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  };

  fmt.shiftISO = function (iso, days) {
    var d = fmt.parseISO(iso);
    if (!d) return iso;
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  function intl(key, opts) {
    if (!dtf[key]) dtf[key] = new Intl.DateTimeFormat(locale(), opts);
    return dtf[key];
  }

  /* Kolejność dnia i miesiąca bierze się z wybranego formatu, nie z kodu:
     en-GB daje 31/12/2026, en-US 12/31/2026, pl-PL 31.12.2026. */
  fmt.date = function (iso) {
    var d = fmt.parseISO(iso);
    if (!d) return iso ? String(iso) : '';
    return intl('d', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  };

  fmt.dayLabel = function (iso) {
    var today = fmt.todayISO();
    if (iso === today) return 'Today';
    if (iso === fmt.shiftISO(today, 1)) return 'Tomorrow';
    if (iso === fmt.shiftISO(today, -1)) return 'Yesterday';
    var d = fmt.parseISO(iso);
    if (!d) return String(iso);
    return intl('wd', { weekday: 'short' }).format(d) + ' ' + fmt.date(iso);
  };

  fmt.monthLabel = function (key) {
    var m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) return key;
    return intl('m', { month: 'short', year: 'numeric' }).format(new Date(+m[1], +m[2] - 1, 1));
  };

  fmt.time = function (date) {
    return intl('t', { hour: '2-digit', minute: '2-digit' }).format(date);
  };

  fmt.cell = function (value, col) {
    if (value == null || value === '') return '';
    if (!col) return String(value);
    if (col.type === 'number') return fmt.number(value, col.format, col.decimals);
    if (col.type === 'date') return fmt.date(value);
    if (col.type === 'bool') return value ? 'Yes' : 'No';
    if (col.type === 'enum') {
      var o = optionOf(col, value);
      return o ? o.label : String(value);
    }
    return String(value);
  };

  function optionOf(col, value) {
    var opts = (col && col.options) || [];
    for (var i = 0; i < opts.length; i++) if (opts[i].value === value) return opts[i];
    return null;
  }

  function plural(n, one, many) { return n === 1 ? one : many; }

  TB.fmt = fmt;

  /* ====================================================================== data */

  var data = { byDs: {}, rev: {}, index: {} };

  function dsList(dsId) {
    if (!data.byDs[dsId]) data.byDs[dsId] = [];
    return data.byDs[dsId];
  }
  function bumpRev(dsId) { data.rev[dsId] = (data.rev[dsId] || 0) + 1; }
  function liveRecords(dsId) {
    return dsList(dsId).filter(function (r) { return !r._d; });
  }

  var idCounter = 0;
  function newId(prefix) {
    idCounter++;
    return prefix + Date.now().toString(36) + idCounter.toString(36) +
      Math.floor(Math.random() * 1296).toString(36);
  }

  /* Koercja przy CZYTANIU, nie destrukcyjna migracja. Przy nieudanej konwersji
     surowa wartość zostaje w rekordzie, a komórka dostaje ostrzeżenie. */
  function coerce(value, col) {
    if (value == null || value === '') return null;
    if (!col) return value;
    switch (col.type) {
      /* Liczby, daty i tak/nie czyta tb-parse.js według locale trackera —
         „06/10/2026” to 6 października w en-GB i 10 czerwca w en-US. */
      case 'number': {
        var n = TBParse.number(value, locale());
        return n == null ? { _bad: value } : n;
      }
      case 'date': {
        var d = TBParse.date(value, locale());
        return d == null ? { _bad: value } : d;
      }
      case 'bool': {
        var b = TBParse.bool(value);
        return b == null ? { _bad: value } : b;
      }
      case 'enum': {
        var v = String(value).trim();
        if (optionOf(col, v)) return v;
        var opts = col.options || [];
        for (var i = 0; i < opts.length; i++) {
          if (String(opts[i].label).toLowerCase() === v.toLowerCase()) return opts[i].value;
        }
        return { _bad: value };
      }
      default:
        return String(value);
    }
  }

  function isBad(v) { return v && typeof v === 'object' && '_bad' in v; }

  function defaultFor(col) {
    var d = col.default;
    if (d === '@today') return fmt.todayISO();
    if (d === '@now') return new Date().toISOString();
    if (d === '@user') return profile.get().name || '';
    if (d === '@team') return profile.get().team || '';
    return d == null ? null : d;
  }

  function blankRecord(dsId) {
    var ds = DS[dsId];
    var rec = { id: newId('r_'), ds: dsId, data: {}, _c: Date.now(), _m: Date.now(), _d: 0 };
    (ds ? ds.columns : []).forEach(function (c) {
      var d = defaultFor(c);
      if (d != null) rec.data[c.id] = d;
    });
    return rec;
  }

  TB.data = data;

  /* ====================================================================== agg */

  var aggCache = {};

  function ctxNow() {
    var today = fmt.todayISO();
    return {
      today: today,
      tomorrow: fmt.shiftISO(today, 1),
      next7: fmt.shiftISO(today, 7),
      next30: fmt.shiftISO(today, 30),
      monthStart: today.slice(0, 8) + '01'
    };
  }

  function resolveValue(v, ctx) {
    if (v === '@today') return ctx.today;
    if (v === '@user') return profile.get().name || '';
    if (v === '@team') return profile.get().team || '';
    return v;
  }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : NaN; }

  function relDate(v, kind, ctx) {
    if (!v) return false;
    var iso = String(v).slice(0, 10);
    var m = /^lastNDays:(\d+)$/.exec(kind || '');
    if (m) return iso >= fmt.shiftISO(ctx.today, -(+m[1])) && iso <= ctx.today;
    switch (kind) {
      case 'today': return iso === ctx.today;
      case 'tomorrow': return iso === ctx.tomorrow;
      case 'overdue': return iso < ctx.today;
      case 'next7': return iso >= ctx.today && iso <= ctx.next7;
      case 'next30': return iso >= ctx.today && iso <= ctx.next30;
      case 'thisMonth': return iso.slice(0, 7) === ctx.today.slice(0, 7);
      case 'lastMonth': {
        var d = fmt.parseISO(ctx.monthStart);
        d.setMonth(d.getMonth() - 1);
        return iso.slice(0, 7) === d.getFullYear() + '-' + pad(d.getMonth() + 1);
      }
      case 'thisYear': return iso.slice(0, 4) === ctx.today.slice(0, 4);
      default: return true;
    }
  }

  function ruleMatch(rec, rule, ctx) {
    var raw = rec.data[rule.field];
    var col = column(rec.ds, rule.field);
    var v = coerce(raw, col);
    if (isBad(v)) v = raw;
    var want = resolveValue(rule.value, ctx);

    switch (rule.cmp) {
      case 'empty': return v == null || v === '';
      case 'notEmpty': return !(v == null || v === '');
      case 'eq': return String(v == null ? '' : v) === String(want == null ? '' : want);
      case 'ne': return String(v == null ? '' : v) !== String(want == null ? '' : want);
      case 'in': return (want || []).some(function (x) { return String(x) === String(v); });
      case 'nin': return !(want || []).some(function (x) { return String(x) === String(v); });
      case 'contains':
        return String(v == null ? '' : v).toLowerCase().indexOf(String(want).toLowerCase()) >= 0;
      case 'startsWith':
        return String(v == null ? '' : v).toLowerCase().indexOf(String(want).toLowerCase()) === 0;
      case 'gt': return num(v) > num(want);
      case 'gte': return num(v) >= num(want);
      case 'lt': return num(v) < num(want);
      case 'lte': return num(v) <= num(want);
      case 'between': return num(v) >= num(want) && num(v) <= num(rule.value2);
      case 'relDate': return relDate(v, want, ctx);
      default: return true;
    }
  }

  function filterMatch(rec, filter, ctx) {
    if (!filter) return true;
    var rules = filter.rules || [];
    if (!rules.length) return true;
    if (filter.op === 'any') {
      return rules.some(function (r) { return r.op ? filterMatch(rec, r, ctx) : ruleMatch(rec, r, ctx); });
    }
    return rules.every(function (r) { return r.op ? filterMatch(rec, r, ctx) : ruleMatch(rec, r, ctx); });
  }

  function filtered(dsId, filter) {
    var ctx = ctxNow();
    return liveRecords(dsId).filter(function (r) { return filterMatch(r, filter, ctx); });
  }

  function groupKey(value, col, grain) {
    if (value == null || value === '') return '—';
    if (col && col.type === 'date') {
      var iso = String(value).slice(0, 10);
      if (grain === 'year') return iso.slice(0, 4);
      if (grain === 'month') return iso.slice(0, 7);
      return iso;
    }
    if (col && col.type === 'bool') return value ? 'Yes' : 'No';
    return String(value);
  }

  function groupLabel(key, col, grain) {
    if (col && col.type === 'date') {
      if (grain === 'month') return fmt.monthLabel(key);
      if (grain === 'year') return key;
      return fmt.date(key);
    }
    if (col && col.type === 'enum') {
      var o = optionOf(col, key);
      return o ? o.label : key;
    }
    return key;
  }

  function reduceOp(op, values) {
    if (op === 'count') return values.length;
    if (op === 'countDistinct') {
      var seen = {};
      values.forEach(function (v) { seen[String(v)] = 1; });
      return Object.keys(seen).length;
    }
    var nums = values.map(num).filter(function (n) { return isFinite(n); });
    if (!nums.length) return op === 'min' || op === 'max' ? null : 0;
    switch (op) {
      case 'sum': return nums.reduce(function (a, b) { return a + b; }, 0);
      case 'avg': return nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
      case 'min': return Math.min.apply(null, nums);
      case 'max': return Math.max.apply(null, nums);
      default: return nums.length;
    }
  }

  /* Jedna specyfikacja agregacji zasila wszystkie renderery. */
  function aggregate(dsId, spec) {
    spec = spec || { op: 'count' };
    var key = dsId + '|' + (data.rev[dsId] || 0) + '|' + JSON.stringify(spec);
    if (aggCache[key]) return aggCache[key];

    var recs = filtered(dsId, spec.filter);
    var out = { scalar: null, labels: [], series: [], total: 0, rows: recs.length };

    function valuesOf(list) {
      return list.map(function (r) {
        var v = coerce(r.data[spec.field], column(dsId, spec.field));
        return isBad(v) ? null : v;
      }).filter(function (v) { return v != null || spec.op === 'count'; });
    }

    if (!spec.groupBy || !spec.groupBy.field) {
      out.scalar = reduceOp(spec.op, spec.op === 'count' ? recs : valuesOf(recs));
      out.total = out.scalar;
      aggCache[key] = out;
      return out;
    }

    var gCol = column(dsId, spec.groupBy.field);
    var grain = spec.groupBy.grain || (gCol && gCol.type === 'date' ? 'month' : null);
    var sCol = spec.split && spec.split.field ? column(dsId, spec.split.field) : null;

    var buckets = {}, order = [], splitSeen = {}, splitOrder = [];

    recs.forEach(function (r) {
      var gk = groupKey(r.data[spec.groupBy.field], gCol, grain);
      if (!buckets[gk]) { buckets[gk] = {}; order.push(gk); }
      var sk = sCol ? groupKey(r.data[spec.split.field], sCol, null) : '_';
      if (!splitSeen[sk]) { splitSeen[sk] = 1; splitOrder.push(sk); }
      if (!buckets[gk][sk]) buckets[gk][sk] = [];
      buckets[gk][sk].push(r);
    });

    function bucketTotal(gk) {
      var all = [];
      for (var sk in buckets[gk]) all = all.concat(buckets[gk][sk]);
      return reduceOp(spec.op, spec.op === 'count' ? all : valuesOf(all)) || 0;
    }
    var sort = spec.groupBy.sort || 'key_asc';
    if (sort === 'key_asc') order.sort();
    else if (sort === 'key_desc') order.sort().reverse();
    else if (sort === 'value_desc') order.sort(function (a, b) { return bucketTotal(b) - bucketTotal(a); });
    else if (sort === 'value_asc') order.sort(function (a, b) { return bucketTotal(a) - bucketTotal(b); });

    if (spec.groupBy.limit > 0 && order.length > spec.groupBy.limit) {
      order = order.slice(0, spec.groupBy.limit);
    }
    if (sCol && spec.split.limit > 0 && splitOrder.length > spec.split.limit) {
      splitOrder = splitOrder.slice(0, spec.split.limit);
    }

    out.labels = order.map(function (k) { return groupLabel(k, gCol, grain); });
    out.series = splitOrder.map(function (sk) {
      return {
        key: sk,
        name: sCol ? groupLabel(sk, sCol, null) : (spec.name || 'Value'),
        values: order.map(function (gk) {
          var list = (buckets[gk] && buckets[gk][sk]) || [];
          return reduceOp(spec.op, spec.op === 'count' ? list : valuesOf(list)) || 0;
        })
      };
    });
    out.total = out.series.reduce(function (s, se) {
      return s + se.values.reduce(function (a, b) { return a + b; }, 0);
    }, 0);
    out.scalar = out.total;

    aggCache[key] = out;
    return out;
  }

  TB.agg = { aggregate: aggregate, filtered: filtered, filterMatch: filterMatch, ctxNow: ctxNow };

  /* ====================================================================== store */

  var store = (function () {
    var db = null;
    var handle = null;
    var mode = 'none';
    var pending = {};
    var idbTimer = null, fileTimer = null;
    var lastFileMtime = 0;
    var saveState = 'off';
    var handleRemembered = true;
    var structureNote = null;

    function idbOpen() {
      return new Promise(function (res, rej) {
        var req = indexedDB.open('tb_' + CFG.meta.trackerId, 1);
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames.contains('records')) {
            d.createObjectStore('records', { keyPath: 'id' }).createIndex('by_ds', 'ds');
          }
          if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
        };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error); };
      });
    }

    function tx(name, m) { return db.transaction(name, m).objectStore(name); }
    function reqP(req) {
      return new Promise(function (res, rej) {
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error); };
      });
    }
    /* IndexedDB rzuca SYNCHRONICZNIE (np. DataCloneError na niekopiowalnej
       wartości), więc wywołania muszą być owinięte — inaczej wyjątek ucieka
       obok obietnicy i zrywa cały łańcuch zamiast trafić do .catch(). */
    function safe(fn) {
      try { return fn(); } catch (err) { return Promise.reject(err); }
    }
    function kvGet(k) {
      return safe(function () {
        return reqP(tx('kv', 'readonly').get(k)).then(function (r) { return r ? r.v : undefined; });
      });
    }
    function kvPut(k, v) {
      return safe(function () { return reqP(tx('kv', 'readwrite').put({ k: k, v: v })); });
    }

    function ingest(records) {
      data.byDs = {};
      data.index = {};
      (records || []).forEach(function (r) {
        if (!r || !r.ds) return;
        dsList(r.ds).push(r);
        data.index[r.id] = r;
      });
      Object.keys(data.byDs).forEach(bumpRev);
      aggCache = {};
    }

    function dataFileObject() {
      var all = [];
      Object.keys(data.byDs).forEach(function (ds) { all = all.concat(data.byDs[ds]); });
      return {
        $kind: 'tracker.data',
        trackerId: CFG.meta.trackerId,
        configRev: CFG.rev || 0,
        savedAt: new Date().toISOString(),
        profile: profile.get(),
        records: all
      };
    }

    function flushIdb() {
      idbTimer = null;
      if (!db) return Promise.resolve();
      var list = Object.keys(pending).map(function (id) { return pending[id]; });
      pending = {};
      if (!list.length) return Promise.resolve();
      return safe(function () {
        var s = tx('records', 'readwrite');
        list.forEach(function (r) { s.put(r); });
        return new Promise(function (res) {
          s.transaction.oncomplete = function () { res(); };
          s.transaction.onerror = function () { res(); };
        });
      }).catch(function () {});
    }

    function setSaveState(s) {
      saveState = s;
      var el2 = doc.getElementById('tb-save');
      if (!el2) return;
      el2.setAttribute('data-state', s);
      el2.textContent = {
        off: 'Not linked to a file',
        dirty: 'Unsaved changes',
        saving: 'Saving…',
        saved: 'Saved ' + fmt.time(new Date())
      }[s] || s;
    }

    function flushFile() {
      fileTimer = null;
      if (!handle || mode !== 'auto') { setSaveState(handle ? 'dirty' : 'off'); return Promise.resolve(); }
      setSaveState('saving');
      var obj = dataFileObject();
      return handle.createWritable().then(function (w) {
        return w.write(JSON.stringify(obj)).then(function () { return w.close(); });
      }).then(function () {
        return handle.getFile();
      }).then(function (f) {
        lastFileMtime = f.lastModified;
        return kvPut('lastFileMtime', lastFileMtime);
      }).then(function () {
        setSaveState('saved');
      }).catch(function (err) {
        setSaveState('dirty');
        TBUI.toast('Could not write the data file: ' + err.message, 'danger', 6000);
      });
    }

    function scheduleSave() {
      if (PREVIEW) return;
      if (!idbTimer) idbTimer = setTimeout(flushIdb, 250);
      if (mode === 'auto') {
        setSaveState('dirty');
        clearTimeout(fileTimer);
        fileTimer = setTimeout(flushFile, 1500);
      } else {
        setSaveState(handle ? 'dirty' : 'off');
      }
    }

    function touch(rec) {
      rec._m = Date.now();
      pending[rec.id] = rec;
      bumpRev(rec.ds);
      aggCache = {};
      scheduleSave();
      TB.shell.invalidate(rec.ds);
    }

    function putRecord(rec) {
      if (!data.index[rec.id]) {
        dsList(rec.ds).push(rec);
        data.index[rec.id] = rec;
      }
      touch(rec);
    }

    function softDelete(rec) { rec._d = 1; touch(rec); }

    function saveNow() { return flushIdb().then(flushFile); }

    function pickFile() {
      return global.showSaveFilePicker({
        suggestedName: (CFG.meta.name || 'tracker').replace(/[^\w\-. ]+/g, '_') + '.data.json',
        types: [{ description: 'Tracker data', accept: { 'application/json': ['.json'] } }]
      }).then(function (h) {
        handle = h;
        mode = 'auto';
        // Nieudane zapamiętanie uchwytu nie może przerwać połączenia.
        return kvPut('fileHandle', h).catch(function (err) {
          handleRemembered = false;
          if (global.console) console.warn('[TB] file handle not remembered:', err && err.message);
        });
      }).then(function () {
        return saveNow();
      }).then(function () {
        TB.shell.renderNotices();
        TBUI.toast('Linked to the data file', 'success');
      });
    }

    /* requestPermission MUSI być pierwszą rzeczą w handlerze gestu —
       żadne await przed nim, inaczej przeglądarka odrzuci prośbę. */
    function reconnect() {
      if (!handle) return Promise.resolve(false);
      return handle.requestPermission({ mode: 'readwrite' }).then(function (p) {
        if (p !== 'granted') {
          mode = 'denied';
          TB.shell.renderNotices();
          return false;
        }
        mode = 'auto';
        return afterConnect().then(function () { return true; });
      });
    }

    /* Profil jest osobisty, więc lokalny ma pierwszeństwo; z pliku bierzemy go
       tylko wtedy, gdy na tej maszynie jeszcze żadnego nie ma. */
    function adoptProfile(obj) {
      if (obj && obj.profile && !profile.hasLocal()) profile.set(obj.profile, true);
    }

    function afterConnect() {
      return handle.getFile().then(function (f) {
        if (f.lastModified > lastFileMtime + 2000 && Object.keys(data.index).length) {
          TB.shell.conflict(f);
          return;
        }
        return f.text().then(function (t) {
          if (t && t.trim()) {
            var obj = JSON.parse(t);
            if (obj && obj.records) {
              ingest(obj.records);
              adoptProfile(obj);
              safe(function () {
                var s = tx('records', 'readwrite');
                obj.records.forEach(function (r) { s.put(r); });
              });
            }
          }
          lastFileMtime = f.lastModified;
          setSaveState('saved');
          TB.shell.renderNotices();
          TB.shell.renderProfile();
          TB.shell.renderActive(true);
        });
      });
    }

    function loadFileNow() {
      return handle.getFile().then(function (f) {
        return f.text().then(function (t) {
          var obj = t && t.trim() ? JSON.parse(t) : { records: [] };
          ingest(obj.records || []);
          adoptProfile(obj);
          safe(function () {
            var s = tx('records', 'readwrite');
            s.clear();
            (obj.records || []).forEach(function (r) { s.put(r); });
          });
          lastFileMtime = f.lastModified;
          setSaveState('saved');
          TB.shell.renderNotices();
          TB.shell.renderActive(true);
        });
      });
    }

    function keepLocal() {
      return saveNow().then(function () {
        TB.shell.renderNotices();
        TB.shell.renderActive(true);
      });
    }

    /* Porównanie wersji struktury. Rekordy NIE są przepisywane — cicha zmiana
       struktury jest myląca, więc użytkownik dostaje podsumowanie. */
    function noteStructureChange(prevRev, prevJson) {
      var rev = CFG.rev || 0;
      try {
        if (prevRev == null || rev === prevRev) return;
        if (rev < prevRev) {
          structureNote = { older: true, from: prevRev, to: rev };
          return;
        }
        var prev = prevJson ? JSON.parse(prevJson) : null;
        var added = 0, removed = 0, tabsDelta = 0;
        if (prev) {
          var oldCols = {}, newCols = {};
          (prev.datasets || []).forEach(function (d) {
            (d.columns || []).forEach(function (c) { oldCols[c.id] = 1; });
          });
          CFG.datasets.forEach(function (d) {
            d.columns.forEach(function (c) { newCols[c.id] = 1; });
          });
          Object.keys(newCols).forEach(function (k) { if (!oldCols[k]) added++; });
          Object.keys(oldCols).forEach(function (k) { if (!newCols[k]) removed++; });
          tabsDelta = CFG.tabs.length - (prev.tabs || []).length;
        }
        structureNote = { from: prevRev, to: rev, added: added, removed: removed, tabs: tabsDelta };
      } finally {
        kvPut('configRev', rev).catch(function () {});
        kvPut('configJson', JSON.stringify(CFG)).catch(function () {});
      }
    }

    function init() {
      if (PREVIEW) {
        var seed = global.__TB_SEED;
        if (seed) {
          var recs = [];
          Object.keys(seed).forEach(function (dsId) {
            (seed[dsId] || []).forEach(function (d) {
              recs.push({ id: newId('r_'), ds: dsId, data: d, _c: Date.now(), _m: Date.now(), _d: 0 });
            });
          });
          ingest(recs);
        }
        mode = 'none';
        return Promise.resolve();
      }
      return idbOpen().then(function (d) {
        db = d;
        return Promise.all([
          reqP(tx('records', 'readonly').getAll()),
          kvGet('fileHandle'), kvGet('lastFileMtime'),
          kvGet('profile'), kvGet('configRev'), kvGet('configJson')
        ]);
      }).then(function (res) {
        ingest(res[0]);
        handle = res[1] || null;
        lastFileMtime = res[2] || 0;
        if (res[3]) profile.set(res[3], true);
        noteStructureChange(res[4], res[5]);
        if (!handle) { mode = 'none'; setSaveState('off'); return; }
        return handle.queryPermission({ mode: 'readwrite' }).then(function (p) {
          if (p === 'granted') { mode = 'auto'; return afterConnect(); }
          mode = p === 'denied' ? 'denied' : 'prompt';
          setSaveState('off');
        });
      });
    }

    return {
      init: init, putRecord: putRecord, softDelete: softDelete, touch: touch,
      saveNow: saveNow, pickFile: pickFile, reconnect: reconnect,
      loadFileNow: loadFileNow, keepLocal: keepLocal,
      dataFileObject: dataFileObject, ingest: ingest,
      replaceAll: function (records) {
        ingest(records);
        safe(function () {
          var s = tx('records', 'readwrite');
          s.clear();
          records.forEach(function (r) { s.put(r); });
        });
        return saveNow();
      },
      persistProfile: function (p) { return kvPut('profile', p).catch(function () {}); },
      mode: function () { return mode; },
      handle: function () { return handle; },
      fileName: function () { return handle ? handle.name : ''; },
      setSaveState: setSaveState,
      state: function () { return saveState; },
      remembered: function () { return handleRemembered; },
      structureNote: function () { return structureNote; }
    };
  })();

  TB.store = store;

  /* ====================================================================== profile */

  var profile = (function () {
    var p = { name: '', team: '', color: 'c1', photo: null };
    var local = false;

    function initials(name) {
      var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '?';
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function set(np, fromStorage) {
      p = {
        name: np.name != null ? np.name : p.name,
        team: np.team != null ? np.team : p.team,
        color: np.color || p.color || 'c1',
        photo: np.photo !== undefined ? np.photo : p.photo
      };
      if (fromStorage) local = true;
      return p;
    }

    function save(np) {
      set(np);
      local = true;
      store.persistProfile(p);
      store.saveNow();
      TB.shell.renderProfile();
      TB.shell.renderActive(true);
    }

    /* Zdjęcie przeskalowane w przeglądarce do kwadratu 96×96 i skompresowane.
       Bez tego jedno zdjęcie z telefonu dokładałoby kilka MB do pliku danych,
       przepisywanych na dysk przy każdym zapisie. */
    function readPhoto(file, size) {
      size = size || 96;
      return new Promise(function (res, rej) {
        if (!/^image\//.test(file.type)) {
          rej(new Error('That file is not an image'));
          return;
        }
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try {
            var c = doc.createElement('canvas');
            c.width = c.height = size;
            var g = c.getContext('2d');
            var s = Math.min(img.width, img.height);
            g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
            res(c.toDataURL('image/jpeg', 0.82));
          } catch (e) {
            rej(e);
          } finally {
            URL.revokeObjectURL(url);
          }
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          rej(new Error('Could not read that image'));
        };
        img.src = url;
      });
    }

    function avatar(extraClass) {
      var a = doc.createElement('div');
      a.className = 'tb-avatar' + (extraClass ? ' ' + extraClass : '');
      a.textContent = initials(p.name);
      if (p.photo) {
        a.style.backgroundImage = 'url(' + p.photo + ')';
        a.classList.add('tb-avatar-has-photo');
      } else {
        a.style.background = 'var(--' + (p.color || 'c1') + ')';
      }
      return a;
    }

    return {
      get: function () { return p; },
      set: set, save: save, avatar: avatar, initials: initials, readPhoto: readPhoto,
      hasLocal: function () { return local; }
    };
  })();

  TB.profile = profile;

  /* ====================================================================== alerts */

  var alerts = (function () {
    function compare(n, cmp, value) {
      switch (cmp) {
        case 'gte': return n >= value;
        case 'lt': return n < value;
        case 'lte': return n <= value;
        case 'eq': return n === value;
        case 'ne': return n !== value;
        default: return n > value;
      }
    }

    function active() {
      return (CFG.alerts || []).map(function (a) {
        if (!DS[a.dataset]) return null;
        var r = aggregate(a.dataset, { op: 'count', filter: a.filter });
        var n = r.scalar || 0;
        if (!compare(n, a.cmp || 'gt', a.value == null ? 0 : a.value)) return null;
        return {
          id: a.id, label: a.label || 'Alert', tone: a.tone || 'warning',
          count: n, goToTab: a.goToTab || null,
          text: String(a.message || '{{n}} matching rows').replace(/\{\{n\}\}/g, n)
        };
      }).filter(Boolean);
    }

    var RANK = { danger: 3, warning: 2, info: 1, success: 0 };
    function worstTone(list) {
      var best = 'info';
      list.forEach(function (a) {
        if ((RANK[a.tone] || 0) > (RANK[best] || 0)) best = a.tone;
      });
      return best;
    }

    return { active: active, worstTone: worstTone };
  })();

  TB.alerts = alerts;

  /* ====================================================================== sel */

  var sel = (function () {
    var byCmp = {};
    function set(cmpId) { if (!byCmp[cmpId]) byCmp[cmpId] = {}; return byCmp[cmpId]; }
    return {
      ids: function (c) { return Object.keys(set(c)); },
      has: function (c, id) { return !!set(c)[id]; },
      count: function (c) { return Object.keys(set(c)).length; },
      toggle: function (c, id, on) {
        var s = set(c);
        if (on == null) on = !s[id];
        if (on) s[id] = 1; else delete s[id];
        return on;
      },
      clear: function (c) { byCmp[c] = {}; },
      setMany: function (c, ids, on) {
        var s = set(c);
        ids.forEach(function (id) { if (on) s[id] = 1; else delete s[id]; });
      }
    };
  })();

  TB.sel = sel;

  /* ====================================================================== render */

  var viewState = {};
  var lastView = {};

  function vs(cmpId) {
    if (!viewState[cmpId]) viewState[cmpId] = { q: '', sort: null, dir: 'asc', page: 1, quick: -1 };
    return viewState[cmpId];
  }

  function div(cls, html) {
    var d = doc.createElement('div');
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function btn(label, cls, onClick) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + (cls || 'btn-secondary');
    b.textContent = label;
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function card(title, sub, bodyEl, headExtra) {
    var c = doc.createElement('section');
    c.className = 'card';
    if (title || sub || headExtra) {
      var h = div('card-h');
      var t = div('');
      if (title) {
        var tt = div('card-t');
        tt.textContent = title;
        t.appendChild(tt);
      }
      if (sub) {
        var ss = div('tb-muted');
        ss.style.fontSize = '11.5px';
        ss.textContent = sub;
        t.appendChild(ss);
      }
      h.appendChild(t);
      if (headExtra) h.appendChild(headExtra);
      c.appendChild(h);
    }
    if (bodyEl) c.appendChild(bodyEl);
    return c;
  }
  function emptyBox(title, text, actions) {
    var e = div('tb-empty');
    var s = doc.createElement('strong');
    s.textContent = title;
    e.appendChild(s);
    if (text) {
      var p = doc.createElement('div');
      p.textContent = text;
      e.appendChild(p);
    }
    if (actions && actions.length) {
      var a = div('tb-empty-actions');
      actions.forEach(function (x) { a.appendChild(x); });
      e.appendChild(a);
    }
    return e;
  }
  function toneColor(tone) {
    return {
      success: 'var(--tb-ok)', danger: 'var(--tb-bad)',
      warning: 'var(--tb-warn)', info: 'var(--tb-info)'
    }[tone] || 'var(--c1)';
  }

  var render = {};

  render.kpi = function (host, cmp) {
    var r = aggregate(cmp.dataset, cmp.agg);
    var opts = cmp.opts || {};
    var body = div('');
    var v = div('kpi-v');
    v.textContent = fmt.number(r.scalar == null ? 0 : r.scalar, opts.format || 'number', opts.decimals);
    body.appendChild(v);
    if (opts.spark && opts.spark.field) {
      var sp = aggregate(cmp.dataset, {
        op: cmp.agg.op, field: cmp.agg.field, filter: cmp.agg.filter,
        groupBy: { field: opts.spark.field, grain: opts.spark.grain || 'month', sort: 'key_asc' }
      });
      if (sp.series.length && sp.series[0].values.length > 1) {
        var sdiv = div('');
        body.appendChild(sdiv);
        TBCharts.spark(sdiv, { values: sp.series[0].values, color: 'c1' });
      }
    }
    var t = div('kpi-t');
    t.textContent = cmp.title || '';
    host.innerHTML = '';
    var c = card(null, null, null);
    c.appendChild(t);
    c.appendChild(body);
    if (cmp.subtitle) {
      var s = div('kpi-s');
      s.textContent = cmp.subtitle;
      c.appendChild(s);
    }
    host.appendChild(c);
  };

  render.stat = render.kpi;

  render.chart = function (host, cmp) {
    var opts = cmp.opts || {};
    var kind = opts.kind || 'bar';
    var r = aggregate(cmp.dataset, cmp.agg);
    host.innerHTML = '';
    var chartHost = div('');
    var c = card(cmp.title, cmp.subtitle, chartHost);
    host.appendChild(c);

    if (!r.labels.length) {
      chartHost.appendChild(emptyBox('Nothing to chart yet',
        'Add rows in a table tab — the chart recalculates on its own.'));
      return;
    }

    var fmtFn = function (v) { return fmt.number(v, opts.format || 'compact'); };

    if (kind === 'donut') {
      var items = r.labels.map(function (l, i) {
        return { label: l, value: r.series.length ? r.series[0].values[i] : 0 };
      }).filter(function (d) { return d.value > 0; });
      if (!items.length) {
        chartHost.appendChild(emptyBox('Nothing to chart yet', ''));
        return;
      }
      TBCharts.donut(chartHost, { items: items, format: fmtFn, centerLabel: opts.centerLabel || 'Total' });
      return;
    }
    if (kind === 'hbar') {
      TBCharts.hbar(chartHost, {
        items: r.labels.map(function (l, i) {
          return { label: l, value: r.series.length ? r.series[0].values[i] : 0 };
        }),
        format: fmtFn, fill: 'c1'
      });
      return;
    }

    var series = r.series.map(function (s, i) {
      return { name: s.name, values: s.values, fill: 'c' + ((i % 5) + 1), color: 'c' + ((i % 5) + 1) };
    });
    var callOpts = {
      labels: r.labels, series: series, height: opts.height || 200,
      format: fmtFn, title: cmp.title
    };
    if (kind === 'line') {
      callOpts.area = opts.area !== false;
      TBCharts.line(chartHost, callOpts);
    } else {
      TBCharts.bar(chartHost, callOpts);
    }

    // Legenda jest obowiązkowa od 2 serii.
    if (series.length >= 2) {
      var legend = doc.createElement('ul');
      legend.className = 'tb-legend';
      legend.style.cssText = 'display:flex;flex-direction:row;gap:14px;flex-wrap:wrap;margin-top:8px';
      legend.innerHTML = series.map(function (s, i) {
        return '<li class="tb-legend-row"><span class="tb-dot" style="--tb-dot:var(--c' +
          ((i % 5) + 1) + ')"></span>' + fmt.esc(s.name) + '</li>';
      }).join('');
      c.appendChild(legend);
    }
  };

  render.progress = function (host, cmp) {
    var opts = cmp.opts || {};
    var r = aggregate(cmp.dataset, cmp.agg);
    var value = r.scalar || 0;
    var target = opts.target || 0;
    var pctv = target > 0 ? Math.min(100, (value / target) * 100) : 0;
    var body = div('');
    var meta = div('tb-bar-meta');
    meta.innerHTML = '<span>' + fmt.esc(cmp.subtitle || 'Progress') + '</span><b>' +
      fmt.esc(fmt.number(value, opts.format || 'number')) +
      (target > 0 ? ' / ' + fmt.esc(fmt.number(target, opts.format || 'number')) : '') + '</b>';
    var track = div('bar');
    var fill = div('tb-bar-fill' + (pctv >= 100 ? ' tb-bar-fill-ok' : ''));
    fill.style.width = pctv.toFixed(1) + '%';
    track.appendChild(fill);
    body.appendChild(meta);
    body.appendChild(track);
    host.innerHTML = '';
    host.appendChild(card(cmp.title, null, body));
  };

  render.banner = function (host, cmp) {
    var opts = cmp.opts || {};
    var text = opts.text || '';
    if (cmp.dataset && cmp.agg) {
      var r = aggregate(cmp.dataset, cmp.agg);
      text = text.replace(/\{\{v\}\}/g, fmt.number(r.scalar == null ? 0 : r.scalar, opts.format || 'integer'));
    }
    var b = div('tb-banner' + (opts.tone ? ' tb-banner-' + opts.tone : ''));
    b.innerHTML = '<i>' + fmt.esc(opts.icon || 'ℹ') + '</i><div class="tb-banner-body">' +
      '<div class="tb-banner-title">' + fmt.esc(cmp.title || '') + '</div>' +
      (text ? '<div class="tb-banner-text">' + fmt.esc(text) + '</div>' : '') + '</div>';
    host.innerHTML = '';
    host.appendChild(b);
  };

  render.agenda = function (host, cmp) {
    var opts = cmp.opts || {};
    var ctx = ctxNow();
    var items = [];
    (opts.sources || []).forEach(function (src) {
      var ds = DS[src.dataset];
      if (!ds) return;
      filtered(src.dataset, src.filter).forEach(function (r) {
        var iso = r.data[src.dateField];
        if (!iso) return;
        iso = String(iso).slice(0, 10);
        if (opts.range === 'next30') {
          if (iso > ctx.next30) return;
          if (iso < ctx.today && !opts.showOverdue) return;
        }
        var toneCol = src.toneField ? column(src.dataset, src.toneField) : null;
        var o = toneCol ? optionOf(toneCol, r.data[src.toneField]) : null;
        items.push({
          iso: iso,
          title: r.data[src.titleField] || r.data[ds.titleField] || '(untitled)',
          meta: src.metaField ? fmt.cell(r.data[src.metaField], column(src.dataset, src.metaField)) : '',
          tone: o ? o.tone : null,
          rec: r
        });
      });
    });
    items.sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0; });

    var body = div('tb-agenda');
    if (!items.length) {
      body.appendChild(emptyBox(opts.emptyText || 'No dates yet',
        'Entries show up here as soon as a date column is filled in.'));
    } else {
      var groups = {}, order = [];
      items.forEach(function (it) {
        if (!groups[it.iso]) { groups[it.iso] = []; order.push(it.iso); }
        groups[it.iso].push(it);
      });
      order.forEach(function (iso) {
        var g = div('tb-agenda-day' +
          (iso === ctx.today ? ' is-today' : '') + (iso < ctx.today ? ' is-overdue' : ''));
        var head = div('tb-agenda-date');
        head.innerHTML = fmt.esc(fmt.dayLabel(iso)) +
          (iso < ctx.today ? ' <small>overdue</small>' : '') +
          ' <small>' + groups[iso].length + '</small>';
        g.appendChild(head);
        groups[iso].forEach(function (it) {
          var row = div('tb-agenda-item');
          row.innerHTML =
            '<span class="tb-dot" style="--tb-dot:' + toneColor(it.tone) + '"></span>' +
            '<span class="tb-agenda-title">' + fmt.esc(it.title) + '</span>' +
            (it.meta ? '<span class="tb-agenda-meta">' + fmt.esc(it.meta) + '</span>' : '');
          row.addEventListener('click', function () { crud.detail(it.rec, null); });
          g.appendChild(row);
        });
        body.appendChild(g);
      });
    }
    host.innerHTML = '';
    host.appendChild(card(cmp.title, cmp.subtitle, body));
  };

  /* ---- sticky notes ---- */

  render.notes = function (host, cmp) {
    var dsId = 'c:' + cmp.id;
    var recs = liveRecords(dsId).filter(function (r) { return !r.data.rowRef; });
    recs.sort(function (a, b) { return (a.data.order || 0) - (b.data.order || 0); });

    var body = div('tb-notes');
    recs.forEach(function (r) { body.appendChild(noteCard(r, false)); });

    var add = btn('+ Add note', 'btn-secondary', function () {
      store.putRecord({
        id: newId('r_'), ds: dsId,
        data: { text: '', color: 'c1', order: Date.now(), rowRef: null },
        _c: Date.now(), _m: Date.now(), _d: 0
      });
    });
    host.innerHTML = '';
    host.appendChild(card(cmp.title, cmp.subtitle, recs.length ? body :
      emptyBox('No notes yet', 'Add one to park a thought you do not want to keep in your head.'),
      add));
  };

  function noteCard(rec, pinned) {
    var n = div('tb-note tb-note-' + (rec.data.color || 'c1') + (pinned ? ' tb-note-pinned' : ''));
    var t = doc.createElement('div');
    t.className = 'tb-note-text';
    t.contentEditable = 'true';
    t.setAttribute('data-placeholder', 'Write something…');
    t.textContent = rec.data.text || '';
    // commit na blur, nie na input — żeby nie zapisywać każdego klawisza
    t.addEventListener('blur', function () {
      if (t.textContent === rec.data.text) return;
      rec.data.text = t.textContent;
      store.touch(rec);
    });
    n.appendChild(t);

    var foot = div('tb-note-foot');
    var when = doc.createElement('span');
    when.textContent = fmt.date(new Date(rec._c).toISOString().slice(0, 10));
    foot.appendChild(when);
    var colors = div('tb-note-colors');
    ['c1', 'c2', 'c3', 'c4', 'c5'].forEach(function (c) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.title = 'Change colour';
      b.setAttribute('aria-label', 'Colour ' + c);
      b.style.background = 'var(--' + c + ')';
      b.addEventListener('click', function () {
        rec.data.color = c;
        store.touch(rec);
      });
      colors.appendChild(b);
    });
    foot.appendChild(colors);
    var del = doc.createElement('button');
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete note');
    del.title = 'Delete';
    del.textContent = '✕';
    del.style.cssText = 'border:0;background:none;cursor:pointer;color:inherit;opacity:.6;padding:0 2px';
    del.addEventListener('click', function () {
      TBUI.confirm({
        title: 'Delete this note?',
        text: 'The text will be removed from the tracker.',
        confirmLabel: 'Delete note', tone: 'danger'
      }).then(function (ok) { if (ok) store.softDelete(rec); });
    });
    foot.appendChild(del);
    n.appendChild(foot);
    return n;
  }

  /* ---- checklist ---- */

  render.checklist = function (host, cmp) {
    var dsId = 'c:' + cmp.id;
    var opts = cmp.opts || {};
    var recs = liveRecords(dsId);
    recs.sort(function (a, b) { return (a.data.order || 0) - (b.data.order || 0); });

    var today = fmt.todayISO();
    recs.forEach(function (r) {
      if (r.data.resetDaily && r.data.done && r.data.lastDoneOn !== today) {
        r.data.done = false;
        store.touch(r);
      }
    });

    var body = div('tb-checklist');
    var groups = {}, order = [];
    recs.forEach(function (r) {
      var g = r.data.group || '';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(r);
    });
    order.forEach(function (g) {
      if (g) {
        var h = div('tb-check-group');
        h.textContent = g;
        body.appendChild(h);
      }
      groups[g].forEach(function (r) { body.appendChild(checkItem(r, opts)); });
    });

    var addWrap = div('tb-check-add');
    var inp = doc.createElement('input');
    inp.className = 'tb-input tb-input-sm';
    inp.placeholder = 'New item, then Enter';
    inp.setAttribute('aria-label', 'New checklist item');
    inp.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !inp.value.trim()) return;
      store.putRecord({
        id: newId('r_'), ds: dsId,
        data: {
          text: inp.value.trim(), done: false, order: Date.now(), group: '', due: null,
          resetDaily: !!opts.resetDaily
        },
        _c: Date.now(), _m: Date.now(), _d: 0
      });
      inp.value = '';
    });
    addWrap.appendChild(inp);

    var doneN = recs.filter(function (r) { return r.data.done; }).length;
    var counter = div('tb-count');
    counter.textContent = doneN + ' / ' + recs.length;

    host.innerHTML = '';
    var inner = div('');
    inner.appendChild(recs.length ? body :
      emptyBox('Checklist is empty', 'Type the first item in the box below.'));
    inner.appendChild(addWrap);
    host.appendChild(card(cmp.title, cmp.subtitle, inner, counter));
  };

  function checkItem(rec, opts) {
    var ctx = ctxNow();
    var overdue = rec.data.due && !rec.data.done && String(rec.data.due).slice(0, 10) < ctx.today;
    var it = div('tb-check-item' + (rec.data.done ? ' is-done' : '') + (overdue ? ' is-overdue' : ''));
    var cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'tb-check';
    cb.checked = !!rec.data.done;
    cb.setAttribute('aria-label', rec.data.text || 'Item');
    cb.addEventListener('change', function () {
      rec.data.done = cb.checked;
      rec.data.lastDoneOn = cb.checked ? fmt.todayISO() : null;
      store.touch(rec);
    });
    it.appendChild(cb);

    var txt = doc.createElement('span');
    txt.className = 'tb-check-text';
    txt.contentEditable = 'true';
    txt.textContent = rec.data.text || '';
    txt.addEventListener('blur', function () {
      if (txt.textContent === rec.data.text) return;
      rec.data.text = txt.textContent;
      store.touch(rec);
    });
    txt.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); txt.blur(); }
    });
    it.appendChild(txt);

    if (opts.showDue !== false && rec.data.due) {
      var due = doc.createElement('span');
      due.className = 'tb-check-due';
      due.textContent = fmt.date(rec.data.due);
      it.appendChild(due);
    }
    var del = doc.createElement('button');
    del.type = 'button';
    del.className = 'tb-modal-close';
    del.style.cssText = 'width:22px;height:22px;font-size:11px';
    del.setAttribute('aria-label', 'Delete item');
    del.textContent = '✕';
    del.addEventListener('click', function () { store.softDelete(rec); });
    it.appendChild(del);
    return it;
  }

  /* ---- table ---- */

  function cmpVal(a, b, col) {
    var va = coerce(a, col), vb = coerce(b, col);
    if (isBad(va)) va = a;
    if (isBad(vb)) vb = b;
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return va - vb;
    if (typeof va === 'boolean') return (va ? 1 : 0) - (vb ? 1 : 0);
    return String(va).localeCompare(String(vb), locale());
  }

  function pgBtn(label, enabled, onClick) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'tb-pg';
    b.textContent = label;
    b.disabled = !enabled;
    if (enabled) b.addEventListener('click', onClick);
    return b;
  }

  function pageNumbers(cur, pages) {
    if (pages <= 7) {
      var a = [];
      for (var i = 1; i <= pages; i++) a.push(i);
      return a;
    }
    var out = [1];
    if (cur > 3) out.push('…');
    for (var p = Math.max(2, cur - 1); p <= Math.min(pages - 1, cur + 1); p++) out.push(p);
    if (cur < pages - 2) out.push('…');
    out.push(pages);
    return out;
  }

  render.table = function (host, cmp) {
    var opts = cmp.opts || {};
    var ds = DS[cmp.dataset];
    if (!ds) {
      host.innerHTML = '';
      host.appendChild(emptyBox('No dataset selected', ''));
      return;
    }

    var state = vs(cmp.id);
    var cols = (opts.columns && opts.columns.length
      ? opts.columns : ds.columns.map(function (c) { return c.id; }))
      .map(function (id) { return column(cmp.dataset, id); })
      .filter(Boolean);

    var base = filtered(cmp.dataset, opts.filter);
    if (state.quick >= 0 && opts.quickFilters && opts.quickFilters[state.quick]) {
      var ctx = ctxNow();
      base = base.filter(function (r) {
        return filterMatch(r, opts.quickFilters[state.quick].filter, ctx);
      });
    }
    var q = (state.q || '').trim().toLowerCase();
    var rows = !q ? base : base.filter(function (r) {
      return cols.some(function (c) {
        return String(fmt.cell(r.data[c.id], c)).toLowerCase().indexOf(q) >= 0;
      });
    });

    var capped = false;
    if (rows.length > 500) { rows = rows.slice(0, 500); capped = true; }

    if (state.sort) {
      var sc = column(cmp.dataset, state.sort);
      var dir = state.dir === 'desc' ? -1 : 1;
      rows = rows.slice().sort(function (a, b) {
        return cmpVal(a.data[state.sort], b.data[state.sort], sc) * dir;
      });
    }

    var pageSize = opts.pageSize || 50;
    var pages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (state.page > pages) state.page = pages;
    var pageRows = rows.slice((state.page - 1) * pageSize, state.page * pageSize);

    host.innerHTML = '';
    var wrap = div('');

    /* --- toolbar --- */
    var bar = div('tb-toolbar');
    if (opts.search !== false) {
      var sw = div('tb-search');
      var si = doc.createElement('input');
      si.type = 'search';
      si.className = 'tb-input';
      si.placeholder = 'Search…';
      si.value = state.q || '';
      si.setAttribute('aria-label', 'Search the table');
      var tmr = null;
      si.addEventListener('input', function () {
        clearTimeout(tmr);
        tmr = setTimeout(function () {
          state.q = si.value;
          state.page = 1;
          render.table(host, cmp);
          var again = host.querySelector('.tb-search input');
          if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        }, 250);
      });
      sw.appendChild(si);
      bar.appendChild(sw);
    }
    if (opts.quickFilters && opts.quickFilters.length) {
      var chips = div('tb-chips');
      opts.quickFilters.forEach(function (qf, i) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'tb-chip-btn';
        b.textContent = qf.label;
        b.setAttribute('aria-pressed', state.quick === i ? 'true' : 'false');
        b.addEventListener('click', function () {
          state.quick = state.quick === i ? -1 : i;
          state.page = 1;
          render.table(host, cmp);
        });
        chips.appendChild(b);
      });
      bar.appendChild(chips);
    }
    bar.appendChild(div('tb-spacer'));

    var selN = sel.count(cmp.id);
    if (selN) {
      var selInfo = div('tb-count');
      selInfo.textContent = selN + ' selected';
      bar.appendChild(selInfo);
    }
    if (opts.allowAdd !== false) {
      bar.appendChild(btn('+ Add row', 'btn-primary', function () {
        crud.detail(blankRecord(cmp.dataset), cmp, true);
      }));
    }
    bar.appendChild(btn('Export', 'btn-secondary', function (e) { io.exportMenu(e, cmp); }));
    wrap.appendChild(bar);

    /* --- table --- */
    var tw = div('tb-table-wrap');
    var table = doc.createElement('table');
    table.className = 'tb-table';
    table.setAttribute('data-tb-ctx', 'table:' + cmp.id);

    var thead = doc.createElement('thead');
    var htr = doc.createElement('tr');
    if (opts.selectable !== false) {
      var th0 = doc.createElement('th');
      th0.className = 'tb-col-sel';
      var all = doc.createElement('input');
      all.type = 'checkbox';
      all.className = 'tb-check';
      all.setAttribute('aria-label', 'Select all rows on this page');
      var pageIds = pageRows.map(function (r) { return r.id; });
      var selOnPage = pageIds.filter(function (id) { return sel.has(cmp.id, id); }).length;
      all.checked = pageIds.length > 0 && selOnPage === pageIds.length;
      all.indeterminate = selOnPage > 0 && selOnPage < pageIds.length;
      all.addEventListener('change', function () {
        sel.setMany(cmp.id, pageIds, all.checked);
        render.table(host, cmp);
      });
      th0.appendChild(all);
      htr.appendChild(th0);
    }
    cols.forEach(function (c) {
      var th = doc.createElement('th');
      th.textContent = c.label;
      if (c.type === 'number') th.className = 'is-num';
      th.setAttribute('data-sortable', '');
      if (state.sort === c.id) th.setAttribute('aria-sort', state.dir === 'desc' ? 'descending' : 'ascending');
      th.addEventListener('click', function () {
        if (state.sort === c.id) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else { state.sort = c.id; state.dir = 'asc'; }
        render.table(host, cmp);
      });
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = doc.createElement('tbody');
    pageRows.forEach(function (r) { tbody.appendChild(tableRow(r, cols, cmp, opts, host)); });
    table.appendChild(tbody);

    if (opts.totals && Object.keys(opts.totals).length) {
      var tfoot = doc.createElement('tfoot');
      var ftr = doc.createElement('tr');
      if (opts.selectable !== false) ftr.appendChild(doc.createElement('td'));
      cols.forEach(function (c, ci) {
        var td = doc.createElement('td');
        var op = opts.totals[c.id];
        if (op) {
          td.className = 'is-num';
          var vals = rows.map(function (r) { return coerce(r.data[c.id], c); })
            .filter(function (v) { return typeof v === 'number'; });
          td.textContent = fmt.number(reduceOp(op, vals), c.format, c.decimals);
        } else if (ci === 0) {
          td.textContent = 'Total';
        }
        ftr.appendChild(td);
      });
      tfoot.appendChild(ftr);
      table.appendChild(tfoot);
    }

    tw.appendChild(table);
    wrap.appendChild(tw);

    if (!base.length) {
      wrap.appendChild(emptyBox('No rows yet',
        'Add the first row, or paste straight from Excel with Ctrl+V.',
        [btn('+ Add row', 'btn-primary', function () {
          crud.detail(blankRecord(cmp.dataset), cmp, true);
        }),
        btn('Paste from Excel', 'btn-secondary', function () {
          io.pasteDialog(cmp.dataset, io.visibleCols(cmp));
        })]));
    } else if (!rows.length) {
      wrap.appendChild(emptyBox('Nothing matches your filters',
        'Change the search term or clear the filter.',
        [btn('Clear filters', 'btn-secondary', function () {
          state.q = ''; state.quick = -1; state.page = 1;
          render.table(host, cmp);
        })]));
    }

    /* --- pagination --- */
    var pager = div('tb-pager');
    var info = doc.createElement('span');
    info.textContent = rows.length + ' ' + plural(rows.length, 'row', 'rows') +
      (rows.length !== base.length ? ' of ' + base.length : '') +
      ' · page ' + state.page + ' of ' + pages;
    pager.appendChild(info);
    if (pages > 1) {
      pager.appendChild(div('tb-spacer'));
      pager.appendChild(pgBtn('‹', state.page > 1, function () { state.page--; render.table(host, cmp); }));
      pageNumbers(state.page, pages).forEach(function (p) {
        if (p === '…') {
          var s = doc.createElement('span');
          s.textContent = '…';
          pager.appendChild(s);
          return;
        }
        var b = pgBtn(String(p), true, function () { state.page = p; render.table(host, cmp); });
        if (p === state.page) b.setAttribute('aria-current', 'page');
        pager.appendChild(b);
      });
      pager.appendChild(pgBtn('›', state.page < pages, function () { state.page++; render.table(host, cmp); }));
    }
    wrap.appendChild(pager);

    if (capped) {
      var warn = div('tb-banner tb-banner-warning');
      warn.innerHTML = '<i>⚠</i><div class="tb-banner-body"><div class="tb-banner-title">' +
        'Showing the first 500 rows</div><div class="tb-banner-text">' +
        'Narrow the filter or the search to see the rest. Export still covers every ' +
        'matching row.</div></div>';
      wrap.appendChild(warn);
    }

    host.appendChild(card(cmp.title, cmp.subtitle, wrap));
    lastView[cmp.id] = { rows: rows, cols: cols, pageRows: pageRows };
    menu.register(cmp);
  };

  function tableRow(rec, cols, cmp, opts, host) {
    var tr = doc.createElement('tr');
    tr.setAttribute('data-tb-row', rec.id);
    if (sel.has(cmp.id, rec.id)) tr.className = 'is-selected';

    if (opts.selectable !== false) {
      var td0 = doc.createElement('td');
      td0.className = 'tb-col-sel';
      var cb = doc.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'tb-check';
      cb.checked = sel.has(cmp.id, rec.id);
      cb.setAttribute('aria-label', 'Select row');
      cb.addEventListener('change', function () {
        sel.toggle(cmp.id, rec.id, cb.checked);
        render.table(host, cmp);
      });
      cb.addEventListener('click', function (e) { e.stopPropagation(); });
      td0.appendChild(cb);
      tr.appendChild(td0);
    }

    cols.forEach(function (c) {
      var td = doc.createElement('td');
      var raw = rec.data[c.id];
      var v = coerce(raw, c);
      if (c.type === 'number') td.className = 'is-num';
      if (c.type === 'longtext') td.className = 'is-clip';

      if (isBad(v)) {
        td.className += ' tb-cell-warn';
        td.title = 'This value does not match the column type (' + c.type + '). The original is kept.';
        td.textContent = String(raw);
      } else if (c.type === 'enum') {
        var o = optionOf(c, v);
        if (o) {
          var sp = doc.createElement('span');
          sp.className = 'tb-tag' + (o.tone ? ' tb-tag-' + o.tone : '');
          sp.textContent = o.label;
          td.appendChild(sp);
        } else {
          td.textContent = v == null ? '' : String(v);
        }
      } else if (c.type === 'bool') {
        var cb2 = doc.createElement('input');
        cb2.type = 'checkbox';
        cb2.className = 'tb-check';
        cb2.checked = !!v;
        cb2.disabled = opts.editable === false;
        cb2.setAttribute('aria-label', c.label);
        cb2.addEventListener('change', function () {
          rec.data[c.id] = cb2.checked;
          store.touch(rec);
        });
        td.appendChild(cb2);
      } else {
        td.textContent = fmt.cell(v, c);
      }

      if (opts.editable !== false && opts.inlineEdit !== false &&
          c.type !== 'bool' && c.type !== 'longtext') {
        td.addEventListener('dblclick', function () { editCell(td, rec, c); });
      }
      tr.appendChild(td);
    });

    if (opts.rowDetail !== false) {
      tr.classList.add('tb-row-click');
      tr.addEventListener('click', function (e) {
        if (e.target.closest('input,button,select,.tb-tag')) return;
        crud.detail(rec, cmp);
      });
    }
    return tr;
  }

  function editCell(td, rec, col) {
    if (td.querySelector('input,select')) return;
    var old = td.innerHTML;
    var v = coerce(rec.data[col.id], col);
    td.innerHTML = '';
    td.classList.add('tb-cell-edit');
    var input;
    if (col.type === 'enum') {
      input = doc.createElement('select');
      input.className = 'tb-select';
      var blank = doc.createElement('option');
      blank.value = '';
      blank.textContent = '—';
      input.appendChild(blank);
      (col.options || []).forEach(function (o) {
        var op = doc.createElement('option');
        op.value = o.value;
        op.textContent = o.label;
        input.appendChild(op);
      });
      input.value = isBad(v) ? '' : (v == null ? '' : v);
    } else {
      input = doc.createElement('input');
      input.className = 'tb-input';
      input.type = col.type === 'date' ? 'date' : 'text';
      if (col.type === 'number') input.inputMode = 'decimal';
      input.value = isBad(v) ? String(rec.data[col.id]) : (v == null ? '' : String(v));
    }
    input.setAttribute('aria-label', col.label);
    td.appendChild(input);
    input.focus();
    if (input.select) input.select();

    var done = false;
    function commit() {
      if (done) return;
      done = true;
      var nv = coerce(input.value, col);
      if (isBad(nv)) {
        TBUI.toast('“' + input.value + '” does not fit the ' + col.label + ' column', 'warning', 4000);
        td.classList.remove('tb-cell-edit');
        td.innerHTML = old;
        return;
      }
      rec.data[col.id] = input.value === '' ? null : nv;
      td.classList.remove('tb-cell-edit');
      store.touch(rec);
    }
    function cancel() {
      if (done) return;
      done = true;
      td.classList.remove('tb-cell-edit');
      td.innerHTML = old;
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
  }

  TB.render = render;

  /* ====================================================================== crud */

  var crud = {};

  function validateField(inp, col, fieldEl) {
    var val = col.type === 'bool' ? inp.checked : inp.value;
    var err = null;
    if (col.required && (val === '' || val == null)) err = 'This field is required.';
    else if (val !== '' && col.type !== 'bool') {
      var v = coerce(val, col);
      if (isBad(v)) {
        err = col.type === 'number' ? 'Enter a number, for example 1234.50.'
          : col.type === 'date' ? 'Pick a date from the calendar.'
          : 'That value does not fit this field.';
      }
    }
    var old = fieldEl ? fieldEl.querySelector('.tb-err') : null;
    if (old) old.remove();
    if (err) {
      inp.setAttribute('aria-invalid', 'true');
      if (fieldEl) {
        var e = div('tb-err');
        e.textContent = err;
        fieldEl.appendChild(e);
      }
      return false;
    }
    inp.removeAttribute('aria-invalid');
    return true;
  }

  function firstNotesComponent() {
    var found = null;
    CFG.tabs.forEach(function (t) {
      (t.components || []).forEach(function (c) { if (!found && c.type === 'notes') found = c; });
    });
    return found;
  }

  crud.detail = function (rec, cmp, isNew) {
    var ds = DS[rec.ds];
    if (!ds) return;
    var form = div('tb-stack');
    var inputs = {};

    ds.columns.forEach(function (c) {
      var f = div('tb-field');
      var lab = doc.createElement('label');
      lab.textContent = c.label + (c.required ? ' *' : '');
      lab.htmlFor = 'f_' + rec.id + '_' + c.id;
      f.appendChild(lab);
      var inp;
      if (c.type === 'enum') {
        inp = doc.createElement('select');
        inp.className = 'tb-select';
        var b = doc.createElement('option');
        b.value = '';
        b.textContent = '—';
        inp.appendChild(b);
        (c.options || []).forEach(function (o) {
          var op = doc.createElement('option');
          op.value = o.value;
          op.textContent = o.label;
          inp.appendChild(op);
        });
      } else if (c.type === 'longtext') {
        inp = doc.createElement('textarea');
        inp.className = 'tb-textarea';
      } else if (c.type === 'bool') {
        inp = doc.createElement('input');
        inp.type = 'checkbox';
        inp.className = 'tb-check';
      } else {
        inp = doc.createElement('input');
        inp.className = 'tb-input';
        inp.type = c.type === 'date' ? 'date' : 'text';
        if (c.type === 'number') inp.inputMode = 'decimal';
      }
      inp.id = 'f_' + rec.id + '_' + c.id;
      var v = coerce(rec.data[c.id], c);
      if (c.type === 'bool') inp.checked = !!v;
      else inp.value = isBad(v) ? String(rec.data[c.id]) : (v == null ? '' : String(v));
      // walidacja po opuszczeniu pola, nie w trakcie pisania
      inp.addEventListener('blur', function () { validateField(inp, c, f); });
      inp.addEventListener('input', function () {
        inp.removeAttribute('aria-invalid');
        var e = f.querySelector('.tb-err');
        if (e) e.remove();
      });
      inputs[c.id] = inp;
      f.appendChild(inp);
      form.appendChild(f);
    });

    var notesWrap = div('tb-stack');
    notesWrap.style.gap = '8px';
    var pinHead = div('tb-check-group');
    pinHead.textContent = 'Notes on this row';
    notesWrap.appendChild(pinHead);
    var pinBox = div('tb-notes');
    notesWrap.appendChild(pinBox);

    function renderPins() {
      pinBox.innerHTML = '';
      var found = [];
      Object.keys(data.byDs).forEach(function (dsId) {
        if (dsId.indexOf('c:') !== 0) return;
        liveRecords(dsId).forEach(function (n) {
          if (n.data.rowRef && n.data.rowRef.recordId === rec.id) found.push(n);
        });
      });
      found.forEach(function (n) { pinBox.appendChild(noteCard(n, true)); });
      if (!found.length) {
        var p = div('tb-muted');
        p.style.fontSize = '12.5px';
        p.textContent = 'No notes pinned to this row yet.';
        pinBox.appendChild(p);
      }
    }
    renderPins();
    notesWrap.appendChild(btn('+ Pin a note', 'btn-ghost', function () {
      var target = firstNotesComponent();
      if (!target) {
        TBUI.toast('Add a notes component in the wizard to pin notes to rows', 'warning', 5000);
        return;
      }
      store.putRecord({
        id: newId('r_'), ds: 'c:' + target.id,
        data: { text: '', color: 'c3', order: Date.now(), rowRef: { ds: rec.ds, recordId: rec.id } },
        _c: Date.now(), _m: Date.now(), _d: 0
      });
      renderPins();
    }));
    form.appendChild(notesWrap);

    var actions = [{ label: 'Close', variant: 'ghost' }];
    if (!isNew) {
      actions.unshift({
        label: 'Delete row', variant: 'secondary', close: false,
        onClick: function () {
          TBUI.confirm({
            title: 'Delete this row?',
            text: 'It disappears from the table and from every calculation. This affects 1 row.',
            confirmLabel: 'Delete row', tone: 'danger'
          }).then(function (ok) {
            if (!ok) return;
            store.softDelete(rec);
            TBUI.drawer.close();
          });
          return false;
        }
      });
    }
    actions.unshift({
      label: isNew ? 'Add row' : 'Save changes', variant: 'primary', close: false,
      onClick: function () {
        var bad = null;
        ds.columns.forEach(function (c) {
          var f = inputs[c.id].closest('.tb-field');
          if (!validateField(inputs[c.id], c, f) && !bad) bad = inputs[c.id];
        });
        if (bad) { bad.focus(); return false; }
        ds.columns.forEach(function (c) {
          var inp = inputs[c.id];
          if (c.type === 'bool') { rec.data[c.id] = inp.checked; return; }
          var nv = coerce(inp.value, c);
          rec.data[c.id] = inp.value === '' ? null : (isBad(nv) ? inp.value : nv);
        });
        store.putRecord(rec);
        TBUI.toast(isNew ? 'Row added' : 'Changes saved', 'success');
        TBUI.drawer.close();
        return false;
      }
    });

    TBUI.drawer.show({
      title: isNew ? 'New row — ' + ds.name : (rec.data[ds.titleField] || ds.name),
      sub: isNew ? null : 'Last changed ' + fmt.date(new Date(rec._m).toISOString().slice(0, 10)),
      body: form,
      actions: actions
    });
  };

  TB.crud = crud;

  /* ====================================================================== menu */

  var menu = (function () {
    var registered = {};

    function targetRecords(cmp, rec) {
      // Akcja z wiersza W ZAZNACZENIU dotyczy całego zaznaczenia.
      // Z wiersza poza zaznaczeniem — tylko tego wiersza.
      if (rec && sel.has(cmp.id, rec.id) && sel.count(cmp.id) > 1) {
        return sel.ids(cmp.id).map(function (id) { return data.index[id]; }).filter(Boolean);
      }
      return rec ? [rec] : [];
    }

    function applyAction(act, recs, cmp) {
      var ctx = ctxNow();
      var n = recs.length;
      function go() {
        recs.forEach(function (r) {
          switch (act.kind) {
            case 'setField': r.data[act.field] = resolveValue(act.value, ctx); break;
            case 'clearField': r.data[act.field] = null; break;
            case 'duplicate':
              store.putRecord({
                id: newId('r_'), ds: r.ds, data: JSON.parse(JSON.stringify(r.data)),
                _c: Date.now(), _m: Date.now(), _d: 0
              });
              return;
            case 'delete': store.softDelete(r); return;
            case 'moveTo': r.ds = act.dataset; break;
            default: break;
          }
          store.touch(r);
        });
        if (act.kind === 'delete') {
          TBUI.toast('Deleted ' + n + ' ' + plural(n, 'row', 'rows'), 'success');
          sel.clear(cmp.id);
        } else {
          TBUI.toast('Updated ' + n + ' ' + plural(n, 'row', 'rows'), 'success');
        }
      }
      if (act.confirm || act.kind === 'delete') {
        TBUI.confirm({
          title: act.kind === 'delete' ? 'Delete rows?' : act.label,
          text: 'This affects ' + n + ' ' + plural(n, 'row', 'rows') + '.',
          confirmLabel: act.kind === 'delete' ? 'Delete' : 'Apply',
          tone: act.kind === 'delete' ? 'danger' : ''
        }).then(function (ok) { if (ok) go(); });
      } else {
        go();
      }
    }

    function buildItems(cmp, rec) {
      var opts = cmp.opts || {};
      var cm = opts.contextMenu || {};
      var builtins = cm.builtins || ['edit', 'duplicate', 'delete', 'addNote', 'copyRow', 'exportSelected'];
      var recs = targetRecords(cmp, rec);
      var n = recs.length;
      var items = [];

      if (n > 1) items.push({ head: n + ' rows selected' });

      if (builtins.indexOf('edit') >= 0) {
        items.push({
          label: n > 1 ? 'Open first row' : 'Edit row', icon: '✎',
          onClick: function () { crud.detail(recs[0], cmp); }
        });
      }
      if (builtins.indexOf('duplicate') >= 0) {
        items.push({
          label: 'Duplicate', icon: '⧉',
          onClick: function () { applyAction({ kind: 'duplicate', label: 'Duplicate' }, recs, cmp); }
        });
      }
      if (builtins.indexOf('addNote') >= 0) {
        items.push({
          label: 'Add a note', icon: '🗒',
          onClick: function () { crud.detail(recs[0], cmp); }
        });
      }
      if (builtins.indexOf('copyRow') >= 0) {
        items.push({
          label: 'Copy as text', icon: '⎘', kbd: 'Ctrl+C',
          onClick: function () { io.copyRows(recs, cmp); }
        });
      }

      var custom = cm.actions || [];
      if (custom.length) {
        items.push({ sep: true });
        custom.forEach(function (a) {
          items.push({
            label: a.label, icon: a.icon || '•',
            onClick: function () { applyAction(a, recs, cmp); }
          });
        });
      }

      if (builtins.indexOf('exportSelected') >= 0) {
        items.push({ sep: true });
        items.push({
          label: 'Export selected to Excel', icon: '⤓',
          disabled: !sel.count(cmp.id),
          onClick: function () { io.exportXlsx(cmp, 'selected'); }
        });
      }
      if (builtins.indexOf('delete') >= 0) {
        items.push({ sep: true });
        items.push({
          label: n > 1 ? 'Delete ' + n + ' rows' : 'Delete row',
          icon: '🗑', danger: true,
          onClick: function () { applyAction({ kind: 'delete', label: 'Delete' }, recs, cmp); }
        });
      }
      return items;
    }

    function register(cmp) {
      var name = 'table:' + cmp.id;
      if (registered[name]) return;
      registered[name] = true;
      TBUI.menu.provider(name, function (e) {
        var tr = (e.target && e.target.closest) ? e.target.closest('[data-tb-row]') : null;
        var rec = tr ? data.index[tr.getAttribute('data-tb-row')] : null;
        if (!rec) return null;
        return buildItems(cmp, rec);
      });
    }

    return { register: register, applyAction: applyAction };
  })();

  /* ====================================================================== io */

  var io = (function () {

    function sheetOf(name, recs, cols) {
      return {
        name: name,
        columns: cols.map(function (c) {
          return { label: c.label, type: c.type, format: c.format };
        }),
        rows: recs.map(function (r) {
          return cols.map(function (c) {
            var v = coerce(r.data[c.id], c);
            if (isBad(v)) return String(r.data[c.id]);
            if (c.type === 'enum') {
              var o = optionOf(c, v);
              return o ? o.label : v;       // enum eksportuje się jako LABELKA
            }
            return v;
          });
        })
      };
    }

    function saveViaLink(blob, filename) {
      var url = URL.createObjectURL(blob);
      var a = doc.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    function download(blob, filename) {
      if (!global.showSaveFilePicker) { saveViaLink(blob, filename); return; }
      global.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'Excel workbook',
          accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
          }
        }]
      }).then(function (h) {
        return h.createWritable().then(function (w) {
          return blob.arrayBuffer().then(function (buf) {
            return w.write(buf).then(function () { return w.close(); });
          });
        });
      }).then(function () {
        TBUI.toast('Exported ' + filename, 'success');
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        saveViaLink(blob, filename);
      });
    }

    function baseName(scope) {
      return (CFG.meta.name || 'tracker').replace(/[^\w\-. ]+/g, '_') + '-' + scope + '-' + fmt.todayISO();
    }

    function exportXlsx(cmp, scope) {
      TBXlsx.setCurrency(currency());
      var view = cmp ? lastView[cmp.id] : null;
      var sheets;

      if (scope === 'all') {
        sheets = CFG.datasets.map(function (d) {
          return sheetOf(d.name, liveRecords(d.id), d.columns);
        });
        var notes = [], checks = [];
        Object.keys(data.byDs).forEach(function (dsId) {
          if (dsId.indexOf('c:') !== 0) return;
          liveRecords(dsId).forEach(function (r) {
            if ('done' in r.data) checks.push(r); else notes.push(r);
          });
        });
        if (notes.length) {
          sheets.push({
            name: 'Notes',
            columns: [{ label: 'Text', type: 'text' }, { label: 'Colour', type: 'text' },
              { label: 'Pinned to', type: 'text' }],
            rows: notes.map(function (r) {
              return [r.data.text || '', r.data.color || '',
                r.data.rowRef ? r.data.rowRef.recordId : ''];
            })
          });
        }
        if (checks.length) {
          sheets.push({
            name: 'Checklists',
            columns: [{ label: 'Item', type: 'text' }, { label: 'Done', type: 'bool' },
              { label: 'Group', type: 'text' }, { label: 'Due', type: 'date' }],
            rows: checks.map(function (r) {
              return [r.data.text || '', !!r.data.done, r.data.group || '', r.data.due || null];
            })
          });
        }
      } else {
        var ds = DS[cmp.dataset];
        var cols = view && view.cols ? view.cols : (ds ? ds.columns : []);
        var recs;
        if (scope === 'selected') {
          recs = sel.ids(cmp.id).map(function (id) { return data.index[id]; }).filter(Boolean);
          if (!recs.length) { TBUI.toast('Nothing is selected', 'warning'); return; }
        } else if (scope === 'view') {
          recs = (view && view.rows) || [];
        } else {
          recs = liveRecords(cmp.dataset);
        }
        sheets = [sheetOf(cmp.title || (ds ? ds.name : 'Data'), recs, cols)];
      }

      var label = { selected: 'selected', view: 'view', dataset: 'dataset', all: 'everything' }[scope];
      download(TBXlsx.build(sheets), baseName(label) + '.xlsx');
    }

    function exportMenu(e, cmp) {
      var view = lastView[cmp.id] || { rows: [] };
      var r = e.currentTarget.getBoundingClientRect();
      TBUI.menu.open(r.left, r.bottom + 4, [
        { head: 'Export to Excel' },
        {
          label: 'Selected rows (' + sel.count(cmp.id) + ')', icon: '☑',
          disabled: !sel.count(cmp.id),
          onClick: function () { exportXlsx(cmp, 'selected'); }
        },
        {
          label: 'Current view (' + view.rows.length + ')', icon: '▤',
          onClick: function () { exportXlsx(cmp, 'view'); }
        },
        {
          label: 'Whole dataset (' + liveRecords(cmp.dataset).length + ')', icon: '▦',
          onClick: function () { exportXlsx(cmp, 'dataset'); }
        },
        { sep: true },
        {
          label: 'Everything — one sheet per dataset', icon: '🗂',
          onClick: function () { exportXlsx(cmp, 'all'); }
        },
        { sep: true },
        { label: 'Data backup as JSON', icon: '{ }', onClick: exportJson }
      ]);
    }

    function exportJson() {
      saveViaLink(new Blob([JSON.stringify(store.dataFileObject(), null, 2)],
        { type: 'application/json' }), baseName('backup') + '.json');
      TBUI.toast('JSON backup saved', 'success');
    }

    function copyRows(recs, cmp) {
      var ds = DS[cmp.dataset];
      var cols = ((cmp.opts && cmp.opts.columns && cmp.opts.columns.length)
        ? cmp.opts.columns.map(function (id) { return column(cmp.dataset, id); })
        : ds.columns).filter(Boolean);
      var text = [cols.map(function (c) { return c.label; }).join('\t')]
        .concat(recs.map(function (r) {
          return cols.map(function (c) { return fmt.cell(coerce(r.data[c.id], c), c); }).join('\t');
        })).join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          TBUI.toast('Copied ' + recs.length + ' ' + plural(recs.length, 'row', 'rows'), 'success');
        });
      }
    }

    function parseDelimited(text, delim) { return TBParse.delimited(text, delim); }

    function findCmp(id) {
      var hit = null;
      CFG.tabs.forEach(function (tab) {
        (tab.components || []).forEach(function (c) { if (c.id === id) hit = c; });
      });
      return hit;
    }

    function visibleCols(cmp) {
      var ds = DS[cmp.dataset];
      var ids = (cmp.opts && cmp.opts.columns && cmp.opts.columns.length)
        ? cmp.opts.columns : ds.columns.map(function (c) { return c.id; });
      return ids.filter(function (id) { return column(cmp.dataset, id); });
    }

    /* Wklejka ze schowka Excela. Zawsze tabulator — Excel innego separatora
       nie daje, a zgadywanie rozcięłoby jednokolumnowe „Smith, John”. */
    function pasteRows(cmp, text) {
      var rows = parseDelimited(text, '\t');
      if (!rows.length) {
        TBUI.toast('There is nothing to paste', 'warning');
        return;
      }
      importDialog(cmp.dataset, rows, visibleCols(cmp));
    }

    /* colOrder: kolumny tabeli, w którą wklejono. Gdy pierwszy wiersz nie
       wygląda na nagłówek (żadna komórka nie jest nazwą kolumny), to są dane
       — dopasowujemy wtedy po pozycji, tak jak leżą kolumny w tabeli. */
    function importDialog(dsId, rows, colOrder) {
      var ds = DS[dsId];
      if (!ds || !rows.length) return;
      function byLabel(h) {
        var k = String(h).toLowerCase().trim();
        return ds.columns.filter(function (c) {
          return String(c.label).toLowerCase().trim() === k;
        })[0] || null;
      }
      var hasHeader = rows[0].some(function (h) { return !!byLabel(h); }) || !colOrder;
      var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      var header = [];
      for (var hi = 0; hi < width; hi++) {
        header.push(hasHeader ? (rows[0][hi] == null ? '' : rows[0][hi]) : 'Column ' + (hi + 1));
      }
      var bodyRows = hasHeader ? rows.slice(1) : rows;
      if (!bodyRows.length) {
        TBUI.toast('That is only a header row — copy some rows under it too', 'warning');
        return;
      }

      var wrap = div('tb-stack');
      var info = div('tb-banner tb-banner-accent');
      info.innerHTML = '<i>↓</i><div class="tb-banner-body"><div class="tb-banner-title">' +
        bodyRows.length + ' ' + plural(bodyRows.length, 'row', 'rows') + ' ready to import</div>' +
        '<div class="tb-banner-text">' + (hasHeader
          ? 'Match the columns from your file to the columns of “' + fmt.esc(ds.name) + '”. '
          : 'There is no header row, so columns are matched by position. Check them below. ') +
        'Anything left on “skip” is ignored.</div></div>';
      wrap.appendChild(info);

      var selects = [];
      header.forEach(function (h, hi) {
        var f = div('tb-field');
        var lab = doc.createElement('label');
        var sample = '';
        for (var si = 0; si < bodyRows.length && !sample; si++) {
          sample = String(bodyRows[si][hi] == null ? '' : bodyRows[si][hi]).trim();
        }
        lab.textContent = (hasHeader ? 'File column: “' + h + '”' : h) +
          (sample ? ' — e.g. “' + (sample.length > 40 ? sample.slice(0, 40) + '…' : sample) + '”' : '');
        f.appendChild(lab);
        var s = doc.createElement('select');
        s.className = 'tb-select';
        var skip = doc.createElement('option');
        skip.value = '';
        skip.textContent = '— skip —';
        s.appendChild(skip);
        ds.columns.forEach(function (c) {
          var o = doc.createElement('option');
          o.value = c.id;
          o.textContent = c.label + ' (' + c.type + ')';
          s.appendChild(o);
        });
        var guess = hasHeader ? byLabel(h) : (colOrder[hi] ? column(dsId, colOrder[hi]) : null);
        if (guess) s.value = guess.id;
        selects.push(s);
        f.appendChild(s);
        wrap.appendChild(f);
      });

      TBUI.modal.show({
        size: 'lg', title: 'Import rows', sub: 'Column mapping', body: wrap,
        actions: [
          { label: 'Cancel', variant: 'ghost' },
          {
            label: 'Import ' + bodyRows.length + ' rows', variant: 'primary', close: false,
            onClick: function () {
              var map = selects.map(function (s) { return s.value; });
              if (!map.some(Boolean)) {
                TBUI.toast('Match at least one column first', 'warning');
                return false;
              }
              var added = 0, warn = 0;
              bodyRows.forEach(function (r) {
                var rec = blankRecord(dsId);
                map.forEach(function (colId, i) {
                  if (!colId) return;
                  var c = column(dsId, colId);
                  var v = coerce(r[i], c);
                  if (isBad(v)) { warn++; rec.data[colId] = r[i]; }
                  else if (v != null) rec.data[colId] = v;
                });
                store.putRecord(rec);
                added++;
              });
              TBUI.toast('Imported ' + added + ' rows' +
                (warn ? ', ' + warn + ' values did not match their column type' : ''),
                warn ? 'warning' : 'success', 5000);
              TBUI.modal.close(wrap.closest('dialog'));
              return false;
            }
          }
        ]
      });
    }

    function pasteDialog(dsId, colOrder) {
      var ta = doc.createElement('textarea');
      ta.className = 'tb-textarea';
      ta.style.minHeight = '160px';
      ta.placeholder = 'Select a range in Excel, copy it (Ctrl+C) and paste here (Ctrl+V).\n' +
        'With a header row, columns are matched by name; without one, by position.';
      ta.setAttribute('aria-label', 'Paste data from Excel');
      var wrap = div('tb-stack');
      wrap.appendChild(ta);

      TBUI.modal.show({
        size: 'lg', title: 'Paste from Excel',
        sub: 'Rows go into “' + (DS[dsId] ? DS[dsId].name : '') + '”',
        body: wrap,
        onOpen: function () { setTimeout(function () { ta.focus(); }, 50); },
        actions: [
          { label: 'Cancel', variant: 'ghost' },
          {
            label: 'Next — match columns', variant: 'primary', close: false,
            onClick: function () {
              var rows = parseDelimited(ta.value, '\t');
              if (!rows.length) {
                TBUI.toast('There is nothing to import', 'warning');
                return false;
              }
              TBUI.modal.close(wrap.closest('dialog'));
              setTimeout(function () { importDialog(dsId, rows, colOrder); }, 60);
              return false;
            }
          }
        ]
      });
    }

    function importJsonFile(file) {
      file.text().then(function (t) {
        var obj = JSON.parse(t);
        if (!obj || !obj.records) {
          TBUI.toast('That is not a tracker data file', 'danger');
          return;
        }
        TBUI.confirm({
          title: 'Load data from this file?',
          text: 'Everything currently in the browser is replaced by ' + obj.records.length +
            ' records from the file.',
          confirmLabel: 'Replace data'
        }).then(function (ok) {
          if (!ok) return;
          store.replaceAll(obj.records).then(function () {
            TB.shell.renderActive(true);
            TBUI.toast('Data loaded from file', 'success');
          });
        });
      });
    }

    return {
      exportXlsx: exportXlsx, exportMenu: exportMenu, exportJson: exportJson,
      copyRows: copyRows, parseDelimited: parseDelimited, pasteRows: pasteRows,
      findCmp: findCmp, visibleCols: visibleCols,
      pasteDialog: pasteDialog, importJsonFile: importJsonFile, importDialog: importDialog
    };
  })();

  TB.io = io;

  /* ====================================================================== shell */

  var shell = (function () {
    var activeTab = null;
    var staleTabs = {};
    var renderedTabs = {};
    var dirtyDatasets = {};
    var rafId = null;
    var cmpHost = {};
    var cmpTab = {};
    var depsByDs = {};

    function noop() {}

    function componentDatasets(cmp) {
      var out = [];
      if (cmp.dataset) out.push(cmp.dataset);
      if (cmp.type === 'notes' || cmp.type === 'checklist') out.push('c:' + cmp.id);
      if (cmp.type === 'agenda') {
        ((cmp.opts || {}).sources || []).forEach(function (s) { if (s.dataset) out.push(s.dataset); });
      }
      if (cmp.type === 'table') {
        CFG.tabs.forEach(function (t) {
          (t.components || []).forEach(function (c) {
            if (c.type === 'notes') out.push('c:' + c.id);
          });
        });
      }
      return out;
    }

    function build() {
      var nav = doc.getElementById('tb-nav');
      var panels = doc.getElementById('tb-panels');
      nav.innerHTML = '';
      panels.innerHTML = '';
      doc.getElementById('tb-brand-name').textContent = CFG.meta.name || 'Tracker';
      doc.title = CFG.meta.name || 'Tracker';

      CFG.tabs.forEach(function (tab, ti) {
        var a = doc.createElement('a');
        a.href = '#' + tab.id;
        a.setAttribute('data-tb-tab', 'panel-' + tab.id);
        if (ti === 0) a.className = 'is-active';
        a.innerHTML = '<i>' + fmt.esc(tab.icon || '▦') + '</i>' + fmt.esc(tab.label || 'Tab');
        nav.appendChild(a);

        var panel = doc.createElement('section');
        panel.id = 'panel-' + tab.id;
        panel.className = 'tb-stack';
        if (ti !== 0) panel.hidden = true;

        var cols = Math.min(3, Math.max(1, (tab.layout && tab.layout.cols) || 1));
        var variant = (tab.layout && tab.layout.variant) || 'even';
        var comps = (tab.components || []).slice().sort(function (a2, b2) {
          return (a2.order || 0) - (b2.order || 0);
        });

        var fullRow = doc.createElement('div');
        fullRow.className = 'tb-stack';
        var grid = doc.createElement('div');
        grid.className = 'tb-grid ' + (cols === 1 ? 'tb-grid-1'
          : cols === 2 ? (variant === 'main' ? 'tb-grid-main' : 'tb-grid-2') : 'tb-grid-3');
        var colEls = [];
        for (var i = 0; i < cols; i++) {
          var ce = doc.createElement('div');
          ce.className = 'tb-stack';
          grid.appendChild(ce);
          colEls.push(ce);
        }

        comps.forEach(function (cmp) {
          var holder = doc.createElement('div');
          holder.setAttribute('data-tb-cmp', cmp.id);
          holder.style.minWidth = '0';
          cmpHost[cmp.id] = holder;
          cmpTab[cmp.id] = tab.id;
          componentDatasets(cmp).forEach(function (dsId) {
            if (!depsByDs[dsId]) depsByDs[dsId] = [];
            if (depsByDs[dsId].indexOf(cmp.id) < 0) depsByDs[dsId].push(cmp.id);
          });
          if (cmp.span === 'full' || cols === 1) fullRow.appendChild(holder);
          else colEls[Math.min(cols - 1, cmp.col || 0)].appendChild(holder);
        });

        if (fullRow.children.length) panel.appendChild(fullRow);
        if (cols > 1 && comps.some(function (c) { return c.span !== 'full'; })) panel.appendChild(grid);
        if (!comps.length) {
          panel.appendChild(emptyBox('This tab is empty',
            'Go back to the wizard and add components to it.'));
        }
        panels.appendChild(panel);
      });

      activeTab = CFG.tabs.length ? CFG.tabs[0].id : null;
      buildHeadActions();
      renderProfile();
    }

    /* ---- profil ---- */

    function renderProfile() {
      var foot = doc.getElementById('tb-side-foot');
      if (!foot) return;
      foot.innerHTML = '';
      if (CFG.meta.personalization === false) return;
      var p = profile.get();
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'tb-profile';
      b.id = 'tb-profile-btn';
      b.setAttribute('aria-label', 'Your profile');
      b.appendChild(profile.avatar());
      var body = div('tb-profile-body');
      var nm = doc.createElement('span');
      nm.className = 'tb-profile-name';
      nm.textContent = p.name || 'Set up your profile';
      var tm = doc.createElement('span');
      tm.className = 'tb-profile-team';
      tm.textContent = p.team || 'No team set';
      body.appendChild(nm);
      body.appendChild(tm);
      b.appendChild(body);
      b.addEventListener('click', profileDialog);
      foot.appendChild(b);
    }

    function profileDialog() {
      var p = profile.get();
      var draft = { name: p.name, team: p.team, color: p.color, photo: p.photo };

      var wrap = div('tb-stack');
      var top = div('tb-profile-edit');
      var preview = div('');
      function drawPreview() {
        preview.innerHTML = '';
        var saved = { name: p.name, team: p.team, color: p.color, photo: p.photo };
        profile.set(draft);
        preview.appendChild(profile.avatar('tb-avatar-lg'));
        profile.set(saved);
      }
      drawPreview();
      top.appendChild(preview);

      var photoBox = div('tb-stack');
      photoBox.style.gap = '6px';
      photoBox.appendChild(btn('Upload a photo', 'btn-secondary', function () {
        var inp = doc.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.addEventListener('change', function () {
          if (!inp.files[0]) return;
          profile.readPhoto(inp.files[0]).then(function (dataUrl) {
            draft.photo = dataUrl;
            drawPreview();
            TBUI.toast('Photo added', 'success');
          }).catch(function (err) {
            TBUI.toast(err.message, 'danger', 5000);
          });
        });
        inp.click();
      }));
      photoBox.appendChild(btn('Remove photo', 'btn-ghost', function () {
        draft.photo = null;
        drawPreview();
      }));
      var hint = div('tb-muted');
      hint.style.fontSize = '11.5px';
      hint.textContent = 'Photos are cropped square and shrunk to 96×96, so the data file stays small.';
      photoBox.appendChild(hint);
      top.appendChild(photoBox);
      wrap.appendChild(top);

      function field(labelText, control) {
        var f = div('tb-field');
        var l = doc.createElement('label');
        l.textContent = labelText;
        var id = 'pf' + Math.random().toString(36).slice(2, 7);
        control.id = id;
        l.htmlFor = id;
        f.appendChild(l);
        f.appendChild(control);
        return f;
      }
      var nameI = doc.createElement('input');
      nameI.className = 'tb-input';
      nameI.value = draft.name;
      nameI.placeholder = 'e.g. Anna Kowalska';
      nameI.addEventListener('input', function () { draft.name = nameI.value; drawPreview(); });
      wrap.appendChild(field('Your name', nameI));

      var teamI = doc.createElement('input');
      teamI.className = 'tb-input';
      teamI.value = draft.team;
      teamI.placeholder = 'e.g. Operations';
      teamI.addEventListener('input', function () { draft.team = teamI.value; });
      wrap.appendChild(field('Team', teamI));

      var colors = div('tb-colors');
      ['c1', 'c2', 'c3', 'c4', 'c5'].forEach(function (c) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.style.background = 'var(--' + c + ')';
        b.setAttribute('aria-label', 'Avatar colour ' + c);
        b.setAttribute('aria-pressed', draft.color === c ? 'true' : 'false');
        b.addEventListener('click', function () {
          draft.color = c;
          var all = colors.querySelectorAll('button');
          for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', 'false');
          b.setAttribute('aria-pressed', 'true');
          drawPreview();
        });
        colors.appendChild(b);
      });
      var cf = div('tb-field');
      var cl = doc.createElement('label');
      cl.textContent = 'Avatar colour';
      cf.appendChild(cl);
      cf.appendChild(colors);
      wrap.appendChild(cf);

      TBUI.modal.show({
        size: 'sm', title: 'Your profile',
        sub: 'Used by the “assign to me” action and shown in the sidebar',
        body: wrap,
        actions: [
          { label: 'Cancel', variant: 'ghost' },
          {
            label: 'Save profile', variant: 'primary',
            onClick: function () {
              profile.save(draft);
              TBUI.toast('Profile saved', 'success');
            }
          }
        ]
      });
    }

    /* ---- topbar ---- */

    function buildHeadActions() {
      var box = doc.getElementById('tb-head-actions');
      box.innerHTML = '';

      if ((CFG.alerts || []).length) {
        var bell = doc.createElement('button');
        bell.type = 'button';
        bell.className = 'tb-bell';
        bell.id = 'tb-bell';
        bell.setAttribute('aria-label', 'Alerts');
        bell.textContent = '🔔';
        bell.addEventListener('click', openAlerts);
        box.appendChild(bell);
      }

      var save = doc.createElement('span');
      save.className = 'tb-save';
      save.id = 'tb-save';
      box.appendChild(save);
      store.setSaveState(store.state());

      var saveBtn = btn('Save', 'btn-primary', function () {
        if (store.mode() !== 'auto') {
          if (!store.handle()) { store.pickFile().catch(noop); return; }
          store.reconnect().then(function (ok) { if (ok) store.saveNow(); });
          return;
        }
        store.saveNow().then(function () { TBUI.toast('Saved', 'success'); });
      });
      saveBtn.title = 'Save now (Ctrl+S)';
      box.appendChild(saveBtn);

      var more = btn('⋯', 'btn-secondary', function (e) {
        var r = e.currentTarget.getBoundingClientRect();
        var items = [
          { head: 'Data' },
          {
            label: 'Export everything to Excel', icon: '🗂',
            onClick: function () { io.exportXlsx(null, 'all'); }
          },
          { label: 'Save a JSON backup', icon: '{ }', onClick: io.exportJson },
          { label: 'Load data from a JSON file…', icon: '↥', onClick: pickJson },
          { sep: true },
          { head: 'Data file' }
        ];
        if (store.mode() === 'auto') {
          items.push({
            label: 'Save now', icon: '💾', kbd: 'Ctrl+S',
            onClick: function () { store.saveNow(); }
          });
          items.push({
            label: 'Link a different file…', icon: '📄',
            onClick: function () { store.pickFile().catch(noop); }
          });
        } else {
          items.push({
            label: 'Link a data file…', icon: '🔗',
            onClick: function () { store.pickFile().catch(noop); }
          });
        }
        if (CFG.meta.personalization !== false) {
          items.push({ sep: true });
          items.push({ label: 'Your profile…', icon: '👤', onClick: profileDialog });
        }
        TBUI.menu.open(r.left, r.bottom + 4, items);
      });
      more.setAttribute('aria-label', 'More options');
      box.appendChild(more);
    }

    function pickJson() {
      var inp = doc.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.addEventListener('change', function () {
        if (inp.files[0]) io.importJsonFile(inp.files[0]);
      });
      inp.click();
    }

    /* ---- alerty ---- */

    function refreshAlerts() {
      var bell = doc.getElementById('tb-bell');
      if (!bell) return;
      var list = alerts.active();
      var old = bell.querySelector('.tb-bell-count');
      if (old) old.remove();
      if (!list.length) {
        bell.removeAttribute('data-tone');
        bell.title = 'No alerts';
        return;
      }
      bell.setAttribute('data-tone', alerts.worstTone(list));
      bell.title = list.length + ' ' + plural(list.length, 'alert', 'alerts');
      var c = doc.createElement('span');
      c.className = 'tb-bell-count';
      c.textContent = list.length;
      bell.appendChild(c);
    }

    function openAlerts(e) {
      var list = alerts.active();
      var r = e.currentTarget.getBoundingClientRect();
      var x = Math.max(8, r.right - 260);
      if (!list.length) {
        TBUI.menu.open(x, r.bottom + 4, [
          { head: 'Alerts' },
          { label: 'Nothing needs your attention', icon: '✓', disabled: true }
        ]);
        return;
      }
      var items = [{ head: list.length + ' ' + plural(list.length, 'alert', 'alerts') }];
      list.forEach(function (a) {
        items.push({
          label: a.label, icon: '●',
          onClick: function () {
            if (!a.goToTab) return;
            var trigger = doc.querySelector('[data-tb-tab="panel-' + a.goToTab + '"]');
            if (trigger) TBUI.tabs.activate(trigger);
          }
        });
        items.push({ head: a.text });
      });
      TBUI.menu.open(x, r.bottom + 4, items);
    }

    /* ---- powiadomienia nad treścią ---- */

    function renderNotices() {
      var box = doc.getElementById('tb-notices');
      if (!box) return;
      box.innerHTML = '';
      if (PREVIEW) {
        var p = div('tb-banner tb-banner-accent');
        p.innerHTML = '<i>👁</i><div class="tb-banner-body"><div class="tb-banner-title">Preview</div>' +
          '<div class="tb-banner-text">Sample data, nothing is saved.</div></div>';
        box.appendChild(p);
        return;
      }
      var sn = store.structureNote();
      if (sn) {
        var sb = div('tb-banner tb-banner-accent');
        var txt;
        if (sn.older) {
          txt = 'You opened an older structure (' + sn.to + ' instead of ' + sn.from +
            '). Your data is safe, but some columns or tabs may not show up.';
        } else {
          var parts = [];
          if (sn.added) parts.push('+' + sn.added + ' columns');
          if (sn.removed) parts.push('-' + sn.removed + ' columns (data kept)');
          if (sn.tabs > 0) parts.push('+' + sn.tabs + ' tabs');
          if (sn.tabs < 0) parts.push(sn.tabs + ' tabs');
          txt = 'Structure updated to version ' + sn.to +
            (parts.length ? ': ' + parts.join(', ') + '.' : '.') + ' Your rows were left untouched.';
        }
        sb.innerHTML = '<i>↻</i><div class="tb-banner-body">' +
          '<div class="tb-banner-title">The tracker structure changed</div>' +
          '<div class="tb-banner-text">' + fmt.esc(txt) + '</div></div>';
        box.appendChild(sb);
      }

      var mode = store.mode();
      if (mode === 'auto' && !store.remembered()) {
        var nr = div('tb-banner tb-banner-warning');
        nr.innerHTML = '<i>⚠</i><div class="tb-banner-body">' +
          '<div class="tb-banner-title">Saving works, but the file was not remembered</div>' +
          '<div class="tb-banner-text">The browser would not store the link to your file. ' +
          'Data is being written normally, but you will have to pick the file again next time.' +
          '</div></div>';
        box.appendChild(nr);
      }
      if (mode === 'prompt') {
        var b = div('tb-banner tb-banner-warning');
        b.innerHTML = '<i>🔗</i><div class="tb-banner-body">' +
          '<div class="tb-banner-title">Reconnect to your data file</div>' +
          '<div class="tb-banner-text">Browsers ask for this once per session. ' +
          'Remembered file: <b>' + fmt.esc(store.fileName()) + '</b></div></div>';
        var act = div('tb-banner-actions');
        act.appendChild(btn('Reconnect', 'btn-primary', function () {
          store.reconnect().then(function (ok) {
            if (ok) TBUI.toast('Connected — changes save automatically', 'success');
            else TBUI.toast('Without file access your changes stay in the browser only', 'warning', 6000);
          });
        }));
        b.appendChild(act);
        box.appendChild(b);
      } else if (mode === 'none' || mode === 'denied') {
        var c = div('tb-banner tb-banner-warning');
        c.innerHTML = '<i>⚠</i><div class="tb-banner-body">' +
          '<div class="tb-banner-title">Your data is not being written to a file</div>' +
          '<div class="tb-banner-text">Changes live in the browser for now. Pick a .json file so the ' +
          'tracker writes them to disk — and once you do, keep tracker.html where it is and ' +
          'under the same name.</div></div>';
        var act2 = div('tb-banner-actions');
        act2.appendChild(btn('Choose a data file', 'btn-primary', function () {
          store.pickFile().catch(noop);
        }));
        c.appendChild(act2);
        box.appendChild(c);
      }
    }

    function conflict(file) {
      var box = doc.getElementById('tb-notices');
      var b = div('tb-banner tb-banner-danger');
      b.innerHTML = '<i>⚠</i><div class="tb-banner-body">' +
        '<div class="tb-banner-title">The data file is newer than the browser copy</div>' +
        '<div class="tb-banner-text">It changed outside this tab on ' +
        fmt.date(new Date(file.lastModified).toISOString().slice(0, 10)) +
        '. Pick which version wins — nothing is overwritten on its own.</div></div>';
      var act = div('tb-banner-actions');
      act.appendChild(btn('Load from file', 'btn-primary', function () {
        store.loadFileNow().then(function () { TBUI.toast('Loaded from file', 'success'); });
      }));
      act.appendChild(btn('Keep browser copy', 'btn-secondary', function () {
        store.keepLocal().then(function () { TBUI.toast('File overwritten with the browser copy', 'success'); });
      }));
      act.appendChild(btn('Download both', 'btn-ghost', function () {
        io.exportJson();
        file.text().then(function (t) {
          var url = URL.createObjectURL(new Blob([t], { type: 'application/json' }));
          var a = doc.createElement('a');
          a.href = url;
          a.download = 'from-file-' + fmt.todayISO() + '.json';
          a.click();
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        });
      }));
      b.appendChild(act);
      box.appendChild(b);
      store.setSaveState('dirty');
    }

    /* ---- renderowanie ---- */

    function findComponent(cmpId) {
      var found = null;
      CFG.tabs.forEach(function (t) {
        (t.components || []).forEach(function (c) { if (c.id === cmpId) found = c; });
      });
      return found;
    }

    function renderComponent(cmp) {
      var host = cmpHost[cmp.id];
      if (!host) return;
      var fn = render[cmp.type];
      if (!fn) {
        host.innerHTML = '';
        host.appendChild(emptyBox('Unknown component type: ' + cmp.type, ''));
        return;
      }
      try {
        fn(host, cmp);
      } catch (err) {
        host.innerHTML = '';
        host.appendChild(emptyBox('Could not render “' + (cmp.title || cmp.type) + '”', err.message));
        if (global.console) console.error('[TB] render', cmp.type, cmp.id, err);
      }
    }

    function componentsOfTab(tabId) {
      var out = [];
      CFG.tabs.forEach(function (t) {
        if (t.id !== tabId) return;
        (t.components || []).forEach(function (c) { out.push(c); });
      });
      return out;
    }

    function renderActive(force) {
      if (!activeTab) return;
      // Zakładka nigdy niepokazana MUSI się wyrenderować, nawet bez flagi stale.
      if (!force && renderedTabs[activeTab] && !staleTabs[activeTab]) return;
      componentsOfTab(activeTab).forEach(renderComponent);
      renderedTabs[activeTab] = 1;
      delete staleTabs[activeTab];
      refreshAlerts();
    }

    /* Mutacja oznacza zbiór jako brudny; przeliczenie leci raz na rAF
       i dotyczy TYLKO komponentów aktywnej zakładki. */
    function invalidate(dsId) {
      dirtyDatasets[dsId] = 1;
      if (rafId) return;
      rafId = requestAnimationFrame(function () {
        rafId = null;
        var touched = {};
        Object.keys(dirtyDatasets).forEach(function (ds) {
          (depsByDs[ds] || []).forEach(function (cmpId) { touched[cmpId] = 1; });
        });
        dirtyDatasets = {};
        Object.keys(touched).forEach(function (cmpId) {
          if (cmpTab[cmpId] === activeTab) {
            var cmp = findComponent(cmpId);
            if (cmp) renderComponent(cmp);
          } else {
            staleTabs[cmpTab[cmpId]] = 1;
          }
        });
        refreshAlerts();
      });
    }

    function onTabChange(e) {
      var tabId = String(e.detail.id || '').replace(/^panel-/, '');
      activeTab = tabId;
      var tab = CFG.tabs.filter(function (t) { return t.id === tabId; })[0];
      doc.getElementById('tb-title').textContent = tab ? (tab.label || '') : '';
      renderActive(false);
    }

    function init() {
      build();
      doc.addEventListener('tb:tabchange', onTabChange);
      TBUI.init(doc);
      var first = CFG.tabs[0];
      doc.getElementById('tb-title').textContent = first ? (first.label || '') : '';
      renderActive(true);
      renderNotices();

      doc.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
        e.preventDefault();
        if (store.mode() === 'auto') {
          store.saveNow().then(function () { TBUI.toast('Saved', 'success'); });
        } else if (store.handle()) {
          store.reconnect().then(function (ok) { if (ok) store.saveNow(); });
        } else {
          store.pickFile().catch(noop);
        }
      });

      /* Ctrl+V na zakładce z tabelą: wklejka z Excela idzie prosto do
         dopasowania kolumn. Nie przejmujemy wklejania w polach edycji ani przy
         otwartym oknie — tam Ctrl+V ma wkleić tekst, jak zawsze. */
      var lastTable = null;
      doc.addEventListener('pointerdown', function (e) {
        var tb = e.target && e.target.closest && e.target.closest('[data-tb-ctx^="table:"]');
        if (tb) lastTable = tb.getAttribute('data-tb-ctx').slice(6);
      }, true);
      doc.addEventListener('paste', function (e) {
        var t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
        if (doc.querySelector('dialog[open]')) return;
        var text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
        if (!text || !text.trim()) return;
        var panel = doc.querySelector('#tb-panels > section:not([hidden])');
        if (!panel) return;
        var ids = Array.prototype.map.call(panel.querySelectorAll('[data-tb-ctx^="table:"]'),
          function (el) { return el.getAttribute('data-tb-ctx').slice(6); });
        /* ostatnio klikana tabela, jeśli jest na tej zakładce; inaczej pierwsza,
           do której wolno dopisywać */
        var pick = ids.indexOf(lastTable) >= 0 ? [lastTable] : ids;
        var cmp = null;
        pick.some(function (id) {
          var c = io.findCmp(id);
          var o = (c && c.opts) || {};
          if (c && DS[c.dataset] && o.allowAdd !== false && o.editable !== false) { cmp = c; return true; }
          return false;
        });
        if (!cmp) return;
        e.preventDefault();
        io.pasteRows(cmp, text);
      });

      doc.addEventListener('visibilitychange', function () {
        if (doc.visibilityState === 'hidden' && store.mode() === 'auto') store.saveNow();
      });
      global.addEventListener('beforeunload', function (e) {
        var s = doc.getElementById('tb-save');
        if (s && s.getAttribute('data-state') === 'dirty') {
          e.preventDefault();
          e.returnValue = '';
        }
      });
    }

    return {
      init: init, invalidate: invalidate, renderActive: renderActive,
      renderNotices: renderNotices, renderProfile: renderProfile,
      conflict: conflict, refreshAlerts: refreshAlerts,
      activeTab: function () { return activeTab; }
    };
  })();

  TB.shell = shell;

  /* ====================================================================== boot */

  function gate(message) {
    var g = doc.createElement('div');
    g.className = 'tb-gate';
    g.innerHTML = '<h1>This tracker runs in Chrome and Edge</h1><p>' + fmt.esc(message) + '</p>';
    doc.body.appendChild(g);
  }

  function boot() {
    try {
      CFG = parseConfig();
    } catch (e) {
      gate(e.message);
      return;
    }
    TBCharts.config.locale = CFG.meta.locale || 'en-GB';
    TBCharts.config.currency = CFG.meta.currency || 'PLN';
    if (global.TBXlsx) TBXlsx.setCurrency(CFG.meta.currency || 'PLN');
    if (CFG.meta.team) profile.set({ team: CFG.meta.team });

    if (!PREVIEW) {
      if (!global.indexedDB) {
        gate('This browser does not expose IndexedDB, so the tracker has nowhere to keep your ' +
          'data. Open the file in Chrome or Edge.');
        return;
      }
      if (!global.showSaveFilePicker) {
        gate('This browser cannot write to files (File System Access API). The tracker would only ' +
          'keep data inside the browser, so it will not start — that way you cannot lose your ' +
          'work by accident. Open the file in Chrome or Edge.');
        return;
      }
    }

    store.init().then(function () {
      shell.init();
    }).catch(function (err) {
      if (global.console) console.error('[TB] boot', err);
      gate('Could not start the local data store: ' + err.message);
    });
  }

  boot();
})(window);
