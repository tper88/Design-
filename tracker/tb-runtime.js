/* ==========================================================================
   TB RUNTIME v1.0 — silnik wygenerowanego trackera.

   Źródłem prawdy jest PLIK .data.json na dysku użytkownika; IndexedDB jest
   szybkim cache'em lokalnym. Taki podział, bo przy otwarciu przez file://
   magazyn przeglądarki jest kluczowany po ŚCIEŻCE pliku — zmiana nazwy albo
   przeniesienie tracker.html wyglądałaby jak utrata wszystkich danych.
   Plik .data.json tego nie dotyczy.

   Target: Chrome i Edge. Bez File System Access albo IndexedDB tracker
   pokazuje bramę, a nie udaje, że zapisuje.

   Moduły: cfg · fmt · store · data · agg · render · shell · crud · menu
           · sel · io · boot
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = document;
  var TB = {};
  global.TB = TB;

  /* ====================================================================== cfg */

  var CFG = null;
  var DS = {};        // id → dataset
  var COL = {};       // dsId → { colId → column }
  var PREVIEW = false;

  function parseConfig() {
    var node = doc.getElementById('tb-config');
    var raw = node ? node.textContent : '';
    var cfg;
    try {
      cfg = JSON.parse(raw);
    } catch (e) {
      throw new Error('Nie udało się odczytać konfiguracji trackera: ' + e.message);
    }
    cfg.meta = cfg.meta || {};
    cfg.datasets = cfg.datasets || [];
    cfg.tabs = cfg.tabs || [];
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

  /* ====================================================================== fmt */

  var fmt = {};

  fmt.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  fmt.nf = function (v, d) {
    return (+v).toLocaleString(CFG.meta.locale || 'pl-PL',
      { maximumFractionDigits: d == null ? 1 : d, minimumFractionDigits: d == null ? 0 : d });
  };

  fmt.number = function (v, format, decimals) {
    if (v == null || v === '' || isNaN(v)) return '';
    switch (format) {
      case 'pln': return fmt.nf(v, decimals == null ? 2 : decimals) + ' zł';
      case 'usd': return '$' + (+v).toLocaleString('en-US', { maximumFractionDigits: 0 });
      case 'pct': return fmt.nf(v, decimals == null ? 1 : decimals) + '%';
      case 'int': return fmt.nf(Math.round(v), 0);
      case 'compact': return TBCharts.fmt.compact(v);
      default: return fmt.nf(v, decimals == null ? 2 : decimals);
    }
  };

  fmt.todayISO = function () {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  fmt.date = function (iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    return m ? m[3] + '.' + m[2] + '.' + m[1] : String(iso);
  };

  var DAY_NAMES = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
  var MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

  fmt.dayLabel = function (iso) {
    var today = fmt.todayISO();
    if (iso === today) return 'Dziś';
    if (iso === fmt.shiftISO(today, 1)) return 'Jutro';
    if (iso === fmt.shiftISO(today, -1)) return 'Wczoraj';
    var d = fmt.parseISO(iso);
    if (!d) return String(iso);
    return DAY_NAMES[d.getDay()] + ' ' + fmt.date(iso);
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

  fmt.monthLabel = function (key) {
    var m = /^(\d{4})-(\d{2})$/.exec(key);
    return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : key;
  };

  /* Formatuje wartość do wyświetlenia w komórce / na liście. */
  fmt.cell = function (value, col) {
    if (value == null || value === '') return '';
    if (!col) return fmt.esc(value);
    if (col.type === 'number') return fmt.number(value, col.format, col.decimals);
    if (col.type === 'date') return fmt.date(value);
    if (col.type === 'bool') return value ? 'tak' : 'nie';
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

  TB.fmt = fmt;
  TB.config = function () { return CFG; };

  /* ====================================================================== data */

  var data = {
    byDs: {},        // dsId → [record]
    rev: {},         // dsId → licznik rewizji (do memoizacji agregacji)
    index: {}        // recordId → record
  };

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
      case 'number': {
        if (typeof value === 'number') return isFinite(value) ? value : { _bad: value };
        var n = parseFloat(String(value).replace(/\s/g, '').replace(',', '.'));
        return isFinite(n) ? n : { _bad: value };
      }
      case 'date': {
        if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
        var d = new Date(value);
        if (!isNaN(d.getTime())) {
          return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        }
        return { _bad: value };
      }
      case 'bool':
        if (typeof value === 'boolean') return value;
        return /^(1|true|tak|yes|y|x)$/i.test(String(value).trim());
      case 'enum': {
        var v = String(value);
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
    if (d === '@user') return store.userName() || '';
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
      monthStart: today.slice(0, 8) + '01',
      yearStart: today.slice(0, 4) + '-01-01'
    };
  }

  function resolveValue(v, ctx) {
    if (v === '@today') return ctx.today;
    if (v === '@user') return store.userName() || '';
    return v;
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

  function filterMatch(rec, filter, ctx) {
    if (!filter) return true;
    if (filter.op === 'not') return !filterMatch(rec, filter.rule || filter.rules, ctx);
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
    if (col && col.type === 'enum') return String(value);
    if (col && col.type === 'bool') return value ? 'tak' : 'nie';
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

  /* Jedna specyfikacja agregacji zasila wszystkie renderery. Zwraca
     znormalizowany kształt: { scalar, labels, series, total, rows }. */
  function aggregate(dsId, spec) {
    spec = spec || { op: 'count' };
    var key = dsId + '|' + (data.rev[dsId] || 0) + '|' + JSON.stringify(spec);
    if (aggCache[key]) return aggCache[key];

    var recs = filtered(dsId, spec.filter);
    var out = { scalar: null, labels: [], series: [], total: 0, rows: recs.length };

    function valuesOf(list) {
      return list.map(function (r) {
        var raw = r.data[spec.field];
        var v = coerce(raw, column(dsId, spec.field));
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

    var buckets = {}, order = [];
    var splitKeys = {}, splitOrder = [];

    recs.forEach(function (r) {
      var gk = groupKey(r.data[spec.groupBy.field], gCol, grain);
      if (!buckets[gk]) { buckets[gk] = {}; order.push(gk); }
      var sk = sCol ? groupKey(r.data[spec.split.field], sCol, null) : '_';
      if (!splitKeys[sk]) { splitKeys[sk] = 1; splitOrder.push(sk); }
      if (!buckets[gk][sk]) buckets[gk][sk] = [];
      buckets[gk][sk].push(r);
    });

    var sort = spec.groupBy.sort || 'key_asc';
    function bucketTotal(gk) {
      var all = [];
      for (var sk in buckets[gk]) all = all.concat(buckets[gk][sk]);
      return reduceOp(spec.op, spec.op === 'count' ? all : valuesOf(all)) || 0;
    }
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
        name: sCol ? groupLabel(sk, sCol, null) : (spec.name || 'Wartość'),
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
    var mode = 'none';       // none | auto | prompt | denied
    var dirtyDs = {};
    var pending = {};        // recordId → record (do batcha w IndexedDB)
    var idbTimer = null, fileTimer = null;
    var lastFileMtime = 0;
    var saveState = 'off';
    var handleRemembered = true;
    var structureNote = null;
    var userName = '';

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

    function tx(storeName, mode2) {
      return db.transaction(storeName, mode2).objectStore(storeName);
    }
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
      try {
        return fn();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    function kvGet(k) {
      return safe(function () {
        return reqP(tx('kv', 'readonly').get(k)).then(function (r) { return r ? r.v : undefined; });
      });
    }
    function kvPut(k, v) {
      return safe(function () { return reqP(tx('kv', 'readwrite').put({ k: k, v: v })); });
    }

    function loadFromIdb() {
      return reqP(tx('records', 'readonly').getAll()).then(function (all) {
        ingest(all);
      });
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
        records: all
      };
    }

    function flushIdb() {
      idbTimer = null;
      if (!db) return Promise.resolve();
      var list = Object.keys(pending).map(function (id) { return pending[id]; });
      pending = {};
      if (!list.length) return Promise.resolve();
      var s = tx('records', 'readwrite');
      list.forEach(function (r) { s.put(r); });
      return new Promise(function (res) {
        s.transaction.oncomplete = function () { res(); };
        s.transaction.onerror = function () { res(); };
      });
    }

    function setSaveState(s) {
      saveState = s;
      var el = doc.getElementById('tb-save');
      if (!el) return;
      el.setAttribute('data-state', s);
      el.textContent = {
        off: 'Nie połączono z plikiem',
        dirty: 'Niezapisane zmiany',
        saving: 'Zapisuję…',
        saved: 'Zapisano ' + new Date().toLocaleTimeString(CFG.meta.locale || 'pl-PL',
          { hour: '2-digit', minute: '2-digit' })
      }[s] || s;
    }

    function flushFile() {
      fileTimer = null;
      if (!handle || mode !== 'auto') { setSaveState(mode === 'auto' ? 'dirty' : 'off'); return Promise.resolve(); }
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
        TBUI.toast('Nie udało się zapisać pliku: ' + err.message, 'danger', 6000);
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
      dirtyDs[rec.ds] = 1;
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

    function softDelete(rec) {
      rec._d = 1;
      touch(rec);
    }

    function saveNow() {
      return flushIdb().then(flushFile);
    }

    /* ---- File System Access ---- */

    function pickFile() {
      return global.showSaveFilePicker({
        suggestedName: (CFG.meta.name || 'tracker').replace(/[^\w\-. ]+/g, '_') + '.data.json',
        types: [{ description: 'Dane trackera', accept: { 'application/json': ['.json'] } }]
      }).then(function (h) {
        handle = h;
        mode = 'auto';
        // Nieudane zapamiętanie uchwytu nie może przerwać połączenia —
        // zapis do pliku działa dalej, tylko nie przetrwa restartu.
        return kvPut('fileHandle', h).catch(function (err) {
          handleRemembered = false;
          if (global.console) console.warn('[TB] nie zapamiętano uchwytu pliku:', err && err.message);
        });
      }).then(function () {
        return saveNow();
      }).then(function () {
        TB.shell.renderNotices();
        TBUI.toast('Połączono z plikiem danych', 'success');
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

    function afterConnect() {
      return handle.getFile().then(function (f) {
        // Plik jest źródłem prawdy: nowszy niż ostatni nasz zapis ⇒ pytamy.
        if (f.lastModified > lastFileMtime + 2000 && Object.keys(data.index).length) {
          TB.shell.conflict(f);
          return;
        }
        return f.text().then(function (t) {
          if (t && t.trim()) {
            var obj = JSON.parse(t);
            if (obj && obj.records) {
              ingest(obj.records);
              var s = tx('records', 'readwrite');
              obj.records.forEach(function (r) { s.put(r); });
            }
          }
          lastFileMtime = f.lastModified;
          setSaveState('saved');
          TB.shell.renderNotices();
          TB.shell.renderActive(true);
        });
      });
    }

    function loadFileNow() {
      return handle.getFile().then(function (f) {
        return f.text().then(function (t) {
          var obj = t && t.trim() ? JSON.parse(t) : { records: [] };
          ingest(obj.records || []);
          var s = tx('records', 'readwrite');
          s.clear();
          (obj.records || []).forEach(function (r) { s.put(r); });
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

    /* Porównanie wersji struktury. Rekordy NIE są przepisywane — zmiana
       configu dotyczy tylko tego, jak dane są pokazywane. Użytkownik dowiaduje
       się jednak, co się zmieniło, bo cicha zmiana struktury jest myląca. */
    function noteStructureChange(prevRev, prevJson) {
      var rev = CFG.rev || 0;
      try {
        if (prevRev == null) return;              // pierwsze uruchomienie
        if (rev === prevRev) return;
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
        return Promise.all([loadFromIdb(), kvGet('fileHandle'), kvGet('lastFileMtime'),
          kvGet('userName'), kvGet('configRev'), kvGet('configJson')]);
      }).then(function (res) {
        handle = res[1] || null;
        lastFileMtime = res[2] || 0;
        userName = res[3] || CFG.meta.userName || '';
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
      init: init,
      putRecord: putRecord,
      softDelete: softDelete,
      touch: touch,
      saveNow: saveNow,
      pickFile: pickFile,
      reconnect: reconnect,
      loadFileNow: loadFileNow,
      keepLocal: keepLocal,
      dataFileObject: dataFileObject,
      ingest: ingest,
      replaceAll: function (records) {
        ingest(records);
        if (db) {
          var s = tx('records', 'readwrite');
          s.clear();
          records.forEach(function (r) { s.put(r); });
        }
        return saveNow();
      },
      mode: function () { return mode; },
      handle: function () { return handle; },
      fileName: function () { return handle ? handle.name : ''; },
      setSaveState: setSaveState,
      state: function () { return saveState; },
      structureNote: function () { return structureNote; },
      remembered: function () { return handleRemembered; },
      userName: function () { return userName; },
      setUserName: function (n) { userName = n; if (db) kvPut('userName', n); }
    };
  })();

  TB.store = store;

  /* ====================================================================== sel */

  var sel = (function () {
    var byCmp = {};            // componentId → { recordId: 1 }
    function set(cmpId) { if (!byCmp[cmpId]) byCmp[cmpId] = {}; return byCmp[cmpId]; }
    return {
      ids: function (cmpId) { return Object.keys(set(cmpId)); },
      has: function (cmpId, id) { return !!set(cmpId)[id]; },
      count: function (cmpId) { return Object.keys(set(cmpId)).length; },
      toggle: function (cmpId, id, on) {
        var s = set(cmpId);
        if (on == null) on = !s[id];
        if (on) s[id] = 1; else delete s[id];
        return on;
      },
      clear: function (cmpId) { byCmp[cmpId] = {}; },
      setMany: function (cmpId, ids, on) {
        var s = set(cmpId);
        ids.forEach(function (id) { if (on) s[id] = 1; else delete s[id]; });
      }
    };
  })();

  TB.sel = sel;

  /* ====================================================================== render */

  var hostByCmp = {};         // componentId → element hosta wykresu (reużywany)
  var viewState = {};         // componentId → { q, sort, dir, page, quick }

  function vs(cmpId) {
    if (!viewState[cmpId]) viewState[cmpId] = { q: '', sort: null, dir: 'asc', page: 1, quick: -1 };
    return viewState[cmpId];
  }

  function card(title, sub, bodyEl, headExtra) {
    var c = doc.createElement('section');
    c.className = 'card';
    if (title || sub || headExtra) {
      var h = doc.createElement('div');
      h.className = 'card-h';
      var t = doc.createElement('div');
      if (title) {
        var tt = doc.createElement('div');
        tt.className = 'card-t';
        tt.textContent = title;
        t.appendChild(tt);
      }
      if (sub) {
        var ss = doc.createElement('div');
        ss.className = 'tb-muted';
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

  var render = {};

  render.kpi = function (host, cmp) {
    var r = aggregate(cmp.dataset, cmp.agg);
    var opts = cmp.opts || {};
    var body = div('');
    var v = div('kpi-v');
    v.textContent = fmt.number(r.scalar == null ? 0 : r.scalar, opts.format || 'num', opts.decimals);
    body.appendChild(v);
    if (opts.spark && opts.spark.field) {
      var spec = {
        op: cmp.agg.op, field: cmp.agg.field, filter: cmp.agg.filter,
        groupBy: { field: opts.spark.field, grain: opts.spark.grain || 'month', sort: 'key_asc' }
      };
      var sp = aggregate(cmp.dataset, spec);
      if (sp.series.length && sp.series[0].values.length > 1) {
        var sdiv = div('');
        body.appendChild(sdiv);
        TBCharts.spark(sdiv, { values: sp.series[0].values, color: opts.tone || 'c1' });
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
    var legendWrap = null;
    var c = card(cmp.title, cmp.subtitle, chartHost);
    host.appendChild(c);

    if (!r.labels.length && kind !== 'donut') {
      chartHost.appendChild(emptyBox('Brak danych do pokazania',
        'Dodaj rekordy w zakładce z tabelą, a wykres policzy się sam.'));
      return;
    }

    var fmtFn = function (v) { return fmt.number(v, opts.format || cmp.agg.format || 'compact'); };

    if (kind === 'donut') {
      var items = r.labels.map(function (l, i) {
        return { label: l, value: r.series.length ? r.series[0].values[i] : 0 };
      }).filter(function (d) { return d.value > 0; });
      if (!items.length) {
        chartHost.appendChild(emptyBox('Brak danych do pokazania', ''));
        return;
      }
      TBCharts.donut(chartHost, { items: items, format: fmtFn, centerLabel: opts.centerLabel || 'Razem' });
      return;
    }
    if (kind === 'hbar') {
      var hitems = r.labels.map(function (l, i) {
        return { label: l, value: r.series.length ? r.series[0].values[i] : 0 };
      });
      TBCharts.hbar(chartHost, { items: hitems, format: fmtFn, fill: 'c1' });
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

    // Legenda jest obowiązkowa od 2 serii — reguła z PROMPT.md §5.
    if (series.length >= 2) {
      legendWrap = doc.createElement('ul');
      legendWrap.className = 'tb-legend';
      legendWrap.style.cssText = 'display:flex;flex-direction:row;gap:14px;flex-wrap:wrap;margin-top:8px';
      legendWrap.innerHTML = series.map(function (s, i) {
        return '<li class="tb-legend-row"><span class="tb-dot" style="--tb-dot:var(--c' +
          ((i % 5) + 1) + ')"></span>' + fmt.esc(s.name) + '</li>';
      }).join('');
      c.appendChild(legendWrap);
    }
  };

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

  render.progress = function (host, cmp) {
    var opts = cmp.opts || {};
    var r = aggregate(cmp.dataset, cmp.agg);
    var value = r.scalar || 0;
    var target = opts.target || 0;
    var pctv = target > 0 ? Math.min(100, (value / target) * 100) : 0;
    var body = div('');
    var meta = div('tb-bar-meta');
    meta.innerHTML = '<span>' + fmt.esc(cmp.subtitle || 'Realizacja') + '</span><b>' +
      fmt.esc(fmt.number(value, opts.format || 'num')) +
      (target > 0 ? ' / ' + fmt.esc(fmt.number(target, opts.format || 'num')) : '') + '</b>';
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
      text = text.replace(/\{\{v\}\}/g, fmt.number(r.scalar == null ? 0 : r.scalar, opts.format || 'int'));
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
    var sources = opts.sources || [];
    var ctx = ctxNow();
    var items = [];
    sources.forEach(function (src) {
      var ds = DS[src.dataset];
      if (!ds) return;
      filtered(src.dataset, src.filter).forEach(function (r) {
        var iso = r.data[src.dateField];
        if (!iso) return;
        iso = String(iso).slice(0, 10);
        if (opts.range === 'next30' && (iso < ctx.today && !opts.showOverdue)) return;
        if (opts.range === 'next30' && iso > ctx.next30) return;
        var toneCol = src.toneField ? column(src.dataset, src.toneField) : null;
        var o = toneCol ? optionOf(toneCol, r.data[src.toneField]) : null;
        items.push({
          iso: iso,
          title: r.data[src.titleField] || r.data[ds.titleField] || '(bez nazwy)',
          meta: src.metaField ? fmt.cell(r.data[src.metaField], column(src.dataset, src.metaField)) : '',
          tone: o ? o.tone : null,
          rec: r
        });
      });
    });
    items.sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0; });

    var body = div('tb-agenda');
    if (!items.length) {
      body.appendChild(emptyBox(opts.emptyText || 'Brak terminów',
        'Terminy pojawią się tu automatycznie, gdy uzupełnisz kolumnę z datą.'));
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
          (iso < ctx.today ? ' <small>po terminie</small>' : '') +
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

  function toneColor(tone) {
    return {
      success: 'var(--tb-ok)', danger: 'var(--tb-bad)',
      warning: 'var(--tb-warn)', info: 'var(--tb-info)'
    }[tone] || 'var(--c1)';
  }

  /* ---- karteczki ---- */

  render.notes = function (host, cmp) {
    var dsId = 'c:' + cmp.id;
    var recs = liveRecords(dsId).filter(function (r) { return !r.data.rowRef; });
    recs.sort(function (a, b) { return (a.data.order || 0) - (b.data.order || 0); });

    var body = div('tb-notes');
    recs.forEach(function (r) { body.appendChild(noteCard(r, false)); });

    var add = btn('+ Dodaj karteczkę', 'btn-secondary', function () {
      var rec = { id: newId('r_'), ds: dsId, data: { text: '', color: 'c1', order: Date.now(), rowRef: null },
        _c: Date.now(), _m: Date.now(), _d: 0 };
      store.putRecord(rec);
    });
    host.innerHTML = '';
    var c = card(cmp.title, cmp.subtitle, recs.length ? body :
      emptyBox('Brak karteczek', 'Dodaj pierwszą, żeby zapisać myśl, której nie chcesz trzymać w głowie.'),
      add);
    host.appendChild(c);
  };

  function noteCard(rec, pinned) {
    var n = div('tb-note tb-note-' + (rec.data.color || 'c1') + (pinned ? ' tb-note-pinned' : ''));
    var t = doc.createElement('div');
    t.className = 'tb-note-text';
    t.contentEditable = 'true';
    t.setAttribute('data-placeholder', 'Wpisz treść…');
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
      b.title = 'Zmień kolor';
      b.setAttribute('aria-label', 'Kolor ' + c);
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
    del.setAttribute('aria-label', 'Usuń karteczkę');
    del.title = 'Usuń';
    del.textContent = '✕';
    del.style.cssText = 'border:0;background:none;cursor:pointer;color:inherit;opacity:.6;padding:0 2px';
    del.addEventListener('click', function () {
      TBUI.confirm({
        title: 'Usunąć karteczkę?',
        text: 'Treść zostanie usunięta z trackera.',
        confirmLabel: 'Usuń karteczkę', tone: 'danger'
      }).then(function (ok) { if (ok) store.softDelete(rec); });
    });
    foot.appendChild(del);
    n.appendChild(foot);
    return n;
  }

  /* ---- checklista ---- */

  render.checklist = function (host, cmp) {
    var dsId = 'c:' + cmp.id;
    var opts = cmp.opts || {};
    var recs = liveRecords(dsId);
    recs.sort(function (a, b) { return (a.data.order || 0) - (b.data.order || 0); });

    // resetDaily: pozycja odhaczona innego dnia wraca jako niezrobiona
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
    inp.placeholder = 'Nowa pozycja i Enter';
    inp.setAttribute('aria-label', 'Nowa pozycja checklisty');
    inp.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !inp.value.trim()) return;
      store.putRecord({
        id: newId('r_'), ds: dsId,
        data: { text: inp.value.trim(), done: false, order: Date.now(), group: '', due: null,
          resetDaily: !!opts.resetDaily },
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
      emptyBox('Checklista jest pusta', 'Dopisz pierwszą pozycję w polu poniżej.'));
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
    cb.setAttribute('aria-label', rec.data.text || 'Pozycja');
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
    del.setAttribute('aria-label', 'Usuń pozycję');
    del.textContent = '✕';
    del.addEventListener('click', function () { store.softDelete(rec); });
    it.appendChild(del);
    return it;
  }

  /* ---- tabela ---- */

  render.table = function (host, cmp) {
    var opts = cmp.opts || {};
    var ds = DS[cmp.dataset];
    if (!ds) { host.innerHTML = ''; host.appendChild(emptyBox('Brak zbioru danych', '')); return; }

    var state = vs(cmp.id);
    var cols = (opts.columns && opts.columns.length ? opts.columns : ds.columns.map(function (c) { return c.id; }))
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

    /* --- pasek narzędzi --- */
    var bar = div('tb-toolbar');
    if (opts.search !== false) {
      var sw = div('tb-search');
      var si = doc.createElement('input');
      si.type = 'search';
      si.className = 'tb-input';
      si.placeholder = 'Szukaj…';
      si.value = state.q || '';
      si.setAttribute('aria-label', 'Szukaj w tabeli');
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
      selInfo.textContent = 'zaznaczono ' + selN;
      bar.appendChild(selInfo);
    }
    if (opts.allowAdd !== false) {
      bar.appendChild(btn('+ Dodaj wiersz', 'btn-primary', function () {
        crud.detail(blankRecord(cmp.dataset), cmp, true);
      }));
    }
    if (opts.export === undefined || opts.export) {
      bar.appendChild(btn('Eksport', 'btn-secondary', function (e) {
        io.exportMenu(e, cmp, { rows: rows, cols: cols, pageRows: pageRows });
      }));
    }
    wrap.appendChild(bar);

    /* --- tabela --- */
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
      all.setAttribute('aria-label', 'Zaznacz wszystkie na stronie');
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
    pageRows.forEach(function (r) {
      tbody.appendChild(tableRow(r, cols, cmp, opts, host));
    });
    table.appendChild(tbody);

    if (opts.totals && Object.keys(opts.totals).length) {
      var tfoot = doc.createElement('tfoot');
      var ftr = doc.createElement('tr');
      if (opts.selectable !== false) ftr.appendChild(doc.createElement('td'));
      cols.forEach(function (c) {
        var td = doc.createElement('td');
        var op = opts.totals[c.id];
        if (op) {
          td.className = 'is-num';
          var vals = rows.map(function (r) { return coerce(r.data[c.id], c); })
            .filter(function (v) { return typeof v === 'number'; });
          td.textContent = fmt.number(reduceOp(op, vals), c.format, c.decimals);
        } else if (c === cols[0]) {
          td.textContent = 'Razem';
        }
        ftr.appendChild(td);
      });
      tfoot.appendChild(ftr);
      table.appendChild(tfoot);
    }

    tw.appendChild(table);
    wrap.appendChild(tw);

    if (!base.length) {
      wrap.appendChild(emptyBox('Jeszcze nie ma żadnych wierszy',
        'Dodaj pierwszy wiersz albo wklej dane z Excela przez Ctrl+V.',
        [btn('+ Dodaj wiersz', 'btn-primary', function () {
          crud.detail(blankRecord(cmp.dataset), cmp, true);
        }),
        btn('Wklej z Excela', 'btn-secondary', function () { io.pasteDialog(cmp.dataset); })]));
    } else if (!rows.length) {
      wrap.appendChild(emptyBox('Nic nie pasuje do filtrów',
        'Zmień wyszukiwaną frazę albo wyłącz filtr.',
        [btn('Wyczyść filtry', 'btn-secondary', function () {
          state.q = ''; state.quick = -1; state.page = 1;
          render.table(host, cmp);
        })]));
    }

    /* --- paginacja --- */
    var pager = div('tb-pager');
    var info = doc.createElement('span');
    info.textContent = rows.length + (capped ? ' z ponad 500 (pokazuję pierwsze 500)' : '') +
      (rows.length !== base.length ? ' z ' + base.length : '') + ' · strona ' + state.page + '/' + pages;
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
        'Pokazuję pierwsze 500 wierszy</div><div class="tb-banner-text">' +
        'Zawęź filtry albo wyszukiwanie, żeby zobaczyć pozostałe. Eksport obejmuje ' +
        'wszystkie pasujące wiersze.</div></div>';
      wrap.appendChild(warn);
    }

    host.appendChild(card(cmp.title, cmp.subtitle, wrap));
    // zapamiętujemy widok, żeby menu kontekstowe i eksport znały aktualne
    // wiersze i kolejność kolumn bez ponownego liczenia
    lastView[cmp.id] = { rows: rows, cols: cols, pageRows: pageRows };
    menu.register(cmp, host);
  };

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

  function cmpVal(a, b, col) {
    var va = coerce(a, col), vb = coerce(b, col);
    if (isBad(va)) va = a;
    if (isBad(vb)) vb = b;
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return va - vb;
    if (typeof va === 'boolean') return (va ? 1 : 0) - (vb ? 1 : 0);
    return String(va).localeCompare(String(vb), CFG.meta.locale || 'pl-PL');
  }

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
      cb.setAttribute('aria-label', 'Zaznacz wiersz');
      cb.addEventListener('change', function () {
        sel.toggle(cmp.id, rec.id, cb.checked);
        tr.classList.toggle('is-selected', cb.checked);
        var bar = host.querySelector('.tb-toolbar');
        if (bar) render.table(host, cmp);
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
        td.title = 'Wartość nie pasuje do typu kolumny (' + c.type + '). Oryginał zachowany.';
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

      // edycja inline: commit na blur/Enter, NIGDY na input
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
      input.type = col.type === 'date' ? 'date' : (col.type === 'number' ? 'text' : 'text');
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
        TBUI.toast('„' + input.value + '" nie pasuje do kolumny ' + col.label, 'warning', 4000);
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

  crud.detail = function (rec, cmp, isNew) {
    var ds = DS[rec.ds];
    if (!ds) return;
    var form = doc.createElement('div');
    form.className = 'tb-stack';
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

    // karteczki przypięte do tego wiersza
    var notesWrap = div('tb-stack');
    notesWrap.style.gap = '8px';
    var pinHead = div('tb-check-group');
    pinHead.textContent = 'Karteczki do tego wiersza';
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
        p.textContent = 'Brak karteczek przypiętych do tego wiersza.';
        pinBox.appendChild(p);
      }
    }
    renderPins();
    var addPin = btn('+ Przypnij karteczkę', 'btn-ghost', function () {
      var target = firstNotesComponent();
      if (!target) {
        TBUI.toast('Dodaj w wizardzie komponent karteczek, żeby móc je przypinać', 'warning', 5000);
        return;
      }
      store.putRecord({
        id: newId('r_'), ds: 'c:' + target.id,
        data: { text: '', color: 'c3', order: Date.now(), rowRef: { ds: rec.ds, recordId: rec.id } },
        _c: Date.now(), _m: Date.now(), _d: 0
      });
      renderPins();
    });
    notesWrap.appendChild(addPin);
    form.appendChild(notesWrap);

    var actions = [{ label: 'Zamknij', variant: 'ghost' }];
    if (!isNew) {
      actions.unshift({
        label: 'Usuń wiersz', variant: 'secondary', close: false,
        onClick: function () {
          TBUI.confirm({
            title: 'Usunąć wiersz?',
            text: 'Wiersz zniknie z tabeli i z wyliczeń. Operacja dotyczy 1 wiersza.',
            confirmLabel: 'Usuń wiersz', tone: 'danger'
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
      label: isNew ? 'Dodaj wiersz' : 'Zapisz zmiany', variant: 'primary', close: false,
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
        TBUI.toast(isNew ? 'Wiersz dodany' : 'Zmiany zapisane', 'success');
        TBUI.drawer.close();
        return false;
      }
    });

    TBUI.drawer.show({
      title: isNew ? 'Nowy wiersz — ' + ds.name : (rec.data[ds.titleField] || ds.name),
      sub: isNew ? null : 'Zmieniono ' + new Date(rec._m).toLocaleString(CFG.meta.locale || 'pl-PL'),
      body: form,
      actions: actions
    });
  };

  function validateField(inp, col, fieldEl) {
    var val = col.type === 'bool' ? inp.checked : inp.value;
    var err = null;
    if (col.required && (val === '' || val == null)) err = 'To pole jest wymagane.';
    else if (val !== '' && col.type !== 'bool') {
      var v = coerce(val, col);
      if (isBad(v)) {
        err = col.type === 'number' ? 'Wpisz liczbę, na przykład 1234,50.'
          : col.type === 'date' ? 'Wybierz datę z kalendarza.'
          : 'Ta wartość nie pasuje do pola.';
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
      (t.components || []).forEach(function (c) {
        if (!found && c.type === 'notes') found = c;
      });
    });
    return found;
  }

  TB.crud = crud;

  /* ====================================================================== menu */

  var menu = (function () {
    var registered = {};

    function targetRecords(cmp, rec) {
      // Akcja z wiersza W ZAZNACZENIU dotyczy całego zaznaczenia.
      // Z wiersza poza zaznaczeniem — tylko tego wiersza, a zaznaczenie zostaje.
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
            case 'duplicate': {
              var copy = { id: newId('r_'), ds: r.ds, data: JSON.parse(JSON.stringify(r.data)),
                _c: Date.now(), _m: Date.now(), _d: 0 };
              store.putRecord(copy);
              return;
            }
            case 'delete': store.softDelete(r); return;
            case 'moveTo': r.ds = act.dataset; break;
            default: break;
          }
          store.touch(r);
        });
        if (act.kind !== 'delete') {
          TBUI.toast(n === 1 ? 'Zmieniono 1 wiersz' : 'Zmieniono ' + n + ' wierszy', 'success');
        } else {
          TBUI.toast(n === 1 ? 'Usunięto 1 wiersz' : 'Usunięto ' + n + ' wierszy', 'success');
          sel.clear(cmp.id);
        }
      }
      if (act.confirm || act.kind === 'delete') {
        TBUI.confirm({
          title: act.kind === 'delete' ? 'Usunąć wiersze?' : act.label,
          text: (act.kind === 'delete' ? 'Operacja dotyczy ' : 'Operacja dotyczy ') +
            n + (n === 1 ? ' wiersza.' : ' wierszy.'),
          confirmLabel: act.kind === 'delete' ? 'Usuń' : 'Wykonaj',
          tone: act.kind === 'delete' ? 'danger' : ''
        }).then(function (ok) { if (ok) go(); });
      } else {
        go();
      }
    }

    function buildItems(cmp, rec, view) {
      var opts = cmp.opts || {};
      var cm = opts.contextMenu || {};
      var builtins = cm.builtins || ['edit', 'duplicate', 'delete', 'addNote', 'copyRow', 'exportSelected'];
      var recs = targetRecords(cmp, rec);
      var n = recs.length;
      var items = [];

      if (n > 1) items.push({ head: 'Zaznaczono ' + n + ' wierszy' });

      if (builtins.indexOf('edit') >= 0) {
        items.push({
          label: n > 1 ? 'Otwórz pierwszy wiersz' : 'Edytuj wiersz', icon: '✎',
          onClick: function () { crud.detail(recs[0], cmp); }
        });
      }
      if (builtins.indexOf('duplicate') >= 0) {
        items.push({
          label: 'Duplikuj', icon: '⧉',
          onClick: function () { applyAction({ kind: 'duplicate', label: 'Duplikuj' }, recs, cmp); }
        });
      }
      if (builtins.indexOf('addNote') >= 0) {
        items.push({
          label: 'Dodaj karteczkę', icon: '🗒',
          onClick: function () { crud.detail(recs[0], cmp); }
        });
      }
      if (builtins.indexOf('copyRow') >= 0) {
        items.push({
          label: 'Kopiuj jako tekst', icon: '⎘', kbd: 'Ctrl+C',
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
          label: 'Eksportuj zaznaczone do Excela', icon: '⤓',
          disabled: !sel.count(cmp.id),
          onClick: function () { io.exportXlsx(cmp, 'selected', view); }
        });
      }
      if (builtins.indexOf('delete') >= 0) {
        items.push({ sep: true });
        items.push({
          label: n > 1 ? 'Usuń ' + n + ' wierszy' : 'Usuń wiersz',
          icon: '🗑', danger: true,
          onClick: function () { applyAction({ kind: 'delete', label: 'Usuń' }, recs, cmp); }
        });
      }
      return items;
    }

    function register(cmp, host) {
      var name = 'table:' + cmp.id;
      if (registered[name]) return;
      registered[name] = true;
      TBUI.menu.provider(name, function (e, hostEl) {
        var tr = (e.target && e.target.closest) ? e.target.closest('[data-tb-row]') : null;
        var rec = tr ? data.index[tr.getAttribute('data-tb-row')] : null;
        if (!rec) return null;
        var view = lastView[cmp.id];
        return buildItems(cmp, rec, view);
      });
    }

    return { register: register, applyAction: applyAction };
  })();

  var lastView = {};

  /* ====================================================================== io */

  var io = (function () {

    function rowsToSheet(cmp, recs, cols) {
      return {
        name: cmp && cmp.title ? cmp.title : (DS[cmp.dataset] ? DS[cmp.dataset].name : 'Dane'),
        columns: cols.map(function (c) {
          return { label: c.label, type: c.type, format: c.format };
        }),
        rows: recs.map(function (r) {
          return cols.map(function (c) {
            var v = coerce(r.data[c.id], c);
            if (isBad(v)) return String(r.data[c.id]);
            if (c.type === 'enum') {
              var o = optionOf(c, v);
              return o ? o.label : v;              // enum eksportuje się jako LABELKA
            }
            return v;
          });
        })
      };
    }

    function download(blob, filename) {
      if (global.showSaveFilePicker) {
        global.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Arkusz Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]
        }).then(function (h) {
          return h.createWritable().then(function (w) {
            return blob.arrayBuffer().then(function (buf) {
              return w.write(buf).then(function () { return w.close(); });
            });
          });
        }).then(function () {
          TBUI.toast('Wyeksportowano ' + filename, 'success');
        }).catch(function (err) {
          if (err && err.name === 'AbortError') return;
          saveViaLink(blob, filename);
        });
      } else {
        saveViaLink(blob, filename);
      }
    }

    function saveViaLink(blob, filename) {
      var url = URL.createObjectURL(blob);
      var a = doc.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    function stamp() { return fmt.todayISO(); }
    function baseName(scope) {
      return (CFG.meta.name || 'tracker').replace(/[^\w\-. ]+/g, '_') + '-' + scope + '-' + stamp();
    }

    function exportXlsx(cmp, scope, view) {
      var ds = DS[cmp ? cmp.dataset : null];
      var sheets;
      if (scope === 'all') {
        sheets = CFG.datasets.map(function (d) {
          return rowsToSheet({ dataset: d.id, title: d.name }, liveRecords(d.id), d.columns);
        });
        // notatki i checklisty jako osobne arkusze
        var notes = [], checks = [];
        Object.keys(data.byDs).forEach(function (dsId) {
          if (dsId.indexOf('c:') !== 0) return;
          liveRecords(dsId).forEach(function (r) {
            if ('done' in r.data) checks.push(r); else notes.push(r);
          });
        });
        if (notes.length) {
          sheets.push({
            name: 'Karteczki',
            columns: [{ label: 'Treść', type: 'text' }, { label: 'Kolor', type: 'text' },
              { label: 'Przypięta do', type: 'text' }],
            rows: notes.map(function (r) {
              return [r.data.text || '', r.data.color || '',
                r.data.rowRef ? r.data.rowRef.recordId : ''];
            })
          });
        }
        if (checks.length) {
          sheets.push({
            name: 'Checklisty',
            columns: [{ label: 'Pozycja', type: 'text' }, { label: 'Zrobione', type: 'bool' },
              { label: 'Grupa', type: 'text' }, { label: 'Termin', type: 'date' }],
            rows: checks.map(function (r) {
              return [r.data.text || '', !!r.data.done, r.data.group || '', r.data.due || null];
            })
          });
        }
      } else {
        var cols = view && view.cols ? view.cols : (ds ? ds.columns : []);
        var recs;
        if (scope === 'selected') {
          recs = sel.ids(cmp.id).map(function (id) { return data.index[id]; }).filter(Boolean);
          if (!recs.length) { TBUI.toast('Nic nie jest zaznaczone', 'warning'); return; }
        } else if (scope === 'view') {
          recs = (view && view.rows) || [];
        } else {
          recs = liveRecords(cmp.dataset);
        }
        sheets = [rowsToSheet(cmp, recs, cols)];
      }
      var blob = TBXlsx.build(sheets);
      var label = { selected: 'zaznaczone', view: 'widok', dataset: 'caly-zbior', all: 'caly-tracker' }[scope];
      download(blob, baseName(label) + '.xlsx');
    }

    function exportMenu(e, cmp, view) {
      lastView[cmp.id] = view;
      var r = e.currentTarget.getBoundingClientRect();
      TBUI.menu.open(r.left, r.bottom + 4, [
        { head: 'Eksport do Excela' },
        {
          label: 'Zaznaczone wiersze (' + sel.count(cmp.id) + ')', icon: '☑',
          disabled: !sel.count(cmp.id),
          onClick: function () { exportXlsx(cmp, 'selected', view); }
        },
        {
          label: 'Aktualny widok (' + view.rows.length + ')', icon: '▤',
          onClick: function () { exportXlsx(cmp, 'view', view); }
        },
        {
          label: 'Cały zbiór (' + liveRecords(cmp.dataset).length + ')', icon: '▦',
          onClick: function () { exportXlsx(cmp, 'dataset', view); }
        },
        { sep: true },
        {
          label: 'Cały tracker — arkusz na zbiór', icon: '🗂',
          onClick: function () { exportXlsx(cmp, 'all', view); }
        },
        { sep: true },
        {
          label: 'Kopia danych jako JSON', icon: '{ }',
          onClick: function () { exportJson(); }
        }
      ]);
    }

    function exportJson() {
      var blob = new Blob([JSON.stringify(store.dataFileObject(), null, 2)], { type: 'application/json' });
      saveViaLink(blob, baseName('dane') + '.json');
      TBUI.toast('Zapisano kopię JSON', 'success');
    }

    function copyRows(recs, cmp) {
      var ds = DS[cmp.dataset];
      var cols = (cmp.opts && cmp.opts.columns && cmp.opts.columns.length
        ? cmp.opts.columns.map(function (id) { return column(cmp.dataset, id); })
        : ds.columns).filter(Boolean);
      var text = [cols.map(function (c) { return c.label; }).join('\t')]
        .concat(recs.map(function (r) {
          return cols.map(function (c) { return fmt.cell(coerce(r.data[c.id], c), c); }).join('\t');
        })).join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          TBUI.toast('Skopiowano ' + recs.length + (recs.length === 1 ? ' wiersz' : ' wierszy'), 'success');
        });
      }
    }

    /* ---- parser CSV/TSV ---- */

    function detectDelimiter(text) {
      var head = text.split(/\r?\n/).slice(0, 5).join('\n');
      var counts = { '\t': 0, ';': 0, ',': 0 };
      Object.keys(counts).forEach(function (d) {
        counts[d] = head.split(d).length - 1;
      });
      var best = '\t';
      Object.keys(counts).forEach(function (d) { if (counts[d] > counts[best]) best = d; });
      return counts[best] ? best : ',';
    }

    function parseDelimited(text, delim) {
      delim = delim || detectDelimiter(text);
      var rows = [], row = [], field = '', inQ = false, i = 0;
      text = text.replace(/^﻿/, '');
      while (i < text.length) {
        var ch = text[i];
        if (inQ) {
          if (ch === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
            inQ = false; i++; continue;
          }
          field += ch; i++; continue;
        }
        if (ch === '"') { inQ = true; i++; continue; }
        if (ch === delim) { row.push(field); field = ''; i++; continue; }
        if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(field); field = '';
          rows.push(row); row = [];
          i++; continue;
        }
        field += ch; i++;
      }
      if (field !== '' || row.length) { row.push(field); rows.push(row); }
      return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    }

    function importDialog(dsId, rows) {
      var ds = DS[dsId];
      if (!ds || !rows.length) return;
      var header = rows[0];
      var bodyRows = rows.slice(1);

      var wrap = doc.createElement('div');
      wrap.className = 'tb-stack';
      var info = div('tb-banner tb-banner-accent');
      info.innerHTML = '<i>↓</i><div class="tb-banner-body"><div class="tb-banner-title">' +
        bodyRows.length + (bodyRows.length === 1 ? ' wiersz' : ' wierszy') + ' do wczytania</div>' +
        '<div class="tb-banner-text">Dopasuj kolumny z pliku do kolumn zbioru „' +
        fmt.esc(ds.name) + '". Kolumny ustawione na „— pomiń —" nie zostaną wczytane.</div></div>';
      wrap.appendChild(info);

      var selects = [];
      header.forEach(function (h, i) {
        var f = div('tb-field');
        var lab = doc.createElement('label');
        lab.textContent = 'Kolumna z pliku: „' + h + '"';
        f.appendChild(lab);
        var s = doc.createElement('select');
        s.className = 'tb-select';
        var skip = doc.createElement('option');
        skip.value = '';
        skip.textContent = '— pomiń —';
        s.appendChild(skip);
        ds.columns.forEach(function (c) {
          var o = doc.createElement('option');
          o.value = c.id;
          o.textContent = c.label + ' (' + c.type + ')';
          s.appendChild(o);
        });
        // automatyczne dopasowanie po nazwie
        var guess = ds.columns.filter(function (c) {
          return String(c.label).toLowerCase().trim() === String(h).toLowerCase().trim();
        })[0];
        if (guess) s.value = guess.id;
        selects.push(s);
        f.appendChild(s);
        wrap.appendChild(f);
      });

      TBUI.modal.show({
        size: 'lg',
        title: 'Wczytaj dane',
        sub: 'Mapowanie kolumn',
        body: wrap,
        actions: [
          { label: 'Anuluj', variant: 'ghost' },
          {
            label: 'Wczytaj ' + bodyRows.length + ' wierszy', variant: 'primary', close: false,
            onClick: function () {
              var map = selects.map(function (s) { return s.value; });
              if (!map.some(Boolean)) {
                TBUI.toast('Dopasuj przynajmniej jedną kolumnę', 'warning');
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
              TBUI.toast('Wczytano ' + added + ' wierszy' +
                (warn ? ', ' + warn + ' wartości nie pasowało do typów' : ''),
                warn ? 'warning' : 'success', 5000);
              TBUI.modal.close(wrap.closest('dialog'));
              return false;
            }
          }
        ]
      });
    }

    function pasteDialog(dsId) {
      var ta = doc.createElement('textarea');
      ta.className = 'tb-textarea';
      ta.style.minHeight = '160px';
      ta.placeholder = 'Zaznacz zakres w Excelu, skopiuj (Ctrl+C) i wklej tutaj (Ctrl+V).\n' +
        'Pierwszy wiersz powinien zawierać nazwy kolumn.';
      ta.setAttribute('aria-label', 'Wklej dane z Excela');
      var wrap = doc.createElement('div');
      wrap.className = 'tb-stack';
      wrap.appendChild(ta);

      TBUI.modal.show({
        size: 'lg',
        title: 'Wklej z Excela',
        sub: 'Dane trafią do zbioru „' + (DS[dsId] ? DS[dsId].name : '') + '"',
        body: wrap,
        onOpen: function () { setTimeout(function () { ta.focus(); }, 50); },
        actions: [
          { label: 'Anuluj', variant: 'ghost' },
          {
            label: 'Dalej — dopasuj kolumny', variant: 'primary', close: false,
            onClick: function () {
              var rows = parseDelimited(ta.value);
              if (rows.length < 2) {
                TBUI.toast('Potrzebuję nagłówka i co najmniej jednego wiersza', 'warning');
                return false;
              }
              TBUI.modal.close(wrap.closest('dialog'));
              setTimeout(function () { importDialog(dsId, rows); }, 60);
              return false;
            }
          }
        ]
      });
    }

    function importCsvFile(dsId, file) {
      file.text().then(function (t) {
        var rows = parseDelimited(t);
        if (rows.length < 2) {
          TBUI.toast('Plik nie zawiera nagłówka i danych', 'warning');
          return;
        }
        importDialog(dsId, rows);
      });
    }

    function importJsonFile(file) {
      file.text().then(function (t) {
        var obj = JSON.parse(t);
        if (!obj || !obj.records) {
          TBUI.toast('To nie jest plik danych trackera', 'danger');
          return;
        }
        TBUI.confirm({
          title: 'Wczytać dane z pliku?',
          text: 'Obecne dane w przeglądarce zostaną zastąpione ' + obj.records.length + ' rekordami z pliku.',
          confirmLabel: 'Zastąp dane'
        }).then(function (ok) {
          if (!ok) return;
          store.replaceAll(obj.records).then(function () {
            TB.shell.renderActive(true);
            TBUI.toast('Wczytano dane z pliku', 'success');
          });
        });
      });
    }

    return {
      exportXlsx: exportXlsx, exportMenu: exportMenu, exportJson: exportJson,
      copyRows: copyRows, parseDelimited: parseDelimited, detectDelimiter: detectDelimiter,
      pasteDialog: pasteDialog, importCsvFile: importCsvFile, importJsonFile: importJsonFile,
      importDialog: importDialog
    };
  })();

  TB.io = io;

  /* ====================================================================== shell */

  var shell = (function () {
    var activeTab = null;
    var staleTabs = {};
    var renderedTabs = {};   // zakładka jeszcze nieodwiedzona MUSI się wyrenderować
    var dirtyDatasets = {};
    var rafId = null;
    var cmpHost = {};        // componentId → element kontenera (STABILNY, reużywany)
    var cmpTab = {};         // componentId → tabId
    var depsByDs = {};       // dsId → [componentId]

    function componentDatasets(cmp) {
      var out = [];
      if (cmp.dataset) out.push(cmp.dataset);
      if (cmp.type === 'notes' || cmp.type === 'checklist') out.push('c:' + cmp.id);
      if (cmp.type === 'agenda') {
        ((cmp.opts || {}).sources || []).forEach(function (s) { if (s.dataset) out.push(s.dataset); });
      }
      // karteczki przypięte do wiersza widać w drawerze tabeli, więc tabela
      // zależy też od zbiorów karteczek
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
        a.innerHTML = '<i>' + fmt.esc(tab.icon || '▦') + '</i>' + fmt.esc(tab.label || 'Zakładka');
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
          panel.appendChild(emptyBox('Ta zakładka jest pusta',
            'Wróć do wizarda i dodaj do niej komponenty.'));
        }
        panels.appendChild(panel);
      });

      activeTab = CFG.tabs.length ? CFG.tabs[0].id : null;
      buildHeadActions();
    }

    function buildHeadActions() {
      var box = doc.getElementById('tb-head-actions');
      box.innerHTML = '';

      var save = doc.createElement('span');
      save.className = 'tb-save';
      save.id = 'tb-save';
      box.appendChild(save);
      // store mógł ustawić stan przed zbudowaniem wskaźnika — odtwarzamy go
      store.setSaveState(store.state());

      var saveBtn = btn('Zapisz', 'btn-primary', function () {
        if (store.mode() !== 'auto') {
          if (!store.handle()) { store.pickFile().catch(noop); return; }
          store.reconnect().then(function (ok) { if (ok) store.saveNow(); });
          return;
        }
        store.saveNow().then(function () { TBUI.toast('Zapisano', 'success'); });
      });
      saveBtn.title = 'Zapisz teraz (Ctrl+S)';
      box.appendChild(saveBtn);

      if (CFG.meta.allowThemeSwitch) {
        var themes = [].slice.call(doc.querySelectorAll('script[type="text/plain"][data-theme]'));
        if (themes.length) {
          var s = doc.createElement('select');
          s.className = 'tb-select';
          s.style.width = 'auto';
          s.setAttribute('aria-label', 'Styl trackera');
          var cur = doc.createElement('option');
          cur.value = '';
          cur.textContent = 'Styl: ' + (CFG.meta.theme || 'domyślny');
          s.appendChild(cur);
          themes.forEach(function (t) {
            var o = doc.createElement('option');
            o.value = t.getAttribute('data-theme');
            o.textContent = 'Styl: ' + (t.getAttribute('data-theme-name') || o.value);
            s.appendChild(o);
          });
          s.addEventListener('change', function () {
            if (!s.value) return;
            var node = doc.querySelector('script[type="text/plain"][data-theme="' + s.value + '"]');
            if (!node) return;
            // podmiana samego tekstu stylu — wykresy używają var(), więc
            // przemalowują się bez re-renderu
            doc.getElementById('tb-theme').textContent = node.textContent;
            TBUI.toast('Zmieniono styl', 'success');
          });
          box.appendChild(s);
        }
      }

      var more = btn('⋯', 'btn-secondary', function (e) {
        var r = e.currentTarget.getBoundingClientRect();
        var items = [
          { head: 'Dane' },
          { label: 'Eksportuj cały tracker do Excela', icon: '🗂',
            onClick: function () { io.exportXlsx({ dataset: null }, 'all', null); } },
          { label: 'Zapisz kopię JSON', icon: '{ }', onClick: io.exportJson },
          { label: 'Wczytaj dane z pliku JSON…', icon: '↥', onClick: pickJson },
          { sep: true },
          { head: 'Plik danych' }
        ];
        if (store.mode() === 'auto') {
          items.push({ label: 'Zapisz teraz', icon: '💾', kbd: 'Ctrl+S',
            onClick: function () { store.saveNow(); } });
          items.push({ label: 'Wskaż inny plik…', icon: '📄',
            onClick: function () { store.pickFile().catch(noop); } });
        } else {
          items.push({ label: 'Połącz z plikiem danych…', icon: '🔗',
            onClick: function () { store.pickFile().catch(noop); } });
        }
        items.push({ sep: true });
        items.push({ label: 'Twoje imię (dla „przypisz do mnie")…', icon: '👤', onClick: askName });
        TBUI.menu.open(r.left, r.bottom + 4, items);
      });
      more.setAttribute('aria-label', 'Więcej opcji');
      box.appendChild(more);
    }

    function noop() {}

    function pickJson() {
      var inp = doc.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.addEventListener('change', function () {
        if (inp.files[0]) io.importJsonFile(inp.files[0]);
      });
      inp.click();
    }

    function askName() {
      var wrap = doc.createElement('div');
      wrap.className = 'tb-field';
      var lab = doc.createElement('label');
      lab.textContent = 'Twoje imię i nazwisko';
      var inp = doc.createElement('input');
      inp.className = 'tb-input';
      inp.value = store.userName() || '';
      wrap.appendChild(lab);
      wrap.appendChild(inp);
      TBUI.modal.show({
        size: 'sm', title: 'Kto pracuje na trackerze?',
        sub: 'Używane przez akcje typu „przypisz do mnie"',
        body: wrap,
        actions: [
          { label: 'Anuluj', variant: 'ghost' },
          { label: 'Zapisz', variant: 'primary', onClick: function () {
            store.setUserName(inp.value.trim());
          } }
        ]
      });
    }

    /* ---- powiadomienia nad treścią ---- */

    function renderNotices() {
      var box = doc.getElementById('tb-notices');
      if (!box) return;
      box.innerHTML = '';
      if (PREVIEW) {
        var p = div('tb-banner tb-banner-accent');
        p.innerHTML = '<i>👁</i><div class="tb-banner-body"><div class="tb-banner-title">Podgląd</div>' +
          '<div class="tb-banner-text">To podgląd z danymi przykładowymi. Nic nie jest zapisywane.</div></div>';
        box.appendChild(p);
        return;
      }
      var sn = store.structureNote();
      if (sn) {
        var sb = div('tb-banner tb-banner-accent');
        var txt;
        if (sn.older) {
          txt = 'Otwierasz starszą wersję struktury (' + sn.to + ' zamiast ' + sn.from +
            '). Dane są bezpieczne, ale część kolumn albo zakładek może się nie pokazywać.';
        } else {
          var parts = [];
          if (sn.added) parts.push('+' + sn.added + ' kolumn');
          if (sn.removed) parts.push('−' + sn.removed + ' kolumn (dane zachowane)');
          if (sn.tabs > 0) parts.push('+' + sn.tabs + ' zakładek');
          if (sn.tabs < 0) parts.push(sn.tabs + ' zakładek');
          txt = 'Struktura zaktualizowana do wersji ' + sn.to +
            (parts.length ? ': ' + parts.join(', ') + '.' : '.') +
            ' Twoje wiersze zostały nietknięte.';
        }
        sb.innerHTML = '<i>↻</i><div class="tb-banner-body">' +
          '<div class="tb-banner-title">Zmieniła się struktura trackera</div>' +
          '<div class="tb-banner-text">' + fmt.esc(txt) + '</div></div>';
        box.appendChild(sb);
      }
      var mode = store.mode();
      if (mode === 'auto' && !store.remembered()) {
        var nr = div('tb-banner tb-banner-warning');
        nr.innerHTML = '<i>⚠</i><div class="tb-banner-body">' +
          '<div class="tb-banner-title">Zapisuję do pliku, ale nie zapamiętałem go na przyszłość</div>' +
          '<div class="tb-banner-text">Przeglądarka nie pozwoliła zachować wskazania pliku. ' +
          'Dane są zapisywane normalnie, ale po zamknięciu karty trzeba będzie wskazać plik ' +
          'ponownie.</div></div>';
        box.appendChild(nr);
      }
      if (mode === 'prompt') {
        var b = div('tb-banner tb-banner-warning');
        b.innerHTML = '<i>🔗</i><div class="tb-banner-body">' +
          '<div class="tb-banner-title">Połącz ponownie z plikiem danych</div>' +
          '<div class="tb-banner-text">Przeglądarka wymaga jednego potwierdzenia na sesję. ' +
          'Zapamiętany plik: <b>' + fmt.esc(store.fileName()) + '</b></div></div>';
        var act = div('tb-banner-actions');
        act.appendChild(btn('Połącz z plikiem', 'btn-primary', function () {
          // requestPermission woła się jako pierwsza rzecz w geście
          store.reconnect().then(function (ok) {
            if (ok) TBUI.toast('Połączono — dane będą zapisywane automatycznie', 'success');
            else TBUI.toast('Bez dostępu do pliku zmiany zostają tylko w przeglądarce', 'warning', 6000);
          });
        }));
        b.appendChild(act);
        box.appendChild(b);
      } else if (mode === 'none' || mode === 'denied') {
        var c = div('tb-banner tb-banner-warning');
        c.innerHTML = '<i>⚠</i><div class="tb-banner-body">' +
          '<div class="tb-banner-title">Dane nie są zapisywane do pliku</div>' +
          '<div class="tb-banner-text">Zmiany trzyma na razie sama przeglądarka. ' +
          'Wskaż plik .json, żeby tracker zapisywał je na dysku — i nie zmieniaj potem nazwy ' +
          'ani miejsca pliku tracker.html.</div></div>';
        var act2 = div('tb-banner-actions');
        act2.appendChild(btn('Wybierz plik danych', 'btn-primary', function () {
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
        '<div class="tb-banner-title">Plik danych jest nowszy niż kopia w przeglądarce</div>' +
        '<div class="tb-banner-text">Plik zmieniono ' +
        new Date(file.lastModified).toLocaleString(CFG.meta.locale || 'pl-PL') +
        ' poza tą kartą. Wybierz, która wersja ma zostać — nic nie nadpiszę samo.</div></div>';
      var act = div('tb-banner-actions');
      act.appendChild(btn('Wczytaj z pliku', 'btn-primary', function () {
        store.loadFileNow().then(function () { TBUI.toast('Wczytano dane z pliku', 'success'); });
      }));
      act.appendChild(btn('Zachowaj z przeglądarki', 'btn-secondary', function () {
        store.keepLocal().then(function () { TBUI.toast('Nadpisano plik danymi z przeglądarki', 'success'); });
      }));
      act.appendChild(btn('Pobierz obie kopie', 'btn-ghost', function () {
        io.exportJson();
        file.text().then(function (t) {
          var blob = new Blob([t], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = doc.createElement('a');
          a.href = url;
          a.download = 'z-pliku-' + fmt.todayISO() + '.json';
          a.click();
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        });
      }));
      b.appendChild(act);
      box.appendChild(b);
      store.setSaveState('dirty');
    }

    /* ---- renderowanie komponentów ---- */

    function renderComponent(cmp) {
      var host = cmpHost[cmp.id];
      if (!host) return;
      var fn = render[cmp.type];
      if (!fn) {
        host.innerHTML = '';
        host.appendChild(emptyBox('Nieznany typ komponentu: ' + cmp.type, ''));
        return;
      }
      try {
        fn(host, cmp);
      } catch (err) {
        host.innerHTML = '';
        host.appendChild(emptyBox('Nie udało się wyrenderować „' + (cmp.title || cmp.type) + '"',
          err.message));
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
      // Renderujemy, gdy: wymuszono, zakładka jest brudna, albo nie była
      // jeszcze ani raz pokazana. Brak flagi stale na nieodwiedzonej zakładce
      // nie znaczy "nic do roboty" — znaczy "nigdy jej nie zbudowano".
      if (!force && renderedTabs[activeTab] && !staleTabs[activeTab]) return;
      componentsOfTab(activeTab).forEach(renderComponent);
      renderedTabs[activeTab] = 1;
      delete staleTabs[activeTab];
    }

    /* Mutacja oznacza zbiór jako brudny; przeliczenie leci raz na rAF
       i dotyczy TYLKO komponentów aktywnej zakładki. Pozostałe dostają
       flagę stale i odświeżą się przy przejściu na nie. */
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
      });
    }

    function findComponent(cmpId) {
      var found = null;
      CFG.tabs.forEach(function (t) {
        (t.components || []).forEach(function (c) { if (c.id === cmpId) found = c; });
      });
      return found;
    }

    function onTabChange(e) {
      var id = e.detail.id || '';
      var tabId = id.replace(/^panel-/, '');
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

      // Ctrl+S zapisuje, zamiast otwierać okno zapisu strony
      doc.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
        e.preventDefault();
        if (store.mode() === 'auto') {
          store.saveNow().then(function () { TBUI.toast('Zapisano', 'success'); });
        } else if (store.handle()) {
          store.reconnect().then(function (ok) { if (ok) store.saveNow(); });
        } else {
          store.pickFile().catch(noop);
        }
      });

      // flush przy ukryciu karty — ostatni moment, w którym zapis się zdąży
      doc.addEventListener('visibilitychange', function () {
        if (doc.visibilityState === 'hidden' && store.mode() === 'auto') store.saveNow();
      });
      global.addEventListener('beforeunload', function (e) {
        if (doc.getElementById('tb-save').getAttribute('data-state') === 'dirty') {
          e.preventDefault();
          e.returnValue = '';
        }
      });
    }

    return {
      init: init, invalidate: invalidate, renderActive: renderActive,
      renderNotices: renderNotices, conflict: conflict,
      activeTab: function () { return activeTab; }
    };
  })();

  TB.shell = shell;

  /* ====================================================================== boot */

  function gate(message) {
    var g = doc.createElement('div');
    g.className = 'tb-gate';
    g.innerHTML = '<h1>Tracker działa w Chrome i Edge</h1><p>' + fmt.esc(message) + '</p>';
    doc.body.appendChild(g);
  }

  function boot() {
    try {
      CFG = parseConfig();
    } catch (e) {
      gate(e.message);
      return;
    }
    TBCharts.config.locale = CFG.meta.locale || 'pl-PL';

    if (!PREVIEW) {
      if (!global.indexedDB) {
        gate('Ta przeglądarka nie udostępnia IndexedDB, więc tracker nie ma gdzie trzymać danych. ' +
          'Otwórz plik w Chrome albo Edge.');
        return;
      }
      if (!global.showSaveFilePicker) {
        gate('Ta przeglądarka nie obsługuje zapisu do pliku (File System Access API). ' +
          'Tracker zapisywałby dane tylko w pamięci przeglądarki, więc nie uruchamiam go, ' +
          'żeby nie stracić Twojej pracy. Otwórz plik w Chrome albo Edge.');
        return;
      }
    }

    store.init().then(function () {
      shell.init();
    }).catch(function (err) {
      if (global.console) console.error('[TB] boot', err);
      gate('Nie udało się uruchomić magazynu danych: ' + err.message);
    });
  }

  // Runtime startuje przy readyState === 'loading', więc DOM shella już jest
  // (jest wyżej w dokumencie), a nic poniżej nas nie potrzebuje.
  boot();
})(window);
