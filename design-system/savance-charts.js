/* ==========================================================================
   SAVANCE CHARTS — lekkie wykresy SVG w stylu Savance (bez zależności)
   Wymaga: savance.css

   SavanceCharts.bar(el, {
     labels: ['Jan','Feb',...],
     series: [{ name:'Income', values:[...], fill:'amber' }, ...],  // fill: amber | lavender | sky | ghost | rose | gold
     yMax: 30, yTicks: 5, height: 200, format: v => v + '%'
   })
   SavanceCharts.line(el, {
     labels: [...], values: [...], color: 'gold', area: true,
     yMax: 60, yTicks: 4, height: 180, format: v => '$' + v + 'k'
   })
   ========================================================================== */
(function (global) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  // gradient stops (góra → dół) – zgodne z --sv-grad-bar-* w savance.css
  var FILLS = {
    amber:    [['0', '#F8C98A', 1], ['0.6', '#E39F5F', 1], ['1', '#E39F5F', 0.35]],
    lavender: [['0', '#D6CFF6', 1], ['0.6', '#A59CE6', 1], ['1', '#8A84E0', 0.35]],
    sky:      [['0', '#F2D6A6', 1], ['0.35', '#BCD7F2', 1], ['0.7', '#89BFEF', 1], ['1', '#5EA6E6', 1]],
    ghost:    [['0', '#FFF0E1', 0.22], ['1', '#FFF0E1', 0.04]],
    rose:     [['0', '#F2A0B4', 1], ['0.6', '#E05A7C', 1], ['1', '#E05A7C', 0.35]],
    gold:     [['0', '#F8DC7E', 1], ['1', '#E0B02E', 0.4]]
  };
  var LINE = { gold: '#F2C94C', amber: '#EFA75E', sky: '#89BFEF', lavender: '#A59CE6', rose: '#E05A7C' };
  var SWATCH = { amber: '#EFA75E', lavender: '#A59CE6', sky: '#89BFEF', ghost: 'rgba(255,240,225,.3)', rose: '#E05A7C', gold: '#F2C94C' };
  var uid = 0;

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function gradient(defs, key) {
    var id = 'svg' + (++uid);
    var g = el('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    (FILLS[key] || FILLS.amber).forEach(function (s) {
      el('stop', { offset: s[0], 'stop-color': s[1], 'stop-opacity': s[2] }, g);
    });
    return 'url(#' + id + ')';
  }
  // słupek z zaokrągloną górą (r=4), płaski przy osi
  function barPath(x, y, w, h) {
    var r = Math.min(4, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }
  function setup(host, opt) {
    host.classList.add('sv-chart');
    host.innerHTML = '';
    var W = opt.width || 520, H = opt.height || 200, m = { t: 12, r: 8, b: 22, l: 30 };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opt.title || 'Wykres' }, host);
    var tip = document.createElement('div');
    tip.className = 'sv-tooltip'; tip.hidden = true; host.appendChild(tip);
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var fmt = opt.format || function (v) { return v; };
    var yMax = opt.yMax, ticks = opt.yTicks || 4;
    var y = function (v) { return m.t + ih - (v / yMax) * ih; };
    var axis = el('g', { 'class': 'sv-axis' }, svg);
    for (var i = 0; i <= ticks; i++) {
      var v = (yMax / ticks) * i, yy = y(v);
      el('line', { 'class': 'sv-gridline', x1: m.l, x2: W - m.r, y1: yy, y2: yy }, axis);
      el('text', { x: m.l - 6, y: yy + 3, 'text-anchor': 'end' }, axis).textContent = fmt(Math.round(v * 10) / 10);
    }
    function show(x, yPx, html) {
      tip.innerHTML = html; tip.hidden = false;
      var r = svg.getBoundingClientRect(), k = r.width / W;
      tip.style.left = (x * k) + 'px'; tip.style.top = (yPx * k) + 'px';
    }
    function hide() { tip.hidden = true; }
    svg.addEventListener('mouseleave', hide);
    return { svg: svg, defs: el('defs', {}, svg), W: W, H: H, m: m, iw: iw, ih: ih, y: y, fmt: fmt, axis: axis, show: show, hide: hide };
  }

  function bar(host, opt) {
    var c = setup(host, opt), n = opt.labels.length, s = opt.series.length;
    var band = c.iw / n, gap = 2;
    var bw = Math.min(opt.barWidth || 14, (band * 0.7 - gap * (s - 1)) / s);
    var fills = opt.series.map(function (se) { return gradient(c.defs, se.fill); });
    opt.labels.forEach(function (lab, i) {
      var cx = c.m.l + band * i + band / 2, gx = cx - (bw * s + gap * (s - 1)) / 2;
      el('text', { x: cx, y: c.H - 6, 'text-anchor': 'middle' }, c.axis).textContent = lab;
      var top = c.H;
      opt.series.forEach(function (se, j) {
        var v = se.values[i], yy = c.y(v);
        top = Math.min(top, yy);
        el('path', { d: barPath(gx + j * (bw + gap), yy, bw, c.m.t + c.ih - yy), fill: fills[j] }, c.svg);
      });
      var hit = el('rect', { 'class': 'sv-hit', x: cx - band / 2, y: c.m.t, width: band, height: c.ih }, c.svg);
      hit.addEventListener('mousemove', function () {
        c.show(cx, top, '<div class="sv-caption">' + lab + '</div>' + opt.series.map(function (se) {
          return '<div style="display:flex;gap:8px;align-items:center"><span class="sv-dot" style="--sv-dot:' + SWATCH[se.fill] +
            '"></span>' + se.name + ' <b style="margin-left:auto">' + c.fmt(se.values[i]) + '</b></div>';
        }).join(''));
      });
    });
  }

  function line(host, opt) {
    var c = setup(host, opt), n = opt.labels.length, col = LINE[opt.color] || opt.color || LINE.gold;
    var step = c.iw / (n - 1);
    var pts = opt.values.map(function (v, i) { return [c.m.l + step * i, c.y(v)]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ',' + p[1]; }).join('');
    if (opt.area !== false) {
      var gid = gradient(c.defs, 'gold');
      c.defs.lastChild.childNodes[0].setAttribute('stop-opacity', .28);
      c.defs.lastChild.childNodes[0].setAttribute('stop-color', col);
      c.defs.lastChild.childNodes[1].setAttribute('stop-opacity', 0);
      c.defs.lastChild.childNodes[1].setAttribute('stop-color', col);
      el('path', { d: d + 'L' + pts[n - 1][0] + ',' + (c.m.t + c.ih) + 'L' + pts[0][0] + ',' + (c.m.t + c.ih) + 'Z', fill: gid }, c.svg);
    }
    el('path', { d: d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, c.svg);
    var cross = el('line', { x1: 0, x2: 0, y1: c.m.t, y2: c.m.t + c.ih, stroke: 'rgba(255,240,225,.25)', 'stroke-dasharray': '3 3', visibility: 'hidden' }, c.svg);
    pts.forEach(function (p, i) {
      el('text', { x: p[0], y: c.H - 6, 'text-anchor': 'middle' }, c.axis).textContent = opt.labels[i];
      var last = i === n - 1;
      el('circle', { cx: p[0], cy: p[1], r: last ? 4.5 : 3, fill: last ? col : '#1A1311', stroke: col, 'stroke-width': 2 }, c.svg);
      var hit = el('rect', { 'class': 'sv-hit', x: p[0] - step / 2, y: c.m.t, width: step, height: c.ih }, c.svg);
      hit.addEventListener('mousemove', function () {
        cross.setAttribute('x1', p[0]); cross.setAttribute('x2', p[0]); cross.setAttribute('visibility', 'visible');
        c.show(p[0], p[1], '<div class="sv-caption">' + opt.labels[i] + '</div><b>' + c.fmt(opt.values[i]) + '</b>');
      });
    });
    c.svg.addEventListener('mouseleave', function () { cross.setAttribute('visibility', 'hidden'); });
  }

  global.SavanceCharts = { bar: bar, line: line, fills: FILLS, colors: LINE };
})(window);
