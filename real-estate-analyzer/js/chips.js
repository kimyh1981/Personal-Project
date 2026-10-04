/*
 * 여러 개 고르기 칩 (구·동·주택 종류). 고른 값은 data-chip-group 묶음의 aria-pressed="true" 버튼.
 *   REA_CHIPS.html(group, options, selected, { presets })  → HTML
 *   REA_CHIPS.toggle(event)  → 바뀐 묶음 이름 (칩이 아니면 null). 묶음 버튼(presets)은 그 값들로 바꾼다
 *   REA_CHIPS.values(root, group) → 고른 값 배열
 */
(function (root) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const SEOUL_GROUPS = [
    ['서울 전체', []],
    ['강남3구', ['강남구', '서초구', '송파구']],
    ['강남4구', ['강남구', '서초구', '송파구', '강동구']],
    ['마용성', ['마포구', '용산구', '성동구']],
    ['노도강', ['노원구', '도봉구', '강북구']],
    ['금관구', ['금천구', '관악구', '구로구']],
  ];
  // options: [{ value, label, note }]
  function html(group, options, selected, opts = {}) {
    const sel = new Set(selected || []);
    const presets = (opts.presets || []).map(([label, vals]) => `<button type="button" class="chip-preset" data-chip-group="${esc(group)}" data-preset="${esc(JSON.stringify(vals))}">${esc(label)}</button>`).join('');
    return `<div class="chips" data-chips="${esc(group)}">
      ${presets ? `<div class="chip-presets">${presets}</div>` : ''}
      <div class="chip-list">${options.map((o) => `<button type="button" class="pick" data-chip-group="${esc(group)}" data-value="${esc(o.value)}" aria-pressed="${sel.has(o.value)}">${esc(o.label)}${o.note ? `<small>${esc(o.note)}</small>` : ''}</button>`).join('')}</div>
    </div>`;
  }
  function toggle(ev) {
    const b = ev.target.closest('[data-chip-group]');
    if (!b) return null;
    const group = b.dataset.chipGroup, box = b.closest('[data-chips]');
    if (b.dataset.preset) {
      const vals = new Set(JSON.parse(b.dataset.preset));
      box.querySelectorAll('.pick').forEach((x) => x.setAttribute('aria-pressed', String(vals.has(x.dataset.value))));
    } else {
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    }
    return group;
  }
  const values = (rootEl, group) => [...rootEl.querySelectorAll(`[data-chips="${group}"] .pick[aria-pressed="true"]`)].map((x) => x.dataset.value);
  root.REA_CHIPS = { html, toggle, values, SEOUL_GROUPS };
})(typeof self !== 'undefined' ? self : this);
