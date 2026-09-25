/* 의존성 없는 SVG 차트: 선(크로스헤어 툴팁), 히스토그램, 산점도+추세선 */
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  let W = 640, H = 280;
  const M = { t: 16, r: 84, b: 32, l: 64 };
  const size = (o, w, h, r) => { W = o.width || w; H = o.height || h; M.r = r ?? 84; };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
    return out;
  }
  const tip = () => document.getElementById('tooltip');
  function showTip(html, evt) {
    const t = tip();
    t.innerHTML = html;
    t.hidden = false;
    const x = Math.min(window.innerWidth - t.offsetWidth - 8, evt.clientX + 14);
    const y = Math.max(8, evt.clientY - t.offsetHeight - 10);
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }
  function hideTip() { tip().hidden = true; }

  function frame(container, yTicks, yFmt, sy) {
    container.innerHTML = '';
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' }, container);
    for (const v of yTicks) {
      el('line', { x1: M.l, x2: W - M.r, y1: sy(v), y2: sy(v), class: 'gridline' }, svg);
      const t = el('text', { x: M.l - 8, y: sy(v) + 4, 'text-anchor': 'end' }, svg);
      t.textContent = yFmt(v);
    }
    return svg;
  }

  /**
   * series: [{ name, color(css var), values:[{x,y}] }], 같은 x 배열 가정
   */
  function line(container, opts) {
    const { series, xFmt, yFmt, ariaLabel, zeroLine } = opts;
    size(opts, 640, 280);
    const xs = series[0].values.map((p) => p.x);
    const ys = series.flatMap((s) => s.values.map((p) => p.y));
    const yTicks = niceTicks(Math.min(...ys, zeroLine ? 0 : Infinity), Math.max(...ys), 5);
    const y0 = yTicks[0], y1 = yTicks[yTicks.length - 1];
    const sx = (x) => M.l + ((x - xs[0]) / (xs[xs.length - 1] - xs[0] || 1)) * (W - M.l - M.r);
    const sy = (y) => H - M.b - ((y - y0) / (y1 - y0)) * (H - M.t - M.b);
    const svg = frame(container, yTicks, yFmt, sy);
    svg.setAttribute('aria-label', ariaLabel || '');
    const every = Math.ceil(xs.length / 8);
    xs.forEach((x, k) => {
      if (k % every && k !== xs.length - 1) return;
      const t = el('text', { x: sx(x), y: H - M.b + 18, 'text-anchor': 'middle' }, svg);
      t.textContent = xFmt(x);
    });
    el('line', { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, class: 'axis' }, svg);
    if (zeroLine && y0 < 0) el('line', { x1: M.l, x2: W - M.r, y1: sy(0), y2: sy(0), class: 'axis' }, svg);

    const labels = [];
    for (const s of series) {
      const d = s.values.map((p, k) => `${k ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
      el('path', { d, fill: 'none', stroke: `var(${s.color})`, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      const last = s.values[s.values.length - 1];
      el('circle', { cx: sx(last.x), cy: sy(last.y), r: 4, fill: `var(${s.color})`, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
      labels.push({ y: sy(last.y), text: s.name, x: sx(last.x) + 8 });
    }
    // 끝점 라벨 겹침 방지
    labels.sort((a, b) => a.y - b.y);
    for (let k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 14) labels[k].y = labels[k - 1].y + 14;
    for (const l of labels) {
      const t = el('text', { x: l.x, y: l.y + 4, class: 'label-strong' }, svg);
      t.textContent = l.text;
    }

    const cross = el('line', { y1: M.t, y2: H - M.b, class: 'axis', visibility: 'hidden' }, svg);
    const hit = el('rect', { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (evt) => {
      const r = svg.getBoundingClientRect();
      const px = ((evt.clientX - r.left) / r.width) * W;
      let k = 0, best = Infinity;
      xs.forEach((x, i) => { const d = Math.abs(sx(x) - px); if (d < best) { best = d; k = i; } });
      cross.setAttribute('x1', sx(xs[k])); cross.setAttribute('x2', sx(xs[k]));
      cross.setAttribute('visibility', 'visible');
      showTip(`<div>${xFmt(xs[k])}</div>` + series.map((s) => `<div>${s.name} <b>${yFmt(s.values[k].y, true)}</b></div>`).join(''), evt);
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  function histogram(container, opts) {
    const { bins, xFmt, colorFor, ariaLabel } = opts;
    size(opts, 420, 240, 20);
    const max = Math.max(...bins.map((b) => b.count));
    const yTicks = niceTicks(0, max, 4);
    const x0 = bins[0].from, x1 = bins[bins.length - 1].to;
    const sx = (x) => M.l + ((x - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
    const sy = (y) => H - M.b - (y / yTicks[yTicks.length - 1]) * (H - M.t - M.b);
    const svg = frame(container, yTicks, (v) => String(v), sy);
    svg.setAttribute('aria-label', ariaLabel || '');
    for (const b of bins) {
      const x = sx(b.from) + 1, w = Math.max(1, sx(b.to) - sx(b.from) - 2);
      const y = sy(b.count), h = H - M.b - y;
      const color = colorFor(b);
      const r = Math.min(4, w / 2, h);
      const d = `M${x},${H - M.b}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${H - M.b}Z`;
      const p = el('path', { d: h > 0 ? d : `M${x},${H - M.b}h${w}`, fill: `var(${color})` }, svg);
      p.addEventListener('pointermove', (evt) => showTip(`${xFmt(b.from)} ~ ${xFmt(b.to)}<br><b>${b.count}</b>회`, evt));
      p.addEventListener('pointerleave', hideTip);
    }
    el('line', { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, class: 'axis' }, svg);
    if (x0 < 0 && x1 > 0) {
      el('line', { x1: sx(0), x2: sx(0), y1: M.t, y2: H - M.b, class: 'axis', 'stroke-dasharray': '3 3' }, svg);
      const t = el('text', { x: sx(0), y: H - M.b + 18, 'text-anchor': 'middle', class: 'label-strong' }, svg);
      t.textContent = '0';
    }
    [x0, x1].forEach((v, k) => {
      const t = el('text', { x: sx(v), y: H - M.b + 18, 'text-anchor': k ? 'end' : 'start' }, svg);
      t.textContent = xFmt(v);
    });
  }

  function scatter(container, opts) {
    const { points, trend, xFmt, yFmt, marker, ariaLabel } = opts;
    size(opts, 460, 280, 56);
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y).concat(marker ? [marker.y] : []);
    const yTicks = niceTicks(Math.min(...ys), Math.max(...ys), 5);
    const xMin = Math.min(...xs), xMax = Math.max(...xs, marker ? marker.x : -Infinity);
    const y0 = yTicks[0], y1 = yTicks[yTicks.length - 1];
    const sx = (x) => M.l + ((x - xMin) / (xMax - xMin || 1)) * (W - M.l - M.r);
    const sy = (y) => H - M.b - ((y - y0) / (y1 - y0)) * (H - M.t - M.b);
    const svg = frame(container, yTicks, yFmt, sy);
    svg.setAttribute('aria-label', ariaLabel || '');
    el('line', { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, class: 'axis' }, svg);
    const xt = niceTicks(xMin, xMax, 5).filter((v) => v >= xMin && v <= xMax);
    for (const v of xt) {
      const t = el('text', { x: sx(v), y: H - M.b + 18, 'text-anchor': 'middle' }, svg);
      t.textContent = xFmt(v);
    }
    if (trend) {
      el('line', { x1: sx(xMin), y1: sy(trend(xMin)), x2: sx(xMax), y2: sy(trend(xMax)), stroke: 'var(--s-buy)', 'stroke-width': 2, 'stroke-dasharray': '6 4' }, svg);
    }
    for (const p of points) {
      const c = el('circle', { cx: sx(p.x), cy: sy(p.y), r: 4, fill: 'var(--s-buy)', 'fill-opacity': 0.55, stroke: 'var(--surface)', 'stroke-width': 1 }, svg);
      c.addEventListener('pointermove', (evt) => showTip(p.tip, evt));
      c.addEventListener('pointerleave', hideTip);
    }
    if (marker) {
      el('circle', { cx: sx(marker.x), cy: sy(marker.y), r: 6, fill: 'var(--s-rent)', stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
      const t = el('text', { x: sx(marker.x) + 10, y: sy(marker.y) + 4, class: 'label-strong' }, svg);
      t.textContent = marker.label;
    }
  }

  root.REA_CHARTS = { line, histogram, scatter };
})(typeof self !== 'undefined' ? self : this);
