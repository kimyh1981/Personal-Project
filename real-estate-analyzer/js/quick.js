/*
 * 조건 입력의 두 방식.
 *  상세 입력: 누구나 자기 조건을 하나하나 넣는다 (기존 입력 폼).
 *  내 조건으로 찾기: 이 기기에 저장된 내 기준(내 맞춤 추천)을 그대로 쓰고, 매수 시기·입주 시기·지역만 고르면
 *                   그 지역 단지를 내 조건으로 평가해 보여 준다. 단지를 고르면 판정 입력을 채워 같은 엔진으로 판정한다.
 */
(function () {
  const T = window.REA_TIERS, M = window.REA_MYMARKET, E = window.REA, P = window.REA_POLICY, GEO = window.REA_GEO, COND = window.REA_COND;
  const $ = (id) => document.getElementById(id);
  const MAN = 1e4;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const won = (x) => {
    if (x == null || !isFinite(x)) return '—';
    const v = Math.round(Math.abs(x) / MAN), e = Math.floor(v / 1e4), r = v % 1e4;
    return (x < 0 ? '−' : '') + (e && r ? `${e}억 ${r.toLocaleString()}만` : e ? `${e}억` : `${r.toLocaleString()}만`) + '원';
  };
  const manw = (x) => `${Math.round(x / MAN).toLocaleString()}만원`;
  const MODE_KEY = 'rea-input-mode', QUICK_KEY = 'rea-quick';
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (_) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* 무시 */ } };
  const thisMonth = () => new Date().toISOString().slice(0, 7);
  const months = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return y2 * 12 + m2 - (y1 * 12 + m1); };
  const addMonths = (a, n) => { const [y, m] = a.split('-').map(Number), t = y * 12 + m - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  const GU = P.REGIONS.filter((r) => r.group === '서울').map((r) => r.name.replace(/^서울 /, ''));

  const form = $('inputs'), panel = $('quickPanel');
  const switchBtns = [...document.querySelectorAll('.mode-switch [data-mode]')];

  function setMode(m) {
    save(MODE_KEY, m);
    form.classList.toggle('mode-mine', m === 'mine');
    panel.hidden = m !== 'mine';
    switchBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
    if (m === 'mine') renderPanel();
    else window.REA_FUTURE && window.REA_FUTURE.setPick(null);
  }
  switchBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  // 세전 연소득 → 월 실수령 (4대보험·소득세 근사, 추정)
  function netMonthly(annual) {
    const pts = [[3000e4, 0.89], [5000e4, 0.865], [7000e4, 0.84], [1e8, 0.78], [1.5e8, 0.72], [2e8, 0.68]];
    if (!(annual > 0)) return 0;
    let r = pts[0][1];
    for (let k = 0; k < pts.length; k++) {
      if (annual <= pts[k][0]) { r = k ? pts[k - 1][1] + (annual - pts[k - 1][0]) / (pts[k][0] - pts[k - 1][0]) * (pts[k][1] - pts[k - 1][1]) : pts[0][1]; break; }
      r = pts[k][1];
    }
    return annual * r / 12;
  }

  let profile = null, list = [];
  function settings() {
    const q = load(QUICK_KEY, {});
    const buy = q.buy || profile.buyDate || thisMonth();
    const move = q.move || (profile.residence === 'defer' ? addMonths(buy, profile.deferMonths || 24) : buy);
    return { buy, move, gu: q.gu || '마포구', dong: q.dong || '' };
  }

  async function renderPanel() {
    profile = M.loadProfile();
    if (!M.hasProfile(profile)) {
      panel.innerHTML = `<div class="quick-empty"><h3>내 기준이 아직 없습니다</h3>
        <p class="muted">내 조건으로 찾기는 '내 맞춤 추천'에 저장한 내 기준(보유 주택·상환 능력·노후 목표)을 그대로 씁니다. 먼저 내 기준을 넣어 주세요. 이 기기에만 저장됩니다.</p>
        <a class="primary-link" href="my.html">내 맞춤 추천에서 내 기준 넣기 ›</a></div>`;
      return;
    }
    const s = settings(), f = T.funds(profile);
    panel.innerHTML = `
      <div class="quick-head">
        <p><b>${esc(profile.name ? profile.name + ' 님 조건' : '내 조건')}</b> · 바로 입주 현금 ${won(f.cash)}${f.temp ? ` · 나중에 입주 현금 ${won(f.cashDefer)}` : ''} · 월 상환 ${manw(profile.pay)}${profile.payMax > profile.pay ? `(최대 ${manw(profile.payMax)})` : ''}${profile.annualIncome ? ` · 연소득 ${won(profile.annualIncome)}` : ''}</p>
        <a href="my.html#myProfileCard">내 기준 고치기 ›</a>
      </div>
      <div class="quick-form">
        <label class="f">매수 시기<input id="q_buy" type="month" data-nosave value="${esc(s.buy)}"></label>
        <label class="f">입주 시기<input id="q_move" type="month" data-nosave value="${esc(s.move)}"><span class="hint">매수 시기와 같으면 바로 입주, 3개월 이상 늦으면 세입자 두고 사는 계획으로 계산</span></label>
        <label class="f">구<select id="q_gu" data-nosave>${GU.map((g) => `<option${g === s.gu ? ' selected' : ''}>${g}</option>`).join('')}</select></label>
        <label class="f">동<select id="q_dong" data-nosave><option value="">전체</option></select></label>
      </div>
      <div id="q_rule"></div>
      <div id="q_list"><p class="muted">서울 시장 데이터를 불러오는 중…</p></div>`;
    try { await M.load(); } catch (err) { $('q_list').innerHTML = `<p>${esc(err.message)}</p>`; return; }
    fillDongs(s);
    compute();
  }
  function fillDongs(s) {
    const pr = M.prepare(), gu = $('q_gu').value;
    const dongs = [...new Set(pr.all.filter((c) => c.regionId === 'seoul-' + gu).map((c) => c.dong))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('q_dong').innerHTML = '<option value="">전체</option>' + dongs.map((d) => `<option${d === s.dong ? ' selected' : ''}>${esc(d)}</option>`).join('');
  }

  // 고른 시기로 바꾼 평가용 조건. 지역은 직접 고르므로 순위 메모의 지역·가격 조건은 쓰지 않는다
  function evalProfile(buy, move) {
    const gap = Math.max(0, months(buy, move));
    const rules = Object.fromEntries(Object.entries(profile.tierRules || {}).map(([k, v]) => [k, { ...v, comment: '' }]));
    return { ...profile, buyDate: buy, residence: gap >= 3 ? 'defer' : 'now', deferMonths: gap >= 3 ? gap : profile.deferMonths, tierRules: rules, locEstimatedOk: true };
  }

  function compute() {
    const buy = $('q_buy').value || thisMonth(), move = $('q_move').value && $('q_move').value >= buy ? $('q_move').value : buy;
    const gu = $('q_gu').value, dong = $('q_dong').value;
    save(QUICK_KEY, { buy, move, gu, dong });
    const p = evalProfile(buy, move), gap = months(buy, move);
    const rr = COND.residenceRule({ regionId: 'seoul-' + gu, buyDate: buy, nohomeSince: p.nohomeSince, tenant: gap >= 3, permitAfter: p.permitAfter });
    $('q_rule').innerHTML = `<div class="residence-box">
      <h4>${gap >= 3 ? `${gap}개월 뒤 입주 (세입자 두고 매수)` : '바로 입주'} · 매수 ${esc(buy)}</h4>
      ${gap >= 3 ? `<p><span class="chip ${rr.deferOK ? 'good' : 'critical'}">${rr.deferOK ? '가능' : '불가'}</span> ${esc(rr.why)}</p>${rr.deferOK ? '' : '<p class="muted">그래서 아래 목록은 바로 입주로 계산했습니다. 허가가 해제된 뒤(2027년 이후) 매수로 보려면 내 기준에서 \'허가 기간 뒤 해제된다고 보기\'를 고르세요.</p>'}` : `<p class="muted">${esc(rr.why)}</p>`}
    </div>`;
    const pr = M.prepare(), f = T.funds(p);
    const subset = pr.all.filter((c) => c.regionId === 'seoul-' + gu && (!dong || c.dong === dong));
    const evals = subset.map((c) => M.evaluate(c, p, f));
    const res = T.classify(evals, p);
    const tierOf = new Map();
    res.tiers.forEach((t, ti) => t.items.forEach((x) => { if (!tierOf.has(x.e.c.id)) tierOf.set(x.e.c.id, { t, ti, score: x.score, value: x.value }); }));
    const inTier = evals.filter((e) => tierOf.has(e.c.id)).sort((a, b) => tierOf.get(a.c.id).ti - tierOf.get(b.c.id).ti || tierOf.get(b.c.id).score - tierOf.get(a.c.id).score);
    const outside = evals.filter((e) => !tierOf.has(e.c.id) && e.c.area >= p.minArea).sort((a, b) => a.c.price - b.c.price);
    list = evals;
    const why = (e) => (e.plus > 0 ? `추가 자금 ${won(e.plus)} 필요` : e.payTotal > p.payMax ? `월 상환 ${manw(e.payTotal)} (최대 ${manw(p.payMax)} 초과)` : e.loc.score < 45 && !e.loc.estimated ? '입지 기준 미달' : e.c.area < p.minArea ? '면적 기준 미달' : '노후 목표 미달');
    const row = (e) => {
      const c = e.c, t = tierOf.get(c.id), defer = e.plan.mode === 'defer';
      return `<li><button type="button" class="q-item" data-cid="${esc(c.id)}">
        <span class="q-top"><b>${esc(c.name)}</b> <span class="muted">${esc(c.dong)} · 전용 ${c.area}㎡${c.builtYear ? ` · ${c.builtYear}년` : ''}</span></span>
        <span class="q-price">${won(c.price)}${c.jeonse ? ` <span class="muted">전세 ${won(c.jeonse)}</span>` : ''}</span>
        <span class="q-tags">${t ? `<span class="chip good">${esc(t.t.rank)}</span>` : `<span class="chip warning">조건 밖 · ${esc(why(e))}</span>`}
          <span class="chip neutral">${defer ? `${e.plan.startMonths}개월 뒤 입주` : '바로 입주'}</span>
          <span class="muted">${e.loan + e.plus > 0 ? `대출 ${won(e.loan)} · 월 ${manw(e.payTotal)}` : '대출 없음'} · 노후 ${Math.round(e.ratio * 100)}%</span></span>
        <span class="q-go">판정 보기 ›</span>
      </button></li>`;
    };
    $('q_list').innerHTML = `<p class="muted">${esc(gu)}${dong ? ' ' + esc(dong) : ''} 단지·평형 ${subset.length.toLocaleString()}곳 중 내 조건으로 순위에 드는 곳 <b>${inTier.length.toLocaleString()}곳</b> (이번 주 서울 실거래 ${esc(M.market.asOf.slice(0, 10))} 기준)</p>
      ${inTier.length ? `<ol class="q-list">${inTier.slice(0, 30).map(row).join('')}</ol>` : '<p>이 지역에는 이번 주 내 조건(순위 기준)에 맞는 곳이 없습니다. 다른 동·구를 고르거나 매수 시기를 바꿔 보세요.</p>'}
      ${outside.length ? `<details class="q-out"><summary>조건 밖 ${outside.length.toLocaleString()}곳 (가격 낮은 순)</summary><ol class="q-list">${outside.slice(0, 30).map(row).join('')}</ol></details>` : ''}`;
  }

  panel.addEventListener('change', (e) => {
    if (!e.target.id || !e.target.id.startsWith('q_')) return;
    if (e.target.id === 'q_gu') { $('q_dong').value = ''; fillDongs({ dong: '' }); }
    compute();
  });

  // 역·학교·통근: 내 맞춤 추천에서 확인한 값(30일 캐시) → 카카오 키가 있으면 조회 → 없으면 구 중심 추정
  async function locationOf(c) {
    const cache = load('rea-my-geo', {})[c.id];
    let coords = cache && cache.coords, subway = cache && cache.station ? GEO.walkMinutes(cache.station.m) : null, school = cache && cache.schoolM != null ? GEO.walkMinutes(cache.schoolM) : null;
    let estimated = false;
    if ((!coords || subway == null || school == null) && window.REA_DIRECT && window.REA_DIRECT.keys.get('kakao')) {
      try {
        const q = `${E.region(c.regionId).name.replace(/^서울 /, '서울특별시 ')} ${c.dong} ${c.jibun || ''}`.trim();
        const g = await (await window.REA_DIRECT.fetch('/api/geo?q=' + encodeURIComponent(q))).json();
        if (g && isFinite(g.lat)) {
          coords = [g.lat, g.lng];
          const n = await (await window.REA_DIRECT.fetch(`/api/nearby?lat=${g.lat}&lng=${g.lng}`)).json();
          if (n.station) subway = GEO.walkMinutes(n.station.meters);
          if (n.school) school = GEO.walkMinutes(n.school.meters);
        }
      } catch (_) { /* 추정으로 */ }
    }
    const at = coords || GEO.CENTROIDS[c.regionId];
    const hubs = GEO.WORKPLACES.filter((w) => ['gbd', 'cbd', 'ybd'].includes(w.id));
    const commute = at ? Math.min(...hubs.map((w) => GEO.transitMinutes(at, w.at))) : 40;
    if (subway == null) { subway = 10; estimated = true; }
    if (school == null) { school = 10; estimated = true; }
    if (!coords) estimated = true;
    return { commute, subway, school, estimated };
  }

  // 판정 엔진과 같은 방식(취득 비용 + 이사비)으로 모자라는 돈만큼만 대출 (한도는 엔진이 다시 자른다)
  function loanFor(c, cash) {
    const closing = E.closingCosts({ price: c.price, regionId: c.regionId, homesAfter: 1, temporaryTwo: false, areaOver85: c.area > 85, firstTime: false,
      publicPrice: c.price * 0.69, bondDiscount: (parseFloat($('bondDiscount').value) || 0) / 100, vat: true, propertyType: '아파트' }).total;
    const need = c.price + closing + (parseFloat($('moveCost').value) || 0) * MAN - cash;
    return Math.max(0, Math.ceil(need / MAN));
  }

  // 고른 단지로 판정 입력을 채우고 같은 엔진으로 판정
  async function apply(e) {
    const c = e.c, buy = $('q_buy').value || thisMonth(), move = $('q_move').value && $('q_move').value >= buy ? $('q_move').value : buy;
    const p = evalProfile(buy, move), f = T.funds(p), defer = e.plan.mode === 'defer';
    const net = netMonthly(p.annualIncome);
    const loc = await locationOf(c);
    const V = {
      purpose: '거주', regionId: c.regionId, propertyType: '아파트', price: Math.round(c.price / MAN), areaM2: c.area,
      jeonsePrice: c.jeonse ? Math.round(c.jeonse / MAN) : '', publicRatio: 69, recentTrades: String(Math.round(c.price / MAN)),
      parcelAddress: `${E.region(c.regionId).name} ${c.dong} ${c.jibun || ''}`.trim(),
      subwayWalkMin: loc.subway, jobCommuteMin: loc.commute, schoolWalkMin: loc.school,
      buyerType: 'nohome', cash: Math.round((defer ? f.cashDefer : f.cash) / MAN), age: p.age,
      borrower: 'single', annualIncome: Math.round((p.annualIncome || 0) / MAN), spouseIncome: 0, netMonthly: Math.round(net / MAN),
      employment: p.employment || 'regular', spouseEmployment: '', retireAge: p.targetAge,
      monthlyLiving: Math.round(Math.max(0, net - p.payMax) / MAN), existingDebt: 0, creditBalance: 0, annualSavings: '',
      rate: +(p.loanRate * 100).toFixed(2), termYears: p.loanTerm || 30, rateType: p.rateType || 'periodic', method: 'amortized', lender: 'bank',
      loanWanted: defer ? 0 : loanFor(c, defer ? f.cashDefer : f.cash), usePrivate: false, reconTarget: false, vat: true,
      assumeTenant: defer, nohomeSince: p.nohomeSince || '', permitAfter: p.permitAfter || 'extend',
      purchaseDate: buy, moveInBy: move !== buy ? move : '',
      appreciation: +(e.growth.g * 100).toFixed(1), rentDeposit: c.jeonse ? Math.round(c.jeonse / MAN) : $('rentDeposit').value,
    };
    for (const [k, v] of Object.entries(V)) {
      const el = $(k); if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    }
    window.REA_FUTURE && window.REA_FUTURE.setPick(c.id, p);
    form.dispatchEvent(new Event('change', { bubbles: true }));
    const note = $('q_applied');
    if (note) note.remove();
    const plan = defer ? ` 세입자 전세 ${won(e.plan.J)}를 안고 지금 현금 ${won(e.plan.cashNow)}로 사고, ${e.plan.startMonths}개월 뒤 입주할 때 모은 돈${e.plan.loanLate ? `과 전세퇴거자금 대출 ${won(e.plan.loanLate)}` : ''}${e.plus ? `, 추가 자금 ${won(e.plus)}` : ''}로 전세금을 돌려주는 계획입니다 (판정은 매수 시점 자금 기준).` : '';
    panel.insertAdjacentHTML('afterbegin', `<p class="demo-note" id="q_applied"><span class="chip good">판정</span> ${esc(c.name)} 전용 ${c.area}㎡로 판정을 계산했습니다.${plan} 월 실수령은 연소득으로 추정(${manw(net)})했고, 생활비는 실수령 − 월 상환 최대로 두었습니다${loc.estimated ? '. 역·학교 거리는 카카오 키가 없어 10분으로 추정했습니다' : ''}. 상세 입력에서 고칠 수 있습니다.</p>`);
    // 휴대폰: 결과 화면으로, PC: 판정으로 스크롤
    const res = document.querySelector('#appbar [data-view="results"][data-tab="conditions"]');
    if (res && getComputedStyle($('appbar')).display !== 'none') res.click();
    else $('verdict').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  panel.addEventListener('click', (ev) => {
    const b = ev.target.closest('.q-item'); if (!b) return;
    const e = list.find((x) => x.c.id === b.dataset.cid);
    if (e) apply(e);
  });

  setMode(load(MODE_KEY, 'detail') === 'mine' ? 'mine' : 'detail');
})();
