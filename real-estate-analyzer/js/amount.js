/*
 * 만원 단위 입력칸 옆에 억 단위 환산을 보여준다 (예: 105000 → 10억 5,000만).
 * 입력값 자체는 숫자 그대로 두어 계산에 영향을 주지 않는다.
 */
(function () {
  function toEok(man) {
    const v = Math.round(Math.abs(man)), e = Math.floor(v / 1e4), r = v % 1e4;
    const s = e && r ? `${e}억 ${r.toLocaleString()}만` : e ? `${e}억` : `${r.toLocaleString()}만`;
    return (man < 0 ? '−' : '') + s + '원';
  }
  const isManwon = (input) => {
    const label = input.closest('label');
    const unit = label && label.querySelector('.unit');
    return unit && /만원/.test(unit.firstChild ? unit.firstChild.textContent : unit.textContent) && input.type === 'number';
  };
  function hintFor(input) {
    const unit = input.closest('label').querySelector('.unit');
    let h = unit.querySelector('.won-hint');
    if (!h) {
      h = document.createElement('b');
      h.className = 'won-hint';
      unit.appendChild(h); // 단위 옆: "만원 · 10억원"
    }
    const n = Number(input.value);
    const t = input.value !== '' && isFinite(n) && n !== 0 ? toEok(n) : '';
    if (h.textContent !== t) h.textContent = t; // 같은 값이면 건드리지 않는다 (관찰자 무한 반복 방지)
  }
  function scan(root) {
    (root || document).querySelectorAll('label input[type=number]').forEach((i) => { if (isManwon(i)) hintFor(i); });
  }
  document.addEventListener('input', (e) => { if (e.target.matches && e.target.matches('input[type=number]') && isManwon(e.target)) hintFor(e.target); });
  document.addEventListener('change', (e) => { if (e.target.matches && e.target.matches('input[type=number]') && isManwon(e.target)) hintFor(e.target); });
  const start = () => {
    scan();
    // 값이 코드로 채워지거나 칸이 새로 그려질 때도 맞춘다
    new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
    setTimeout(scan, 300); setTimeout(scan, 1500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.REA_AMOUNT = { toEok, scan };
})();
