/*
 * 숫자 칸 옆 × 버튼: 누르면 값을 한 번에 지우고, 칸이 바뀐 것처럼(input·change) 알려 다시 계산하게 한다.
 * 화면이 나중에 그리는 칸(내 기준·순위 조건 등)에도 붙도록 문서 전체를 지켜본다.
 */
(function () {
  const SEL = 'input[type=number]';
  function attach(input) {
    if (input.dataset.clr || input.readOnly || input.disabled) return;
    input.dataset.clr = '1';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'clr';
    b.setAttribute('aria-label', '지우기');
    b.tabIndex = -1;
    b.textContent = '×';
    input.insertAdjacentElement('afterend', b);
    sync(input);
  }
  const sync = (input) => {
    const b = input.nextElementSibling;
    if (b && b.classList.contains('clr')) b.hidden = input.value === '';
  };
  const scan = (root) => root.querySelectorAll && root.querySelectorAll(SEL).forEach(attach);

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button.clr');
    if (!b) return;
    e.preventDefault();
    const input = b.previousElementSibling;
    if (!input || !input.matches(SEL)) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    sync(input);
    input.focus();
  });
  document.addEventListener('input', (e) => { if (e.target.matches && e.target.matches(SEL)) sync(e.target); }, true);
  document.addEventListener('change', (e) => { if (e.target.matches && e.target.matches(SEL)) sync(e.target); }, true);

  // 값이 코드로 바뀌는 경우(예시값 되돌리기·판정 보기로 채우기)도 맞춘다
  const resync = () => document.querySelectorAll(SEL).forEach(sync);
  new MutationObserver((list) => {
    for (const m of list) m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches(SEL)) attach(n); else scan(n); } });
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('rea:updated', resync);
  setInterval(resync, 1500); // 코드가 값을 바꾸면 이벤트가 없어서, 가볍게 주기적으로 맞춘다
  scan(document);
})();
