/* ==========================================================================
   TB CHARTS v1.0 — lekkie wykresy SVG bez zależności.
   Port design-system/savance-charts.js na wspólny kontrakt tokenów motywów.

   TBCharts.bar(el,   { labels, series:[{name, values, fill}], yMax?, yTicks?, height?, barWidth?, format? })
   TBCharts.line(el,  { labels, series:[{name, values, color}] | values, color?, area?, yMax?, yTicks?, height?, format? })
   TBCharts.hbar(el,  { items:[{label, value}], fill?, format?, max? })
   TBCharts.donut(el, { items:[{label, value, color?}], centerLabel?, centerValue?, format? })
   TBCharts.spark(el, { values, color?, area? })

   KOLORY: wyłącznie tokeny motywu --c1..--c5 (plus --tb-chart-muted dla tła/ghost).
   Kolor trafia do SVG jako `var(--cN)` w ATRYBUCIE style, nie w atrybucie
   prezentacyjnym — tylko tak przechodzi podstawienie zmiennej CSS. Dzięki temu
   zmiana motywu przemalowuje wykresy bez linijki JS i bez przerysowania.

   Jedna kolejność serii dla wszystkich typów wykresów, żeby ta sama kategoria
   miała ten sam kolor na każdym wykresie.

   Opcjonalnie motyw może zdefiniować --cN-hi (jaśniejszy wierzch gradientu);
   bez tego gradient to ten sam odcień z malejącą alfą.
   ========================================================================== */
(function (global) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  // Klucz → referencja do tokenu motywu. `hi` używany na szczycie gradientu.
  var SERIES = {
    c1: { base: 'var(--c1)', hi: 'var(--c1-hi, var(--c1))' },
    c2: { base: 'var(--c2)', hi: 'var(--c2-hi, var(--c2))' },
    c3: { base: 'var(--c3)', hi: 'var(--c3-hi, var(--c3))' },
    c4: { base: 'var(--c4)', hi: 'var(--c4-hi, var(--c4))' },
    c5: { base: 'var(--c5)', hi: 'var(--c5-hi, var(--c5))' },
    ghost: { base: 'var(--tb-chart-muted)', hi: 'var(--tb-chart-muted)' }
  };
  var ORDER = ['c1', 'c2', 'c3', 'c4', 'c5'];
  var uid = 0;

  var cfg = { locale: 'en-GB', currency: 'PLN' };

  function nf(v, d) {
    return (+v).toLocaleString(cfg.locale, { maximumFractionDigits: d == null ? 1 : d });
  }
  var fmt = {
    compact: function (v) {
      var a = Math.abs(v);
      if (a >= 1e9) return nf(v / 1e9) + 'B';
      if (a >= 1e6) return nf(v / 1e6) + 'M';
      if (a >= 1e3) return nf(v / 1e3) + 'k';
      return nf(v, 2);
    },
    currency: function (v) {
      return (+v).toLocaleString(cfg.locale,
        { style: 'currency', currency: cfg.currency, maximumFractionDigits: 2 });
    },
    pct: function (v) { return nf(v) + '%'; },
    num: function (v) { return nf(v, 2); },
    int: function (v) { return nf(Math.round(v), 0); }
  };

  /* Zwraca referencję koloru nadającą się do wstawienia w CSS. Przyjmuje klucz
     serii (c1..c5, ghost), gotowe var(--...), #hex albo rgb(). */
  function color(c, i) {
    if (c && SERIES[c]) return SERIES[c].base;
    if (typeof c === 'string' && /^(var\(|#|rgb|hsl)/i.test(c)) return c;
    return SERIES[ORDER[i % ORDER.length]].base;
  }
  function seriesKey(k, i) {
    return SERIES[k] ? k : ORDER[i % ORDER.length];
  }

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
  /* stop-color przez atrybut style — w atrybucie prezentacyjnym var() nie działa. */
  function addStop(g, offset, colorRef, opacity) {
    var s = el('stop', { offset: offset }, g);
    s.setAttribute('style', 'stop-color:' + colorRef + ';stop-opacity:' + opacity);
    return s;
  }
  /* stops: [[offset, colorRef, opacity], ...]; dir 'v' | 'h' */
  function gradient(defs, stops, dir) {
    var id = 'tbg' + (++uid);
    var g = el('linearGradient', dir === 'h'
      ? { id: id, x1: 0, y1: 0, x2: 1, y2: 0 }
      : { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    stops.forEach(function (s) { addStop(g, s[0], s[1], s[2]); });
    return 'url(#' + id + ')';
  }
  /* Pionowe wypełnienie słupka: jaśniejszy wierzch, wygaszony dół. */
  function barFill(defs, key) {
    var s = SERIES[key] || SERIES.c1;
    return gradient(defs, [[0, s.hi, 1], [0.6, s.base, 1], [1, s.base, 0.35]], 'v');
  }
  /* Poziome wypełnienie (ranking). */
  function hbarFill(defs, key) {
    var s = SERIES[key] || SERIES.c1;
    return gradient(defs, [[0, s.base, 0.55], [1, s.hi, 1]], 'h');
  }
  function barPath(x, y, w, h) {
    if (h <= 0) return '';
    var r = Math.min(4, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function tooltip(host) {
    var tip = document.createElement('div');
    tip.className = 'tb-tooltip';
    tip.hidden = true;
    host.appendChild(tip);
    return tip;
  }
  function row(dot, name, val) {
    return '<div class="tb-tip-row"><span class="tb-dot" style="--tb-dot:' + dot + '"></span>' +
      esc(name) + ' <b>' + esc(val) + '</b></div>';
  }

  function setup(host, opt, dataMax) {
    host.classList.add('tb-chart');
    host.innerHTML = '';
    var W = opt.width || Math.round(host.clientWidth) || 520;
    var H = opt.height || 200;
    var fmtFn = opt.format || fmt.compact;
    var yMax = opt.yMax || niceMax(dataMax), ticks = opt.yTicks || 4;
    var m = { t: 12, r: 10, b: 22, l: Math.max(30, String(fmtFn(yMax)).length * 6 + 10) };
    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, 'class': 'chart',
      role: 'img', 'aria-label': opt.title || 'Chart'
    }, host);
    var tip = tooltip(host);
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var y = function (v) { return m.t + ih - (Math.max(0, v) / yMax) * ih; };
    var axis = el('g', { 'class': 'tb-axis' }, svg);
    for (var i = 0; i <= ticks; i++) {
      var v = (yMax / ticks) * i, yy = y(v);
      el('line', { 'class': 'tb-gridline', x1: m.l, x2: W - m.r, y1: yy, y2: yy }, axis);
      el('text', { x: m.l - 6, y: yy + 3, 'text-anchor': 'end' }, axis).textContent = fmtFn(v);
    }
    function show(x, yPx, html) {
      tip.innerHTML = html;
      tip.hidden = false;
      var k = svg.getBoundingClientRect().width / W;
      tip.style.left = (x * k) + 'px';
      tip.style.top = (yPx * k) + 'px';
    }
    svg.addEventListener('mouseleave', function () { tip.hidden = true; });
    return {
      svg: svg, defs: el('defs', {}, svg), W: W, H: H, m: m,
      iw: iw, ih: ih, y: y, fmt: fmtFn, axis: axis, show: show
    };
  }

  function labelStep(n, iw) {
    return Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 42))));
  }

  function bar(host, opt) {
    var series = (opt.series || []).map(function (s, i) {
      var o = {};
      for (var k in s) o[k] = s[k];
      o.fill = seriesKey(s.fill, i);
      return o;
    });
    var max = Math.max.apply(null, series.reduce(function (a, s) {
      return a.concat(s.values);
    }, [0]));
    var c = setup(host, opt, max), n = opt.labels.length, s = series.length;
    var band = c.iw / Math.max(1, n), gap = 2, step = labelStep(n, c.iw);
    var bw = Math.max(3, Math.min(opt.barWidth || 14, (band * 0.7 - gap * (s - 1)) / Math.max(1, s)));
    var fills = series.map(function (se) { return barFill(c.defs, se.fill); });
    opt.labels.forEach(function (lab, i) {
      var cx = c.m.l + band * i + band / 2;
      var gx = cx - (bw * s + gap * (s - 1)) / 2;
      var top = c.H;
      if (i % step === 0) {
        el('text', { x: cx, y: c.H - 6, 'text-anchor': 'middle' }, c.axis).textContent = lab;
      }
      series.forEach(function (se, j) {
        var yy = c.y(se.values[i] || 0);
        top = Math.min(top, yy);
        var d = barPath(gx + j * (bw + gap), yy, bw, c.m.t + c.ih - yy);
        if (d) el('path', { d: d, fill: fills[j] }, c.svg);
      });
      var hit = el('rect', {
        'class': 'tb-hit', x: cx - band / 2, y: c.m.t, width: band, height: c.ih
      }, c.svg);
      hit.addEventListener('mousemove', function () {
        c.show(cx, top, '<div class="tb-tip-head">' + esc(lab) + '</div>' + series.map(function (se) {
          return row(SERIES[se.fill].base, se.name, c.fmt(se.values[i] || 0));
        }).join(''));
      });
      if (opt.onClick) {
        hit.style.cursor = 'pointer';
        hit.addEventListener('click', function () { opt.onClick(i, lab); });
      }
    });
  }

  function line(host, opt) {
    var src = opt.series || [{ name: opt.name || opt.title || 'Value', values: opt.values, color: opt.color }];
    var series = src.map(function (s, i) {
      var o = {};
      for (var k in s) o[k] = s[k];
      o.color = color(s.color, i);
      return o;
    });
    var max = Math.max.apply(null, series.reduce(function (a, s) {
      return a.concat(s.values);
    }, [0]));
    var c = setup(host, opt, max), n = opt.labels.length;
    var stepX = c.iw / Math.max(1, n - 1), ls = labelStep(n, c.iw);
    var base = c.m.t + c.ih;
    series.forEach(function (se, si) {
      var pts = se.values.map(function (v, i) { return [c.m.l + stepX * i, c.y(v || 0)]; });
      if (!pts.length) return;
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ',' + p[1]; }).join('');
      if (opt.area !== false && si === 0) {
        var g = gradient(c.defs, [[0, se.color, 0.28], [1, se.color, 0]], 'v');
        el('path', {
          d: d + 'L' + pts[n - 1][0] + ',' + base + 'L' + pts[0][0] + ',' + base + 'Z', fill: g
        }, c.svg);
      }
      var path = el('path', {
        d: d, fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }, c.svg);
      path.setAttribute('style', 'stroke:' + se.color);
      var dots = n <= 24;
      pts.forEach(function (p, i) {
        var last = i === n - 1;
        if (!dots && !last) return;
        var dot = el('circle', { cx: p[0], cy: p[1], r: last ? 4.5 : 3, 'stroke-width': 2 }, c.svg);
        dot.setAttribute('style',
          'fill:' + (last ? se.color : 'var(--tb-chart-dot-bg)') + ';stroke:' + se.color);
      });
    });
    var cross = el('line', {
      x1: 0, x2: 0, y1: c.m.t, y2: base, 'stroke-dasharray': '3 3', visibility: 'hidden'
    }, c.svg);
    cross.setAttribute('style', 'stroke:var(--tb-chart-crosshair)');
    opt.labels.forEach(function (lab, i) {
      var x = c.m.l + stepX * i;
      if (i % ls === 0) {
        el('text', { x: x, y: c.H - 6, 'text-anchor': 'middle' }, c.axis).textContent = lab;
      }
      var hit = el('rect', {
        'class': 'tb-hit', x: x - stepX / 2, y: c.m.t, width: Math.max(stepX, 4), height: c.ih
      }, c.svg);
      hit.addEventListener('mousemove', function () {
        cross.setAttribute('x1', x);
        cross.setAttribute('x2', x);
        cross.setAttribute('visibility', 'visible');
        var top = Math.min.apply(null, series.map(function (s) { return c.y(s.values[i] || 0); }));
        c.show(x, top, '<div class="tb-tip-head">' + esc(lab) + '</div>' + series.map(function (s) {
          return row(s.color, s.name, c.fmt(s.values[i] || 0));
        }).join(''));
      });
    });
    c.svg.addEventListener('mouseleave', function () {
      cross.setAttribute('visibility', 'hidden');
    });
  }

  /* Słupki poziome — rankingi, top N. */
  function hbar(host, opt) {
    host.classList.add('tb-chart');
    host.innerHTML = '';
    var items = opt.items || [], n = items.length, fmtFn = opt.format || fmt.compact;
    var max = opt.max || Math.max.apply(null, items.map(function (d) { return d.value; }).concat([0])) || 1;
    var W = opt.width || Math.round(host.clientWidth) || 520;
    var rowH = 30, labW = opt.labelWidth || Math.min(140, W * 0.3);
    var valW = Math.max.apply(null, items.map(function (d) {
      return String(fmtFn(d.value)).length;
    }).concat([3])) * 6.6 + 14;
    var H = Math.max(rowH, n * rowH);
    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, 'class': 'chart',
      role: 'img', 'aria-label': opt.title || 'Ranking'
    }, host);
    var tip = tooltip(host), defs = el('defs', {}, svg);
    var fill = hbarFill(defs, seriesKey(opt.fill, 0));
    var axis = el('g', { 'class': 'tb-axis' }, svg);
    var iw = Math.max(40, W - labW - valW);
    items.forEach(function (d, i) {
      var y = i * rowH, w = Math.max(2, (d.value / max) * iw);
      var t = el('text', { x: 0, y: y + rowH / 2 + 4 }, axis);
      t.textContent = String(d.label).length > 20 ? String(d.label).slice(0, 19) + '…' : d.label;
      t.setAttribute('style', 'fill:var(--text-2);font-size:11px');
      var track = el('rect', { x: labW, y: y + 9, width: iw, height: 12, rx: 6 }, svg);
      track.setAttribute('style', 'fill:var(--tb-chart-track)');
      el('rect', { x: labW, y: y + 9, width: w, height: 12, rx: 6, fill: fill }, svg);
      var v = el('text', { x: W, y: y + rowH / 2 + 4, 'text-anchor': 'end' }, axis);
      v.textContent = fmtFn(d.value);
      v.setAttribute('style', 'fill:var(--text);font-size:11px;font-weight:600');
      var hit = el('rect', { 'class': 'tb-hit', x: 0, y: y, width: W, height: rowH }, svg);
      hit.addEventListener('mousemove', function () {
        tip.innerHTML = '<b>' + esc(d.label) + '</b><br>' + esc(fmtFn(d.value));
        tip.hidden = false;
        var k = svg.getBoundingClientRect().width / W;
        tip.style.left = ((labW + w) * k) + 'px';
        tip.style.top = ((y + 9) * k) + 'px';
      });
      if (opt.onClick) {
        hit.style.cursor = 'pointer';
        hit.addEventListener('click', function () { opt.onClick(i, d); });
      }
    });
    svg.addEventListener('mouseleave', function () { tip.hidden = true; });
  }

  /* Donut — udział w całości. Max 6 segmentów, reszta zwijana do "Inne". */
  function donut(host, opt) {
    host.classList.add('tb-chart', 'tb-chart-donut');
    host.innerHTML = '';
    var fmtFn = opt.format || fmt.compact;
    var items = (opt.items || []).slice().sort(function (a, b) { return b.value - a.value; });
    if (items.length > 6) {
      var rest = items.slice(5).reduce(function (s, d) { return s + d.value; }, 0);
      items = items.slice(0, 5).concat([{
        label: opt.otherLabel || 'Other', value: rest, color: 'var(--tb-chart-muted)'
      }]);
    }
    var total = items.reduce(function (s, d) { return s + d.value; }, 0) || 1;
    var S = 160, R = 64, r = 46, cx = S / 2, cy = S / 2;
    var svg = el('svg', {
      viewBox: '0 0 ' + S + ' ' + S, 'class': 'chart',
      role: 'img', 'aria-label': opt.title || 'Share'
    }, host);
    var tip = tooltip(host), a0 = -Math.PI / 2;
    var gapA = items.length > 1 ? 0.025 : 0;
    items.forEach(function (d, i) {
      var col = color(d.color, i), frac = d.value / total, a1 = a0 + frac * Math.PI * 2;
      var s0 = a0 + gapA / 2, s1 = Math.max(s0 + 0.001, a1 - gapA / 2);
      var large = s1 - s0 > Math.PI ? 1 : 0;
      if (frac >= 0.9999) { s1 = s0 + Math.PI * 2 - 0.0001; large = 1; }
      var p = function (rad, a) { return (cx + rad * Math.cos(a)) + ',' + (cy + rad * Math.sin(a)); };
      var path = el('path', {
        d: 'M' + p(R, s0) + 'A' + R + ',' + R + ' 0 ' + large + ' 1 ' + p(R, s1) + 'L' + p(r, s1) +
          'A' + r + ',' + r + ' 0 ' + large + ' 0 ' + p(r, s0) + 'Z'
      }, svg);
      path.setAttribute('style', 'fill:' + col + ';cursor:pointer;transition:opacity .2s');
      path.addEventListener('mousemove', function (e) {
        var b = host.getBoundingClientRect();
        tip.innerHTML = row(col, d.label, fmtFn(d.value) + ' · ' + fmt.pct(frac * 100));
        tip.hidden = false;
        tip.style.left = (e.clientX - b.left) + 'px';
        tip.style.top = (e.clientY - b.top) + 'px';
      });
      path.addEventListener('mouseleave', function () { tip.hidden = true; });
      if (opt.onClick) path.addEventListener('click', function () { opt.onClick(i, d); });
      d._color = col;
      d._frac = frac;
      a0 = a1;
    });
    var t1 = el('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', 'class': 'tb-donut-center' }, svg);
    t1.textContent = opt.centerValue != null ? opt.centerValue : fmtFn(total);
    var t2 = el('text', { x: cx, y: cy + 20, 'text-anchor': 'middle', 'class': 'tb-donut-sub' }, svg);
    t2.textContent = opt.centerLabel || 'Total';
    var ul = document.createElement('ul');
    ul.className = 'tb-legend';
    ul.innerHTML = items.map(function (d) {
      return '<li class="tb-legend-row"><span class="tb-dot" style="--tb-dot:' + d._color + '"></span>' +
        esc(d.label) + '<b>' + esc(fmt.pct(d._frac * 100)) + '</b></li>';
    }).join('');
    host.appendChild(ul);
  }

  /* Sparkline — mini trend w karcie KPI, bez osi. */
  function spark(host, opt) {
    host.innerHTML = '';
    var v = opt.values || [], n = v.length, W = 120, H = 36, pad = 3;
    if (!n) return;
    var min = Math.min.apply(null, v), max = Math.max.apply(null, v), span = max - min || 1;
    var col = color(opt.color, 0);
    var pts = v.map(function (x, i) {
      return [
        pad + (W - pad * 2) * i / Math.max(1, n - 1),
        pad + (H - pad * 2) * (1 - (x - min) / span)
      ];
    });
    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none',
      'class': 'tb-spark', 'aria-hidden': 'true'
    }, host);
    var d = pts.map(function (p, i) {
      return (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1);
    }).join('');
    if (opt.area !== false) {
      var g = gradient(el('defs', {}, svg), [[0, col, 0.35], [1, col, 0]], 'v');
      el('path', {
        d: d + 'L' + pts[n - 1][0] + ',' + H + 'L' + pts[0][0] + ',' + H + 'Z', fill: g
      }, svg);
    }
    var p2 = el('path', {
      d: d, fill: 'none', 'stroke-width': 1.75,
      'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round'
    }, svg);
    p2.setAttribute('style', 'stroke:' + col);
  }

  /* Rysowanie w pikselach kontenera; przerysowanie przy zmianie szerokości,
     także gdy ukryta zakładka albo drawer staje się widoczny.
     Guard na _tbRO — ten sam host wywołany ponownie NIE dubluje obserwatora. */
  function tracked(fn) {
    return function (host, opt) {
      if (!host) return;
      host._tbFn = fn;
      host._tbOpt = opt;
      fn(host, opt);
      host._tbW = host.clientWidth;
      if (!host._tbRO && global.ResizeObserver) {
        host._tbRO = new ResizeObserver(function () {
          var w = host.clientWidth;
          if (w > 0 && Math.abs(w - (host._tbW || 0)) > 2) {
            host._tbW = w;
            host._tbFn(host, host._tbOpt);
          }
        });
        host._tbRO.observe(host);
      }
    };
  }

  global.TBCharts = {
    bar: tracked(bar),
    line: tracked(line),
    hbar: tracked(hbar),
    donut: donut,   // stały viewBox 160×160 — nie wymaga obserwatora szerokości
    spark: spark,   // stały viewBox, skalowany przez preserveAspectRatio:none
    fmt: fmt,
    order: ORDER,
    series: SERIES,
    niceMax: niceMax,
    config: cfg
  };
})(window);
