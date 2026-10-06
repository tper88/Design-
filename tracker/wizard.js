/* ==========================================================================
   WIZARD.JS — kreator trackerów.

   Składa konfigurację (tracker.json) i emituje pojedynczy plik HTML
   z wklejonymi assetami. Assety leżą w tym samym pliku jako base64.

   Dwie pułapki emisji, zaadresowane niżej w emit():
   1. JSON.stringify NIE escapuje "<". Nazwa zakładki z "</script>" zamknęłaby
      wyspę konfiguracji i wstrzyknęła skrypt. Dlatego "<" → <.
   2. String.replace podstawia $& i $' w ZAMIENNIKU. Plik CSS zawierający $&
      zepsułby wyjście. Dlatego każde wstrzyknięcie assetu idzie formą
      funkcyjną: .replace(marker, function () { return value; }).

   Panel konfiguracji komponentu jest generowany z descriptorów pól (FIELDS),
   nie pisany ręcznie dla każdego typu. To jedyny sposób, żeby dziewięć typów
   komponentów nie oznaczało dziewięciu formularzy do utrzymania.
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = document;
  var esc = TBUI.esc;

  /* ====================================================================== assety */

  var ASSET = {};

  function loadAssets() {
    var nodes = doc.querySelectorAll('script[type="text/plain"][data-asset]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var raw = n.textContent;
      // samo atob() zepsułoby polskie znaki — trzeba przez TextDecoder
      ASSET[n.getAttribute('data-asset')] = n.getAttribute('data-enc') === 'b64'
        ? new TextDecoder().decode(Uint8Array.from(atob(raw), function (c) { return c.charCodeAt(0); }))
        : raw;
    }
    try {
      ASSET.themes = JSON.parse(ASSET['themes.json']);
    } catch (e) {
      ASSET.themes = { themes: [] };
    }
  }

  /* ====================================================================== stan */

  var idSeq = 0;
  function mintId(prefix) {
    idSeq++;
    return prefix + Date.now().toString(36).slice(-4) + idSeq.toString(36) +
      Math.floor(Math.random() * 1296).toString(36);
  }

  var W = {
    step: 0,
    cfg: null,
    tab: 0,          // indeks edytowanej zakładki
    cmp: null,       // id edytowanego komponentu
    ds: 0            // indeks edytowanego zbioru
  };

  var STEPS = [
    { id: 0, label: 'Start', icon: '◆' },
    { id: 1, label: 'Podstawy', icon: '⚙' },
    { id: 2, label: 'Dane', icon: '▤' },
    { id: 3, label: 'Zakładki', icon: '▦' },
    { id: 4, label: 'Komponenty', icon: '◳' },
    { id: 5, label: 'Podgląd i zapis', icon: '⤓' }
  ];

  function freshConfig() {
    return {
      $kind: 'tracker.config',
      schema: 1,
      rev: 1,
      meta: {
        trackerId: mintId('trk_'),
        name: 'Mój tracker',
        theme: (ASSET.themes.themes[0] || {}).id || 'amber-dusk',
        allowThemeSwitch: false,
        locale: 'pl-PL',
        currency: 'PLN',
        userName: '',
        fontHref: null,
        useWebFonts: true
      },
      datasets: [],
      tabs: []
    };
  }

  /* ====================================================================== katalogi */

  var COL_TYPES = [
    { v: 'text', l: 'Tekst' },
    { v: 'longtext', l: 'Długi tekst' },
    { v: 'number', l: 'Liczba' },
    { v: 'date', l: 'Data' },
    { v: 'enum', l: 'Lista wyboru' },
    { v: 'bool', l: 'Tak/nie' }
  ];
  var FORMATS = [
    { v: 'num', l: '1 234,56' },
    { v: 'int', l: '1 234' },
    { v: 'pln', l: '1 234,56 zł' },
    { v: 'usd', l: '$1 234' },
    { v: 'pct', l: '12,3%' },
    { v: 'compact', l: '1,2 tys.' }
  ];
  var TONES = [
    { v: '', l: 'bez koloru' },
    { v: 'success', l: 'zielony' },
    { v: 'warning', l: 'żółty' },
    { v: 'danger', l: 'czerwony' },
    { v: 'info', l: 'niebieski' }
  ];
  var OPS = [
    { v: 'count', l: 'Policz wiersze' },
    { v: 'sum', l: 'Suma' },
    { v: 'avg', l: 'Średnia' },
    { v: 'min', l: 'Minimum' },
    { v: 'max', l: 'Maksimum' },
    { v: 'countDistinct', l: 'Liczba unikalnych' }
  ];
  var GRAINS = [
    { v: '', l: 'bez grupowania' },
    { v: 'day', l: 'dziennie' },
    { v: 'month', l: 'miesięcznie' },
    { v: 'year', l: 'rocznie' }
  ];
  var CMPS = [
    { v: 'eq', l: 'jest równe' },
    { v: 'ne', l: 'jest różne od' },
    { v: 'contains', l: 'zawiera' },
    { v: 'gt', l: 'większe niż' },
    { v: 'lt', l: 'mniejsze niż' },
    { v: 'gte', l: 'większe lub równe' },
    { v: 'lte', l: 'mniejsze lub równe' },
    { v: 'empty', l: 'jest puste' },
    { v: 'notEmpty', l: 'jest niepuste' },
    { v: 'relDate', l: 'data względem dziś' }
  ];
  var REL_DATES = [
    { v: 'today', l: 'dziś' },
    { v: 'tomorrow', l: 'jutro' },
    { v: 'overdue', l: 'po terminie' },
    { v: 'next7', l: 'najbliższe 7 dni' },
    { v: 'next30', l: 'najbliższe 30 dni' },
    { v: 'thisMonth', l: 'ten miesiąc' },
    { v: 'lastMonth', l: 'poprzedni miesiąc' }
  ];

  var TYPES = [
    { v: 'kpi', l: 'Karta KPI', i: '①', needsDs: true },
    { v: 'stat', l: 'Statystyka', i: '◷', needsDs: true },
    { v: 'chart', l: 'Wykres', i: '▥', needsDs: true },
    { v: 'table', l: 'Tabela', i: '▤', needsDs: true },
    { v: 'progress', l: 'Pasek postępu', i: '▰', needsDs: true },
    { v: 'banner', l: 'Baner z wnioskiem', i: '❝', needsDs: false },
    { v: 'agenda', l: 'Agenda terminów', i: '🗓', needsDs: false },
    { v: 'notes', l: 'Karteczki', i: '🗒', needsDs: false },
    { v: 'checklist', l: 'Checklista', i: '☑', needsDs: false }
  ];

  var KINDS = [
    { v: 'setField', l: 'Ustaw pole na wartość' },
    { v: 'clearField', l: 'Wyczyść pole' },
    { v: 'duplicate', l: 'Duplikuj wiersz' },
    { v: 'delete', l: 'Usuń wiersz' },
    { v: 'moveTo', l: 'Przenieś do innego zbioru' }
  ];

  /* Descriptory pól — z nich generuje się panel konfiguracji każdego typu. */
  var FIELDS = {
    kpi: [
      { k: 'title', kind: 'text', label: 'Tytuł', wide: true },
      { k: 'subtitle', kind: 'text', label: 'Podpis pod wartością' },
      { k: 'dataset', kind: 'dataset', label: 'Zbiór danych' },
      { k: 'agg.op', kind: 'enum', label: 'Działanie', options: OPS },
      { k: 'agg.field', kind: 'column', label: 'Kolumna', when: function (c) { return c.agg.op !== 'count'; } },
      { k: 'opts.format', kind: 'enum', label: 'Format liczby', options: FORMATS },
      { k: 'opts.spark.field', kind: 'column', label: 'Sparkline po kolumnie z datą', types: ['date'] },
      { k: 'agg.filter', kind: 'filter', label: 'Licz tylko wiersze, gdzie…', wide: true }
    ],
    chart: [
      { k: 'title', kind: 'text', label: 'Tytuł', wide: true },
      { k: 'subtitle', kind: 'text', label: 'Podpis (jednostka, okres)' },
      { k: 'dataset', kind: 'dataset', label: 'Zbiór danych' },
      { k: 'opts.kind', kind: 'enum', label: 'Rodzaj', options: [
        { v: 'bar', l: 'Słupki' }, { v: 'line', l: 'Linia' },
        { v: 'donut', l: 'Pierścień (udział)' }, { v: 'hbar', l: 'Ranking poziomy' }] },
      { k: 'agg.op', kind: 'enum', label: 'Działanie', options: OPS },
      { k: 'agg.field', kind: 'column', label: 'Kolumna', when: function (c) { return c.agg.op !== 'count'; } },
      { k: 'agg.groupBy.field', kind: 'column', label: 'Grupuj po kolumnie' },
      { k: 'agg.groupBy.grain', kind: 'enum', label: 'Ziarno czasu', options: GRAINS },
      { k: 'agg.split.field', kind: 'column', label: 'Podziel na serie po kolumnie' },
      { k: 'agg.groupBy.limit', kind: 'number', label: 'Maks. grup (0 = bez limitu)' },
      { k: 'agg.filter', kind: 'filter', label: 'Licz tylko wiersze, gdzie…', wide: true }
    ],
    table: [
      { k: 'title', kind: 'text', label: 'Tytuł', wide: true },
      { k: 'dataset', kind: 'dataset', label: 'Zbiór danych' },
      { k: 'opts.pageSize', kind: 'number', label: 'Wierszy na stronę' },
      { k: 'opts.editable', kind: 'bool', label: 'Pozwól edytować' },
      { k: 'opts.selectable', kind: 'bool', label: 'Checkboksy do zaznaczania' },
      { k: 'opts.search', kind: 'bool', label: 'Pole wyszukiwania' },
      { k: 'opts.rowNotes', kind: 'bool', label: 'Karteczki przy wierszu' },
      { k: 'opts.columns', kind: 'columns', label: 'Które kolumny pokazać', wide: true },
      { k: 'opts.filter', kind: 'filter', label: 'Stały filtr (tak robi się zapisany widok)', wide: true },
      { k: 'opts.contextMenu', kind: 'ctxmenu', label: 'Menu pod prawym przyciskiem', wide: true }
    ],
    progress: [
      { k: 'title', kind: 'text', label: 'Tytuł', wide: true },
      { k: 'subtitle', kind: 'text', label: 'Opis' },
      { k: 'dataset', kind: 'dataset', label: 'Zbiór danych' },
      { k: 'agg.op', kind: 'enum', label: 'Działanie', options: OPS },
      { k: 'agg.field', kind: 'column', label: 'Kolumna', when: function (c) { return c.agg.op !== 'count'; } },
      { k: 'opts.target', kind: 'number', label: 'Cel (liczba)' },
      { k: 'opts.format', kind: 'enum', label: 'Format liczby', options: FORMATS },
      { k: 'agg.filter', kind: 'filter', label: 'Licz tylko wiersze, gdzie…', wide: true }
    ],
    banner: [
      { k: 'title', kind: 'text', label: 'Nagłówek', wide: true },
      { k: 'opts.text', kind: 'text', label: 'Treść ({{v}} wstawi wyliczoną liczbę)', wide: true },
      { k: 'opts.tone', kind: 'enum', label: 'Ton', options: [
        { v: '', l: 'neutralny' }, { v: 'accent', l: 'akcent' },
        { v: 'success', l: 'zielony' }, { v: 'warning', l: 'żółty' }, { v: 'danger', l: 'czerwony' }] },
      { k: 'opts.icon', kind: 'text', label: 'Ikona (jeden znak)' },
      { k: 'dataset', kind: 'dataset', label: 'Zbiór do wyliczenia {{v}}' },
      { k: 'agg.op', kind: 'enum', label: 'Działanie', options: OPS },
      { k: 'agg.field', kind: 'column', label: 'Kolumna', when: function (c) { return c.agg.op !== 'count'; } },
      { k: 'agg.filter', kind: 'filter', label: 'Licz tylko wiersze, gdzie…', wide: true }
    ],
    agenda: [
      { k: 'title', kind: 'text', label: 'Tytuł', wide: true },
      { k: 'subtitle', kind: 'text', label: 'Podpis' },
      { k: 'opts.range', kind: 'enum', label: 'Zakres', options: [
        { v: '', l: 'wszystko' }, { v: 'next30', l: 'najbliższe 30 dni' }] },
      { k: 'opts.showOverdue', kind: 'bool', label: 'Pokaż też po terminie' },
      { k: 'opts.sources', kind: 'sources', label: 'Skąd brać terminy', wide: true }
    ],
    notes: [
      { k: 'title', kind: 'text', label: 'Tytuł', wide: true },
      { k: 'subtitle', kind: 'text', label: 'Podpis' }
    ],
    checklist: [
      { k: 'title', kind: 'text', label: 'Tytuł', wide: true },
      { k: 'subtitle', kind: 'text', label: 'Podpis' },
      { k: 'opts.resetDaily', kind: 'bool', label: 'Codziennie odznaczaj od nowa' },
      { k: 'opts.showDue', kind: 'bool', label: 'Pokaż terminy pozycji' }
    ]
  };
  FIELDS.stat = FIELDS.kpi;

  /* ====================================================================== ścieżki */

  function getPath(obj, path) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function setPath(obj, path, value) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function dsOf(id) {
    return W.cfg.datasets.filter(function (d) { return d.id === id; })[0] || null;
  }

  /* ====================================================================== helpery DOM */

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(label, cls, onClick) {
    var b = el('button', 'btn ' + (cls || 'btn-secondary'), label);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function mini(label, title, onClick, danger) {
    var b = el('button', 'wz-mini' + (danger ? ' wz-mini-danger' : ''), label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function field(label, control, wide) {
    var f = el('div', 'tb-field' + (wide ? ' wz-wide' : ''));
    var l = el('label', null, label);
    var id = 'wzf' + (++idSeq);
    control.id = id;
    l.htmlFor = id;
    f.appendChild(l);
    f.appendChild(control);
    return f;
  }
  function input(value, onChange, type) {
    var i = el('input', 'tb-input');
    i.type = type || 'text';
    i.value = value == null ? '' : value;
    i.addEventListener('change', function () { onChange(i.value); });
    return i;
  }
  function select(options, value, onChange) {
    var s = el('select', 'tb-select');
    options.forEach(function (o) {
      var op = el('option', null, o.l);
      op.value = o.v;
      s.appendChild(op);
    });
    s.value = value == null ? '' : value;
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }
  function checkbox(label, value, onChange) {
    var w = el('label', 'tb-switch');
    var i = doc.createElement('input');
    i.type = 'checkbox';
    i.checked = !!value;
    i.addEventListener('change', function () { onChange(i.checked); });
    w.appendChild(i);
    w.appendChild(doc.createTextNode(label));
    return w;
  }
  function card(title, bodyEl, headExtra) {
    var c = el('section', 'card');
    if (title || headExtra) {
      var h = el('div', 'card-h');
      h.appendChild(el('div', 'card-t', title || ''));
      if (headExtra) h.appendChild(headExtra);
      c.appendChild(h);
    }
    if (bodyEl) c.appendChild(bodyEl);
    return c;
  }
  function hint(text) {
    var p = el('p', 'tb-dim', text);
    p.style.cssText = 'font-size:12.5px;margin:0 0 10px';
    return p;
  }

  /* ====================================================================== szablony */

  function tplEmpty() {
    var cfg = freshConfig();
    cfg.meta.name = 'Mój tracker';
    var ds = { id: mintId('ds_'), name: 'Dane', titleField: null, columns: [] };
    ds.columns.push({ id: mintId('c_'), label: 'Nazwa', type: 'text', required: true });
    ds.titleField = ds.columns[0].id;
    cfg.datasets.push(ds);
    cfg.tabs.push({
      id: mintId('t_'), label: 'Dane', icon: '▤', preset: 'data',
      layout: { cols: 1, variant: 'even' },
      components: [{
        id: mintId('k_'), type: 'table', title: 'Dane', col: 0, order: 10, span: 'full',
        dataset: ds.id, agg: { op: 'count' },
        opts: { pageSize: 50, editable: true, selectable: true, search: true, rowNotes: true,
          columns: [], contextMenu: { builtins: ['edit', 'duplicate', 'delete', 'addNote', 'copyRow', 'exportSelected'], actions: [] } }
      }]
    });
    return cfg;
  }

  function tplQueries() {
    var cfg = freshConfig();
    cfg.meta.name = 'Rejestr zapytań';
    var c = {
      req: mintId('c_'), subj: mintId('c_'), recv: mintId('c_'),
      due: mintId('c_'), stat: mintId('c_'), asg: mintId('c_'), res: mintId('c_')
    };
    var ds = {
      id: mintId('ds_'), name: 'Zapytania', titleField: c.subj,
      columns: [
        { id: c.req, label: 'Zgłaszający', type: 'text', required: true },
        { id: c.subj, label: 'Temat', type: 'text', required: true },
        { id: c.recv, label: 'Wpłynęło', type: 'date', default: '@today' },
        { id: c.due, label: 'Termin', type: 'date' },
        { id: c.stat, label: 'Status', type: 'enum', default: 'new', options: [
          { value: 'new', label: 'Nowe', tone: 'info' },
          { value: 'wip', label: 'W toku', tone: 'warning' },
          { value: 'done', label: 'Zamknięte', tone: 'success' }] },
        { id: c.asg, label: 'Opiekun', type: 'text' },
        { id: c.res, label: 'Rozwiązanie', type: 'longtext' }
      ]
    };
    cfg.datasets.push(ds);

    var openFilter = { op: 'and', rules: [{ field: c.stat, cmp: 'ne', value: 'done' }] };

    cfg.tabs.push({
      id: mintId('t_'), label: 'Podsumowanie', icon: '◷', preset: 'summary',
      layout: { cols: 2, variant: 'main' },
      components: [
        { id: mintId('k_'), type: 'banner', title: 'Otwarte zapytania', col: 0, order: 5, span: 'full',
          dataset: ds.id, agg: { op: 'count', filter: openFilter },
          opts: { tone: 'accent', icon: 'ℹ', text: 'Do obsługi zostało {{v}}.', format: 'int' } },
        { id: mintId('k_'), type: 'kpi', title: 'Wszystkie zapytania', col: 0, order: 10,
          dataset: ds.id, agg: { op: 'count' }, opts: { format: 'int' } },
        { id: mintId('k_'), type: 'kpi', title: 'Po terminie', col: 1, order: 11,
          dataset: ds.id,
          agg: { op: 'count', filter: { op: 'and', rules: [
            { field: c.due, cmp: 'relDate', value: 'overdue' },
            { field: c.stat, cmp: 'ne', value: 'done' }] } },
          opts: { format: 'int' } },
        { id: mintId('k_'), type: 'chart', title: 'Zapytania w czasie', col: 0, order: 20,
          dataset: ds.id,
          agg: { op: 'count', groupBy: { field: c.recv, grain: 'month', sort: 'key_asc' } },
          opts: { kind: 'bar' } },
        { id: mintId('k_'), type: 'chart', title: 'Podział po statusie', col: 1, order: 21,
          dataset: ds.id, agg: { op: 'count', groupBy: { field: c.stat, sort: 'value_desc' } },
          opts: { kind: 'donut' } }
      ]
    });

    cfg.tabs.push({
      id: mintId('t_'), label: 'Rejestr', icon: '▤', preset: 'query',
      layout: { cols: 1, variant: 'even' },
      components: [{
        id: mintId('k_'), type: 'table', title: 'Zapytania', col: 0, order: 10, span: 'full',
        dataset: ds.id, agg: { op: 'count' },
        opts: {
          pageSize: 50, editable: true, selectable: true, search: true, rowNotes: true,
          columns: [c.recv, c.subj, c.req, c.stat, c.due, c.asg],
          quickFilters: [
            { label: 'Otwarte', filter: openFilter },
            { label: 'Po terminie', filter: { op: 'and', rules: [
              { field: c.due, cmp: 'relDate', value: 'overdue' },
              { field: c.stat, cmp: 'ne', value: 'done' }] } }
          ],
          contextMenu: {
            builtins: ['edit', 'duplicate', 'delete', 'addNote', 'copyRow', 'exportSelected'],
            actions: [
              { id: mintId('a_'), label: 'Zamknij zapytanie', icon: '✓', kind: 'setField', field: c.stat, value: 'done' },
              { id: mintId('a_'), label: 'Termin na dziś', icon: '📅', kind: 'setField', field: c.due, value: '@today' },
              { id: mintId('a_'), label: 'Przypisz do mnie', icon: '👤', kind: 'setField', field: c.asg, value: '@user' }
            ]
          }
        }
      }]
    });

    cfg.tabs.push({
      id: mintId('t_'), label: 'Terminy', icon: '🗓', preset: 'agenda',
      layout: { cols: 2, variant: 'main' },
      components: [
        { id: mintId('k_'), type: 'agenda', title: 'Najbliższe terminy', col: 0, order: 10,
          opts: { range: 'next30', showOverdue: true, display: 'list',
            sources: [{ dataset: ds.id, dateField: c.due, titleField: c.subj,
              metaField: c.asg, toneField: c.stat, filter: openFilter }] } },
        { id: mintId('k_'), type: 'checklist', title: 'Rytuały dnia', col: 1, order: 11,
          opts: { resetDaily: true, showDue: false } }
      ]
    });

    cfg.tabs.push({
      id: mintId('t_'), label: 'Notatki', icon: '🗒', preset: 'notes',
      layout: { cols: 1, variant: 'even' },
      components: [{ id: mintId('k_'), type: 'notes', title: 'Karteczki', col: 0, order: 10, span: 'full', opts: {} }]
    });
    return cfg;
  }

  function tplTasks() {
    var cfg = freshConfig();
    cfg.meta.name = 'Zadania i notatki';
    var c = { t: mintId('c_'), due: mintId('c_'), pr: mintId('c_'), done: mintId('c_'), who: mintId('c_') };
    var ds = {
      id: mintId('ds_'), name: 'Zadania', titleField: c.t,
      columns: [
        { id: c.t, label: 'Zadanie', type: 'text', required: true },
        { id: c.due, label: 'Termin', type: 'date' },
        { id: c.pr, label: 'Priorytet', type: 'enum', default: 'mid', options: [
          { value: 'low', label: 'Niski', tone: '' },
          { value: 'mid', label: 'Średni', tone: 'warning' },
          { value: 'high', label: 'Wysoki', tone: 'danger' }] },
        { id: c.who, label: 'Kto', type: 'text', default: '@user' },
        { id: c.done, label: 'Zrobione', type: 'bool' }
      ]
    };
    cfg.datasets.push(ds);
    var notDone = { op: 'and', rules: [{ field: c.done, cmp: 'ne', value: 'true' }] };
    cfg.tabs.push({
      id: mintId('t_'), label: 'Dziś', icon: '◆', preset: 'summary',
      layout: { cols: 2, variant: 'main' },
      components: [
        { id: mintId('k_'), type: 'agenda', title: 'Terminy', col: 0, order: 10,
          opts: { range: 'next30', showOverdue: true, display: 'list',
            sources: [{ dataset: ds.id, dateField: c.due, titleField: c.t, metaField: c.who, toneField: c.pr }] } },
        { id: mintId('k_'), type: 'checklist', title: 'Checklista dnia', col: 1, order: 11,
          opts: { resetDaily: true } },
        { id: mintId('k_'), type: 'notes', title: 'Karteczki', col: 1, order: 12, opts: {} }
      ]
    });
    cfg.tabs.push({
      id: mintId('t_'), label: 'Zadania', icon: '▤', preset: 'data',
      layout: { cols: 1, variant: 'even' },
      components: [{
        id: mintId('k_'), type: 'table', title: 'Wszystkie zadania', col: 0, order: 10, span: 'full',
        dataset: ds.id, agg: { op: 'count' },
        opts: {
          pageSize: 50, editable: true, selectable: true, search: true, rowNotes: true,
          columns: [c.t, c.due, c.pr, c.who, c.done],
          quickFilters: [{ label: 'Niezrobione', filter: notDone }],
          contextMenu: {
            builtins: ['edit', 'duplicate', 'delete', 'addNote', 'copyRow', 'exportSelected'],
            actions: [
              { id: mintId('a_'), label: 'Oznacz jako zrobione', icon: '✓', kind: 'setField', field: c.done, value: 'true' },
              { id: mintId('a_'), label: 'Termin na dziś', icon: '📅', kind: 'setField', field: c.due, value: '@today' }
            ]
          }
        }
      }]
    });
    return cfg;
  }

  var TEMPLATES = [
    { id: 'queries', name: 'Rejestr zapytań', text: 'Zgłoszenia od biznesu: kto pyta, status, termin, opiekun. Plus podsumowanie, terminy i karteczki.', make: tplQueries },
    { id: 'tasks', name: 'Zadania i notatki', text: 'Lista zadań z priorytetami, checklista dnia, karteczki i agenda terminów.', make: tplTasks },
    { id: 'empty', name: 'Pusty tracker', text: 'Jeden zbiór danych i jedna tabela. Wszystko inne dobudujesz sam.', make: tplEmpty }
  ];

  /* ====================================================================== kroki */

  function render() {
    renderRail();
    for (var i = 0; i <= 5; i++) {
      doc.getElementById('wz-step-' + i).hidden = i !== W.step;
    }
    doc.getElementById('wz-step-title').textContent = STEPS[W.step].label;
    doc.getElementById('wz-progress').textContent = 'krok ' + (W.step + 1) + ' z 6';
    doc.getElementById('wz-prev').disabled = W.step === 0;
    var next = doc.getElementById('wz-next');
    next.textContent = W.step === 5 ? 'Zapisz tracker' : 'Dalej →';
    next.disabled = W.step === 0 && !W.cfg;
    doc.getElementById('wz-errors').innerHTML = '';

    if (W.step === 0) renderStep0();
    if (W.step === 1) renderStep1();
    if (W.step === 2) renderStep2();
    if (W.step === 3) renderStep3();
    if (W.step === 4) renderStep4();
    if (W.step === 5) renderStep5();

    doc.getElementById('wz-side-note').textContent = {
      0: 'Wybierz szablon albo wczytaj plik .tracker.json, jeśli chcesz zmienić istniejący tracker.',
      1: 'Styl zmienisz później, wracając do tego kroku i generując tracker ponownie.',
      2: 'Nazwy kolumn możesz zmieniać bez końca. Usunięcie kolumny nie usuwa danych z istniejącego trackera.',
      3: 'Układ to podział ekranu na kolumny. Kolumny danych tabeli ustawia się w kroku Komponenty.',
      4: 'Komponenty liczące podpinają się pod zbiór danych i same przeliczają się po każdej zmianie.',
      5: 'Zapisz oba pliki. HTML to tracker, .tracker.json to jego struktura do późniejszych zmian.'
    }[W.step] || '';
  }

  function renderRail() {
    var rail = doc.getElementById('wz-rail');
    rail.innerHTML = '';
    STEPS.forEach(function (s) {
      var a = el('a', s.id === W.step ? 'is-active' : '');
      a.href = '#';
      a.innerHTML = '<i>' + esc(s.icon) + '</i>' + esc(s.label);
      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (!W.cfg && s.id > 0) return;
        W.step = s.id;
        render();
      });
      rail.appendChild(a);
    });
  }

  /* ---- krok 0: start ---- */

  function renderStep0() {
    var box = doc.getElementById('wz-start-cards');
    box.innerHTML = '';
    TEMPLATES.forEach(function (t) {
      var b = el('button', 'wz-tile');
      b.type = 'button';
      b.appendChild(el('div', 'wz-tile-title', t.name));
      b.appendChild(el('div', 'wz-tile-text', t.text));
      b.addEventListener('click', function () {
        W.cfg = t.make();
        W.step = 1;
        render();
        TBUI.toast('Szablon „' + t.name + '" wczytany', 'success');
      });
      box.appendChild(b);
    });
  }

  /* ---- krok 1: podstawy ---- */

  function renderStep1() {
    var host = doc.getElementById('wz-step-1');
    host.innerHTML = '';
    var m = W.cfg.meta;

    var basics = el('div', 'wz-fields');
    basics.appendChild(field('Nazwa trackera', input(m.name, function (v) {
      m.name = v.trim() || 'Tracker';
    }), true));
    basics.appendChild(field('Waluta', select(
      [{ v: 'PLN', l: 'złoty (PLN)' }, { v: 'EUR', l: 'euro (EUR)' }, { v: 'USD', l: 'dolar (USD)' }],
      m.currency, function (v) { m.currency = v; })));
    basics.appendChild(field('Twoje imię (dla akcji „przypisz do mnie")',
      input(m.userName, function (v) { m.userName = v.trim(); })));
    host.appendChild(card('Podstawy', basics));

    var themes = el('div', 'wz-themes');
    (ASSET.themes.themes || []).forEach(function (t) {
      var b = el('button', 'wz-tile');
      b.type = 'button';
      b.setAttribute('aria-pressed', m.theme === t.id ? 'true' : 'false');
      var sw = el('div', 'wz-swatch');
      sw.innerHTML =
        '<span style="background:' + esc(t.swatch.pageBg) + '"></span>' +
        '<span style="background:' + esc(t.swatch.surface) + '"></span>' +
        '<span class="wz-sw-series">' + t.swatch.series.map(function (c) {
          return '<i style="background:' + esc(c) + '"></i>';
        }).join('') + '</span>';
      b.appendChild(sw);
      b.appendChild(el('div', 'wz-tile-title', t.name));
      b.appendChild(el('div', 'wz-tile-text', Math.round(t.bytes / 1024) + ' KB'));
      b.addEventListener('click', function () {
        m.theme = t.id;
        m.fontHref = t.fontHref || null;
        renderStep1();
      });
      themes.appendChild(b);
    });
    var themeBox = el('div', '');
    themeBox.appendChild(hint('Styl wpływa na kolory, typografię i kształty. Komponenty i dane są te same ' +
      'w każdym z nich.'));
    themeBox.appendChild(themes);

    var extras = el('div', 'tb-stack');
    extras.style.marginTop = '14px';
    var allThemesKb = Math.round((ASSET.themes.themes || []).reduce(function (s, t) {
      return s + t.bytes;
    }, 0) / 1024);
    var oneKb = Math.round(((ASSET.themes.themes || []).filter(function (t) {
      return t.id === m.theme;
    })[0] || { bytes: 0 }).bytes / 1024);
    extras.appendChild(checkbox(
      'Pozwól przełączać styl w gotowym trackerze (+' + Math.max(0, allThemesKb - oneKb) + ' KB)',
      m.allowThemeSwitch, function (v) { m.allowThemeSwitch = v; renderStep1(); }));
    extras.appendChild(checkbox(
      'Wczytuj fonty z internetu, gdy jest połączenie (bez tego: fonty systemowe)',
      m.useWebFonts, function (v) { m.useWebFonts = v; }));
    themeBox.appendChild(extras);
    host.appendChild(card('Styl', themeBox));
  }

  /* ---- krok 2: dane ---- */

  function renderStep2() {
    var host = doc.getElementById('wz-step-2');
    host.innerHTML = '';
    if (!W.cfg.datasets.length) {
      W.cfg.datasets.push({ id: mintId('ds_'), name: 'Dane', titleField: null, columns: [] });
    }
    if (W.ds >= W.cfg.datasets.length) W.ds = 0;

    var split = el('div', 'wz-split');

    // lista zbiorów
    var left = el('div', '');
    left.appendChild(hint('Zbiór danych to jedna tabela: kolumny i wiersze. ' +
      'Komponenty liczące podpinają się pod zbiór.'));
    W.cfg.datasets.forEach(function (d, i) {
      var row = el('div', 'wz-row');
      if (i === W.ds) row.style.borderColor = 'var(--accent)';
      var main = el('div', 'wz-row-main');
      main.appendChild(el('div', 'wz-row-title', d.name));
      main.appendChild(el('div', 'wz-row-meta', d.columns.length + ' kolumn'));
      main.style.cursor = 'pointer';
      main.addEventListener('click', function () { W.ds = i; renderStep2(); });
      row.appendChild(main);
      var acts = el('div', 'wz-row-actions');
      acts.appendChild(mini('✕', 'Usuń zbiór', function () {
        var used = usedDataset(d.id);
        TBUI.confirm({
          title: 'Usunąć zbiór „' + d.name + '"?',
          text: used ? 'Korzysta z niego ' + used + ' komponentów — stracą źródło danych.'
            : 'Zbiór nie jest nigdzie używany.',
          confirmLabel: 'Usuń zbiór', tone: 'danger'
        }).then(function (ok) {
          if (!ok) return;
          W.cfg.datasets.splice(i, 1);
          W.ds = 0;
          renderStep2();
        });
      }, true));
      row.appendChild(acts);
      left.appendChild(row);
    });
    var add = btn('+ Nowy zbiór', 'btn-secondary', function () {
      W.cfg.datasets.push({ id: mintId('ds_'), name: 'Nowy zbiór', titleField: null, columns: [] });
      W.ds = W.cfg.datasets.length - 1;
      renderStep2();
    });
    add.style.marginTop = '8px';
    left.appendChild(add);
    split.appendChild(card('Zbiory danych', left));

    // edytor kolumn
    var ds = W.cfg.datasets[W.ds];
    var right = el('div', 'tb-stack');
    var nameRow = el('div', 'wz-fields');
    nameRow.appendChild(field('Nazwa zbioru', input(ds.name, function (v) {
      ds.name = v.trim() || 'Zbiór';
      renderStep2();
    })));
    nameRow.appendChild(field('Kolumna z nazwą wiersza', select(
      [{ v: '', l: '— brak —' }].concat(ds.columns.map(function (c) { return { v: c.id, l: c.label }; })),
      ds.titleField || '', function (v) { ds.titleField = v || null; })));
    right.appendChild(nameRow);

    var list = el('div', '');
    ds.columns.forEach(function (c, i) {
      list.appendChild(columnRow(ds, c, i));
    });
    if (!ds.columns.length) {
      list.appendChild(el('p', 'tb-dim', 'Brak kolumn. Dodaj pierwszą albo wklej nagłówek z Excela.'));
    }
    right.appendChild(list);

    var bar = el('div', 'tb-flexrow');
    bar.appendChild(btn('+ Dodaj kolumnę', 'btn-primary', function () {
      ds.columns.push({ id: mintId('c_'), label: 'Nowa kolumna', type: 'text' });
      if (!ds.titleField) ds.titleField = ds.columns[0].id;
      renderStep2();
    }));
    bar.appendChild(btn('Wklej nagłówek z Excela', 'btn-secondary', function () {
      pasteColumns(ds);
    }));
    right.appendChild(bar);
    split.appendChild(card('Kolumny zbioru „' + ds.name + '"', right));

    host.appendChild(split);

    var warn = el('div', 'tb-banner tb-banner-accent');
    warn.innerHTML = '<i>ℹ</i><div class="tb-banner-body"><div class="tb-banner-title">' +
      'Zmiana nazwy to nie to samo co usunięcie</div><div class="tb-banner-text">' +
      'Nazwę kolumny możesz zmieniać dowolnie — dane zostają, bo tracker rozpoznaje kolumny ' +
      'po ukrytym identyfikatorze. Natomiast <b>usunięcie</b> kolumny ukrywa jej dane ' +
      '(wracają, jeśli dodasz ją ponownie). Nie usuwaj kolumny, żeby ją „przemianować".</div></div>';
    host.appendChild(warn);
  }

  function usedDataset(dsId) {
    var n = 0;
    W.cfg.tabs.forEach(function (t) {
      (t.components || []).forEach(function (c) {
        if (c.dataset === dsId) n++;
        ((c.opts || {}).sources || []).forEach(function (s) { if (s.dataset === dsId) n++; });
      });
    });
    return n;
  }

  function columnRow(ds, c, i) {
    var row = el('div', 'wz-row');
    var main = el('div', 'wz-row-main');
    var top = el('div', 'tb-flexrow');
    top.style.gap = '6px';
    var nameI = input(c.label, function (v) { c.label = v.trim() || 'Kolumna'; });
    nameI.className = 'tb-input tb-input-sm';
    nameI.style.flex = '1 1 140px';
    nameI.setAttribute('aria-label', 'Nazwa kolumny');
    top.appendChild(nameI);
    var typeS = select(COL_TYPES.map(function (t) { return { v: t.v, l: t.l }; }), c.type, function (v) {
      c.type = v;
      if (v !== 'enum') delete c.options;
      if (v !== 'number') delete c.format;
      renderStep2();
    });
    typeS.className = 'tb-select tb-input-sm';
    typeS.style.flex = '0 0 130px';
    typeS.setAttribute('aria-label', 'Typ kolumny');
    top.appendChild(typeS);
    if (c.type === 'number') {
      var fmtS = select(FORMATS.map(function (f) { return { v: f.v, l: f.l }; }), c.format || 'num',
        function (v) { c.format = v; });
      fmtS.className = 'tb-select tb-input-sm';
      fmtS.style.flex = '0 0 120px';
      fmtS.setAttribute('aria-label', 'Format liczby');
      top.appendChild(fmtS);
    }
    main.appendChild(top);

    var bottom = el('div', 'tb-flexrow');
    bottom.style.cssText = 'gap:10px;margin-top:4px';
    bottom.appendChild(checkbox('wymagana', c.required, function (v) {
      if (v) c.required = true; else delete c.required;
    }));
    if (c.type === 'date') {
      bottom.appendChild(checkbox('domyślnie dziś', c.default === '@today', function (v) {
        if (v) c.default = '@today'; else delete c.default;
      }));
    }
    if (c.type === 'text') {
      bottom.appendChild(checkbox('domyślnie Twoje imię', c.default === '@user', function (v) {
        if (v) c.default = '@user'; else delete c.default;
      }));
    }
    if (c.type === 'enum') {
      bottom.appendChild(btn('Opcje listy (' + ((c.options || []).length) + ')', 'btn-ghost', function () {
        editOptions(c);
      }));
    }
    main.appendChild(bottom);
    row.appendChild(main);

    var acts = el('div', 'wz-row-actions');
    acts.appendChild(mini('↑', 'W górę', function () {
      if (i === 0) return;
      ds.columns.splice(i - 1, 0, ds.columns.splice(i, 1)[0]);
      renderStep2();
    }));
    acts.appendChild(mini('↓', 'W dół', function () {
      if (i >= ds.columns.length - 1) return;
      ds.columns.splice(i + 1, 0, ds.columns.splice(i, 1)[0]);
      renderStep2();
    }));
    acts.appendChild(mini('✕', 'Usuń kolumnę', function () {
      TBUI.confirm({
        title: 'Usunąć kolumnę „' + c.label + '"?',
        text: 'W istniejącym trackerze jej dane zostaną ukryte, nie wymazane — wrócą, ' +
          'jeśli dodasz tę kolumnę ponownie. Jeśli chcesz tylko zmienić nazwę, zamknij to okno ' +
          'i edytuj pole z nazwą.',
        confirmLabel: 'Usuń kolumnę', tone: 'danger'
      }).then(function (ok) {
        if (!ok) return;
        ds.columns.splice(i, 1);
        if (ds.titleField === c.id) ds.titleField = ds.columns.length ? ds.columns[0].id : null;
        W.cfg.tabs.forEach(function (t) {
          (t.components || []).forEach(function (cm) {
            if (cm.opts && cm.opts.columns) {
              cm.opts.columns = cm.opts.columns.filter(function (x) { return x !== c.id; });
            }
          });
        });
        renderStep2();
      });
    }, true));
    row.appendChild(acts);
    return row;
  }

  function editOptions(col) {
    col.options = col.options || [];
    var wrap = el('div', 'tb-stack');

    function draw() {
      wrap.innerHTML = '';
      wrap.appendChild(hint('Wartość to identyfikator zapisywany w danych; etykieta jest tym, ' +
        'co widzi użytkownik i co trafia do eksportu Excela.'));
      col.options.forEach(function (o, i) {
        var r = el('div', 'wz-row');
        var m = el('div', 'tb-flexrow');
        m.style.cssText = 'flex:1;gap:6px';
        var vi = input(o.value, function (v) { o.value = v.trim(); });
        vi.className = 'tb-input tb-input-sm';
        vi.placeholder = 'wartość';
        vi.setAttribute('aria-label', 'Wartość');
        var li = input(o.label, function (v) { o.label = v; });
        li.className = 'tb-input tb-input-sm';
        li.placeholder = 'etykieta';
        li.setAttribute('aria-label', 'Etykieta');
        var ts = select(TONES, o.tone || '', function (v) { o.tone = v; });
        ts.className = 'tb-select tb-input-sm';
        ts.style.flex = '0 0 120px';
        ts.setAttribute('aria-label', 'Kolor');
        m.appendChild(vi);
        m.appendChild(li);
        m.appendChild(ts);
        r.appendChild(m);
        var a = el('div', 'wz-row-actions');
        a.appendChild(mini('✕', 'Usuń opcję', function () {
          col.options.splice(i, 1);
          draw();
        }, true));
        r.appendChild(a);
        wrap.appendChild(r);
      });
      var add = btn('+ Dodaj opcję', 'btn-secondary', function () {
        col.options.push({ value: 'opcja' + (col.options.length + 1), label: 'Opcja ' + (col.options.length + 1), tone: '' });
        draw();
      });
      wrap.appendChild(add);
    }
    draw();

    TBUI.modal.show({
      size: 'lg', title: 'Opcje listy „' + col.label + '"', body: wrap,
      actions: [{ label: 'Gotowe', variant: 'primary', onClick: function () { renderStep2(); } }]
    });
  }

  function pasteColumns(ds) {
    var ta = el('textarea', 'tb-textarea');
    ta.style.minHeight = '140px';
    ta.placeholder = 'Wklej z Excela nagłówek i kilka wierszy (Ctrl+V).\n' +
      'Z pierwszego wiersza powstaną nazwy kolumn, a typy zgadnę z danych poniżej.';
    ta.setAttribute('aria-label', 'Wklej nagłówek z Excela');
    var wrap = el('div', 'tb-stack');
    wrap.appendChild(hint('Kreator utworzy same kolumny. Dane wczytasz już w gotowym trackerze — ' +
      'ma do tego ten sam mechanizm wklejania.'));
    wrap.appendChild(ta);

    TBUI.modal.show({
      size: 'lg', title: 'Wklej nagłówek z Excela', body: wrap,
      onOpen: function () { setTimeout(function () { ta.focus(); }, 50); },
      actions: [
        { label: 'Anuluj', variant: 'ghost' },
        { label: 'Utwórz kolumny', variant: 'primary', close: false, onClick: function () {
          var rows = parseDelimited(ta.value);
          if (!rows.length) {
            TBUI.toast('Nie widzę żadnych danych do odczytania', 'warning');
            return false;
          }
          var header = rows[0];
          var body = rows.slice(1);
          var added = 0;
          header.forEach(function (h, i) {
            var label = String(h).trim();
            if (!label) return;
            var samples = body.map(function (r) { return r[i]; })
              .filter(function (v) { return v != null && String(v).trim() !== ''; });
            ds.columns.push({ id: mintId('c_'), label: label, type: guessType(samples) });
            added++;
          });
          if (!ds.titleField && ds.columns.length) ds.titleField = ds.columns[0].id;
          TBUI.toast('Utworzono ' + added + ' kolumn', 'success');
          TBUI.modal.close(wrap.closest('dialog'));
          renderStep2();
          return false;
        } }
      ]
    });
  }

  function guessType(samples) {
    if (!samples.length) return 'text';
    var dates = 0, nums = 0, bools = 0, uniq = {};
    samples.forEach(function (s) {
      var v = String(s).trim();
      uniq[v.toLowerCase()] = 1;
      if (/^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(v)) dates++;
      else if (/^-?[\d\s]+([.,]\d+)?$/.test(v)) nums++;
      if (/^(tak|nie|true|false|yes|no|1|0)$/i.test(v)) bools++;
    });
    var n = samples.length;
    if (bools === n && Object.keys(uniq).length <= 2) return 'bool';
    if (dates / n >= 0.7) return 'date';
    if (nums / n >= 0.7) return 'number';
    if (Object.keys(uniq).length <= Math.max(2, Math.min(8, n / 2))) return 'enum';
    if (samples.some(function (s) { return String(s).length > 80; })) return 'longtext';
    return 'text';
  }

  /* prosty parser CSV/TSV — ta sama logika co w runtimie trackera */
  function parseDelimited(text, delim) {
    if (!delim) {
      var head = text.split(/\r?\n/).slice(0, 5).join('\n');
      var counts = { '\t': 0, ';': 0, ',': 0 };
      Object.keys(counts).forEach(function (d) { counts[d] = head.split(d).length - 1; });
      delim = '\t';
      Object.keys(counts).forEach(function (d) { if (counts[d] > counts[delim]) delim = d; });
      if (!counts[delim]) delim = ',';
    }
    var rows = [], row = [], f = '', inQ = false, i = 0;
    text = text.replace(/^﻿/, '');
    while (i < text.length) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { f += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        f += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === delim) { row.push(f); f = ''; i++; continue; }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = ''; rows.push(row); row = []; i++; continue;
      }
      f += ch; i++;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  /* ---- krok 3: zakładki ---- */

  function renderStep3() {
    var host = doc.getElementById('wz-step-3');
    host.innerHTML = '';
    var body = el('div', '');
    body.appendChild(hint('Zakładka to jedna strona trackera. Układ dzieli ją na kolumny; ' +
      'komponenty rozmieszcza się w kroku następnym.'));

    W.cfg.tabs.forEach(function (t, i) {
      var row = el('div', 'wz-row');
      var main = el('div', 'wz-row-main');
      var top = el('div', 'tb-flexrow');
      top.style.gap = '6px';
      var ni = input(t.label, function (v) { t.label = v.trim() || 'Zakładka'; });
      ni.className = 'tb-input tb-input-sm';
      ni.style.flex = '1 1 160px';
      ni.setAttribute('aria-label', 'Nazwa zakładki');
      top.appendChild(ni);
      var ii = input(t.icon || '▦', function (v) { t.icon = v.slice(0, 2) || '▦'; });
      ii.className = 'tb-input tb-input-sm';
      ii.style.flex = '0 0 56px';
      ii.setAttribute('aria-label', 'Ikona');
      top.appendChild(ii);
      var cs = select([{ v: '1', l: '1 kolumna' }, { v: '2', l: '2 kolumny' }, { v: '3', l: '3 kolumny' }],
        String((t.layout && t.layout.cols) || 1), function (v) {
          t.layout = t.layout || {};
          t.layout.cols = +v;
          renderStep3();
        });
      cs.className = 'tb-select tb-input-sm';
      cs.style.flex = '0 0 120px';
      cs.setAttribute('aria-label', 'Liczba kolumn');
      top.appendChild(cs);
      if ((t.layout && t.layout.cols) === 2) {
        var vs = select([{ v: 'even', l: 'równe' }, { v: 'main', l: 'szeroka + wąska' }],
          (t.layout.variant || 'even'), function (v) { t.layout.variant = v; });
        vs.className = 'tb-select tb-input-sm';
        vs.style.flex = '0 0 150px';
        vs.setAttribute('aria-label', 'Proporcje kolumn');
        top.appendChild(vs);
      }
      main.appendChild(top);
      main.appendChild(el('div', 'wz-row-meta',
        (t.components || []).length + ' komponentów · ' +
        (t.components || []).map(function (c) { return typeLabel(c.type); }).join(', ')));
      row.appendChild(main);

      var acts = el('div', 'wz-row-actions');
      acts.appendChild(mini('◳', 'Edytuj komponenty', function () {
        W.tab = i;
        W.step = 4;
        render();
      }));
      acts.appendChild(mini('↑', 'W górę', function () {
        if (i === 0) return;
        W.cfg.tabs.splice(i - 1, 0, W.cfg.tabs.splice(i, 1)[0]);
        renderStep3();
      }));
      acts.appendChild(mini('↓', 'W dół', function () {
        if (i >= W.cfg.tabs.length - 1) return;
        W.cfg.tabs.splice(i + 1, 0, W.cfg.tabs.splice(i, 1)[0]);
        renderStep3();
      }));
      acts.appendChild(mini('✕', 'Usuń zakładkę', function () {
        TBUI.confirm({
          title: 'Usunąć zakładkę „' + t.label + '"?',
          text: 'Razem z nią zniknie ' + (t.components || []).length + ' komponentów. ' +
            'Dane w zbiorach zostają.',
          confirmLabel: 'Usuń zakładkę', tone: 'danger'
        }).then(function (ok) {
          if (!ok) return;
          W.cfg.tabs.splice(i, 1);
          renderStep3();
        });
      }, true));
      row.appendChild(acts);
      body.appendChild(row);
    });

    if (!W.cfg.tabs.length) {
      body.appendChild(el('p', 'tb-dim', 'Brak zakładek. Dodaj pierwszą.'));
    }
    var add = btn('+ Dodaj zakładkę', 'btn-primary', function () {
      W.cfg.tabs.push({
        id: mintId('t_'), label: 'Nowa zakładka', icon: '▦', preset: 'blank',
        layout: { cols: 1, variant: 'even' }, components: []
      });
      renderStep3();
    });
    add.style.marginTop = '10px';
    body.appendChild(add);
    host.appendChild(card('Zakładki', body));
  }

  function typeLabel(v) {
    var t = TYPES.filter(function (x) { return x.v === v; })[0];
    return t ? t.l : v;
  }

  /* ---- krok 4: komponenty ---- */

  function renderStep4() {
    var host = doc.getElementById('wz-step-4');
    host.innerHTML = '';
    if (!W.cfg.tabs.length) {
      host.appendChild(card('Brak zakładek', el('p', 'tb-dim',
        'Wróć do kroku „Zakładki" i dodaj przynajmniej jedną.')));
      return;
    }
    if (W.tab >= W.cfg.tabs.length) W.tab = 0;
    var tab = W.cfg.tabs[W.tab];

    var picker = el('div', 'tb-flexrow');
    picker.appendChild(field('Zakładka', select(
      W.cfg.tabs.map(function (t, i) { return { v: String(i), l: t.label }; }),
      String(W.tab), function (v) { W.tab = +v; W.cmp = null; renderStep4(); })));
    host.appendChild(card(null, picker));

    var split = el('div', 'wz-split');

    // lista komponentów
    var left = el('div', '');
    var comps = (tab.components || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
    tab.components = comps;
    comps.forEach(function (c, i) {
      var row = el('div', 'wz-row');
      if (c.id === W.cmp) row.style.borderColor = 'var(--accent)';
      var main = el('div', 'wz-row-main');
      main.appendChild(el('div', 'wz-row-title', (c.title || typeLabel(c.type))));
      var where = c.span === 'full' ? 'cała szerokość' : 'kolumna ' + ((c.col || 0) + 1);
      main.appendChild(el('div', 'wz-row-meta', typeLabel(c.type) + ' · ' + where));
      main.style.cursor = 'pointer';
      main.addEventListener('click', function () { W.cmp = c.id; renderStep4(); });
      row.appendChild(main);
      var acts = el('div', 'wz-row-actions');
      acts.appendChild(mini('↑', 'Wyżej', function () {
        if (i === 0) return;
        var prev = comps[i - 1].order || 0;
        comps[i - 1].order = c.order || 0;
        c.order = prev;
        renderStep4();
      }));
      acts.appendChild(mini('↓', 'Niżej', function () {
        if (i >= comps.length - 1) return;
        var nx = comps[i + 1].order || 0;
        comps[i + 1].order = c.order || 0;
        c.order = nx;
        renderStep4();
      }));
      acts.appendChild(mini('✕', 'Usuń komponent', function () {
        tab.components = tab.components.filter(function (x) { return x.id !== c.id; });
        if (W.cmp === c.id) W.cmp = null;
        renderStep4();
      }, true));
      row.appendChild(acts);
      left.appendChild(row);
    });
    if (!comps.length) left.appendChild(el('p', 'tb-dim', 'Zakładka jest pusta. Dodaj komponent poniżej.'));

    var types = el('div', 'wz-types');
    types.style.marginTop = '12px';
    TYPES.forEach(function (t) {
      var b = el('button', 'wz-type');
      b.type = 'button';
      b.innerHTML = '<i>' + esc(t.i) + '</i>' + esc(t.l);
      b.addEventListener('click', function () {
        var c = newComponent(t.v, tab);
        tab.components.push(c);
        W.cmp = c.id;
        renderStep4();
      });
      types.appendChild(b);
    });
    left.appendChild(el('div', 'tb-check-group', 'Dodaj komponent'));
    left.appendChild(types);
    split.appendChild(card('Komponenty zakładki „' + tab.label + '"', left));

    // panel konfiguracji
    var cmp = (tab.components || []).filter(function (c) { return c.id === W.cmp; })[0];
    var right = el('div', '');
    if (!cmp) {
      right.appendChild(el('p', 'tb-dim', 'Wybierz komponent z listy po lewej albo dodaj nowy.'));
    } else {
      right.appendChild(configPanel(cmp, tab));
    }
    split.appendChild(card(cmp ? 'Konfiguracja: ' + typeLabel(cmp.type) : 'Konfiguracja', right));
    host.appendChild(split);
  }

  function newComponent(type, tab) {
    var ds = W.cfg.datasets[0];
    var maxOrder = (tab.components || []).reduce(function (m, c) {
      return Math.max(m, c.order || 0);
    }, 0);
    var c = {
      id: mintId('k_'), type: type, title: typeLabel(type),
      col: 0, order: maxOrder + 10, span: 1,
      dataset: null, agg: { op: 'count' }, opts: {}
    };
    var meta = TYPES.filter(function (t) { return t.v === type; })[0];
    if (meta && meta.needsDs && ds) c.dataset = ds.id;
    if (type === 'chart') c.opts.kind = 'bar';
    if (type === 'table') {
      c.span = 'full';
      c.opts = {
        pageSize: 50, editable: true, selectable: true, search: true, rowNotes: true,
        columns: ds ? ds.columns.slice(0, 6).map(function (x) { return x.id; }) : [],
        contextMenu: { builtins: ['edit', 'duplicate', 'delete', 'addNote', 'copyRow', 'exportSelected'], actions: [] }
      };
    }
    if (type === 'agenda') c.opts = { range: 'next30', showOverdue: true, display: 'list', sources: [] };
    if (type === 'banner') { c.span = 'full'; c.opts = { tone: 'accent', icon: 'ℹ', text: '' }; }
    if (type === 'checklist') c.opts = { resetDaily: false, showDue: true };
    return c;
  }

  /* Panel generowany z descriptorów — jeden renderer dla wszystkich typów. */
  function configPanel(cmp, tab) {
    var wrap = el('div', 'tb-stack');

    var place = el('div', 'wz-fields');
    var cols = (tab.layout && tab.layout.cols) || 1;
    place.appendChild(field('Szerokość', select(
      [{ v: '1', l: 'jedna kolumna' }, { v: 'full', l: 'cała szerokość' }],
      cmp.span === 'full' ? 'full' : '1', function (v) {
        cmp.span = v === 'full' ? 'full' : 1;
        renderStep4();
      })));
    if (cols > 1 && cmp.span !== 'full') {
      var opts = [];
      for (var i = 0; i < cols; i++) opts.push({ v: String(i), l: 'kolumna ' + (i + 1) });
      place.appendChild(field('Umieść w', select(opts, String(cmp.col || 0), function (v) {
        cmp.col = +v;
        renderStep4();
      })));
    }
    wrap.appendChild(place);

    var fields = FIELDS[cmp.type] || [];
    var grid = el('div', 'wz-fields');
    fields.forEach(function (f) {
      if (f.when && !f.when(cmp)) return;
      var ctrl = buildControl(f, cmp);
      if (!ctrl) return;
      if (f.kind === 'filter' || f.kind === 'ctxmenu' || f.kind === 'columns' || f.kind === 'sources') {
        var box = el('div', 'tb-field wz-wide');
        box.appendChild(el('label', null, f.label));
        box.appendChild(ctrl);
        grid.appendChild(box);
      } else {
        grid.appendChild(field(f.label, ctrl, f.wide));
      }
    });
    wrap.appendChild(grid);

    if (cmp.type === 'chart') {
      var warn = chartWarning(cmp);
      if (warn) {
        var b = el('div', 'tb-banner tb-banner-warning');
        b.innerHTML = '<i>⚠</i><div class="tb-banner-body"><div class="tb-banner-text">' +
          esc(warn) + '</div></div>';
        wrap.appendChild(b);
      }
    }
    return wrap;
  }

  function chartWarning(cmp) {
    var kind = (cmp.opts || {}).kind;
    var split = cmp.agg && cmp.agg.split && cmp.agg.split.field;
    if (kind === 'line' && split && !(cmp.agg.split.limit > 0 && cmp.agg.split.limit <= 3)) {
      return 'Wykres liniowy z wieloma seriami staje się nieczytelny. Ustaw limit serii na 3 lub mniej.';
    }
    if (kind === 'donut' && !(cmp.agg && cmp.agg.groupBy && cmp.agg.groupBy.field)) {
      return 'Pierścień potrzebuje kolumny do grupowania — bez niej nie ma czego dzielić.';
    }
    if ((kind === 'bar' || kind === 'line') && !(cmp.agg && cmp.agg.groupBy && cmp.agg.groupBy.field)) {
      return 'Ten wykres potrzebuje kolumny w polu „Grupuj po kolumnie".';
    }
    return null;
  }

  function buildControl(f, cmp) {
    var val = getPath(cmp, f.k);
    var ds = dsOf(cmp.dataset);

    if (f.kind === 'text') {
      return input(val == null ? '' : val, function (v) { setPath(cmp, f.k, v); });
    }
    if (f.kind === 'number') {
      var i = input(val == null ? '' : val, function (v) {
        setPath(cmp, f.k, v === '' ? null : parseFloat(String(v).replace(',', '.')));
      });
      i.inputMode = 'decimal';
      return i;
    }
    if (f.kind === 'bool') {
      var w = el('div', '');
      w.appendChild(checkbox('', !!val, function (v) { setPath(cmp, f.k, v); }));
      return w.firstChild;
    }
    if (f.kind === 'enum') {
      return select(f.options, val == null ? '' : String(val), function (v) {
        setPath(cmp, f.k, v);
        renderStep4();
      });
    }
    if (f.kind === 'dataset') {
      return select([{ v: '', l: '— wybierz —' }].concat(
        W.cfg.datasets.map(function (d) { return { v: d.id, l: d.name }; })),
        val || '', function (v) {
          setPath(cmp, f.k, v || null);
          if (cmp.opts && cmp.opts.columns) cmp.opts.columns = [];
          renderStep4();
        });
    }
    if (f.kind === 'column') {
      if (!ds) return null;
      var list = ds.columns.filter(function (c) {
        return !f.types || f.types.indexOf(c.type) >= 0;
      });
      return select([{ v: '', l: '— brak —' }].concat(
        list.map(function (c) { return { v: c.id, l: c.label }; })),
        val || '', function (v) { setPath(cmp, f.k, v || null); renderStep4(); });
    }
    if (f.kind === 'columns') {
      if (!ds) return el('p', 'tb-dim', 'Najpierw wybierz zbiór danych.');
      return columnsPicker(cmp, ds);
    }
    if (f.kind === 'filter') {
      if (!ds) return el('p', 'tb-dim', 'Najpierw wybierz zbiór danych.');
      return filterEditor(cmp, f.k, ds);
    }
    if (f.kind === 'ctxmenu') {
      if (!ds) return el('p', 'tb-dim', 'Najpierw wybierz zbiór danych.');
      return ctxMenuEditor(cmp, ds);
    }
    if (f.kind === 'sources') {
      return sourcesEditor(cmp);
    }
    return null;
  }

  function columnsPicker(cmp, ds) {
    cmp.opts.columns = cmp.opts.columns || [];
    var box = el('div', '');
    box.appendChild(hint('Kolejność zaznaczania wyznacza kolejność kolumn w tabeli i w eksporcie.'));
    var list = el('div', 'tb-flexrow');
    ds.columns.forEach(function (c) {
      var on = cmp.opts.columns.indexOf(c.id) >= 0;
      var b = el('button', 'tb-chip-btn', c.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', function () {
        var i = cmp.opts.columns.indexOf(c.id);
        if (i >= 0) cmp.opts.columns.splice(i, 1);
        else cmp.opts.columns.push(c.id);
        renderStep4();
      });
      list.appendChild(b);
    });
    box.appendChild(list);
    var all = btn('Zaznacz wszystkie', 'btn-ghost', function () {
      cmp.opts.columns = ds.columns.map(function (c) { return c.id; });
      renderStep4();
    });
    all.style.marginTop = '8px';
    box.appendChild(all);
    return box;
  }

  function filterEditor(cmp, path, ds) {
    var f = getPath(cmp, path);
    if (!f || !f.rules) {
      f = { op: 'and', rules: [] };
      setPath(cmp, path, f);
    }
    var box = el('div', '');
    box.appendChild(hint('Wszystkie warunki muszą być spełnione jednocześnie. ' +
      'Brak warunków oznacza „wszystkie wiersze".'));
    f.rules.forEach(function (r, i) {
      var row = el('div', 'wz-row');
      var m = el('div', 'tb-flexrow');
      m.style.cssText = 'flex:1;gap:6px;flex-wrap:wrap';
      var fs = select(ds.columns.map(function (c) { return { v: c.id, l: c.label }; }),
        r.field || '', function (v) { r.field = v; renderStep4(); });
      fs.className = 'tb-select tb-input-sm';
      fs.style.flex = '1 1 120px';
      fs.setAttribute('aria-label', 'Kolumna');
      m.appendChild(fs);
      var cs = select(CMPS, r.cmp || 'eq', function (v) { r.cmp = v; renderStep4(); });
      cs.className = 'tb-select tb-input-sm';
      cs.style.flex = '1 1 130px';
      cs.setAttribute('aria-label', 'Warunek');
      m.appendChild(cs);

      if (r.cmp !== 'empty' && r.cmp !== 'notEmpty') {
        var col = ds.columns.filter(function (c) { return c.id === r.field; })[0];
        var vc;
        if (r.cmp === 'relDate') {
          vc = select(REL_DATES, r.value || 'today', function (v) { r.value = v; });
        } else if (col && col.type === 'enum') {
          vc = select((col.options || []).map(function (o) { return { v: o.value, l: o.label }; }),
            r.value || '', function (v) { r.value = v; });
        } else if (col && col.type === 'bool') {
          vc = select([{ v: 'true', l: 'tak' }, { v: 'false', l: 'nie' }],
            String(r.value || 'true'), function (v) { r.value = v; });
        } else {
          vc = input(r.value == null ? '' : r.value, function (v) { r.value = v; });
        }
        vc.className = (vc.tagName === 'SELECT' ? 'tb-select' : 'tb-input') + ' tb-input-sm';
        vc.style.flex = '1 1 120px';
        vc.setAttribute('aria-label', 'Wartość');
        m.appendChild(vc);
      }
      row.appendChild(m);
      var a = el('div', 'wz-row-actions');
      a.appendChild(mini('✕', 'Usuń warunek', function () {
        f.rules.splice(i, 1);
        renderStep4();
      }, true));
      row.appendChild(a);
      box.appendChild(row);
    });
    var add = btn('+ Dodaj warunek', 'btn-ghost', function () {
      f.rules.push({ field: ds.columns.length ? ds.columns[0].id : '', cmp: 'eq', value: '' });
      renderStep4();
    });
    add.style.marginTop = '6px';
    box.appendChild(add);
    return box;
  }

  function ctxMenuEditor(cmp, ds) {
    cmp.opts.contextMenu = cmp.opts.contextMenu || { builtins: [], actions: [] };
    var cm = cmp.opts.contextMenu;
    cm.builtins = cm.builtins || [];
    cm.actions = cm.actions || [];

    var box = el('div', '');
    box.appendChild(hint('Akcja wywołana prawym przyciskiem na wierszu, który jest w zaznaczeniu, ' +
      'dotyczy całego zaznaczenia. Na wierszu poza zaznaczeniem — tylko tego wiersza.'));

    var bset = [
      { v: 'edit', l: 'Edytuj wiersz' }, { v: 'duplicate', l: 'Duplikuj' },
      { v: 'addNote', l: 'Dodaj karteczkę' }, { v: 'copyRow', l: 'Kopiuj jako tekst' },
      { v: 'exportSelected', l: 'Eksportuj zaznaczone' }, { v: 'delete', l: 'Usuń wiersz' }
    ];
    var chips = el('div', 'tb-flexrow');
    bset.forEach(function (b) {
      var on = cm.builtins.indexOf(b.v) >= 0;
      var btn2 = el('button', 'tb-chip-btn', b.l);
      btn2.type = 'button';
      btn2.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn2.addEventListener('click', function () {
        var i = cm.builtins.indexOf(b.v);
        if (i >= 0) cm.builtins.splice(i, 1); else cm.builtins.push(b.v);
        renderStep4();
      });
      chips.appendChild(btn2);
    });
    box.appendChild(el('div', 'tb-check-group', 'Pozycje standardowe'));
    box.appendChild(chips);

    box.appendChild(el('div', 'tb-check-group', 'Własne akcje'));
    cm.actions.forEach(function (a, i) {
      var row = el('div', 'wz-row');
      var m = el('div', 'tb-flexrow');
      m.style.cssText = 'flex:1;gap:6px;flex-wrap:wrap';
      var li = input(a.label, function (v) { a.label = v; });
      li.className = 'tb-input tb-input-sm';
      li.style.flex = '1 1 140px';
      li.placeholder = 'Nazwa w menu';
      li.setAttribute('aria-label', 'Nazwa akcji');
      m.appendChild(li);
      var ks = select(KINDS, a.kind || 'setField', function (v) { a.kind = v; renderStep4(); });
      ks.className = 'tb-select tb-input-sm';
      ks.style.flex = '1 1 150px';
      ks.setAttribute('aria-label', 'Co robi');
      m.appendChild(ks);

      if (a.kind === 'setField' || a.kind === 'clearField') {
        var fs = select(ds.columns.map(function (c) { return { v: c.id, l: c.label }; }),
          a.field || '', function (v) { a.field = v; renderStep4(); });
        fs.className = 'tb-select tb-input-sm';
        fs.style.flex = '1 1 120px';
        fs.setAttribute('aria-label', 'Pole');
        m.appendChild(fs);
      }
      if (a.kind === 'setField') {
        var col = ds.columns.filter(function (c) { return c.id === a.field; })[0];
        var vc;
        if (col && col.type === 'enum') {
          vc = select((col.options || []).map(function (o) { return { v: o.value, l: o.label }; }),
            a.value || '', function (v) { a.value = v; });
        } else if (col && col.type === 'bool') {
          vc = select([{ v: 'true', l: 'tak' }, { v: 'false', l: 'nie' }],
            String(a.value || 'true'), function (v) { a.value = v; });
        } else if (col && col.type === 'date') {
          vc = select([{ v: '@today', l: 'dzisiejsza data' }, { v: '', l: 'wartość własna' }],
            a.value === '@today' ? '@today' : '', function (v) { a.value = v; renderStep4(); });
        } else {
          vc = select([{ v: '@user', l: 'Twoje imię' }, { v: '', l: 'wartość własna' }],
            a.value === '@user' ? '@user' : '', function (v) { a.value = v; renderStep4(); });
        }
        vc.className = 'tb-select tb-input-sm';
        vc.style.flex = '1 1 130px';
        vc.setAttribute('aria-label', 'Wartość');
        m.appendChild(vc);
        if (a.value !== '@today' && a.value !== '@user' &&
            !(col && (col.type === 'enum' || col.type === 'bool'))) {
          var ti = input(a.value == null ? '' : a.value, function (v) { a.value = v; });
          ti.className = 'tb-input tb-input-sm';
          ti.style.flex = '1 1 110px';
          ti.placeholder = 'wartość';
          ti.setAttribute('aria-label', 'Wartość własna');
          m.appendChild(ti);
        }
      }
      if (a.kind === 'moveTo') {
        var ms = select(W.cfg.datasets.map(function (d) { return { v: d.id, l: d.name }; }),
          a.dataset || '', function (v) { a.dataset = v; });
        ms.className = 'tb-select tb-input-sm';
        ms.style.flex = '1 1 130px';
        ms.setAttribute('aria-label', 'Zbiór docelowy');
        m.appendChild(ms);
      }
      row.appendChild(m);
      var acts = el('div', 'wz-row-actions');
      acts.appendChild(mini('✕', 'Usuń akcję', function () {
        cm.actions.splice(i, 1);
        renderStep4();
      }, true));
      row.appendChild(acts);
      box.appendChild(row);
    });

    var add = btn('+ Dodaj własną akcję', 'btn-ghost', function () {
      cm.actions.push({
        id: mintId('a_'), label: 'Nowa akcja', icon: '•', kind: 'setField',
        field: ds.columns.length ? ds.columns[0].id : '', value: ''
      });
      renderStep4();
    });
    add.style.marginTop = '6px';
    box.appendChild(add);
    return box;
  }

  function sourcesEditor(cmp) {
    cmp.opts.sources = cmp.opts.sources || [];
    var box = el('div', '');
    box.appendChild(hint('Agenda zbiera terminy z dowolnej liczby zbiorów. ' +
      'Dla każdego wskaż kolumnę z datą i kolumnę z nazwą.'));
    cmp.opts.sources.forEach(function (s, i) {
      var ds = dsOf(s.dataset);
      var row = el('div', 'wz-row');
      var m = el('div', 'wz-fields');
      m.style.flex = '1';
      m.appendChild(field('Zbiór', select(
        W.cfg.datasets.map(function (d) { return { v: d.id, l: d.name }; }),
        s.dataset || '', function (v) { s.dataset = v; renderStep4(); })));
      if (ds) {
        var dateCols = ds.columns.filter(function (c) { return c.type === 'date'; });
        m.appendChild(field('Kolumna z datą', select(
          [{ v: '', l: '— wybierz —' }].concat(dateCols.map(function (c) { return { v: c.id, l: c.label }; })),
          s.dateField || '', function (v) { s.dateField = v; })));
        m.appendChild(field('Kolumna z nazwą', select(
          [{ v: '', l: '— wybierz —' }].concat(ds.columns.map(function (c) { return { v: c.id, l: c.label }; })),
          s.titleField || '', function (v) { s.titleField = v; })));
        m.appendChild(field('Kolumna z opisem', select(
          [{ v: '', l: '— brak —' }].concat(ds.columns.map(function (c) { return { v: c.id, l: c.label }; })),
          s.metaField || '', function (v) { s.metaField = v || null; })));
        m.appendChild(field('Kolumna kolorująca kropkę', select(
          [{ v: '', l: '— brak —' }].concat(ds.columns.filter(function (c) { return c.type === 'enum'; })
            .map(function (c) { return { v: c.id, l: c.label }; })),
          s.toneField || '', function (v) { s.toneField = v || null; })));
      }
      row.appendChild(m);
      var a = el('div', 'wz-row-actions');
      a.appendChild(mini('✕', 'Usuń źródło', function () {
        cmp.opts.sources.splice(i, 1);
        renderStep4();
      }, true));
      row.appendChild(a);
      box.appendChild(row);
    });
    var add = btn('+ Dodaj źródło terminów', 'btn-ghost', function () {
      var d = W.cfg.datasets[0];
      cmp.opts.sources.push({
        dataset: d ? d.id : null,
        dateField: d ? (d.columns.filter(function (c) { return c.type === 'date'; })[0] || {}).id || null : null,
        titleField: d ? d.titleField : null,
        metaField: null, toneField: null, filter: null
      });
      renderStep4();
    });
    add.style.marginTop = '6px';
    box.appendChild(add);
    return box;
  }

  /* ---- krok 5: podgląd i zapis ---- */

  function renderStep5() {
    var host = doc.getElementById('wz-step-5');
    host.innerHTML = '';

    var problems = validate();
    if (problems.length) {
      var b = el('div', 'tb-banner tb-banner-danger');
      b.innerHTML = '<i>⚠</i><div class="tb-banner-body"><div class="tb-banner-title">' +
        'Zanim wygenerujemy tracker, trzeba poprawić ' + problems.length +
        (problems.length === 1 ? ' rzecz' : ' rzeczy') + '</div><div class="tb-banner-text"><ul style="margin:6px 0 0;padding-left:18px">' +
        problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') +
        '</ul></div></div>';
      host.appendChild(b);
    }

    var html = problems.length ? '' : emit(W.cfg, false);
    var kb = html ? (new Blob([html]).size / 1024) : 0;

    var sum = el('dl', 'wz-summary');
    function addRow(k, v) {
      sum.appendChild(el('dt', null, k));
      sum.appendChild(el('dd', null, v));
    }
    addRow('Nazwa', W.cfg.meta.name);
    addRow('Styl', (ASSET.themes.themes.filter(function (t) {
      return t.id === W.cfg.meta.theme;
    })[0] || {}).name || W.cfg.meta.theme);
    addRow('Zbiory danych', W.cfg.datasets.map(function (d) {
      return d.name + ' (' + d.columns.length + ' kol.)';
    }).join(', ') || '—');
    addRow('Zakładki', W.cfg.tabs.map(function (t) { return t.label; }).join(', ') || '—');
    addRow('Komponentów', String(W.cfg.tabs.reduce(function (s, t) {
      return s + (t.components || []).length;
    }, 0)));
    addRow('Przełączanie stylu', W.cfg.meta.allowThemeSwitch ? 'włączone' : 'wyłączone');
    if (html) addRow('Rozmiar pliku', kb.toFixed(0) + ' KB');
    host.appendChild(card('Podsumowanie', sum));

    var actions = el('div', 'tb-flexrow');
    actions.appendChild(btn('Podgląd', 'btn-secondary', function () {
      if (problems.length) { TBUI.toast('Najpierw popraw błędy', 'warning'); return; }
      preview();
    }));
    var dl = btn('Pobierz tracker (.html)', 'btn-primary', function () {
      if (problems.length) { TBUI.toast('Najpierw popraw błędy', 'warning'); return; }
      saveFile(emit(W.cfg, false), fileBase() + '.html', 'text/html');
    });
    actions.appendChild(dl);
    actions.appendChild(btn('Pobierz strukturę (.tracker.json)', 'btn-secondary', function () {
      W.cfg.rev = (W.cfg.rev || 1);
      saveFile(JSON.stringify(W.cfg, null, 2), fileBase() + '.tracker.json', 'application/json');
    }));
    var box = el('div', '');
    box.appendChild(hint('Zapisz oba pliki w tym samym miejscu. HTML to działający tracker. ' +
      'Plik .tracker.json wczytasz w kroku Start, gdy zechcesz zmienić strukturę — ' +
      'dane w trackerze zostaną zachowane, bo identyfikator trackera się nie zmienia.'));
    box.appendChild(actions);
    host.appendChild(card('Zapis', box));

    var note = el('div', 'tb-banner tb-banner-warning');
    note.innerHTML = '<i>⚠</i><div class="tb-banner-body"><div class="tb-banner-title">' +
      'Nie zmieniaj nazwy ani miejsca pliku trackera</div><div class="tb-banner-text">' +
      'Przeglądarka wiąże swoją lokalną kopię danych ze ścieżką pliku. Dane i tak żyją ' +
      'w osobnym pliku .json, ale po przeniesieniu HTML-a trzeba będzie wskazać go ponownie. ' +
      'Aktualizując tracker, nadpisz stary plik w tym samym miejscu.</div></div>';
    host.appendChild(note);
  }

  function fileBase() {
    return (W.cfg.meta.name || 'tracker').replace(/[^\w\-. ]+/g, '_').trim() || 'tracker';
  }

  function validate() {
    var p = [];
    var cfg = W.cfg;
    if (!cfg.meta.name || !cfg.meta.name.trim()) p.push('Tracker nie ma nazwy (krok Podstawy).');
    if (!cfg.datasets.length) p.push('Nie ma żadnego zbioru danych (krok Dane).');
    cfg.datasets.forEach(function (d) {
      if (!d.columns.length) p.push('Zbiór „' + d.name + '" nie ma ani jednej kolumny.');
      d.columns.forEach(function (c) {
        if (c.type === 'enum' && !(c.options || []).length) {
          p.push('Kolumna „' + c.label + '" jest listą wyboru, ale nie ma opcji.');
        }
      });
    });
    if (!cfg.tabs.length) p.push('Nie ma żadnej zakładki (krok Zakładki).');
    var ids = {};
    cfg.tabs.forEach(function (t) {
      if (!(t.components || []).length) {
        p.push('Zakładka „' + t.label + '" jest pusta — dodaj komponent albo ją usuń.');
      }
      (t.components || []).forEach(function (c) {
        if (ids[c.id]) p.push('Powtórzony identyfikator komponentu — usuń i dodaj go ponownie.');
        ids[c.id] = 1;
        var meta = TYPES.filter(function (x) { return x.v === c.type; })[0];
        if (meta && meta.needsDs && !dsOf(c.dataset)) {
          p.push('Komponent „' + (c.title || meta.l) + '" w zakładce „' + t.label +
            '" nie ma wybranego zbioru danych.');
        }
        if (c.type === 'chart') {
          var w = chartWarning(c);
          if (w) p.push('Wykres „' + (c.title || '') + '" w zakładce „' + t.label + '": ' + w);
        }
        if (c.type === 'agenda' && !((c.opts || {}).sources || []).some(function (s) {
          return s.dataset && s.dateField;
        })) {
          p.push('Agenda „' + (c.title || '') + '" nie ma źródła z kolumną daty.');
        }
        if (c.type === 'table' && !((c.opts || {}).columns || []).length) {
          p.push('Tabela „' + (c.title || '') + '" nie ma wybranej ani jednej kolumny.');
        }
      });
    });
    return p;
  }

  /* ====================================================================== emisja */

  function jsonIsland(cfg) {
    // JSON.stringify NIE escapuje "<" — bez tego "</script>" w nazwie zakładki
    // zamknęłoby wyspę i wstrzyknęło skrypt.
    return JSON.stringify(cfg)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function themeIslands(cfg) {
    if (!cfg.meta.allowThemeSwitch) return '';
    return (ASSET.themes.themes || []).filter(function (t) {
      return t.id !== cfg.meta.theme;
    }).map(function (t) {
      var css = ASSET['theme:' + t.id] || '';
      return '<script type="text/plain" data-theme="' + t.id + '" data-theme-name="' +
        esc(t.name) + '">' + css.replace(/<\//g, '<\\/') + '<\/script>';
    }).join('\n');
  }

  function emit(cfg, preview) {
    var out = ASSET.shell;
    var theme = ASSET['theme:' + cfg.meta.theme] || '';
    var cfg2 = JSON.parse(JSON.stringify(cfg));
    if (preview) cfg2.meta.preview = true;

    // Forma FUNKCYJNA zamiennika jest konieczna: String.replace podstawia
    // $& i $' w zamienniku, więc asset zawierający $& zepsułby wyjście.
    function put(marker, value) {
      out = out.replace(marker, function () { return value; });
    }
    put('<!--TB:TITLE-->', esc(cfg.meta.name || 'Tracker'));
    put('<!--TB:FONTLINK-->', cfg.meta.useWebFonts && cfg.meta.fontHref
      ? '<link rel="stylesheet" href="' + esc(cfg.meta.fontHref) + '">' : '');
    put('<!--TB:THEMECSS-->', theme);
    put('<!--TB:EXTRACSS-->', ASSET.trackercss);
    put('<!--TB:THEMES-->', themeIslands(cfg));
    put('<!--TB:CONFIG-->', jsonIsland(cfg2));
    put('<!--TB:CHARTS-->', ASSET.charts);
    put('<!--TB:UI-->', ASSET.ui);
    put('<!--TB:XLSX-->', ASSET.xlsx);
    put('<!--TB:RUNTIME-->', (preview ? seedJs(cfg) + '\n' : '') + ASSET.runtime);
    return out;
  }

  /* Dane przykładowe tylko do podglądu — wstrzykiwane przed runtimem,
     czytane wyłącznie wtedy, gdy magazyn jest pusty i tryb to podgląd. */
  function seedJs(cfg) {
    var seed = {};
    cfg.datasets.forEach(function (d) { seed[d.id] = synth(d, 24); });
    cfg.tabs.forEach(function (t) {
      (t.components || []).forEach(function (c) {
        if (c.type === 'notes') {
          seed['c:' + c.id] = [
            { text: 'Zadzwonić do Kowalskiego w sprawie terminu', color: 'c1', order: 1, rowRef: null },
            { text: 'Sprawdzić rozliczenie za wrzesień', color: 'c3', order: 2, rowRef: null }
          ];
        }
        if (c.type === 'checklist') {
          seed['c:' + c.id] = [
            { text: 'Przegląd skrzynki', done: true, order: 1, group: '', due: null, resetDaily: true, lastDoneOn: null },
            { text: 'Odpisać na zaległe zapytania', done: false, order: 2, group: '', due: null, resetDaily: true },
            { text: 'Raport dzienny', done: false, order: 3, group: '', due: null, resetDaily: true }
          ];
        }
      });
    });
    return 'window.__TB_SEED=' + jsonIsland(seed) + ';';
  }

  var NAMES = ['Anna Kowalska', 'Piotr Nowak', 'Maria Wiśniewska', 'Tomasz Lewandowski',
    'Katarzyna Zielińska', 'Michał Szymański', 'Agnieszka Dąbrowska', 'Paweł Kaczmarek'];
  var SUBJECTS = ['Korekta faktury', 'Zapytanie o limit', 'Reklamacja dostawy',
    'Zmiana danych', 'Rozliczenie kwartału', 'Dostęp do raportu', 'Weryfikacja umowy',
    'Prośba o duplikat'];

  function synth(ds, n) {
    var rows = [];
    for (var i = 0; i < n; i++) {
      var row = {};
      ds.columns.forEach(function (c, ci) {
        switch (c.type) {
          case 'number':
            row[c.id] = Math.round((50 + Math.pow(i % 9 + 1, 2) * 37 + (ci * 13) % 70) * 100) / 100;
            break;
          case 'date': {
            var d = new Date();
            d.setDate(d.getDate() - 150 + i * 7 + ci * 2);
            row[c.id] = d.getFullYear() + '-' +
              ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
            break;
          }
          case 'enum': {
            var o = c.options || [];
            row[c.id] = o.length ? o[i % o.length].value : null;
            break;
          }
          case 'bool':
            row[c.id] = i % 3 === 0;
            break;
          case 'longtext':
            row[c.id] = 'Przykładowy opis pozycji numer ' + (i + 1) +
              '. Treść służy tylko do podglądu układu.';
            break;
          default:
            row[c.id] = /nazw|temat|tytu|spraw/i.test(c.label)
              ? SUBJECTS[i % SUBJECTS.length]
              : NAMES[(i + ci) % NAMES.length];
        }
      });
      rows.push(row);
    }
    return rows;
  }

  function preview() {
    var html = emit(W.cfg, true);
    var frame = doc.createElement('iframe');
    frame.className = 'wz-preview';
    frame.setAttribute('title', 'Podgląd trackera');
    frame.srcdoc = html;
    var wrap = el('div', 'tb-stack');
    var info = el('div', 'wz-size',
      'Podgląd z danymi przykładowymi. Rozmiar finalnego pliku: ' +
      (new Blob([emit(W.cfg, false)]).size / 1024).toFixed(0) + ' KB');
    wrap.appendChild(info);
    wrap.appendChild(frame);
    TBUI.modal.show({
      size: 'xl', title: 'Podgląd', sub: W.cfg.meta.name, body: wrap,
      actions: [{ label: 'Zamknij', variant: 'ghost' }]
    });
  }

  function saveFile(text, filename, mime) {
    var blob = new Blob([text], { type: mime });
    if (global.showSaveFilePicker) {
      global.showSaveFilePicker({ suggestedName: filename }).then(function (h) {
        return h.createWritable().then(function (w) {
          return w.write(blob).then(function () { return w.close(); });
        });
      }).then(function () {
        TBUI.toast('Zapisano ' + filename, 'success');
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        link(blob, filename);
      });
    } else {
      link(blob, filename);
    }
  }
  function link(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    TBUI.toast('Pobrano ' + filename, 'success');
  }

  /* ====================================================================== wczytanie configu */

  function loadConfigFile(file) {
    file.text().then(function (t) {
      var cfg;
      try {
        cfg = JSON.parse(t);
      } catch (e) {
        TBUI.toast('Nie udało się odczytać pliku: ' + e.message, 'danger', 6000);
        return;
      }
      if (!cfg || cfg.$kind !== 'tracker.config' || !cfg.meta || !cfg.meta.trackerId) {
        TBUI.toast('To nie jest plik struktury trackera (.tracker.json)', 'danger', 6000);
        return;
      }
      cfg.rev = (cfg.rev || 1) + 1;     // nowa wersja struktury
      cfg.datasets = cfg.datasets || [];
      cfg.tabs = cfg.tabs || [];
      cfg.meta.useWebFonts = cfg.meta.useWebFonts !== false;
      W.cfg = cfg;
      W.step = 1;
      W.tab = 0;
      W.cmp = null;
      W.ds = 0;
      render();
      TBUI.toast('Wczytano strukturę „' + (cfg.meta.name || '') + '" (wersja ' + cfg.rev + ')',
        'success', 5000);
    });
  }

  /* ====================================================================== init */

  function init() {
    loadAssets();
    doc.getElementById('wz-prev').addEventListener('click', function () {
      if (W.step > 0) { W.step--; render(); }
    });
    doc.getElementById('wz-next').addEventListener('click', function () {
      if (W.step === 5) {
        var problems = validate();
        if (problems.length) { TBUI.toast('Najpierw popraw błędy na liście', 'warning'); return; }
        saveFile(emit(W.cfg, false), fileBase() + '.html', 'text/html');
        return;
      }
      if (W.step === 0 && !W.cfg) { TBUI.toast('Wybierz szablon albo wczytaj plik', 'warning'); return; }
      W.step++;
      render();
    });
    TBUI.dropzone(doc.getElementById('wz-cfg-zone'), function (files) {
      if (files[0]) loadConfigFile(files[0]);
    });
    render();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();

  global.TBWizard = { state: W, emit: emit, validate: validate, synth: synth, parseDelimited: parseDelimited };
})(window);
