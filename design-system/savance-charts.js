/* ==========================================================================
   SAVANCE CHARTS v1.1 — lekkie wykresy SVG w stylu Savance (bez zależności)
   Wymaga: savance.css

   SavanceCharts.bar(el,   { labels, series:[{name, values, fill}], yMax?, yTicks?, height?, barWidth?, format? })
   SavanceCharts.line(el,  { labels, series:[{name, values, color}] | values, color?, area?, yMax?, yTicks?, height?, format? })
   SavanceCharts.hbar(el,  { items:[{label, value}], fill?, format?, max? })
   SavanceCharts.donut(el, { items:[{label, value, color?}], centerLabel?, centerValue?, format? })
   SavanceCharts.spark(el, { values, color?, area? })
   SavanceCharts.fmt.compact(1234567) → "1,2M"   .pln(1234) → "1 234 zł"   .pct(12.3) → "12,3%"

   fill (słupki):  amber | lavender | sky | rose | gold | ghost
   color (linie):  gold | amber | sky | lavender | rose | khaki   (lub dowolny #hex)
   yMax pominięte → liczone automatycznie („ładna” wartość powyżej maksimum)
   ========================================================================== */
(function (global) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  var FILLS = {
    amber:    [['0', '#F8C98A', 1], ['0.6', '#E39F5F', 1], ['1', '#E39F5F', 0.35]],
    lavender: [['0', '#D6CFF6', 1], ['0.6', '#A59CE6', 1], ['1', '#8A84E0', 0.35]],
    sky:      [['0', '#F2D6A6', 1], ['0.35', '#BCD7F2', 1], ['0.7', '#89BFEF', 1], ['1', '#5EA6E6', 1]],
    rose:     [['0', '#F2A0B4', 1], ['0.6', '#E05A7C', 1], ['1', '#E05A7C', 0.35]],
    gold:     [['0', '#F8DC7E', 1], ['1', '#E0B02E', 0.4]],
    ghost:    [['0', '#FFF0E1', 0.22], ['1', '#FFF0E1', 0.04]]
  };
  var COLORS = { amber: '#EFA75E', lavender: '#A59CE6', sky: '#89BFEF', rose: '#E05A7C', gold: '#F2C94C', khaki: '#B89C7C', ghost: 'rgba(255,240,225,.3)' };
  var ORDER = ['amber', 'lavender', 'sky', 'rose', 'gold', 'khaki'];      // stała kolejność serii
  var LINE_ORDER = ['gold', 'sky', 'lavender', 'amber', 'rose', 'khaki']; // linie zaczynają od gold
  var uid = 0;

  function pl(v, d) { return (+v).toLocaleString('pl-PL', { maximumFractionDigits: d == null ? 1 : d }); }
  var fmt = {
    compact: function (v) {                                   // 1,2k · 3,4M · 1,1B
      var a = Math.abs(v);
      if (a >= 1e9) return pl(v / 1e9) + 'B';
      if (a >= 1e6) return pl(v / 1e6) + 'M';
      if (a >= 1e3) return pl(v / 1e3) + 'k';
      return pl(v, 2);
    },
    pln: function (v) { return pl(Math.round(v), 0) + ' zł'; },           // 1 234 zł
    usd: function (v) { return '$' + Math.round(v).toLocaleString('en-US'); },
    pct: function (v) { return pl(v) + '%'; },                              // 12,3%
    num: function (v) { return pl(v, 2); }                                  // 1 234,56
  };

  function color(c, i, order) { return COLORS[c] || c || COLORS[(order || ORDER)[i % 6]]; }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    var s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return s * p;
  }
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function gradient(defs, stops) {
    var id = 'svg' + (++uid);
    var g = el('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    stops.forEach(function (s) { el('stop', { offset: s[0], 'stop-color': s[1], 'stop-opacity': s[2] }, g); });
    return 'url(#' + id + ')';
  }
  function hgradient(defs, key) {
    var id = 'svg' + (++uid), st = FILLS[key] || FILLS.amber;
    var g = el('linearGradient', { id: id, x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
    el('stop', { offset: 0, 'stop-color': st[st.length - 1][1], 'stop-opacity': 0.55 }, g);
    el('stop', { offset: 1, 'stop-color': st[0][1], 'stop-opacity': 1 }, g);
    return 'url(#' + id + ')';
  }
  function barPath(x, y, w, h) { // zaokrąglona góra (r=4), płasko przy osi
    if (h <= 0) return '';
    var r = Math.min(4, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function tooltip(host) {
    var tip = document.createElement('div');
    tip.className = 'sv-tooltip'; tip.hidden = true; host.appendChild(tip);
    return tip;
  }
  function row(dot, name, val) {
    return '<div style="display:flex;gap:8px;align-items:center"><span class="sv-dot" style="--sv-dot:' + dot + '"></span>' +
      esc(name) + ' <b style="margin-left:auto">' + esc(val) + '</b></div>';
  }

  function setup(host, opt, dataMax) {
    host.classList.add('sv-chart');
    host.innerHTML = '';
    var W = opt.width || Math.round(host.clientWidth) || 520, H = opt.height || 200, fmtFn = opt.format || fmt.compact;
    var yMax = opt.yMax || niceMax(dataMax), ticks = opt.yTicks || 4;
    var m = { t: 12, r: 10, b: 22, l: Math.max(30, fmtFn(yMax).length * 6 + 10) };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opt.title || 'Wykres' }, host);
    var tip = tooltip(host);
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var y = function (v) { return m.t + ih - (Math.max(0, v) / yMax) * ih; };
    var axis = el('g', { 'class': 'sv-axis' }, svg);
    for (var i = 0; i <= ticks; i++) {
      var v = (yMax / ticks) * i, yy = y(v);
      el('line', { 'class': 'sv-gridline', x1: m.l, x2: W - m.r, y1: yy, y2: yy }, axis);
      el('text', { x: m.l - 6, y: yy + 3, 'text-anchor': 'end' }, axis).textContent = fmtFn(v);
    }
    function show(x, yPx, html) {
      tip.innerHTML = html; tip.hidden = false;
      var k = svg.getBoundingClientRect().width / W;
      tip.style.left = (x * k) + 'px'; tip.style.top = (yPx * k) + 'px';
    }
    svg.addEventListener('mouseleave', function () { tip.hidden = true; });
    return { svg: svg, defs: el('defs', {}, svg), W: W, H: H, m: m, iw: iw, ih: ih, y: y, fmt: fmtFn, axis: axis, show: show };
  }
  // pomija część etykiet osi X, gdy jest ich za dużo
  function labelStep(n, iw) { return Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 42)))); }

  function bar(host, opt) {
    var series = opt.series.map(function (s, i) { return Object.assign({ fill: ORDER[i % 6] }, s); });
    var max = Math.max.apply(null, series.reduce(function (a, s) { return a.concat(s.values); }, [0]));
    var c = setup(host, opt, max), n = opt.labels.length, s = series.length;
    var band = c.iw / n, gap = 2, step = labelStep(n, c.iw);
    var bw = Math.max(3, Math.min(opt.barWidth || 14, (band * 0.7 - gap * (s - 1)) / s));
    var fills = series.map(function (se) { return gradient(c.defs, FILLS[se.fill] || FILLS.amber); });
    opt.labels.forEach(function (lab, i) {
      var cx = c.m.l + band * i + band / 2, gx = cx - (bw * s + gap * (s - 1)) / 2, top = c.H;
      if (i % step === 0) el('text', { x: cx, y: c.H - 6, 'text-anchor': 'middle' }, c.axis).textContent = lab;
      series.forEach(function (se, j) {
        var yy = c.y(se.values[i] || 0); top = Math.min(top, yy);
        var d = barPath(gx + j * (bw + gap), yy, bw, c.m.t + c.ih - yy);
        if (d) el('path', { d: d, fill: fills[j] }, c.svg);
      });
      var hit = el('rect', { 'class': 'sv-hit', x: cx - band / 2, y: c.m.t, width: band, height: c.ih }, c.svg);
      hit.addEventListener('mousemove', function () {
        c.show(cx, top, '<div class="sv-caption">' + esc(lab) + '</div>' + series.map(function (se) {
          return row(COLORS[se.fill] || se.fill, se.name, c.fmt(se.values[i] || 0));
        }).join(''));
      });
      if (opt.onClick) { hit.style.cursor = 'pointer'; hit.addEventListener('click', function () { opt.onClick(i, lab); }); }
    });
  }

  function line(host, opt) {
    var series = opt.series || [{ name: opt.name || opt.title || 'Wartość', values: opt.values, color: opt.color }];
    series = series.map(function (s, i) { return Object.assign({}, s, { color: color(s.color, i, LINE_ORDER) }); });
    var max = Math.max.apply(null, series.reduce(function (a, s) { return a.concat(s.values); }, [0]));
    var c = setup(host, opt, max), n = opt.labels.length, stepX = c.iw / Math.max(1, n - 1), ls = labelStep(n, c.iw);
    var base = c.m.t + c.ih;
    series.forEach(function (se, si) {
      var pts = se.values.map(function (v, i) { return [c.m.l + stepX * i, c.y(v || 0)]; });
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ',' + p[1]; }).join('');
      if (opt.area !== false && si === 0) {
        var g = gradient(c.defs, [['0', se.color, 0.28], ['1', se.color, 0]]);
        el('path', { d: d + 'L' + pts[n - 1][0] + ',' + base + 'L' + pts[0][0] + ',' + base + 'Z', fill: g }, c.svg);
      }
      el('path', { d: d, fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, c.svg);
      var dots = n <= 24;
      pts.forEach(function (p, i) {
        var last = i === n - 1;
        if (dots || last) el('circle', { cx: p[0], cy: p[1], r: last ? 4.5 : 3, fill: last ? se.color : '#1A1311', stroke: se.color, 'stroke-width': 2 }, c.svg);
      });
    });
    var cross = el('line', { x1: 0, x2: 0, y1: c.m.t, y2: base, stroke: 'rgba(255,240,225,.25)', 'stroke-dasharray': '3 3', visibility: 'hidden' }, c.svg);
    opt.labels.forEach(function (lab, i) {
      var x = c.m.l + stepX * i;
      if (i % ls === 0) el('text', { x: x, y: c.H - 6, 'text-anchor': 'middle' }, c.axis).textContent = lab;
      var hit = el('rect', { 'class': 'sv-hit', x: x - stepX / 2, y: c.m.t, width: Math.max(stepX, 4), height: c.ih }, c.svg);
      hit.addEventListener('mousemove', function () {
        cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
        var top = Math.min.apply(null, series.map(function (s) { return c.y(s.values[i] || 0); }));
        c.show(x, top, '<div class="sv-caption">' + esc(lab) + '</div>' + series.map(function (s) {
          return row(s.color, s.name, c.fmt(s.values[i] || 0));
        }).join(''));
      });
    });
    c.svg.addEventListener('mouseleave', function () { cross.setAttribute('visibility', 'hidden'); });
  }

  // słupki poziome – rankingi, top N kategorii
  function hbar(host, opt) {
    host.classList.add('sv-chart'); host.innerHTML = '';
    var items = opt.items, n = items.length, fmtFn = opt.format || fmt.compact;
    var max = opt.max || Math.max.apply(null, items.map(function (d) { return d.value; }).concat([0])) || 1;
    var W = opt.width || Math.round(host.clientWidth) || 520, rowH = 30, labW = opt.labelWidth || Math.min(140, W * 0.3);
    var valW = Math.max.apply(null, items.map(function (d) { return String(fmtFn(d.value)).length; }).concat([3])) * 6.6 + 14, H = n * rowH;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opt.title || 'Ranking' }, host);
    var tip = tooltip(host), defs = el('defs', {}, svg), fill = hgradient(defs, opt.fill || 'amber');
    var axis = el('g', { 'class': 'sv-axis' }, svg), iw = Math.max(40, W - labW - valW);
    items.forEach(function (d, i) {
      var y = i * rowH, w = Math.max(2, (d.value / max) * iw);
      var t = el('text', { x: 0, y: y + rowH / 2 + 4 }, axis); t.textContent = String(d.label).length > 20 ? String(d.label).slice(0, 19) + '…' : d.label;
      t.setAttribute('style', 'fill:var(--sv-text-2);font-size:11px');
      el('rect', { x: labW, y: y + 9, width: iw, height: 12, rx: 6, fill: 'rgba(255,240,225,.06)' }, svg);
      el('rect', { x: labW, y: y + 9, width: w, height: 12, rx: 6, fill: fill }, svg);
      var v = el('text', { x: W, y: y + rowH / 2 + 4, 'text-anchor': 'end' }, axis); v.textContent = fmtFn(d.value);
      v.setAttribute('style', 'fill:var(--sv-text);font-size:11px;font-weight:600');
      var hit = el('rect', { 'class': 'sv-hit', x: 0, y: y, width: W, height: rowH }, svg);
      hit.addEventListener('mousemove', function () {
        tip.innerHTML = '<b>' + esc(d.label) + '</b><br>' + esc(fmtFn(d.value)); tip.hidden = false;
        var k = svg.getBoundingClientRect().width / W;
        tip.style.left = ((labW + w) * k) + 'px'; tip.style.top = ((y + 9) * k) + 'px';
      });
      if (opt.onClick) { hit.style.cursor = 'pointer'; hit.addEventListener('click', function () { opt.onClick(i, d); }); }
    });
    svg.addEventListener('mouseleave', function () { tip.hidden = true; });
  }

  // donut – udział w całości (max 6 segmentów, reszta → "Inne")
  function donut(host, opt) {
    host.classList.add('sv-chart', 'sv-chart--donut'); host.innerHTML = '';
    var fmtFn = opt.format || fmt.compact;
    var items = opt.items.slice().sort(function (a, b) { return b.value - a.value; });
    if (items.length > 6) {
      var rest = items.slice(5).reduce(function (s, d) { return s + d.value; }, 0);
      items = items.slice(0, 5).concat([{ label: opt.otherLabel || 'Inne', value: rest, color: 'rgba(255,240,225,.28)' }]);
    }
    var total = items.reduce(function (s, d) { return s + d.value; }, 0) || 1;
    var S = 160, R = 64, r = 46, cx = S / 2, cy = S / 2;
    var svg = el('svg', { viewBox: '0 0 ' + S + ' ' + S, role: 'img', 'aria-label': opt.title || 'Udział' }, host);
    var tip = tooltip(host), a0 = -Math.PI / 2, gapA = items.length > 1 ? 0.025 : 0;
    items.forEach(function (d, i) {
      var col = color(d.color, i), frac = d.value / total, a1 = a0 + frac * Math.PI * 2;
      var s0 = a0 + gapA / 2, s1 = Math.max(s0 + 0.001, a1 - gapA / 2), large = s1 - s0 > Math.PI ? 1 : 0;
      if (frac >= 0.9999) { s1 = s0 + Math.PI * 2 - 0.0001; large = 1; }
      var p = function (rad, a) { return (cx + rad * Math.cos(a)) + ',' + (cy + rad * Math.sin(a)); };
      var path = el('path', { d: 'M' + p(R, s0) + 'A' + R + ',' + R + ' 0 ' + large + ' 1 ' + p(R, s1) + 'L' + p(r, s1) +
        'A' + r + ',' + r + ' 0 ' + large + ' 0 ' + p(r, s0) + 'Z', fill: col, style: 'cursor:pointer;transition:opacity .2s' }, svg);
      path.addEventListener('mousemove', function (e) {
        var b = host.getBoundingClientRect();
        tip.innerHTML = row(col, d.label, fmtFn(d.value) + ' · ' + fmt.pct(frac * 100)); tip.hidden = false;
        tip.style.left = (e.clientX - b.left) + 'px'; tip.style.top = (e.clientY - b.top) + 'px';
      });
      path.addEventListener('mouseleave', function () { tip.hidden = true; });
      if (opt.onClick) path.addEventListener('click', function () { opt.onClick(i, d); });
      d._color = col; d._frac = frac; a0 = a1;
    });
    var t1 = el('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', 'class': 'sv-donut-center' }, svg);
    t1.textContent = opt.centerValue != null ? opt.centerValue : fmtFn(total);
    var t2 = el('text', { x: cx, y: cy + 20, 'text-anchor': 'middle', 'class': 'sv-donut-sub' }, svg);
    t2.textContent = opt.centerLabel || 'Razem';
    var ul = document.createElement('ul'); ul.className = 'sv-legend';
    ul.innerHTML = items.map(function (d) {
      return '<li class="sv-legend__row"><span class="sv-dot" style="--sv-dot:' + d._color + '"></span>' + esc(d.label) +
        '<b>' + esc(fmt.pct(d._frac * 100)) + '</b></li>';
    }).join('');
    host.appendChild(ul);
  }

  // sparkline – mini trend w karcie KPI / statystyki (bez osi)
  function spark(host, opt) {
    host.innerHTML = '';
    var v = opt.values, n = v.length, W = 120, H = 36, pad = 3;
    var min = Math.min.apply(null, v), max = Math.max.apply(null, v), span = max - min || 1;
    var col = COLORS[opt.color] || opt.color || 'rgba(255,255,255,.9)';
    var pts = v.map(function (x, i) { return [pad + (W - pad * 2) * i / Math.max(1, n - 1), pad + (H - pad * 2) * (1 - (x - min) / span)]; });
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', 'class': 'sv-spark', 'aria-hidden': 'true' }, host);
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('');
    if (opt.area !== false) {
      var g = gradient(el('defs', {}, svg), [['0', col, 0.35], ['1', col, 0]]);
      el('path', { d: d + 'L' + pts[n - 1][0] + ',' + H + 'L' + pts[0][0] + ',' + H + 'Z', fill: g }, svg);
    }
    el('path', { d: d, fill: 'none', stroke: col, 'stroke-width': 1.75, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }, svg);
  }

  // wykres rysowany w pikselach kontenera (tekst zawsze 10–11 px); przerysowanie przy zmianie szerokości,
  // także gdy ukryta zakładka / modal staje się widoczny
  function tracked(fn) {
    return function (host, opt) {
      if (!host) return;
      host._svFn = fn; host._svOpt = opt;
      fn(host, opt); host._svW = host.clientWidth;
      if (!host._svRO && global.ResizeObserver) {
        host._svRO = new ResizeObserver(function () {
          var w = host.clientWidth;
          if (w > 0 && Math.abs(w - (host._svW || 0)) > 2) { host._svW = w; host._svFn(host, host._svOpt); }
        });
        host._svRO.observe(host);
      }
    };
  }
  bar = tracked(bar); line = tracked(line); hbar = tracked(hbar);

  global.SavanceCharts = { bar: bar, line: line, hbar: hbar, donut: donut, spark: spark, fmt: fmt, colors: COLORS, order: ORDER, niceMax: niceMax };
})(window);
