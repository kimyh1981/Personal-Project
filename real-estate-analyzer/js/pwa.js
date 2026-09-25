/* 앱 모드: 서비스 워커 등록, 설치 버튼, 휴대폰 하단 탭(결과·입력) 전환 */
(function () {
  const $ = (id) => document.getElementById(id);
  const layout = document.querySelector('.layout');
  const bar = $('appbar');
  const install = $('installBtn');

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 설치 없이도 동작 */ });
  }

  // 설치 (안드로이드 크롬·삼성 인터넷)
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    install.hidden = false;
  });
  install.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    install.hidden = true;
  });
  window.addEventListener('appinstalled', () => { install.hidden = true; });

  // 하단 탭: 버튼마다 (화면, 결과 탭) 조합을 가진다
  const buttons = [...bar.querySelectorAll('[data-view]')];
  function markActive(btn) {
    buttons.forEach((b) => b.setAttribute('aria-current', String(b === btn)));
  }
  function setView(view, tab, push) {
    layout.dataset.view = view;
    document.body.dataset.view = view;
    if (tab) document.querySelector(`.tabs button[data-tab="${tab}"]`)?.click();
    const current = view === 'inputs' ? 'inputs' : tab || document.querySelector('.tabs button[aria-selected="true"]')?.dataset.tab;
    markActive(buttons.find((b) => b.dataset.view === view && (view === 'inputs' || b.dataset.tab === current)) || null);
    if (view === 'results' && tab && tab !== 'conditions') document.querySelector('.tabs')?.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0 });
    if (push) history.replaceState(null, '', `?view=${view}${location.hash}`);
  }
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view, b.dataset.tab, true);
  });
  // 결과 화면 안의 탭을 직접 눌러도 하단 표시를 맞춘다
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('button[data-tab]');
    if (t && layout.dataset.view === 'results') markActive(buttons.find((b) => b.dataset.tab === t.dataset.tab) || null);
  });
  $('peekOpen').addEventListener('click', () => setView('results', null, true));
  const params = new URLSearchParams(location.search);
  setView(params.get('view') === 'inputs' ? 'inputs' : 'results', null, false);

  // 입력 화면 하단에 현재 판정을 띄워 둔다
  const showPeek = (d) => {
    $('peekScore').textContent = d.score != null ? d.score : '—';
    $('peekLabel').textContent = d.label || '';
    $('peek').dataset.tone = d.tone || 'warning';
  };
  document.addEventListener('rea:updated', (e) => showPeek(e.detail || {}));
  if (window.REA_LAST) showPeek(window.REA_LAST);
})();
