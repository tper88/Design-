/* ==========================================================================
   WIZARD.JS — kreator trackerów.

   Interfejs po angielsku; komentarze po polsku, bo to kod do utrzymania.

   Składa konfigurację (tracker.json) i emituje pojedynczy plik HTML
   z wklejonymi assetami. Assety leżą w tym samym pliku jako base64.

   Dwie pułapki emisji, zaadresowane w emit():
   1. JSON.stringify NIE escapuje "<". Nazwa zakładki z "</script>" zamknęłaby
      wyspę konfiguracji i wstrzyknęła skrypt. Dlatego "<" → <.
   2. String.replace podstawia $& i $' w ZAMIENNIKU. Plik CSS zawierający $&
      zepsułby wyjście. Dlatego każde wstrzyknięcie assetu idzie formą
      funkcyjną: .replace(marker, function () { return value; }).

   Panel konfiguracji komponentu jest generowany z descriptorów pól (FIELDS),
   nie pisany ręcznie dla każdego typu.
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
      // samo atob() zepsułoby znaki spoza ASCII — trzeba przez TextDecoder
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

  var W = { step: 0, cfg: null, tab: 0, cmp: null, ds: 0, alert: null };

  var STEPS = [
    { id: 0, label: 'Start', icon: '◆' },
    { id: 1, label: 'Basics', icon: '⚙' },
    { id: 2, label: 'Data', icon: '▤' },
    { id: 3, label: 'Tabs', icon: '▦' },
    { id: 4, label: 'Components', icon: '◳' },
    { id: 5, label: 'Alerts', icon: '🔔' },
    { id: 6, label: 'Review & export', icon: '⤓' }
  ];
  var LAST = 6;

  function freshConfig() {
    return {
      $kind: 'tracker.config',
      schema: 1,
      rev: 1,
      meta: {
        trackerId: mintId('trk_'),
        name: 'My tracker',
        theme: (ASSET.themes.themes[0] || {}).id || 'amber-dusk',
        locale: 'en-GB',
        currency: 'PLN',
        team: '',
        personalization: true,
        useWebFonts: true,
        fontHref: null
      },
      datasets: [],
      tabs: [],
      alerts: []
    };
  }

  /* ====================================================================== katalogi */

  var COL_TYPES = [
    { v: 'text', l: 'Text' },
    { v: 'longtext', l: 'Long text' },
    { v: 'number', l: 'Number' },
    { v: 'date', l: 'Date' },
    { v: 'enum', l: 'Pick list' },
    { v: 'bool', l: 'Yes / no' }
  ];
  var FORMATS = [
    { v: 'number', l: '1,234.56' },
    { v: 'integer', l: '1,235' },
    { v: 'currency', l: 'currency' },
    { v: 'percent', l: '12.3%' },
    { v: 'compact', l: '1.2k' }
  ];
  var LOCALES = [
    { v: 'en-GB', l: 'English (UK) — 31/12/2026 · 1,234.56' },
    { v: 'en-US', l: 'English (US) — 12/31/2026 · 1,234.56' },
    { v: 'pl-PL', l: 'Polish — 31.12.2026 · 1 234,56' }
  ];
  var CURRENCIES = [
    { v: 'PLN', l: 'Polish złoty (PLN)' },
    { v: 'EUR', l: 'Euro (EUR)' },
    { v: 'USD', l: 'US dollar (USD)' },
    { v: 'GBP', l: 'Pound sterling (GBP)' }
  ];
  var TONES = [
    { v: '', l: 'no colour' },
    { v: 'success', l: 'green' },
    { v: 'warning', l: 'amber' },
    { v: 'danger', l: 'red' },
    { v: 'info', l: 'blue' }
  ];
  var OPS = [
    { v: 'count', l: 'Count rows' },
    { v: 'sum', l: 'Sum' },
    { v: 'avg', l: 'Average' },
    { v: 'min', l: 'Minimum' },
    { v: 'max', l: 'Maximum' },
    { v: 'countDistinct', l: 'Distinct values' }
  ];
  var GRAINS = [
    { v: '', l: 'no time grouping' },
    { v: 'day', l: 'by day' },
    { v: 'month', l: 'by month' },
    { v: 'year', l: 'by year' }
  ];
  var CMPS = [
    { v: 'eq', l: 'is' },
    { v: 'ne', l: 'is not' },
    { v: 'contains', l: 'contains' },
    { v: 'gt', l: 'greater than' },
    { v: 'lt', l: 'less than' },
    { v: 'gte', l: 'at least' },
    { v: 'lte', l: 'at most' },
    { v: 'empty', l: 'is empty' },
    { v: 'notEmpty', l: 'is not empty' },
    { v: 'relDate', l: 'date relative to today' }
  ];
  var REL_DATES = [
    { v: 'today', l: 'today' },
    { v: 'tomorrow', l: 'tomorrow' },
    { v: 'overdue', l: 'overdue' },
    { v: 'next7', l: 'within 7 days' },
    { v: 'next30', l: 'within 30 days' },
    { v: 'thisMonth', l: 'this month' },
    { v: 'lastMonth', l: 'last month' }
  ];
  var ALERT_CMPS = [
    { v: 'gt', l: 'more than' },
    { v: 'gte', l: 'at least' },
    { v: 'eq', l: 'exactly' },
    { v: 'lt', l: 'fewer than' }
  ];

  var TYPES = [
    { v: 'kpi', l: 'KPI card', i: '①', needsDs: true },
    { v: 'stat', l: 'Stat', i: '◷', needsDs: true },
    { v: 'chart', l: 'Chart', i: '▥', needsDs: true },
    { v: 'table', l: 'Table', i: '▤', needsDs: true },
    { v: 'progress', l: 'Progress bar', i: '▰', needsDs: true },
    { v: 'banner', l: 'Insight banner', i: '❝', needsDs: false },
    { v: 'agenda', l: 'Agenda', i: '🗓', needsDs: false },
    { v: 'notes', l: 'Sticky notes', i: '🗒', needsDs: false },
    { v: 'checklist', l: 'Checklist', i: '☑', needsDs: false }
  ];

  var KINDS = [
    { v: 'setField', l: 'Set a field to a value' },
    { v: 'clearField', l: 'Clear a field' },
    { v: 'duplicate', l: 'Duplicate the row' },
    { v: 'delete', l: 'Delete the row' },
    { v: 'moveTo', l: 'Move to another dataset' }
  ];

  var FIELDS = {
    kpi: [
      { k: 'title', kind: 'text', label: 'Title', wide: true },
      { k: 'subtitle', kind: 'text', label: 'Caption under the value' },
      { k: 'dataset', kind: 'dataset', label: 'Dataset' },
      { k: 'agg.op', kind: 'enum', label: 'Calculation', options: OPS },
      { k: 'agg.field', kind: 'column', label: 'Column', when: function (c) { return c.agg.op !== 'count'; } },
      { k: 'opts.format', kind: 'enum', label: 'Number format', options: FORMATS },
      { k: 'opts.spark.field', kind: 'column', label: 'Sparkline over a date column', types: ['date'] },
      { k: 'agg.filter', kind: 'filter', label: 'Only count rows where…', wide: true }
    ],
    chart: [
      { k: 'title', kind: 'text', label: 'Title', wide: true },
      { k: 'subtitle', kind: 'text', label: 'Caption (unit, period)' },
      { k: 'dataset', kind: 'dataset', label: 'Dataset' },
      { k: 'opts.kind', kind: 'enum', label: 'Chart type', options: [
        { v: 'bar', l: 'Bars' }, { v: 'line', l: 'Line' },
        { v: 'donut', l: 'Donut (share)' }, { v: 'hbar', l: 'Ranking' }] },
      { k: 'agg.op', kind: 'enum', label: 'Calculation', options: OPS },
      { k: 'agg.field', kind: 'column', label: 'Column', when: function (c) { return c.agg.op !== 'count'; } },
      { k: 'agg.groupBy.field', kind: 'column', label: 'Group by column' },
      { k: 'agg.groupBy.grain', kind: 'enum', label: 'Time grouping', options: GRAINS },
      { k: 'agg.split.field', kind: 'column', label: 'Split into series by' },
      { k: 'agg.groupBy.limit', kind: 'number', label: 'Max groups (0 = no limit)' },
      { k: 'agg.filter', kind: 'filter', label: 'Only count rows where…', wide: true }
    ],
    table: [
      { k: 'title', kind: 'text', label: 'Title', wide: true },
      { k: 'dataset', kind: 'dataset', label: 'Dataset' },
      { k: 'opts.pageSize', kind: 'number', label: 'Rows per page' },
      { k: 'opts.editable', kind: 'bool', label: 'Allow editing' },
      { k: 'opts.selectable', kind: 'bool', label: 'Row checkboxes' },
      { k: 'opts.search', kind: 'bool', label: 'Search box' },
      { k: 'opts.rowNotes', kind: 'bool', label: 'Notes on rows' },
      { k: 'opts.columns', kind: 'columns', label: 'Columns to show', wide: true },
      { k: 'opts.filter', kind: 'filter', label: 'Fixed filter (this is how you make a saved view)', wide: true },
      { k: 'opts.contextMenu', kind: 'ctxmenu', label: 'Right-click menu', wide: true }
    ],
    progress: [
      { k: 'title', kind: 'text', label: 'Title', wide: true },
      { k: 'subtitle', kind: 'text', label: 'Description' },
      { k: 'dataset', kind: 'dataset', label: 'Dataset' },
      { k: 'agg.op', kind: 'enum', label: 'Calculation', options: OPS },
      { k: 'agg.field', kind: 'column', label: 'Column', when: function (c) { return c.agg.op !== 'count'; } },
      { k: 'opts.target', kind: 'number', label: 'Target' },
      { k: 'opts.format', kind: 'enum', label: 'Number format', options: FORMATS },
      { k: 'agg.filter', kind: 'filter', label: 'Only count rows where…', wide: true }
    ],
    banner: [
      { k: 'title', kind: 'text', label: 'Heading', wide: true },
      { k: 'opts.text', kind: 'text', label: 'Body ({{v}} inserts the calculated number)', wide: true },
      { k: 'opts.tone', kind: 'enum', label: 'Tone', options: [
        { v: '', l: 'neutral' }, { v: 'accent', l: 'accent' },
        { v: 'success', l: 'green' }, { v: 'warning', l: 'amber' }, { v: 'danger', l: 'red' }] },
      { k: 'opts.icon', kind: 'text', label: 'Icon (one character)' },
      { k: 'dataset', kind: 'dataset', label: 'Dataset for {{v}}' },
      { k: 'agg.op', kind: 'enum', label: 'Calculation', options: OPS },
      { k: 'agg.field', kind: 'column', label: 'Column', when: function (c) { return c.agg.op !== 'count'; } },
      { k: 'agg.filter', kind: 'filter', label: 'Only count rows where…', wide: true }
    ],
    agenda: [
      { k: 'title', kind: 'text', label: 'Title', wide: true },
      { k: 'subtitle', kind: 'text', label: 'Caption' },
      { k: 'opts.range', kind: 'enum', label: 'Range', options: [
        { v: '', l: 'everything' }, { v: 'next30', l: 'next 30 days' }] },
      { k: 'opts.showOverdue', kind: 'bool', label: 'Include overdue' },
      { k: 'opts.sources', kind: 'sources', label: 'Where the dates come from', wide: true }
    ],
    notes: [
      { k: 'title', kind: 'text', label: 'Title', wide: true },
      { k: 'subtitle', kind: 'text', label: 'Caption' }
    ],
    checklist: [
      { k: 'title', kind: 'text', label: 'Title', wide: true },
      { k: 'subtitle', kind: 'text', label: 'Caption' },
      { k: 'opts.resetDaily', kind: 'bool', label: 'Clear the ticks every day' },
      { k: 'opts.showDue', kind: 'bool', label: 'Show item due dates' }
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
  function small(el2, flex) {
    el2.className = (el2.tagName === 'SELECT' ? 'tb-select' : 'tb-input') + ' tb-input-sm';
    if (flex) el2.style.flex = flex;
    return el2;
  }

  /* ====================================================================== szablony */

  function tplBlank() {
    var cfg = freshConfig();
    cfg.meta.name = 'My tracker';
    var ds = { id: mintId('ds_'), name: 'Data', titleField: null, columns: [] };
    ds.columns.push({ id: mintId('c_'), label: 'Name', type: 'text', required: true });
    ds.titleField = ds.columns[0].id;
    cfg.datasets.push(ds);
    cfg.tabs.push({
      id: mintId('t_'), label: 'Data', icon: '▤',
      layout: { cols: 1, variant: 'even' },
      components: [{
        id: mintId('k_'), type: 'table', title: 'Data', col: 0, order: 10, span: 'full',
        dataset: ds.id, agg: { op: 'count' },
        opts: {
          pageSize: 50, editable: true, selectable: true, search: true, rowNotes: true,
          columns: [ds.columns[0].id],
          contextMenu: {
            builtins: ['edit', 'duplicate', 'delete', 'addNote', 'copyRow', 'exportSelected'],
            actions: []
          }
        }
      }]
    });
    return cfg;
  }

  function tplRequests() {
    var cfg = freshConfig();
    cfg.meta.name = 'Request log';
    cfg.meta.team = 'Operations';
    var c = {
      req: mintId('c_'), subj: mintId('c_'), recv: mintId('c_'),
      due: mintId('c_'), stat: mintId('c_'), own: mintId('c_'), res: mintId('c_')
    };
    var ds = {
      id: mintId('ds_'), name: 'Requests', titleField: c.subj,
      columns: [
        { id: c.req, label: 'Requested by', type: 'text', required: true },
        { id: c.subj, label: 'Subject', type: 'text', required: true },
        { id: c.recv, label: 'Received', type: 'date', default: '@today' },
        { id: c.due, label: 'Due', type: 'date' },
        { id: c.stat, label: 'Status', type: 'enum', default: 'new', options: [
          { value: 'new', label: 'New', tone: 'info' },
          { value: 'wip', label: 'In progress', tone: 'warning' },
          { value: 'done', label: 'Closed', tone: 'success' }] },
        { id: c.own, label: 'Owner', type: 'text', default: '@user' },
        { id: c.res, label: 'Resolution', type: 'longtext' }
      ]
    };
    cfg.datasets.push(ds);

    var open = { op: 'and', rules: [{ field: c.stat, cmp: 'ne', value: 'done' }] };
    var overdue = { op: 'and', rules: [
      { field: c.due, cmp: 'relDate', value: 'overdue' },
      { field: c.stat, cmp: 'ne', value: 'done' }] };
    var mine = { op: 'and', rules: [
      { field: c.own, cmp: 'eq', value: '@user' },
      { field: c.stat, cmp: 'ne', value: 'done' }] };

    var tSummary = mintId('t_'), tLog = mintId('t_'), tDates = mintId('t_'), tNotes = mintId('t_');

    cfg.tabs.push({
      id: tSummary, label: 'Summary', icon: '◷',
      layout: { cols: 2, variant: 'main' },
      components: [
        { id: mintId('k_'), type: 'banner', title: 'Open requests', col: 0, order: 5, span: 'full',
          dataset: ds.id, agg: { op: 'count', filter: open },
          opts: { tone: 'accent', icon: 'ℹ', text: '{{v}} still waiting for an answer.', format: 'integer' } },
        { id: mintId('k_'), type: 'kpi', title: 'All requests', col: 0, order: 10,
          dataset: ds.id, agg: { op: 'count' }, opts: { format: 'integer' } },
        { id: mintId('k_'), type: 'kpi', title: 'Overdue', col: 1, order: 11,
          dataset: ds.id, agg: { op: 'count', filter: overdue }, opts: { format: 'integer' } },
        { id: mintId('k_'), type: 'chart', title: 'Requests over time', col: 0, order: 20,
          dataset: ds.id,
          agg: { op: 'count', groupBy: { field: c.recv, grain: 'month', sort: 'key_asc' } },
          opts: { kind: 'bar' } },
        { id: mintId('k_'), type: 'chart', title: 'By status', col: 1, order: 21,
          dataset: ds.id, agg: { op: 'count', groupBy: { field: c.stat, sort: 'value_desc' } },
          opts: { kind: 'donut' } }
      ]
    });

    cfg.tabs.push({
      id: tLog, label: 'Log', icon: '▤',
      layout: { cols: 1, variant: 'even' },
      components: [{
        id: mintId('k_'), type: 'table', title: 'Requests', col: 0, order: 10, span: 'full',
        dataset: ds.id, agg: { op: 'count' },
        opts: {
          pageSize: 50, editable: true, selectable: true, search: true, rowNotes: true,
          columns: [c.recv, c.subj, c.req, c.stat, c.due, c.own],
          quickFilters: [
            { label: 'Open', filter: open },
            { label: 'Overdue', filter: overdue },
            { label: 'Mine', filter: mine }
          ],
          contextMenu: {
            builtins: ['edit', 'duplicate', 'delete', 'addNote', 'copyRow', 'exportSelected'],
            actions: [
              { id: mintId('a_'), label: 'Close request', icon: '✓', kind: 'setField', field: c.stat, value: 'done' },
              { id: mintId('a_'), label: 'Due today', icon: '📅', kind: 'setField', field: c.due, value: '@today' },
              { id: mintId('a_'), label: 'Assign to me', icon: '👤', kind: 'setField', field: c.own, value: '@user' }
            ]
          }
        }
      }]
    });

    cfg.tabs.push({
      id: tDates, label: 'Dates', icon: '🗓',
      layout: { cols: 2, variant: 'main' },
      components: [
        { id: mintId('k_'), type: 'agenda', title: 'What is due', col: 0, order: 10,
          opts: { range: 'next30', showOverdue: true, display: 'list',
            sources: [{ dataset: ds.id, dateField: c.due, titleField: c.subj,
              metaField: c.own, toneField: c.stat, filter: open }] } },
        { id: mintId('k_'), type: 'checklist', title: 'Daily routine', col: 1, order: 11,
          opts: { resetDaily: true, showDue: false } }
      ]
    });

    cfg.tabs.push({
      id: tNotes, label: 'Notes', icon: '🗒',
      layout: { cols: 1, variant: 'even' },
      components: [{ id: mintId('k_'), type: 'notes', title: 'Sticky notes', col: 0, order: 10, span: 'full', opts: {} }]
    });

    cfg.alerts = [
      { id: mintId('al_'), label: 'Overdue requests', dataset: ds.id, filter: overdue,
        cmp: 'gt', value: 0, tone: 'danger',
        message: '{{n}} requests are past their due date.', goToTab: tLog },
      { id: mintId('al_'), label: 'Unassigned work', dataset: ds.id,
        filter: { op: 'and', rules: [
          { field: c.own, cmp: 'empty' },
          { field: c.stat, cmp: 'ne', value: 'done' }] },
        cmp: 'gt', value: 0, tone: 'warning',
        message: '{{n}} open requests have no owner.', goToTab: tLog }
    ];
    return cfg;
  }

  function tplTasks() {
    var cfg = freshConfig();
    cfg.meta.name = 'Tasks and notes';
    var c = { t: mintId('c_'), due: mintId('c_'), pr: mintId('c_'), who: mintId('c_'), done: mintId('c_') };
    var ds = {
      id: mintId('ds_'), name: 'Tasks', titleField: c.t,
      columns: [
        { id: c.t, label: 'Task', type: 'text', required: true },
        { id: c.due, label: 'Due', type: 'date' },
        { id: c.pr, label: 'Priority', type: 'enum', default: 'mid', options: [
          { value: 'low', label: 'Low', tone: '' },
          { value: 'mid', label: 'Medium', tone: 'warning' },
          { value: 'high', label: 'High', tone: 'danger' }] },
        { id: c.who, label: 'Owner', type: 'text', default: '@user' },
        { id: c.done, label: 'Done', type: 'bool' }
      ]
    };
    cfg.datasets.push(ds);
    var notDone = { op: 'and', rules: [{ field: c.done, cmp: 'ne', value: 'true' }] };
    var tToday = mintId('t_'), tAll = mintId('t_');

    cfg.tabs.push({
      id: tToday, label: 'Today', icon: '◆',
      layout: { cols: 2, variant: 'main' },
      components: [
        { id: mintId('k_'), type: 'agenda', title: 'Coming up', col: 0, order: 10,
          opts: { range: 'next30', showOverdue: true, display: 'list',
            sources: [{ dataset: ds.id, dateField: c.due, titleField: c.t,
              metaField: c.who, toneField: c.pr, filter: notDone }] } },
        { id: mintId('k_'), type: 'checklist', title: 'Daily checklist', col: 1, order: 11,
          opts: { resetDaily: true } },
        { id: mintId('k_'), type: 'notes', title: 'Sticky notes', col: 1, order: 12, opts: {} }
      ]
    });
    cfg.tabs.push({
      id: tAll, label: 'Tasks', icon: '▤',
      layout: { cols: 1, variant: 'even' },
      components: [{
        id: mintId('k_'), type: 'table', title: 'All tasks', col: 0, order: 10, span: 'full',
        dataset: ds.id, agg: { op: 'count' },
        opts: {
          pageSize: 50, editable: true, selectable: true, search: true, rowNotes: true,
          columns: [c.t, c.due, c.pr, c.who, c.done],
          quickFilters: [{ label: 'Not done', filter: notDone }],
          contextMenu: {
            builtins: ['edit', 'duplicate', 'delete', 'addNote', 'copyRow', 'exportSelected'],
            actions: [
              { id: mintId('a_'), label: 'Mark as done', icon: '✓', kind: 'setField', field: c.done, value: 'true' },
              { id: mintId('a_'), label: 'Due today', icon: '📅', kind: 'setField', field: c.due, value: '@today' }
            ]
          }
        }
      }]
    });
    cfg.alerts = [
      { id: mintId('al_'), label: 'Overdue tasks', dataset: ds.id,
        filter: { op: 'and', rules: [
          { field: c.due, cmp: 'relDate', value: 'overdue' },
          { field: c.done, cmp: 'ne', value: 'true' }] },
        cmp: 'gt', value: 0, tone: 'danger',
        message: '{{n}} tasks are overdue.', goToTab: tAll }
    ];
    return cfg;
  }

  var TEMPLATES = [
    { id: 'requests', name: 'Request log',
      text: 'Incoming requests with owner, status and due date. Comes with a summary, an agenda and alerts.',
      make: tplRequests },
    { id: 'tasks', name: 'Tasks and notes',
      text: 'A task list with priorities, a daily checklist, sticky notes and an agenda.',
      make: tplTasks },
    { id: 'blank', name: 'Blank tracker',
      text: 'One dataset and one table. You build everything else yourself.',
      make: tplBlank }
  ];

  /* ====================================================================== kroki */

  function render() {
    renderRail();
    for (var i = 0; i <= LAST; i++) {
      var p = doc.getElementById('wz-step-' + i);
      if (p) p.hidden = i !== W.step;
    }
    doc.getElementById('wz-step-title').textContent = STEPS[W.step].label;
    doc.getElementById('wz-progress').textContent = 'step ' + (W.step + 1) + ' of ' + (LAST + 1);
    doc.getElementById('wz-prev').disabled = W.step === 0;
    var next = doc.getElementById('wz-next');
    next.textContent = W.step === LAST ? 'Save tracker' : 'Next →';
    next.disabled = W.step === 0 && !W.cfg;
    doc.getElementById('wz-errors').innerHTML = '';

    var fn = [renderStep0, renderStep1, renderStep2, renderStep3, renderStep4,
      renderStep5, renderStep6][W.step];
    if (fn) fn();

    doc.getElementById('wz-side-note').textContent = [
      'Pick a template, or load a .tracker.json if you want to change an existing tracker.',
      'The style is fixed when you generate. To change it later, load the .tracker.json back here.',
      'Renaming a column is always safe. Deleting one only hides its data — it comes back if you re-add it.',
      'Layout means how the screen is split. Table columns are set in the Components step.',
      'Components that calculate bind to a dataset and refresh themselves after every change.',
      'Alerts appear under the bell in the tracker. They are recalculated after every change.',
      'Save both files. The HTML is the tracker; the .tracker.json is its structure for later edits.'
    ][W.step] || '';
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

  /* ---- 0: start ---- */

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
        TBUI.toast('Loaded the “' + t.name + '” template', 'success');
      });
      box.appendChild(b);
    });
  }

  /* ---- 1: basics ---- */

  function renderStep1() {
    var host = doc.getElementById('wz-step-1');
    host.innerHTML = '';
    var m = W.cfg.meta;

    var basics = el('div', 'wz-fields');
    basics.appendChild(field('Tracker name', input(m.name, function (v) {
      m.name = v.trim() || 'Tracker';
    }), true));
    basics.appendChild(field('Number and date format', select(LOCALES, m.locale, function (v) {
      m.locale = v;
    })));
    basics.appendChild(field('Currency', select(CURRENCIES, m.currency, function (v) {
      m.currency = v;
    })));
    host.appendChild(card('Basics', basics));

    var pers = el('div', '');
    pers.appendChild(hint('Everyone who opens the tracker can set their own name, team, avatar ' +
      'colour and photo. The “assign to me” action uses that name.'));
    var pf = el('div', 'wz-fields');
    pf.appendChild(field('Default team name', input(m.team, function (v) { m.team = v.trim(); })));
    pers.appendChild(pf);
    var sw = el('div', '');
    sw.style.marginTop = '10px';
    sw.appendChild(checkbox('Let people personalise the tracker', m.personalization !== false,
      function (v) { m.personalization = v; }));
    pers.appendChild(sw);
    host.appendChild(card('Personalisation', pers));

    var themeBox = el('div', '');
    themeBox.appendChild(hint('The style is baked into the generated file. To switch it later, ' +
      'load the .tracker.json back into this wizard, pick another style and generate again — ' +
      'your data stays where it is.'));
    var themes = el('div', 'wz-themes');
    (ASSET.themes.themes || []).forEach(function (t) {
      var b = el('button', 'wz-tile');
      b.type = 'button';
      b.setAttribute('aria-pressed', m.theme === t.id ? 'true' : 'false');
      var swatch = el('div', 'wz-swatch');
      swatch.innerHTML =
        '<span style="background:' + esc(t.swatch.pageBg) + '"></span>' +
        '<span style="background:' + esc(t.swatch.surface) + '"></span>' +
        '<span class="wz-sw-series">' + t.swatch.series.map(function (c) {
          return '<i style="background:' + esc(c) + '"></i>';
        }).join('') + '</span>';
      b.appendChild(swatch);
      b.appendChild(el('div', 'wz-tile-title', t.name));
      b.appendChild(el('div', 'wz-tile-text', Math.round(t.bytes / 1024) + ' KB'));
      b.addEventListener('click', function () {
        m.theme = t.id;
        m.fontHref = t.fontHref || null;
        renderStep1();
      });
      themes.appendChild(b);
    });
    themeBox.appendChild(themes);
    var fonts = el('div', '');
    fonts.style.marginTop = '14px';
    fonts.appendChild(checkbox('Load web fonts when online (otherwise system fonts)',
      m.useWebFonts, function (v) { m.useWebFonts = v; }));
    themeBox.appendChild(fonts);
    host.appendChild(card('Style', themeBox));
  }

  /* ---- 2: data ---- */

  function usedDataset(dsId) {
    var n = 0;
    W.cfg.tabs.forEach(function (t) {
      (t.components || []).forEach(function (c) {
        if (c.dataset === dsId) n++;
        ((c.opts || {}).sources || []).forEach(function (s) { if (s.dataset === dsId) n++; });
      });
    });
    (W.cfg.alerts || []).forEach(function (a) { if (a.dataset === dsId) n++; });
    return n;
  }

  function renderStep2() {
    var host = doc.getElementById('wz-step-2');
    host.innerHTML = '';
    if (!W.cfg.datasets.length) {
      W.cfg.datasets.push({ id: mintId('ds_'), name: 'Data', titleField: null, columns: [] });
    }
    if (W.ds >= W.cfg.datasets.length) W.ds = 0;

    var split = el('div', 'wz-split');

    var left = el('div', '');
    left.appendChild(hint('A dataset is one table: columns and rows. Components that calculate ' +
      'bind to a dataset.'));
    W.cfg.datasets.forEach(function (d, i) {
      var row = el('div', 'wz-row');
      if (i === W.ds) row.style.borderColor = 'var(--accent)';
      var main = el('div', 'wz-row-main');
      main.appendChild(el('div', 'wz-row-title', d.name));
      main.appendChild(el('div', 'wz-row-meta', d.columns.length + ' columns'));
      main.style.cursor = 'pointer';
      main.addEventListener('click', function () { W.ds = i; renderStep2(); });
      row.appendChild(main);
      var acts = el('div', 'wz-row-actions');
      acts.appendChild(mini('✕', 'Delete dataset', function () {
        var used = usedDataset(d.id);
        TBUI.confirm({
          title: 'Delete “' + d.name + '”?',
          text: used ? used + ' components or alerts use it — they will lose their source.'
            : 'Nothing uses this dataset.',
          confirmLabel: 'Delete dataset', tone: 'danger'
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
    var add = btn('+ New dataset', 'btn-secondary', function () {
      W.cfg.datasets.push({ id: mintId('ds_'), name: 'New dataset', titleField: null, columns: [] });
      W.ds = W.cfg.datasets.length - 1;
      renderStep2();
    });
    add.style.marginTop = '8px';
    left.appendChild(add);
    split.appendChild(card('Datasets', left));

    var ds = W.cfg.datasets[W.ds];
    var right = el('div', 'tb-stack');
    var nameRow = el('div', 'wz-fields');
    nameRow.appendChild(field('Dataset name', input(ds.name, function (v) {
      ds.name = v.trim() || 'Dataset';
      renderStep2();
    })));
    nameRow.appendChild(field('Column used as the row title', select(
      [{ v: '', l: '— none —' }].concat(ds.columns.map(function (c) { return { v: c.id, l: c.label }; })),
      ds.titleField || '', function (v) { ds.titleField = v || null; })));
    right.appendChild(nameRow);

    var list = el('div', '');
    ds.columns.forEach(function (c, i) { list.appendChild(columnRow(ds, c, i)); });
    if (!ds.columns.length) {
      list.appendChild(el('p', 'tb-dim', 'No columns yet. Add one, or paste a header from Excel.'));
    }
    right.appendChild(list);

    var bar = el('div', 'tb-flexrow');
    bar.appendChild(btn('+ Add column', 'btn-primary', function () {
      ds.columns.push({ id: mintId('c_'), label: 'New column', type: 'text' });
      if (!ds.titleField) ds.titleField = ds.columns[0].id;
      renderStep2();
    }));
    bar.appendChild(btn('Paste a header from Excel', 'btn-secondary', function () { pasteColumns(ds); }));
    right.appendChild(bar);
    split.appendChild(card('Columns of “' + ds.name + '”', right));
    host.appendChild(split);

    var warn = el('div', 'tb-banner tb-banner-accent');
    warn.innerHTML = '<i>ℹ</i><div class="tb-banner-body"><div class="tb-banner-title">' +
      'Renaming is not the same as deleting</div><div class="tb-banner-text">' +
      'Rename a column as often as you like — the data stays, because the tracker matches columns ' +
      'by a hidden id. <b>Deleting</b> a column only hides its data (it returns if you add the ' +
      'column back). Never delete a column just to rename it.</div></div>';
    host.appendChild(warn);
  }

  function columnRow(ds, c, i) {
    var row = el('div', 'wz-row');
    var main = el('div', 'wz-row-main');
    var top = el('div', 'tb-flexrow');
    top.style.gap = '6px';
    var nameI = small(input(c.label, function (v) { c.label = v.trim() || 'Column'; }), '1 1 140px');
    nameI.setAttribute('aria-label', 'Column name');
    top.appendChild(nameI);
    var typeS = small(select(COL_TYPES, c.type, function (v) {
      c.type = v;
      if (v !== 'enum') delete c.options;
      if (v !== 'number') delete c.format;
      renderStep2();
    }), '0 0 130px');
    typeS.setAttribute('aria-label', 'Column type');
    top.appendChild(typeS);
    if (c.type === 'number') {
      var fmtS = small(select(FORMATS, c.format || 'number', function (v) { c.format = v; }), '0 0 120px');
      fmtS.setAttribute('aria-label', 'Number format');
      top.appendChild(fmtS);
    }
    main.appendChild(top);

    var bottom = el('div', 'tb-flexrow');
    bottom.style.cssText = 'gap:10px;margin-top:4px';
    bottom.appendChild(checkbox('required', c.required, function (v) {
      if (v) c.required = true; else delete c.required;
    }));
    if (c.type === 'date') {
      bottom.appendChild(checkbox('defaults to today', c.default === '@today', function (v) {
        if (v) c.default = '@today'; else delete c.default;
      }));
    }
    if (c.type === 'text') {
      bottom.appendChild(checkbox('defaults to the user’s name', c.default === '@user', function (v) {
        if (v) c.default = '@user'; else delete c.default;
      }));
      bottom.appendChild(checkbox('defaults to their team', c.default === '@team', function (v) {
        if (v) c.default = '@team'; else delete c.default;
      }));
    }
    if (c.type === 'enum') {
      bottom.appendChild(btn('Pick list options (' + ((c.options || []).length) + ')', 'btn-ghost',
        function () { editOptions(c); }));
    }
    main.appendChild(bottom);
    row.appendChild(main);

    var acts = el('div', 'wz-row-actions');
    acts.appendChild(mini('↑', 'Move up', function () {
      if (i === 0) return;
      ds.columns.splice(i - 1, 0, ds.columns.splice(i, 1)[0]);
      renderStep2();
    }));
    acts.appendChild(mini('↓', 'Move down', function () {
      if (i >= ds.columns.length - 1) return;
      ds.columns.splice(i + 1, 0, ds.columns.splice(i, 1)[0]);
      renderStep2();
    }));
    acts.appendChild(mini('✕', 'Delete column', function () {
      TBUI.confirm({
        title: 'Delete “' + c.label + '”?',
        text: 'In an existing tracker its data is hidden, not erased — it comes back if you add ' +
          'this column again. If you only want a new name, close this and edit the name field.',
        confirmLabel: 'Delete column', tone: 'danger'
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
      wrap.appendChild(hint('The value is the identifier stored in your data; the label is what ' +
        'people see and what lands in the Excel export.'));
      col.options.forEach(function (o, i) {
        var r = el('div', 'wz-row');
        var m = el('div', 'tb-flexrow');
        m.style.cssText = 'flex:1;gap:6px';
        var vi = small(input(o.value, function (v) { o.value = v.trim(); }), '1 1 90px');
        vi.placeholder = 'value';
        vi.setAttribute('aria-label', 'Value');
        var li = small(input(o.label, function (v) { o.label = v; }), '1 1 110px');
        li.placeholder = 'label';
        li.setAttribute('aria-label', 'Label');
        var ts = small(select(TONES, o.tone || '', function (v) { o.tone = v; }), '0 0 110px');
        ts.setAttribute('aria-label', 'Colour');
        m.appendChild(vi);
        m.appendChild(li);
        m.appendChild(ts);
        r.appendChild(m);
        var a = el('div', 'wz-row-actions');
        a.appendChild(mini('✕', 'Remove option', function () {
          col.options.splice(i, 1);
          draw();
        }, true));
        r.appendChild(a);
        wrap.appendChild(r);
      });
      wrap.appendChild(btn('+ Add option', 'btn-secondary', function () {
        var n = col.options.length + 1;
        col.options.push({ value: 'option' + n, label: 'Option ' + n, tone: '' });
        draw();
      }));
    }
    draw();

    TBUI.modal.show({
      size: 'lg', title: 'Pick list options for “' + col.label + '”', body: wrap,
      actions: [{ label: 'Done', variant: 'primary', onClick: function () { renderStep2(); } }]
    });
  }

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

  function guessType(samples) {
    if (!samples.length) return 'text';
    var dates = 0, nums = 0, bools = 0, uniq = {};
    samples.forEach(function (s) {
      var v = String(s).trim();
      uniq[v.toLowerCase()] = 1;
      if (/^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(v)) dates++;
      else if (/^-?[\d\s]+([.,]\d+)?$/.test(v)) nums++;
      if (/^(yes|no|true|false|tak|nie|1|0)$/i.test(v)) bools++;
    });
    var n = samples.length;
    if (bools === n && Object.keys(uniq).length <= 2) return 'bool';
    if (dates / n >= 0.7) return 'date';
    if (nums / n >= 0.7) return 'number';
    if (Object.keys(uniq).length <= Math.max(2, Math.min(8, n / 2))) return 'enum';
    if (samples.some(function (s) { return String(s).length > 80; })) return 'longtext';
    return 'text';
  }

  function pasteColumns(ds) {
    var ta = el('textarea', 'tb-textarea');
    ta.style.minHeight = '140px';
    ta.placeholder = 'Paste a header row and a few rows from Excel (Ctrl+V).\n' +
      'Column names come from the first row; types are guessed from the rows below.';
    ta.setAttribute('aria-label', 'Paste a header from Excel');
    var wrap = el('div', 'tb-stack');
    wrap.appendChild(hint('This creates the columns only. Rows are imported later, inside the ' +
      'tracker itself — it has the same paste box.'));
    wrap.appendChild(ta);

    TBUI.modal.show({
      size: 'lg', title: 'Paste a header from Excel', body: wrap,
      onOpen: function () { setTimeout(function () { ta.focus(); }, 50); },
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Create columns', variant: 'primary', close: false, onClick: function () {
            var rows = parseDelimited(ta.value);
            if (!rows.length) {
              TBUI.toast('I cannot see any data there', 'warning');
              return false;
            }
            var header = rows[0], body = rows.slice(1), added = 0;
            header.forEach(function (h, i) {
              var label = String(h).trim();
              if (!label) return;
              var samples = body.map(function (r) { return r[i]; })
                .filter(function (v) { return v != null && String(v).trim() !== ''; });
              var type = guessType(samples);
              var col = { id: mintId('c_'), label: label, type: type };
              if (type === 'enum') {
                var seen = {};
                samples.forEach(function (s) { seen[String(s).trim()] = 1; });
                col.options = Object.keys(seen).map(function (v) {
                  return { value: v, label: v, tone: '' };
                });
              }
              ds.columns.push(col);
              added++;
            });
            if (!ds.titleField && ds.columns.length) ds.titleField = ds.columns[0].id;
            TBUI.toast('Created ' + added + ' columns', 'success');
            TBUI.modal.close(wrap.closest('dialog'));
            renderStep2();
            return false;
          }
        }
      ]
    });
  }

  /* ---- 3: tabs ---- */

  function typeLabel(v) {
    var t = TYPES.filter(function (x) { return x.v === v; })[0];
    return t ? t.l : v;
  }

  function renderStep3() {
    var host = doc.getElementById('wz-step-3');
    host.innerHTML = '';
    var body = el('div', '');
    body.appendChild(hint('A tab is one page of the tracker. Layout splits it into columns; ' +
      'components go into those columns in the next step.'));

    W.cfg.tabs.forEach(function (t, i) {
      var row = el('div', 'wz-row');
      var main = el('div', 'wz-row-main');
      var top = el('div', 'tb-flexrow');
      top.style.gap = '6px';
      var ni = small(input(t.label, function (v) { t.label = v.trim() || 'Tab'; }), '1 1 160px');
      ni.setAttribute('aria-label', 'Tab name');
      top.appendChild(ni);
      var ii = small(input(t.icon || '▦', function (v) { t.icon = v.slice(0, 2) || '▦'; }), '0 0 56px');
      ii.setAttribute('aria-label', 'Icon');
      top.appendChild(ii);
      var cs = small(select([{ v: '1', l: '1 column' }, { v: '2', l: '2 columns' }, { v: '3', l: '3 columns' }],
        String((t.layout && t.layout.cols) || 1), function (v) {
          t.layout = t.layout || {};
          t.layout.cols = +v;
          renderStep3();
        }), '0 0 120px');
      cs.setAttribute('aria-label', 'Number of columns');
      top.appendChild(cs);
      if ((t.layout && t.layout.cols) === 2) {
        var vs = small(select([{ v: 'even', l: 'equal' }, { v: 'main', l: 'wide + narrow' }],
          (t.layout.variant || 'even'), function (v) { t.layout.variant = v; }), '0 0 150px');
        vs.setAttribute('aria-label', 'Column proportions');
        top.appendChild(vs);
      }
      main.appendChild(top);
      main.appendChild(el('div', 'wz-row-meta',
        (t.components || []).length + ' components · ' +
        (t.components || []).map(function (c) { return typeLabel(c.type); }).join(', ')));
      row.appendChild(main);

      var acts = el('div', 'wz-row-actions');
      acts.appendChild(mini('◳', 'Edit components', function () {
        W.tab = i;
        W.step = 4;
        render();
      }));
      acts.appendChild(mini('↑', 'Move up', function () {
        if (i === 0) return;
        W.cfg.tabs.splice(i - 1, 0, W.cfg.tabs.splice(i, 1)[0]);
        renderStep3();
      }));
      acts.appendChild(mini('↓', 'Move down', function () {
        if (i >= W.cfg.tabs.length - 1) return;
        W.cfg.tabs.splice(i + 1, 0, W.cfg.tabs.splice(i, 1)[0]);
        renderStep3();
      }));
      acts.appendChild(mini('✕', 'Delete tab', function () {
        TBUI.confirm({
          title: 'Delete “' + t.label + '”?',
          text: 'It takes ' + (t.components || []).length + ' components with it. ' +
            'Your datasets are not affected.',
          confirmLabel: 'Delete tab', tone: 'danger'
        }).then(function (ok) {
          if (!ok) return;
          W.cfg.tabs.splice(i, 1);
          renderStep3();
        });
      }, true));
      row.appendChild(acts);
      body.appendChild(row);
    });

    if (!W.cfg.tabs.length) body.appendChild(el('p', 'tb-dim', 'No tabs yet. Add the first one.'));
    var add = btn('+ Add tab', 'btn-primary', function () {
      W.cfg.tabs.push({
        id: mintId('t_'), label: 'New tab', icon: '▦',
        layout: { cols: 1, variant: 'even' }, components: []
      });
      renderStep3();
    });
    add.style.marginTop = '10px';
    body.appendChild(add);
    host.appendChild(card('Tabs', body));
  }

  /* ---- 4: components ---- */

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
        contextMenu: {
          builtins: ['edit', 'duplicate', 'delete', 'addNote', 'copyRow', 'exportSelected'],
          actions: []
        }
      };
    }
    if (type === 'agenda') c.opts = { range: 'next30', showOverdue: true, display: 'list', sources: [] };
    if (type === 'banner') { c.span = 'full'; c.opts = { tone: 'accent', icon: 'ℹ', text: '' }; }
    if (type === 'checklist') c.opts = { resetDaily: false, showDue: true };
    return c;
  }

  function renderStep4() {
    var host = doc.getElementById('wz-step-4');
    host.innerHTML = '';
    if (!W.cfg.tabs.length) {
      host.appendChild(card('No tabs', el('p', 'tb-dim',
        'Go back to the Tabs step and add at least one.')));
      return;
    }
    if (W.tab >= W.cfg.tabs.length) W.tab = 0;
    var tab = W.cfg.tabs[W.tab];

    var picker = el('div', 'tb-flexrow');
    picker.appendChild(field('Tab', select(
      W.cfg.tabs.map(function (t, i) { return { v: String(i), l: t.label }; }),
      String(W.tab), function (v) { W.tab = +v; W.cmp = null; renderStep4(); })));
    host.appendChild(card(null, picker));

    var split = el('div', 'wz-split');

    var left = el('div', '');
    var comps = (tab.components || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
    tab.components = comps;
    comps.forEach(function (c, i) {
      var row = el('div', 'wz-row');
      if (c.id === W.cmp) row.style.borderColor = 'var(--accent)';
      var main = el('div', 'wz-row-main');
      main.appendChild(el('div', 'wz-row-title', c.title || typeLabel(c.type)));
      main.appendChild(el('div', 'wz-row-meta', typeLabel(c.type) + ' · ' +
        (c.span === 'full' ? 'full width' : 'column ' + ((c.col || 0) + 1))));
      main.style.cursor = 'pointer';
      main.addEventListener('click', function () { W.cmp = c.id; renderStep4(); });
      row.appendChild(main);
      var acts = el('div', 'wz-row-actions');
      acts.appendChild(mini('↑', 'Move up', function () {
        if (i === 0) return;
        var prev = comps[i - 1].order || 0;
        comps[i - 1].order = c.order || 0;
        c.order = prev;
        renderStep4();
      }));
      acts.appendChild(mini('↓', 'Move down', function () {
        if (i >= comps.length - 1) return;
        var nx = comps[i + 1].order || 0;
        comps[i + 1].order = c.order || 0;
        c.order = nx;
        renderStep4();
      }));
      acts.appendChild(mini('✕', 'Remove component', function () {
        tab.components = tab.components.filter(function (x) { return x.id !== c.id; });
        if (W.cmp === c.id) W.cmp = null;
        renderStep4();
      }, true));
      row.appendChild(acts);
      left.appendChild(row);
    });
    if (!comps.length) left.appendChild(el('p', 'tb-dim', 'This tab is empty. Add a component below.'));

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
    left.appendChild(el('div', 'tb-check-group', 'Add a component'));
    left.appendChild(types);
    split.appendChild(card('Components on “' + tab.label + '”', left));

    var cmp = (tab.components || []).filter(function (c) { return c.id === W.cmp; })[0];
    var right = el('div', '');
    if (!cmp) right.appendChild(el('p', 'tb-dim', 'Pick a component on the left, or add a new one.'));
    else right.appendChild(configPanel(cmp, tab));
    split.appendChild(card(cmp ? 'Settings: ' + typeLabel(cmp.type) : 'Settings', right));
    host.appendChild(split);
  }

  function chartWarning(cmp) {
    var kind = (cmp.opts || {}).kind;
    var split = cmp.agg && cmp.agg.split && cmp.agg.split.field;
    if (kind === 'line' && split && !(cmp.agg.split.limit > 0 && cmp.agg.split.limit <= 3)) {
      return 'A line chart with many series becomes unreadable. Set the series limit to 3 or fewer.';
    }
    if (kind === 'donut' && !(cmp.agg && cmp.agg.groupBy && cmp.agg.groupBy.field)) {
      return 'A donut needs a column to group by — without one there is nothing to split.';
    }
    if ((kind === 'bar' || kind === 'line') && !(cmp.agg && cmp.agg.groupBy && cmp.agg.groupBy.field)) {
      return 'This chart needs a column in “Group by column”.';
    }
    return null;
  }

  function configPanel(cmp, tab) {
    var wrap = el('div', 'tb-stack');

    var place = el('div', 'wz-fields');
    var cols = (tab.layout && tab.layout.cols) || 1;
    place.appendChild(field('Width', select(
      [{ v: '1', l: 'one column' }, { v: 'full', l: 'full width' }],
      cmp.span === 'full' ? 'full' : '1', function (v) {
        cmp.span = v === 'full' ? 'full' : 1;
        renderStep4();
      })));
    if (cols > 1 && cmp.span !== 'full') {
      var opts = [];
      for (var i = 0; i < cols; i++) opts.push({ v: String(i), l: 'column ' + (i + 1) });
      place.appendChild(field('Place in', select(opts, String(cmp.col || 0), function (v) {
        cmp.col = +v;
        renderStep4();
      })));
    }
    wrap.appendChild(place);

    var grid = el('div', 'wz-fields');
    (FIELDS[cmp.type] || []).forEach(function (f) {
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

  function buildControl(f, cmp) {
    var val = getPath(cmp, f.k);
    var ds = dsOf(cmp.dataset);

    if (f.kind === 'text') return input(val == null ? '' : val, function (v) { setPath(cmp, f.k, v); });
    if (f.kind === 'number') {
      var i = input(val == null ? '' : val, function (v) {
        setPath(cmp, f.k, v === '' ? null : parseFloat(String(v).replace(',', '.')));
      });
      i.inputMode = 'decimal';
      return i;
    }
    if (f.kind === 'bool') {
      var w = checkbox('', !!val, function (v) { setPath(cmp, f.k, v); });
      return w;
    }
    if (f.kind === 'enum') {
      return select(f.options, val == null ? '' : String(val), function (v) {
        setPath(cmp, f.k, v);
        renderStep4();
      });
    }
    if (f.kind === 'dataset') {
      return select([{ v: '', l: '— choose —' }].concat(
        W.cfg.datasets.map(function (d) { return { v: d.id, l: d.name }; })),
        val || '', function (v) {
          setPath(cmp, f.k, v || null);
          if (cmp.opts && cmp.opts.columns) cmp.opts.columns = [];
          renderStep4();
        });
    }
    if (f.kind === 'column') {
      if (!ds) return null;
      var list = ds.columns.filter(function (c) { return !f.types || f.types.indexOf(c.type) >= 0; });
      return select([{ v: '', l: '— none —' }].concat(
        list.map(function (c) { return { v: c.id, l: c.label }; })),
        val || '', function (v) { setPath(cmp, f.k, v || null); renderStep4(); });
    }
    if (f.kind === 'columns') {
      if (!ds) return el('p', 'tb-dim', 'Choose a dataset first.');
      return columnsPicker(cmp, ds);
    }
    if (f.kind === 'filter') {
      if (!ds) return el('p', 'tb-dim', 'Choose a dataset first.');
      return filterEditor(cmp, f.k, ds, renderStep4);
    }
    if (f.kind === 'ctxmenu') {
      if (!ds) return el('p', 'tb-dim', 'Choose a dataset first.');
      return ctxMenuEditor(cmp, ds);
    }
    if (f.kind === 'sources') return sourcesEditor(cmp);
    return null;
  }

  function columnsPicker(cmp, ds) {
    cmp.opts.columns = cmp.opts.columns || [];
    var box = el('div', '');
    box.appendChild(hint('The order you tick them is the order of columns in the table and in exports.'));
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
    var all = btn('Select all', 'btn-ghost', function () {
      cmp.opts.columns = ds.columns.map(function (c) { return c.id; });
      renderStep4();
    });
    all.style.marginTop = '8px';
    box.appendChild(all);
    return box;
  }

  /* Edytor filtra działa na dowolnym obiekcie i ścieżce, żeby mógł go używać
     i panel komponentu, i edytor alertów. */
  function filterEditor(obj, path, ds, redraw) {
    var f = getPath(obj, path);
    if (!f || !f.rules) {
      f = { op: 'and', rules: [] };
      setPath(obj, path, f);
    }
    var box = el('div', '');
    box.appendChild(hint('Every condition must hold at the same time. No conditions means all rows.'));
    f.rules.forEach(function (r, i) {
      var row = el('div', 'wz-row');
      var m = el('div', 'tb-flexrow');
      m.style.cssText = 'flex:1;gap:6px;flex-wrap:wrap';
      var fs = small(select(ds.columns.map(function (c) { return { v: c.id, l: c.label }; }),
        r.field || '', function (v) { r.field = v; redraw(); }), '1 1 120px');
      fs.setAttribute('aria-label', 'Column');
      m.appendChild(fs);
      var cs = small(select(CMPS, r.cmp || 'eq', function (v) { r.cmp = v; redraw(); }), '1 1 130px');
      cs.setAttribute('aria-label', 'Condition');
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
          vc = select([{ v: 'true', l: 'yes' }, { v: 'false', l: 'no' }],
            String(r.value || 'true'), function (v) { r.value = v; });
        } else if (col && col.type === 'text') {
          vc = select([{ v: '', l: 'a value I type' }, { v: '@user', l: 'the current user' },
            { v: '@team', l: 'their team' }],
            (r.value === '@user' || r.value === '@team') ? r.value : '',
            function (v) { r.value = v; redraw(); });
        } else {
          vc = input(r.value == null ? '' : r.value, function (v) { r.value = v; });
        }
        small(vc, '1 1 120px');
        vc.setAttribute('aria-label', 'Value');
        m.appendChild(vc);
        var colT = col && col.type === 'text';
        if (colT && r.value !== '@user' && r.value !== '@team') {
          var ti = small(input(r.value == null ? '' : r.value, function (v) { r.value = v; }), '1 1 110px');
          ti.placeholder = 'value';
          ti.setAttribute('aria-label', 'Typed value');
          m.appendChild(ti);
        }
      }
      row.appendChild(m);
      var a = el('div', 'wz-row-actions');
      a.appendChild(mini('✕', 'Remove condition', function () {
        f.rules.splice(i, 1);
        redraw();
      }, true));
      row.appendChild(a);
      box.appendChild(row);
    });
    var add = btn('+ Add condition', 'btn-ghost', function () {
      f.rules.push({ field: ds.columns.length ? ds.columns[0].id : '', cmp: 'eq', value: '' });
      redraw();
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
    box.appendChild(hint('Right-clicking a row that is part of a selection applies the action to ' +
      'the whole selection. On a row outside the selection it applies to that row only.'));

    var bset = [
      { v: 'edit', l: 'Edit row' }, { v: 'duplicate', l: 'Duplicate' },
      { v: 'addNote', l: 'Add a note' }, { v: 'copyRow', l: 'Copy as text' },
      { v: 'exportSelected', l: 'Export selected' }, { v: 'delete', l: 'Delete row' }
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
    box.appendChild(el('div', 'tb-check-group', 'Standard items'));
    box.appendChild(chips);

    box.appendChild(el('div', 'tb-check-group', 'Your own actions'));
    cm.actions.forEach(function (a, i) {
      var row = el('div', 'wz-row');
      var m = el('div', 'tb-flexrow');
      m.style.cssText = 'flex:1;gap:6px;flex-wrap:wrap';
      var li = small(input(a.label, function (v) { a.label = v; }), '1 1 140px');
      li.placeholder = 'Menu label';
      li.setAttribute('aria-label', 'Action label');
      m.appendChild(li);
      var ks = small(select(KINDS, a.kind || 'setField', function (v) { a.kind = v; renderStep4(); }), '1 1 150px');
      ks.setAttribute('aria-label', 'What it does');
      m.appendChild(ks);

      if (a.kind === 'setField' || a.kind === 'clearField') {
        var fs = small(select(ds.columns.map(function (c) { return { v: c.id, l: c.label }; }),
          a.field || '', function (v) { a.field = v; renderStep4(); }), '1 1 120px');
        fs.setAttribute('aria-label', 'Field');
        m.appendChild(fs);
      }
      if (a.kind === 'setField') {
        var col = ds.columns.filter(function (c) { return c.id === a.field; })[0];
        var vc;
        if (col && col.type === 'enum') {
          vc = select((col.options || []).map(function (o) { return { v: o.value, l: o.label }; }),
            a.value || '', function (v) { a.value = v; });
        } else if (col && col.type === 'bool') {
          vc = select([{ v: 'true', l: 'yes' }, { v: 'false', l: 'no' }],
            String(a.value || 'true'), function (v) { a.value = v; });
        } else if (col && col.type === 'date') {
          vc = select([{ v: '@today', l: 'today’s date' }, { v: '', l: 'a value I type' }],
            a.value === '@today' ? '@today' : '', function (v) { a.value = v; renderStep4(); });
        } else {
          vc = select([{ v: '@user', l: 'the current user' }, { v: '@team', l: 'their team' },
            { v: '', l: 'a value I type' }],
            (a.value === '@user' || a.value === '@team') ? a.value : '',
            function (v) { a.value = v; renderStep4(); });
        }
        small(vc, '1 1 130px');
        vc.setAttribute('aria-label', 'Value');
        m.appendChild(vc);
        var typed = !(col && (col.type === 'enum' || col.type === 'bool')) &&
          a.value !== '@today' && a.value !== '@user' && a.value !== '@team';
        if (typed) {
          var ti = small(input(a.value == null ? '' : a.value, function (v) { a.value = v; }), '1 1 110px');
          ti.placeholder = 'value';
          ti.setAttribute('aria-label', 'Typed value');
          m.appendChild(ti);
        }
      }
      if (a.kind === 'moveTo') {
        var ms = small(select(W.cfg.datasets.map(function (d) { return { v: d.id, l: d.name }; }),
          a.dataset || '', function (v) { a.dataset = v; }), '1 1 130px');
        ms.setAttribute('aria-label', 'Target dataset');
        m.appendChild(ms);
      }
      row.appendChild(m);
      var acts = el('div', 'wz-row-actions');
      acts.appendChild(mini('✕', 'Remove action', function () {
        cm.actions.splice(i, 1);
        renderStep4();
      }, true));
      row.appendChild(acts);
      box.appendChild(row);
    });

    var add = btn('+ Add your own action', 'btn-ghost', function () {
      cm.actions.push({
        id: mintId('a_'), label: 'New action', icon: '•', kind: 'setField',
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
    box.appendChild(hint('An agenda can pull dates from any number of datasets. For each one, ' +
      'point at the date column and the column holding the title.'));
    cmp.opts.sources.forEach(function (s, i) {
      var ds = dsOf(s.dataset);
      var row = el('div', 'wz-row');
      var m = el('div', 'wz-fields');
      m.style.flex = '1';
      m.appendChild(field('Dataset', select(
        W.cfg.datasets.map(function (d) { return { v: d.id, l: d.name }; }),
        s.dataset || '', function (v) { s.dataset = v; renderStep4(); })));
      if (ds) {
        var dateCols = ds.columns.filter(function (c) { return c.type === 'date'; });
        m.appendChild(field('Date column', select(
          [{ v: '', l: '— choose —' }].concat(dateCols.map(function (c) { return { v: c.id, l: c.label }; })),
          s.dateField || '', function (v) { s.dateField = v; })));
        m.appendChild(field('Title column', select(
          [{ v: '', l: '— choose —' }].concat(ds.columns.map(function (c) { return { v: c.id, l: c.label }; })),
          s.titleField || '', function (v) { s.titleField = v; })));
        m.appendChild(field('Secondary text', select(
          [{ v: '', l: '— none —' }].concat(ds.columns.map(function (c) { return { v: c.id, l: c.label }; })),
          s.metaField || '', function (v) { s.metaField = v || null; })));
        m.appendChild(field('Column that colours the dot', select(
          [{ v: '', l: '— none —' }].concat(ds.columns.filter(function (c) { return c.type === 'enum'; })
            .map(function (c) { return { v: c.id, l: c.label }; })),
          s.toneField || '', function (v) { s.toneField = v || null; })));
      }
      row.appendChild(m);
      var a = el('div', 'wz-row-actions');
      a.appendChild(mini('✕', 'Remove source', function () {
        cmp.opts.sources.splice(i, 1);
        renderStep4();
      }, true));
      row.appendChild(a);
      box.appendChild(row);
    });
    var add = btn('+ Add a source', 'btn-ghost', function () {
      var d = W.cfg.datasets[0];
      cmp.opts.sources.push({
        dataset: d ? d.id : null,
        dateField: d ? ((d.columns.filter(function (c) { return c.type === 'date'; })[0] || {}).id || null) : null,
        titleField: d ? d.titleField : null,
        metaField: null, toneField: null, filter: null
      });
      renderStep4();
    });
    add.style.marginTop = '6px';
    box.appendChild(add);
    return box;
  }

  /* ---- 5: alerts ---- */

  function renderStep5() {
    var host = doc.getElementById('wz-step-5');
    host.innerHTML = '';
    W.cfg.alerts = W.cfg.alerts || [];

    var intro = el('div', '');
    intro.appendChild(hint('Alerts show up under the bell in the tracker’s top bar, with a count ' +
      'and a colour. They are recalculated whenever the data changes — there is no background ' +
      'process and nothing is sent anywhere.'));

    if (!W.cfg.datasets.length) {
      intro.appendChild(el('p', 'tb-dim', 'Add a dataset first — an alert counts rows in one.'));
      host.appendChild(card('Alerts', intro));
      return;
    }

    W.cfg.alerts.forEach(function (a, i) {
      var open = W.alert === a.id;
      var row = el('div', 'wz-row');
      row.style.display = 'block';

      var head = el('div', 'tb-flexrow');
      head.style.gap = '6px';
      var li = small(input(a.label, function (v) { a.label = v.trim() || 'Alert'; }), '1 1 160px');
      li.setAttribute('aria-label', 'Alert name');
      head.appendChild(li);
      var ts = small(select(TONES.filter(function (t) { return t.v; }), a.tone || 'warning',
        function (v) { a.tone = v; }), '0 0 110px');
      ts.setAttribute('aria-label', 'Tone');
      head.appendChild(ts);
      head.appendChild(el('div', 'tb-spacer'));
      head.appendChild(mini(open ? '▾' : '▸', open ? 'Collapse' : 'Expand', function () {
        W.alert = open ? null : a.id;
        renderStep5();
      }));
      head.appendChild(mini('✕', 'Remove alert', function () {
        W.cfg.alerts.splice(i, 1);
        renderStep5();
      }, true));
      row.appendChild(head);

      if (!open) {
        var ds0 = dsOf(a.dataset);
        var meta = el('div', 'wz-row-meta');
        meta.style.marginTop = '4px';
        meta.textContent = (ds0 ? ds0.name : 'no dataset') + ' · ' +
          ((ALERT_CMPS.filter(function (x) { return x.v === (a.cmp || 'gt'); })[0] || {}).l || '') +
          ' ' + (a.value == null ? 0 : a.value) + ' rows';
        row.appendChild(meta);
      } else {
        var body = el('div', '');
        body.style.marginTop = '10px';
        var g = el('div', 'wz-fields');
        g.appendChild(field('Dataset to count', select(
          W.cfg.datasets.map(function (d) { return { v: d.id, l: d.name }; }),
          a.dataset || '', function (v) { a.dataset = v; renderStep5(); })));
        g.appendChild(field('Fire when there are', select(ALERT_CMPS, a.cmp || 'gt',
          function (v) { a.cmp = v; })));
        g.appendChild(field('this many rows', input(a.value == null ? 0 : a.value, function (v) {
          a.value = parseInt(v, 10) || 0;
        })));
        g.appendChild(field('Jump to tab when clicked', select(
          [{ v: '', l: '— nowhere —' }].concat(
            W.cfg.tabs.map(function (t) { return { v: t.id, l: t.label }; })),
          a.goToTab || '', function (v) { a.goToTab = v || null; })));
        body.appendChild(g);

        var msg = field('Message ({{n}} inserts the number)',
          input(a.message || '', function (v) { a.message = v; }), true);
        body.appendChild(msg);

        var dsA = dsOf(a.dataset);
        if (dsA) {
          var fb = el('div', 'tb-field wz-wide');
          fb.appendChild(el('label', null, 'Count only rows where…'));
          fb.appendChild(filterEditor(a, 'filter', dsA, renderStep5));
          body.appendChild(fb);
        }
        row.appendChild(body);
      }
      host.appendChild(row);
    });

    if (!W.cfg.alerts.length) {
      intro.appendChild(el('p', 'tb-dim', 'No alerts yet. A good first one: “overdue rows, more than 0”.'));
    }
    var add = btn('+ Add alert', 'btn-primary', function () {
      var d = W.cfg.datasets[0];
      var a = {
        id: mintId('al_'), label: 'New alert', dataset: d ? d.id : null,
        filter: { op: 'and', rules: [] }, cmp: 'gt', value: 0, tone: 'warning',
        message: '{{n}} rows need attention.', goToTab: W.cfg.tabs.length ? W.cfg.tabs[0].id : null
      };
      W.cfg.alerts.push(a);
      W.alert = a.id;
      renderStep5();
    });
    add.style.marginTop = '10px';
    intro.appendChild(add);
    host.insertBefore(card('Alerts', intro), host.firstChild);
  }

  /* ---- 6: review ---- */

  function fileBase() {
    return (W.cfg.meta.name || 'tracker').replace(/[^\w\-. ]+/g, '_').trim() || 'tracker';
  }

  function validate() {
    var p = [];
    var cfg = W.cfg;
    if (!cfg.meta.name || !cfg.meta.name.trim()) p.push('The tracker has no name (Basics step).');
    if (!cfg.datasets.length) p.push('There is no dataset (Data step).');
    cfg.datasets.forEach(function (d) {
      if (!d.columns.length) p.push('Dataset “' + d.name + '” has no columns.');
      d.columns.forEach(function (c) {
        if (c.type === 'enum' && !(c.options || []).length) {
          p.push('Column “' + c.label + '” is a pick list but has no options.');
        }
      });
    });
    if (!cfg.tabs.length) p.push('There are no tabs (Tabs step).');
    var ids = {};
    cfg.tabs.forEach(function (t) {
      if (!(t.components || []).length) {
        p.push('Tab “' + t.label + '” is empty — add a component or remove the tab.');
      }
      (t.components || []).forEach(function (c) {
        if (ids[c.id]) p.push('Duplicate component id — remove it and add it again.');
        ids[c.id] = 1;
        var meta = TYPES.filter(function (x) { return x.v === c.type; })[0];
        if (meta && meta.needsDs && !dsOf(c.dataset)) {
          p.push('Component “' + (c.title || meta.l) + '” on “' + t.label + '” has no dataset.');
        }
        if (c.type === 'chart') {
          var w = chartWarning(c);
          if (w) p.push('Chart “' + (c.title || '') + '” on “' + t.label + '”: ' + w);
        }
        if (c.type === 'agenda' && !((c.opts || {}).sources || []).some(function (s) {
          return s.dataset && s.dateField;
        })) {
          p.push('Agenda “' + (c.title || '') + '” has no source with a date column.');
        }
        if (c.type === 'table' && !((c.opts || {}).columns || []).length) {
          p.push('Table “' + (c.title || '') + '” shows no columns.');
        }
      });
    });
    (cfg.alerts || []).forEach(function (a) {
      if (!dsOf(a.dataset)) p.push('Alert “' + a.label + '” has no dataset.');
      if (!a.message || !a.message.trim()) p.push('Alert “' + a.label + '” has no message.');
    });
    return p;
  }

  function renderStep6() {
    var host = doc.getElementById('wz-step-6');
    host.innerHTML = '';

    var problems = validate();
    if (problems.length) {
      var b = el('div', 'tb-banner tb-banner-danger');
      b.innerHTML = '<i>⚠</i><div class="tb-banner-body"><div class="tb-banner-title">' +
        problems.length + (problems.length === 1 ? ' thing needs' : ' things need') +
        ' fixing before we can generate</div><div class="tb-banner-text">' +
        '<ul style="margin:6px 0 0;padding-left:18px">' +
        problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') +
        '</ul></div></div>';
      host.appendChild(b);
    }

    var html = problems.length ? '' : emit(W.cfg, false);
    var sum = el('dl', 'wz-summary');
    function addRow(k, v) {
      sum.appendChild(el('dt', null, k));
      sum.appendChild(el('dd', null, v));
    }
    addRow('Name', W.cfg.meta.name);
    addRow('Style', (ASSET.themes.themes.filter(function (t) {
      return t.id === W.cfg.meta.theme;
    })[0] || {}).name || W.cfg.meta.theme);
    addRow('Format', (LOCALES.filter(function (l) { return l.v === W.cfg.meta.locale; })[0] || {}).l ||
      W.cfg.meta.locale);
    addRow('Datasets', W.cfg.datasets.map(function (d) {
      return d.name + ' (' + d.columns.length + ' cols)';
    }).join(', ') || '—');
    addRow('Tabs', W.cfg.tabs.map(function (t) { return t.label; }).join(', ') || '—');
    addRow('Components', String(W.cfg.tabs.reduce(function (s, t) {
      return s + (t.components || []).length;
    }, 0)));
    addRow('Alerts', String((W.cfg.alerts || []).length));
    addRow('Personalisation', W.cfg.meta.personalization === false ? 'off' : 'on');
    if (html) addRow('File size', (new Blob([html]).size / 1024).toFixed(0) + ' KB');
    host.appendChild(card('Summary', sum));

    var actions = el('div', 'tb-flexrow');
    actions.appendChild(btn('Preview', 'btn-secondary', function () {
      if (problems.length) { TBUI.toast('Fix the problems first', 'warning'); return; }
      preview();
    }));
    actions.appendChild(btn('Download tracker (.html)', 'btn-primary', function () {
      if (problems.length) { TBUI.toast('Fix the problems first', 'warning'); return; }
      saveFile(emit(W.cfg, false), fileBase() + '.html', 'text/html');
    }));
    actions.appendChild(btn('Download structure (.tracker.json)', 'btn-secondary', function () {
      saveFile(JSON.stringify(W.cfg, null, 2), fileBase() + '.tracker.json', 'application/json');
    }));
    var box = el('div', '');
    box.appendChild(hint('Save both files in the same place. The HTML is the working tracker. ' +
      'Load the .tracker.json back in the Start step whenever you want to change the structure ' +
      'or the style — your data survives, because the tracker id does not change.'));
    box.appendChild(actions);
    host.appendChild(card('Export', box));

    var note = el('div', 'tb-banner tb-banner-warning');
    note.innerHTML = '<i>⚠</i><div class="tb-banner-body"><div class="tb-banner-title">' +
      'Do not rename or move the tracker file</div><div class="tb-banner-text">' +
      'The browser ties its local cache to the file path. Your data also lives in a separate ' +
      '.json file, but after moving the HTML people have to point at it again. When you update ' +
      'a tracker, overwrite the old file in place.</div></div>';
    host.appendChild(note);
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
            { text: 'Call the client before shipping', color: 'c1', order: 1, rowRef: null },
            { text: 'Check the September reconciliation', color: 'c3', order: 2, rowRef: null }
          ];
        }
        if (c.type === 'checklist') {
          seed['c:' + c.id] = [
            { text: 'Clear the inbox', done: true, order: 1, group: '', due: null, resetDaily: true, lastDoneOn: null },
            { text: 'Answer open requests', done: false, order: 2, group: '', due: null, resetDaily: true },
            { text: 'Daily report', done: false, order: 3, group: '', due: null, resetDaily: true }
          ];
        }
      });
    });
    return 'window.__TB_SEED=' + jsonIsland(seed) + ';';
  }

  var NAMES = ['Anna Kowalska', 'Peter Novak', 'Maria Wisniewska', 'Tom Lewandowski',
    'Kate Zielinska', 'Michael Szymanski', 'Agnes Dabrowska', 'Paul Kaczmarek'];
  var SUBJECTS = ['Invoice correction', 'Credit limit query', 'Delivery complaint',
    'Address change', 'Quarterly reconciliation', 'Report access', 'Contract review',
    'Duplicate request'];

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
            row[c.id] = 'Sample description for row ' + (i + 1) +
              '. This text only exists to show the layout.';
            break;
          default:
            row[c.id] = /name|subject|title|task|topic/i.test(c.label)
              ? SUBJECTS[i % SUBJECTS.length]
              : NAMES[(i + ci) % NAMES.length];
        }
      });
      rows.push(row);
    }
    return rows;
  }

  function preview() {
    var frame = doc.createElement('iframe');
    frame.className = 'wz-preview';
    frame.setAttribute('title', 'Tracker preview');
    frame.srcdoc = emit(W.cfg, true);
    var wrap = el('div', 'tb-stack');
    wrap.appendChild(el('div', 'wz-size',
      'Preview with sample data. Final file size: ' +
      (new Blob([emit(W.cfg, false)]).size / 1024).toFixed(0) + ' KB'));
    wrap.appendChild(frame);
    TBUI.modal.show({
      size: 'xl', title: 'Preview', sub: W.cfg.meta.name, body: wrap,
      actions: [{ label: 'Close', variant: 'ghost' }]
    });
  }

  function link(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    TBUI.toast('Downloaded ' + filename, 'success');
  }

  function saveFile(text, filename, mime) {
    var blob = new Blob([text], { type: mime });
    if (global.showSaveFilePicker) {
      global.showSaveFilePicker({ suggestedName: filename }).then(function (h) {
        return h.createWritable().then(function (w) {
          return w.write(blob).then(function () { return w.close(); });
        });
      }).then(function () {
        TBUI.toast('Saved ' + filename, 'success');
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        link(blob, filename);
      });
    } else {
      link(blob, filename);
    }
  }

  /* ====================================================================== wczytanie configu */

  function loadConfigFile(file) {
    file.text().then(function (t) {
      var cfg;
      try {
        cfg = JSON.parse(t);
      } catch (e) {
        TBUI.toast('Could not read that file: ' + e.message, 'danger', 6000);
        return;
      }
      if (!cfg || cfg.$kind !== 'tracker.config' || !cfg.meta || !cfg.meta.trackerId) {
        TBUI.toast('That is not a tracker structure file (.tracker.json)', 'danger', 6000);
        return;
      }
      cfg.rev = (cfg.rev || 1) + 1;
      cfg.datasets = cfg.datasets || [];
      cfg.tabs = cfg.tabs || [];
      cfg.alerts = cfg.alerts || [];
      cfg.meta.locale = cfg.meta.locale || 'en-GB';
      cfg.meta.currency = cfg.meta.currency || 'PLN';
      cfg.meta.useWebFonts = cfg.meta.useWebFonts !== false;
      if (cfg.meta.personalization === undefined) cfg.meta.personalization = true;
      delete cfg.meta.allowThemeSwitch;
      W.cfg = cfg;
      W.step = 1;
      W.tab = 0;
      W.cmp = null;
      W.ds = 0;
      W.alert = null;
      render();
      TBUI.toast('Loaded “' + (cfg.meta.name || '') + '” (structure version ' + cfg.rev + ')',
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
      if (W.step === LAST) {
        if (validate().length) { TBUI.toast('Fix the listed problems first', 'warning'); return; }
        saveFile(emit(W.cfg, false), fileBase() + '.html', 'text/html');
        return;
      }
      if (W.step === 0 && !W.cfg) { TBUI.toast('Pick a template or load a file', 'warning'); return; }
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

  global.TBWizard = {
    state: W, emit: emit, validate: validate, synth: synth, parseDelimited: parseDelimited
  };
})(window);
