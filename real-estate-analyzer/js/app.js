/* 화면 제어: 입력 → 엔진 → 결과 렌더링 */
(function () {
  const E = window.REA, P = window.REA_POLICY, C = window.REA_CHARTS, COND = window.REA_COND;
  const $ = (id) => document.getElementById(id);
  const MAN = 1e4;
  const STORE_KEY = 'rea-inputs-v1';

  // ── 포맷 ──────────────────────────────────────────────────────────────
  function won(x, opts = {}) {
    if (x == null || !isFinite(x)) return opts.inf || '제한 없음';
    const neg = x < 0;
    let v = Math.round(Math.abs(x) / MAN); // 만원
    const eok = Math.floor(v / 1e4), man = v % 1e4;
    let s;
    if (eok && man) s = `${eok.toLocaleString()}억 ${man.toLocaleString()}만`;
    else if (eok) s = `${eok.toLocaleString()}억`;
    else s = `${man.toLocaleString()}만`;
    if (opts.short && eok) s = `${(Math.abs(x) / 1e8).toFixed(Math.abs(x) >= 1e10 ? 0 : 1)}억`;
    return (neg ? '−' : opts.sign && x > 0 ? '+' : '') + s + (opts.short ? '' : '원');
  }
  const pct = (x, d = 1) => (isFinite(x) ? (x * 100).toFixed(d) + '%' : '—');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const STATUS_TEXT = { good: '양호', warning: '주의', serious: '경계', critical: '위험' };
  const chip = (status, text) => `<span class="chip ${status}">${esc(text || STATUS_TEXT[status])}</span>`;

  // ── 입력 ──────────────────────────────────────────────────────────────
  const form = $('inputs');
  const defaults = {};
  function initRegions() {
    const sel = $('regionId');
    const groups = {};
    for (const r of P.REGIONS) (groups[r.group] ||= []).push(r);
    sel.innerHTML = Object.entries(groups).map(([g, rs]) =>
      `<optgroup label="${esc(g)}">${rs.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</optgroup>`).join('');
    sel.value = 'seoul-마포구';
  }
  function snapshotDefaults() {
    for (const e of form.elements) if (e.id) defaults[e.id] = e.type === 'checkbox' ? e.checked : e.value;
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!saved) return;
      for (const [k, v] of Object.entries(saved)) {
        const e = $(k);
        if (!e) continue;
        if (e.type === 'checkbox') e.checked = !!v; else e.value = v;
      }
    } catch (_) { /* 저장소 사용 불가 시 기본값 */ }
  }
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(formValues()));
    } catch (_) { /* 무시 */ }
  }
  // 폼의 현재 값 {id: 문자열|불리언}
  function formValues() {
    const out = {};
    for (const e of form.elements) if (e.id && e.type !== 'file' && !e.dataset.nosave) out[e.id] = e.type === 'checkbox' ? e.checked : e.value;
    return out;
  }
  function read(V = formValues()) {
    const val = (id) => (V[id] ?? defaults[id]);
    // 빈 칸은 예시 기본값으로 대신한다 (0으로 조용히 바뀌지 않도록)
    const n = (id, scale = 1) => {
      let v = parseFloat(val(id));
      if (!isFinite(v)) v = parseFloat(defaults[id]);
      return isFinite(v) ? v * scale : 0;
    };
    const opt = (id, scale = 1) => { const v = parseFloat(V[id]); return isFinite(v) ? v * scale : null; };
    return {
      regionId: val('regionId'),
      purpose: val('purpose'), propertyType: val('propertyType'), assumeTenant: !!val('assumeTenant'),
      price: n('price', MAN), areaM2: n('areaM2'), jeonsePrice: opt('jeonsePrice', MAN), publicRatio: n('publicRatio', 0.01),
      buyerType: val('buyerType'),
      annualIncome: n('annualIncome', MAN), existingDebt: n('existingDebt', MAN), cash: n('cash', MAN),
      monthlyLiving: n('monthlyLiving', MAN), age: n('age'), annualSavings: n('annualSavings', MAN),
      newlywed: !!val('newlywed'), newborn: !!val('newborn'), multichild: !!val('multichild'),
      rate: n('rate', 0.01), termYears: Math.max(1, n('termYears')), rateType: val('rateType'), method: val('method'),
      lender: val('lender'), loanWanted: opt('loanWanted', MAN),
      rentDeposit: n('rentDeposit', MAN), rentMonthly: n('rentMonthly', MAN), rentLoan: n('rentLoan', MAN), rentLoanRate: n('rentLoanRate', 0.01),
      years: Math.min(30, Math.max(1, Math.round(n('years')))), appreciation: n('appreciation', 0.01), appreciationVol: n('appreciationVol', 0.01),
      rentGrowth: n('rentGrowth', 0.01), invReturn: n('invReturn', 0.01), invVol: n('invVol', 0.01),
      maintenanceRate: n('maintenanceRate', 0.01), moveCost: n('moveCost', MAN), bondDiscount: n('bondDiscount', 0.01),
      vat: !!val('vat'), reform2026: !!val('reform2026'), useRenewalRight: !!val('useRenewalRight'), rateChange: n('rateChange', 0.01),
    };
  }

  // ── 최신 공공데이터 상태 ──────────────────────────────────────────────
  // available: 로컬 서버가 있어 조회 가능, regulation: 규제 변경 감지 결과, landUse: 주소별 필지 조회 결과
  const liveState = { available: false, regulation: null, regulationError: '', landUse: {}, sources: [], redev: null };
  function liveFor(V) {
    const addr = String(V.parcelAddress || '').trim();
    return {
      regulation: liveState.regulation,
      landUse: addr ? liveState.landUse[addr] || null : null,
      unavailable: liveState.available ? liveState.regulationError || '조회 중' : '로컬 서버(npm start)로 열어야 조회됩니다',
    };
  }
  async function liveGet(pathQs) {
    const r = await fetch(pathQs, { cache: 'no-store' });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code });
    return j;
  }
  async function refreshRegulation(fresh) {
    try {
      liveState.regulation = await liveGet(`api/regulation${fresh ? '?fresh=1' : ''}`);
      liveState.regulationError = '';
    } catch (err) {
      liveState.regulation = null;
      liveState.regulationError = err.message;
    }
    try { liveState.sources = (await liveGet('api/sources')).sources; } catch (_) { /* 무시 */ }
    update();
  }
  async function fetchLandUse(fresh) {
    const addr = $('parcelAddress').value.trim();
    const st = $('landUseStatus');
    if (!liveState.available) { st.textContent = '로컬 서버(npm start)로 열어야 조회할 수 있습니다.'; return; }
    if (!addr) { st.textContent = '지번 주소를 입력하세요.'; return; }
    st.textContent = '조회 중…';
    try {
      const r = await liveGet(`api/landuse?address=${encodeURIComponent(addr)}${fresh ? '&fresh=1' : ''}`);
      liveState.landUse[addr] = r;
      st.textContent = `${r.address} · ${r.zones.length ? r.zones.join(', ') : '지역지구 없음'} (${fmtTime(r.fetchedAt)} 조회)`;
    } catch (err) {
      st.textContent = `조회 실패: ${err.message}`;
    }
    await refreshSources();
    update();
  }
  async function fetchRedev() {
    const st = $('redevStatus'), pick = $('redevPick');
    if (!liveState.available) { st.textContent = '로컬 서버(npm start)로 열어야 조회할 수 있습니다.'; return; }
    const r = E.region($('regionId').value);
    const sido = r.group.startsWith('서울') ? '서울' : r.group.startsWith('경기') ? '경기' : null;
    if (!sido) { st.textContent = '정비사업 조회는 서울·경기 지역만 지원합니다.'; return; }
    st.textContent = '조회 중…';
    try {
      const res = await liveGet(`api/redev?sido=${sido}&q=${encodeURIComponent($('redevQuery').value.trim())}`);
      liveState.redev = res;
      if (!res.items.length) { pick.hidden = true; st.textContent = `검색 결과가 없습니다 (${res.source} ${res.total}건 중).`; return; }
      pick.innerHTML = '<option value="">결과 선택</option>' + res.items.map((it, k) => `<option value="${k}">${esc(it.name || '(이름 없음)')} · ${esc(it.district)} · ${esc(P.RECON.stageLabels[it.currentStage] || it.currentStage || it.stage || '단계 미상')}${it.currentStageDate ? ' ' + it.currentStageDate : ''}</option>`).join('');
      pick.hidden = false;
      st.textContent = `${res.source} · ${fmtTime(res.fetchedAt)} 조회 · ${res.items.length}건`;
    } catch (err) {
      pick.hidden = true;
      st.textContent = `조회 실패: ${err.message}`;
    }
    await refreshSources();
    update();
  }
  function applyRedev(k) {
    const it = liveState.redev && liveState.redev.items[k];
    if (!it) return;
    $('reconTarget').checked = true;
    if (it.currentStage) $('reconStage').value = it.currentStage;
    $('stageDate').value = it.currentStageDate || '';
    liveState.redevPicked = it;
    $('redevStatus').textContent = `${it.name}: ${P.RECON.stageLabels[it.currentStage] || it.currentStage || '단계 미상'}${it.currentStageDate ? ` (${it.currentStageDate})` : ''} 반영 · 출처 ${liveState.redev.source}`;
    update();
  }
  async function refreshSources() {
    try { liveState.sources = (await liveGet('api/sources')).sources; } catch (_) { /* 무시 */ }
  }
  const fmtTime = (iso) => { try { return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return iso; } };

  // 필수 조건 입력 (빈 칸은 null → 누락으로 판정)
  const REQ_INPUT = {
    purpose: 'purpose', regionId: 'regionId', propertyType: 'propertyType', areaM2: 'areaM2', price: 'price', cash: 'cash',
    ownedHomes: 'buyerType', annualIncome: 'annualIncome', 'timing.purchaseDate': 'purchaseDate',
    'location.jobCommuteMin': 'jobCommuteMin', 'location.schoolWalkMin': 'schoolWalkMin', 'location.subwayWalkMin': 'subwayWalkMin',
    recentTrades: 'recentTrades', jeonse: 'jeonsePrice', 'timing.holdingYears': 'years',
    'recon.stage': 'reconStage', 'recon.priorAssetValue': 'priorAssetValue', 'recon.expectedContribution': 'expectedContribution',
  };
  function readConditions(V = formValues()) {
    const num = (id, scale = 1) => { const v = parseFloat(V[id]); return isFinite(v) ? v * scale : null; };
    const list = (id) => String(V[id] || '').split(',').map((x) => x.trim()).filter(Boolean);
    const owned = { first: 0, nohome: 0, one_dispose: 1, one: 1, multi: 2 }[V.buyerType];
    let trades = list('recentTrades').map((x) => Number(x.replace(/[^0-9.]/g, '')) * MAN).filter((x) => x > 0);
    if (!trades.length && txs) {
      const comp = E.comparables(txs, num('areaM2') || 0, 3);
      if (comp) trades = comp.points.slice(-5).map((p) => p.t.price);
    }
    return {
      purpose: V.purpose || null, regionId: V.regionId || null, propertyType: V.propertyType || null,
      areaM2: num('areaM2'), price: num('price', MAN), recentTrades: trades, jeonse: num('jeonsePrice', MAN),
      assumeTenant: !!V.assumeTenant, cash: num('cash', MAN), ownedHomes: owned ?? null,
      willSellExisting: V.buyerType === 'one_dispose', annualIncome: num('annualIncome', MAN), annualSavings: num('annualSavings', MAN) || 0,
      location: {
        subwayWalkMin: num('subwayWalkMin'), jobCommuteMin: num('jobCommuteMin'), schoolWalkMin: num('schoolWalkMin'),
        amenities: list('amenities'), negatives: list('negatives'),
      },
      recon: {
        target: !!V.reconTarget, stage: V.reconTarget ? V.reconStage || null : null,
        priorAssetValue: num('priorAssetValue', MAN), expectedContribution: num('expectedContribution', MAN),
        newUnitValue: num('newUnitValue', MAN), relocationLtv: num('relocationLtv', 0.01),
        tempHousingDeposit: num('tempHousingDeposit', MAN), ownerHeldYears: num('ownerHeldYears'), ownerLivedYears: num('ownerLivedYears'),
        stageDate: V.reconTarget ? V.stageDate || null : null,
      },
      live: liveFor(V),
      timing: { purchaseDate: V.purchaseDate || null, holdingYears: num('years'), moveInBy: V.moveInBy || null },
      loan: { rate: (num('rate') ?? 4) / 100, termYears: num('termYears') || 30, method: V.method },
    };
  }

  // 보유 상태 → 취득 후 주택 수·세제상 1세대1주택 여부
  function household(i) {
    switch (i.buyerType) {
      case 'first': case 'nohome': return { homesAfter: 1, temporaryTwo: false, oneHouse: true };
      case 'one_dispose': return { homesAfter: 2, temporaryTwo: true, oneHouse: true };
      case 'one': return { homesAfter: 2, temporaryTwo: false, oneHouse: false };
      default: return { homesAfter: 3, temporaryTwo: false, oneHouse: false };
    }
  }

  // ── 계산 ──────────────────────────────────────────────────────────────
  function compute(i, cond) {
    const hh = household(i);
    const r = E.region(i.regionId);
    const livesIn = COND.livesIn(cond);
    // 비거주(세입자 승계·임대)면 전세보증금을 받아 매수자금에 쓴다. 선순위 임차인이 있으면 주담대는 보수적으로 0
    const tenantDeposit = !livesIn ? i.jeonsePrice || 0 : 0;
    const limit = E.loanLimit({
      price: i.price, regionId: i.regionId, buyerType: i.buyerType, annualIncome: i.annualIncome,
      existingAnnualDebtService: i.existingDebt, rate: i.rate, termYears: i.termYears,
      method: i.method, rateType: i.rateType, lender: i.lender, livesIn, propertyType: i.propertyType,
    });
    const maxLoan = tenantDeposit ? 0 : limit.amount;
    const loan = i.loanWanted != null ? Math.max(0, Math.min(i.loanWanted, maxLoan)) : maxLoan;
    const termYears = limit.termYears;
    const publicPrice = i.price * i.publicRatio;
    const closing = E.closingCosts({
      price: i.price, regionId: i.regionId, homesAfter: hh.homesAfter, temporaryTwo: hh.temporaryTwo,
      areaOver85: i.areaM2 > 85, firstTime: i.buyerType === 'first', publicPrice,
      bondDiscount: i.bondDiscount, vat: i.vat, propertyType: i.propertyType,
    });
    const holding = E.holdingTax({ publicPrice, oneHouse: hh.oneHouse, homes: hh.homesAfter, age: i.age, yearsHeld: 0, resident: livesIn, reform2026: i.reform2026 });
    const monthlyPayment = i.method === 'equalPrincipal'
      ? (E.schedule(loan, i.rate, termYears, 'equalPrincipal').payment[0] || 0)
      : E.pmt(loan, i.rate, termYears * 12);
    const need = i.price - loan - tenantDeposit + closing.total + (livesIn ? i.moveCost : 0);
    const fundingGap = need - i.cash;
    const leftover = i.cash - need;
    const monthlyIncome = i.annualIncome / 12;
    const stress = E.stressTest({ loan, rate: i.rate, termYears, method: i.method, monthlyIncome, price: i.price });

    const sim = {
      years: i.years, cash: i.cash, price: i.price, loan, rate: i.rate, termYears, method: i.method,
      closing: closing.total, regionId: i.regionId, homesAfter: hh.homesAfter, publicRatio: i.publicRatio,
      maintenanceRate: i.maintenanceRate, appreciation: i.appreciation, invReturn: i.invReturn,
      rentDeposit: i.rentDeposit, rentMonthly: i.rentMonthly, rentLoan: Math.min(i.rentLoan, i.rentDeposit), rentLoanRate: i.rentLoanRate,
      rentGrowth: i.rentGrowth, useRenewalRight: i.useRenewalRight, moveCost: i.moveCost, oneHouse: hh.oneHouse, age: i.age, reform2026: i.reform2026, vat: i.vat,
    };
    const base = E.simulate(sim);
    const breakeven = livesIn ? E.breakevenAppreciation(sim) : undefined;
    const mc = livesIn ? E.monteCarlo(sim, { runs: 800, seed: 20260925, appreciationVol: i.appreciationVol, invVol: i.invVol }) : null;
    const gap = livesIn ? null : E.gapInvestment({
      price: i.price, deposit: tenantDeposit, loan, rate: i.rate, termYears, method: i.method, closing: closing.total,
      years: i.years, appreciation: i.appreciation, rentGrowth: i.rentGrowth, useRenewalRight: i.useRenewalRight, invReturn: i.invReturn,
      regionId: i.regionId, homesAfter: hh.homesAfter, oneHouse: hh.oneHouse, publicRatio: i.publicRatio, age: i.age, reform2026: i.reform2026, vat: i.vat,
    });
    const policyLoans = E.policyLoanEligibility({
      price: i.price, householdIncome: i.annualIncome, netAsset: i.cash, areaM2: i.areaM2, buyerType: i.buyerType,
      newlywed: i.newlywed, newborn: i.newborn, multichild: i.multichild,
    });
    const afford = E.maxAffordablePrice({
      regionId: i.regionId, buyerType: i.buyerType, annualIncome: i.annualIncome, existingAnnualDebtService: i.existingDebt,
      rate: i.rate, termYears: i.termYears, method: i.method, rateType: i.rateType, lender: i.lender,
      cash: i.cash, moveCost: i.moveCost, homesAfter: hh.homesAfter, temporaryTwo: hh.temporaryTwo, livesIn, propertyType: i.propertyType,
      areaOver85: i.areaM2 > 85, publicRatio: i.publicRatio, bondDiscount: i.bondDiscount, vat: i.vat,
    });
    const sens = livesIn && base.feasible ? E.sensitivity(sim) : null;
    const jeonseRatio = i.jeonsePrice > 0 ? i.jeonsePrice / i.price : null;
    const assess = COND.assess(cond, {
      price: i.price, loanUsed: loan, tenantDeposit, requiredCash: need, surplus: i.cash - need,
      totalCost: i.price + closing.total, dsr: i.annualIncome > 0 ? (monthlyPayment * 12 + i.existingDebt) / i.annualIncome : 0,
      loanBlockedReason: limit.blockedReason, taxHeavy: closing.tax.heavy, taxRate: closing.tax.rate, homesAfter: hh.homesAfter,
    });
    const v = E.verdict({
      fundingGap, burden: monthlyIncome > 0 ? monthlyPayment / monthlyIncome : Infinity,
      stressBurden: stress.rateShocks[2].burden,
      buyWinProb: livesIn && base.feasible ? mc.buyWinProb : null,
      breakeven, expectedAppreciation: i.appreciation,
      emergencyMonths: i.monthlyLiving > 0 ? Math.max(0, leftover) / i.monthlyLiving : 99,
      jeonseRatio, pir: i.annualIncome > 0 ? i.price / i.annualIncome : null,
      gapExcess: gap ? gap.excess : null, gapEquity: gap ? gap.equity : null,
    });
    // 필수 조건 점검의 차단 항목은 점수와 무관하게 매수 불가
    if (assess.verdict === '불가') { v.label = '매수 불가 — 조건 차단'; v.tone = 'critical'; }
    else if (v.tone === 'good' && assess.flags.some((f) => f.level === 'warn' && f.category !== '규제')) { v.label = '조건부 검토'; v.tone = 'warning'; }
    return { i, hh, r, cond, livesIn, tenantDeposit, gap, assess, afford, sens, limit, loan, termYears, publicPrice, closing, holding, monthlyPayment, need, fundingGap, leftover, stress, sim, base, breakeven, mc, policyLoans, jeonseRatio, v };
  }

  // ── 렌더 ──────────────────────────────────────────────────────────────
  function renderVerdict(c) {
    const v = c.v;
    const el = $('verdict');
    el.dataset.tone = v.tone;
    el.innerHTML = `
      <div class="score" aria-label="종합 점수 ${v.score}점"><b>${v.score}</b><span>/ 100</span></div>
      <div>
        <h2>${esc(v.label)}</h2>
        <p class="sub">${esc(c.i.purpose)} · ${esc(c.r.name)} ${esc(c.i.propertyType)} · ${esc(won(c.i.price))} · 전용 ${c.i.areaM2}㎡ · ${c.i.years}년 ${c.livesIn ? '거주' : '보유'} 가정</p>
        <ul class="checklist">${v.checks.map((k) => `<li>${chip(k.status)}<span>${esc(k.label)}</span><span class="d">${esc(k.detail)}</span></li>`).join('')}</ul>
        ${verdictExtras(c.assess)}
      </div>`;
  }
  const FLAG = { block: ['critical', '차단'], warn: ['warning', '주의'], info: ['neutral', '정보'] };
  function verdictExtras(a) {
    const scores = Object.entries(a.scores).map(([k, sc]) => `<span>${k} 점수 <b>${sc.score}</b>/100</span>`).join('');
    const hard = a.flags.filter((f) => f.level !== 'info');
    const list = hard.length ? `<ul class="flags" style="margin-top:12px">${hard.map((f) => `<li>${chip(FLAG[f.level][0], FLAG[f.level][1])}<span class="cat">${esc(f.category)}</span><span class="msg">${esc(f.message)}</span></li>`).join('')}</ul>` : '';
    return (scores ? `<div class="scores">${scores}<span>조건 점검 ${a.flags.filter((f) => f.level === 'block').length}건 차단 · ${a.flags.filter((f) => f.level === 'warn').length}건 주의</span></div>` : '') + list;
  }

  // ── 조건 점검 ─────────────────────────────────────────────────────────
  function checklistCard(list) {
    const order = ['목적', '지역', '입지', '주택유형', '확보자금', '매매단가', '필요자금', '재건축', '시기'];
    const rows = list.slice().sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
      .map((r) => `<tr><td>${esc(r.category)}</td><td>${esc(r.label)}</td><td>${esc(r.scope)}</td><td>${r.done ? chip('good', '입력됨') : chip('critical', '누락')}</td><td class="muted">${esc(r.why)}</td></tr>`).join('');
    const done = list.filter((r) => r.done).length;
    return `<div class="card">
      <h3>필수 조건 ${done} / ${list.length}</h3>
      <p class="muted">목적과 상황(재건축·세입자 승계)에 따라 필요한 항목이 달라집니다. 하나라도 비면 판정하지 않습니다.</p>
      <div class="tbl-wrap"><table><thead><tr><th>분류</th><th>항목</th><th>적용</th><th>상태</th><th>필요한 이유</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }
  function renderConditions(c) {
    const a = c.assess, u = a.unit;
    const flags = a.flags.length
      ? `<ul class="flags">${a.flags.map((f) => `<li>${chip(FLAG[f.level][0], FLAG[f.level][1])}<span class="cat">${esc(f.category)}</span><span class="msg">${esc(f.message)}</span></li>`).join('')}</ul>`
      : '<p class="muted">걸리는 규제·조건이 없습니다.</p>';
    const scoreCard = Object.entries(a.scores).map(([k, sc]) => `
      <div class="card">
        <h3>${k} 점수 ${sc.score} / 100</h3>
        <div class="tbl-wrap"><table><tbody>
          ${Object.entries(sc.parts).map(([p, v]) => `<tr><td>${esc(p)}</td><td class="n">${v}</td></tr>`).join('')}
          <tr><td>호재·악재·유형 보정</td><td class="n">${sc.adj >= 0 ? '+' : ''}${sc.adj}</td></tr>
        </tbody></table></div>
      </div>`).join('');
    const t = a.timing;
    $('tab-conditions').innerHTML = `
      <div class="card">
        <h3>규제·조건 판정: ${esc({ 불가: '불가', 조건부: '조건부 진행', 진행가능: '진행 가능' }[a.verdict])}</h3>
        <p class="muted">${esc(a.region.name)} · ${a.region.regulated ? '규제지역' : '비규제'} · ${a.region.capital ? '수도권' : '지방'} · ${a.region.landPermit ? '토지거래허가 대상' : '토지거래허가 비대상'} · ${esc(c.i.propertyType)} · ${c.livesIn ? '실거주' : '비거주(임대)'}</p>
        ${flags}
      </div>
      <div class="grid2">
        <div class="card">
          <h3>매매단가</h3>
          <div class="tbl-wrap"><table><tbody>
            <tr><td>전용 ㎡당</td><td class="n">${esc(won(u.perM2))}</td></tr>
            <tr><td>전용 평당 (3.3058㎡)</td><td class="n">${esc(won(u.perPyeong))}</td></tr>
            ${u.recentAvg != null ? `<tr><td>최근 실거래 평균 (${c.cond.recentTrades.length}건)</td><td class="n">${esc(won(u.recentAvg))}</td></tr><tr class="hl"><td>실거래 평균 대비</td><td class="n">${u.premium >= 0 ? '+' : ''}${pct(u.premium)}</td></tr>` : ''}
            ${u.jeonseRatio != null ? `<tr><td>전세가율</td><td class="n">${pct(u.jeonseRatio)}</td></tr><tr><td>갭 (매매 − 전세)</td><td class="n">${esc(won(u.gap))}</td></tr>` : ''}
          </tbody></table></div>
          <p class="muted" style="font-size:12px">평당가는 전용면적 기준입니다. 광고의 공급면적 평당가보다 높게 나옵니다.</p>
        </div>
        <div class="card">
          <h3>필요자금</h3>
          <div class="tbl-wrap"><table><tbody>
            <tr><td>매매가</td><td class="n">${esc(won(c.i.price))}</td></tr>
            <tr><td>취득 부대비용</td><td class="n">${esc(won(c.closing.total))}</td></tr>
            ${c.livesIn ? `<tr><td>이사비</td><td class="n">${esc(won(c.i.moveCost))}</td></tr>` : ''}
            <tr><td>− 주택담보대출</td><td class="n">${esc(won(-c.loan))}</td></tr>
            ${c.tenantDeposit ? `<tr><td>− 전세보증금 (세입자)</td><td class="n">${esc(won(-c.tenantDeposit))}</td></tr>` : ''}
            <tr class="total"><td>필요 자기자금</td><td class="n">${esc(won(c.need))}</td></tr>
            <tr><td>확보 자금</td><td class="n">${esc(won(c.i.cash))}</td></tr>
            <tr class="hl"><td>${c.fundingGap > 0 ? '부족' : '여유'}</td><td class="n ${c.fundingGap > 0 ? 'neg' : 'pos'}">${esc(won(Math.abs(c.fundingGap)))}</td></tr>
          </tbody></table></div>
        </div>
        ${scoreCard}
        <div class="card">
          <h3>시기</h3>
          ${t.events.length ? `<ul class="timeline">${t.events.map((e) => `<li><span class="date">${esc(e.date)}</span><span>${esc(e.label)}</span></li>`).join('')}</ul>` : '<p class="muted">매수 예정 시점을 입력하세요.</p>'}
        </div>
      </div>
      ${freshnessCard()}
      ${checklistCard(a.checklist)}`;
  }
  function freshnessCard() {
    const reg = liveState.regulation;
    let head;
    if (!liveState.available) head = `${chip('warning', '미확인')} 로컬 서버 없이 열려 있어 최신 공공데이터를 조회하지 못했습니다. 규정 기준일 ${esc(P.asOf)} 값으로 계산합니다.`;
    else if (!reg) head = `${chip('warning', '확인 실패')} 규제 변경 확인 실패: ${esc(liveState.regulationError || '조회 중')}`;
    else if (reg.changes.some((x) => !x.upcoming)) head = `${chip('critical', '변경 감지')} 기준일 이후 규제 관련 변경이 있습니다. 아래 항목을 확인하세요.`;
    else head = `${reg.ok ? chip('good', '최신') : chip('warning', '일부 미확인')} ${fmtTime(reg.checkedAt)} 확인 · 기준일 ${esc(reg.asOf)} 이후 규제 변경 ${reg.changes.filter((x) => !x.upcoming).length}건`;
    const changes = reg && reg.changes.length
      ? `<ul class="plain">${reg.changes.slice(0, 10).map((x) => `<li>${esc(x.date || '')} · ${esc(x.kind)} · ${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}</li>`).join('')}</ul>` : '';
    const rows = liveState.sources.map((src) => `<tr><td>${esc(src.name)}</td><td>${src.configured ? (src.last ? (src.last.ok ? chip('good', '정상') : chip('critical', '실패')) : chip('neutral', '대기')) : chip('warning', '설정 필요')}</td><td class="muted">${src.last ? esc(fmtTime(src.last.at)) + (src.last.detail ? ' · ' + esc(src.last.detail) : '') : esc(src.configured ? '' : src.how)}</td></tr>`).join('');
    return `<div class="card">
      <h3>데이터 최신성</h3>
      <p>${head}</p>
      ${changes}
      ${rows ? `<div class="tbl-wrap"><table><thead><tr><th>출처</th><th>상태</th><th>최근 조회</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
      ${liveState.available ? '<div class="row"><button type="button" class="ghost" id="regRefresh">지금 다시 확인</button></div>' : ''}
    </div>`;
  }

  // ── 재건축·이주비 ─────────────────────────────────────────────────────
  function renderRecon(c) {
    const r = c.assess.recon;
    $('reconTabBtn').hidden = !r;
    if (!r) { $('tab-recon').innerHTML = ''; return; }
    const reloc = c.tenantDeposit ? '세입자 보증금 반환' : c.livesIn ? '공사기간 임시거주 보증금' : '—';
    const picked = liveState.redevPicked && liveState.redevPicked.currentStage === r.stage ? liveState.redevPicked : null;
    const steps = picked ? picked.timeline : P.RECON.stages.slice(1).map((st) => ({ stage: st, label: P.RECON.stageLabels[st] || st, date: st === r.stage ? r.stageDate : null, current: st === r.stage }));
    const timeline = `<div class="card">
        <h3>재건축 진행 단계${picked ? ` · ${esc(picked.name)}` : ''}</h3>
        <p class="muted">${picked ? `출처 ${esc(liveState.redev.source)} · ${esc(fmtTime(liveState.redev.fetchedAt))} 조회` : '정비사업 검색으로 불러오면 단계별 날짜가 채워집니다.'}${r.elapsedInStage ? ` · 현재 단계 ${r.elapsedInStage.toFixed(1)}년 경과 반영` : ''}</p>
        <ol class="steps">${steps.map((st, k) => `<li class="${st.current ? 'current' : st.done ? 'done' : ''}"><span class="no">${k + 1}</span><span>${st.current ? '<span class="now">현재 단계</span>' : ''}${esc(st.label)}</span><span class="date">${st.date ? esc(st.date) : ''}</span></li>`).join('')}</ol>
      </div>`;
    $('tab-recon').innerHTML = `
      <div class="grid2">
        <div class="card">
          <h3>${esc(P.RECON.stageLabels[r.stage] || r.stage)} 단계 · 신축 입주까지 약 ${r.yearsToMoveIn}년</h3>
          <p class="muted">이주 시점: ${esc(r.relocationTiming)}</p>
          <p>${r.transferBlocked ? chip('critical', '조합원 지위 승계 불가') : chip('good', '조합원 지위 승계 가능')}</p>
          ${r.expectedGain != null ? `<p class="big ${r.expectedGain >= 0 ? 'pos' : 'neg'}">${esc(won(r.expectedGain, { sign: true }))}</p><p class="muted">예상 차익 = 신축 시세 − (매수 총비용 + 분담금 + 입주까지 이자)</p>` : '<p class="muted">신축 예상 시세를 넣으면 예상 차익을 계산합니다.</p>'}
        </div>
        <div class="card">
          <h3>이주비로 돈이 도는 순서</h3>
          <div class="tbl-wrap"><table><tbody>
            <tr><td>종전자산 감정가 × 이주비 LTV ${pct(r.relocationLtv, 0)}</td><td class="n">${esc(won(r.relocationBase))}</td></tr>
            <tr><td>이주비 대출</td><td class="n">${esc(won(r.relocationLoan))}</td></tr>
            <tr><td>− 이주 시점 주담대 잔액 (대환)</td><td class="n">${esc(won(-r.balanceAtRelocation))}</td></tr>
            <tr class="hl"><td>이주비 순수령</td><td class="n">${esc(won(r.netRelocation))}</td></tr>
            <tr><td>${reloc}</td><td class="n">${esc(won(c.tenantDeposit || r.tempDeposit || 0))}</td></tr>
            <tr class="total"><td>이주 때 필요한 자기자금</td><td class="n">${esc(won(Math.max(0, r.cashAtRelocation)))}</td></tr>
            <tr><td>그때까지 확보 예상 (매수 후 여유 + 연 저축)</td><td class="n">${esc(won(r.fundsAtRelocation))}</td></tr>
            <tr><td>입주 때 분담금</td><td class="n">${esc(won(r.contribution))}</td></tr>
            <tr><td>입주 때 확보 예상</td><td class="n">${esc(won(Math.max(0, r.fundsAtMoveIn)))}</td></tr>
            <tr class="total"><td>총 투입 자기자금 (매수 + 이주 + 입주)</td><td class="n">${esc(won(r.totalCashCommitted))}</td></tr>
            <tr><td>입주까지 대출 이자</td><td class="n">${esc(won(r.interest))}</td></tr>
          </tbody></table></div>
        </div>
      </div>
      ${timeline}
      <div class="card">
        <h3>확인할 것</h3>
        <ul class="plain">${r.blockers.concat(r.warnings, r.notes).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      </div>`;
  }

  // 필수 조건이 비었을 때
  function renderMissing(list, errors) {
    const el = $('verdict');
    el.dataset.tone = 'warning';
    const miss = list.filter((r) => !r.done);
    el.innerHTML = `<div class="score" aria-label="판정 보류"><b>—</b><span>보류</span></div>
      <div>
        <h2>입력 보완 필요</h2>
        <p class="sub">필수 조건 ${miss.length}개가 비어 있어 판정하지 않았습니다.</p>
        <ul class="flags">${miss.map((r) => `<li>${chip('critical', '누락')}<span class="cat">${esc(r.category)}</span><span class="msg">${esc(r.label)} — ${esc(r.why)}</span></li>`).join('')}${errors.map((e) => `<li>${chip('critical', '오류')}<span class="cat">입력</span><span class="msg">${esc(e)}</span></li>`).join('')}</ul>
      </div>`;
    $('kpis').innerHTML = '';
    $('tab-conditions').innerHTML = checklistCard(list);
    for (const id of ['loan', 'cost', 'compare', 'timing', 'risk', 'recon']) $('tab-' + id).innerHTML = '<div class="card"><p class="muted">필수 조건을 먼저 채우면 계산합니다. "조건 점검" 탭에서 빠진 항목을 확인하세요.</p></div>';
  }

  function renderKpis(c) {
    const k = [
      { k: '대출 가능액', v: won(c.loan), s: `한도 결정: ${c.limit.binding.label}` },
      { k: '필요 자기자본', v: won(c.need), s: c.fundingGap > 0 ? `${won(c.fundingGap)} 부족` : `여유 ${won(c.leftover)}` },
      { k: '월 상환액 (첫 달)', v: won(c.monthlyPayment), s: c.i.annualIncome > 0 ? `월 소득의 ${pct(c.monthlyPayment / (c.i.annualIncome / 12))}` : '소득 없음' },
      { k: '취득 부대비용', v: won(c.closing.total), s: `매매가의 ${pct(c.closing.total / c.i.price, 2)}` },
    ];
    $('kpis').innerHTML = k.map((x) => `<div class="kpi"><span class="k">${x.k}</span><span class="v">${esc(x.v)}</span><span class="s">${esc(x.s)}</span></div>`).join('');
  }

  function renderLoan(c) {
    const L = c.limit;
    const finite = L.candidates.filter((x) => isFinite(x.amount));
    const max = Math.max(...finite.map((x) => x.amount), 1);
    const bars = L.candidates.map((x) => `
      <div class="bar${x.key === L.binding.key ? ' binding' : ''}">
        <span class="name">${esc(x.label)}</span>
        <span class="track"><span class="fill" style="width:${isFinite(x.amount) ? (x.amount / max) * 100 : 100}%"></span></span>
        <span class="amt">${esc(won(x.amount))}</span>
      </div>`).join('');
    const pl = c.policyLoans.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.eligible ? chip('good', '대상') : chip('critical', '제외')}</td><td class="n">${esc(won(p.maxLoan))}</td><td>${esc(p.rate)}</td><td>${esc(p.reasons.join(', ') || '—')}</td></tr>`).join('');
    const zoneName = { regulated: '규제지역 (조정대상·투기과열)', capital: '수도권 비규제', local: '지방 비규제' }[L.zone];
    $('tab-loan').innerHTML = `
      <div class="card">
        <h3>세 가지 한도 중 가장 낮은 값이 대출 가능액</h3>
        <p class="muted">${esc(zoneName)} · DSR 심사금리 ${pct(L.dsrRate, 2)} (실금리 ${pct(c.i.rate, 2)} + 스트레스 ${pct(L.stress, 2)}) · 만기 ${L.termYears}년</p>
        <div class="bars">${bars}</div>
      </div>
        <div class="card">
          <h3>이 조건으로 살 수 있는 최고 가격</h3>
          <p class="big">${esc(won(c.afford.price))}${c.afford.capped ? ' 이상' : ''}</p>
          <p class="muted">보유 현금 ${esc(won(c.i.cash))} + 대출 ${esc(won(c.afford.loan))} − 취득 부대비용·이사비. 지금 매매가는 이 한도의 ${pct(c.i.price / c.afford.price, 0)}입니다.</p>
        </div>
        <div class="card">
          <h3>대출 조건·의무</h3>
          <ul class="plain">${L.conditions.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>특이 조건 없음</li>'}</ul>
        </div>
        <div class="card">
          <h3>정책모기지 간이 판정</h3>
          <div class="tbl-wrap"><table>
            <thead><tr><th>상품</th><th>판정</th><th class="n">최대 한도</th><th>금리</th><th>제외 사유</th></tr></thead>
            <tbody>${pl}</tbody></table></div>
          <p class="muted" style="font-size:12px">정책모기지도 LTV·지역 한도가 함께 적용됩니다. 최종 요건은 주택도시기금·한국주택금융공사에서 확인하세요.</p>
        </div>`;
  }

  function renderCost(c) {
    const cl = c.closing;
    const h = c.holding;
    const cgt = c.base.cgt;
    const rows = cl.items.filter((x) => x.amount > 0).map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${esc(won(x.amount))}</td></tr>`).join('');
    const hRows = [
      ['재산세' + (h.special ? ' (1주택 특례세율)' : ''), h.property], ['도시지역분', h.urban], ['지방교육세', h.propertyEdu],
      ['종합부동산세', h.cpt], ['농어촌특별세 (종부세분)', h.cptRural],
    ].map(([k, v]) => `<tr><td>${k}</td><td class="n">${esc(won(v))}</td></tr>`).join('');
    $('tab-cost').innerHTML = `
      <div class="grid2">
        <div class="card">
          <h3>살 때 한 번 내는 돈</h3>
          <p class="muted">취득세율 ${pct(cl.tax.rate, 2)}${cl.tax.heavy ? ' (다주택 중과)' : ''}${cl.tax.credit ? ` · 생애최초 감면 ${won(cl.tax.credit)}` : ''}</p>
          <div class="tbl-wrap"><table><tbody>${rows}<tr class="total"><td>합계</td><td class="n">${esc(won(cl.total))}</td></tr></tbody></table></div>
        </div>
        <div class="card">
          <h3>매년 내는 보유세 (첫해)</h3>
          <p class="muted">공시가격 추정 ${esc(won(c.publicPrice))} · 재산세 과세표준 ${esc(won(h.propertyBase))}</p>
          <div class="tbl-wrap"><table><tbody>${hRows}<tr class="total"><td>연간 합계</td><td class="n">${esc(won(h.total))}</td></tr></tbody></table></div>
        </div>
        <div class="card">
          <h3>${c.i.years}년 뒤 팔 때 양도세</h3>
          <p class="muted">예상 매도가 ${esc(won(c.base.salePrice))} (연 ${pct(c.i.appreciation)} 가정) · ${esc(cgt.note)}</p>
          <div class="tbl-wrap"><table><tbody>
            <tr><td>양도차익 (필요경비 차감)</td><td class="n">${esc(won(cgt.gain))}</td></tr>
            <tr><td>과세 대상 차익</td><td class="n">${esc(won(cgt.taxableGain))}</td></tr>
            <tr><td>장기보유특별공제 ${cgt.ltRate ? pct(cgt.ltRate, 0) : ''}</td><td class="n">${esc(won(cgt.ltDeduction))}</td></tr>
            <tr><td>양도소득세</td><td class="n">${esc(won(cgt.tax))}</td></tr>
            <tr><td>지방소득세</td><td class="n">${esc(won(cgt.local))}</td></tr>
            <tr class="total"><td>합계</td><td class="n">${esc(won(cgt.total))}</td></tr>
          </tbody></table></div>
        </div>
        <div class="card">
          <h3>매도 시 중개보수</h3>
          <p class="big">${esc(won(c.base.sellFee))}</p>
          <p class="muted">상한요율 기준. 실제 요율은 협의로 낮출 수 있습니다.</p>
        </div>
      </div>`;
  }

  function renderGap(c) {
    const g = c.gap;
    $('tab-compare').innerHTML = `
      <div class="card">
        <h3>비거주 투자 — 같은 돈을 연 ${pct(c.i.invReturn)}로 굴렸을 때와 비교</h3>
        <p class="muted">자기자본 ${esc(won(g.equity))} (매매가 − 전세보증금${c.loan ? ' − 대출' : ''} + 부대비용). 보증금 증액분은 받아서 굴리고, 보유세·이자는 매년 냅니다. 마지막 해는 매도 비용·양도세·보증금 반환까지 뺀 값입니다.</p>
        <div class="legend"><span><i style="--c:var(--s-buy)"></i>매수 투자</span><span><i style="--c:var(--s-rent)"></i>대안 투자</span></div>
        <div id="nwChart"></div>
      </div>
      <div class="grid2">
        <div class="card">
          <h3>${c.i.years}년 뒤 대안 대비 초과수익</h3>
          <p class="big ${g.excess >= 0 ? 'pos' : 'neg'}">${esc(won(g.excess, { sign: true }))}</p>
          <div class="tbl-wrap"><table><tbody>
            <tr><td>매수 투자 최종</td><td class="n">${esc(won(g.final))}</td></tr>
            <tr><td>대안 투자 최종</td><td class="n">${esc(won(g.alt))}</td></tr>
            <tr><td>연평균 수익률 (자기자본 기준)</td><td class="n">${g.cagr == null ? '—' : pct(g.cagr, 2)}</td></tr>
            <tr><td>예상 매도가</td><td class="n">${esc(won(g.salePrice))}</td></tr>
            <tr><td>양도세 (비거주${g.cgt.note ? ' · ' + esc(g.cgt.note) : ''})</td><td class="n">${esc(won(g.cgt.total))}</td></tr>
          </tbody></table></div>
        </div>
        <div class="card">
          <h3>비거주 매수에서 달라지는 점</h3>
          <ul class="plain">
            <li>수도권·규제지역은 주담대 6개월 전입의무 때문에 대출 없이 전세보증금으로 잔금을 치러야 합니다.</li>
            <li>규제지역에서 취득한 집은 2년을 살아야 1세대1주택 비과세를 받습니다. 비거주면 양도세가 과세됩니다.</li>
            <li>역전세(보증금 하락) 때는 차액을 돌려줘야 하므로 여유자금이 필요합니다.</li>
          </ul>
        </div>
      </div>`;
    C.line($('nwChart'), {
      series: [
        { name: '매수 투자', color: '--s-buy', values: g.series.map((p) => ({ x: p.year, y: p.invest })) },
        { name: '대안 투자', color: '--s-rent', values: g.series.map((p) => ({ x: p.year, y: p.alt })) },
      ],
      xFmt: (x) => `${x}년`, yFmt: (v, full) => (full ? won(v) : won(v, { short: true })), ariaLabel: '매수 투자와 대안 투자의 연도별 자산',
    });
  }

  function renderCompare(c) {
    if (!c.livesIn) { renderGap(c); return; }
    const b = c.base, mc = c.mc;
    const tab = $('tab-compare');
    if (!b.feasible) {
      tab.innerHTML = `<div class="card"><h3>비교할 수 없습니다</h3><p class="muted">${b.buyUpfront + c.i.moveCost > c.i.cash ? `매수에 필요한 현금 ${won(b.buyUpfront + c.i.moveCost)}이 보유 현금보다 많습니다. 대출을 늘리거나 가격을 낮춰 보세요.` : `임차 보증금 자기부담 ${won(b.rentUpfront)}이 보유 현금보다 많습니다.`}</p></div>`;
      return;
    }
    const diffCls = b.diff >= 0 ? 'pos' : 'neg';
    tab.innerHTML = `
      <div class="card">
        <h3>순자산 추이 — 같은 현금, 같은 월 주거비 예산</h3>
        <p class="muted">주거비가 덜 드는 쪽이 매달 차액을 연 ${pct(c.i.invReturn)}로 투자한다고 봅니다. 매수 쪽은 집값 − 대출잔액, 마지막 해는 매도 비용과 양도세까지 뺀 값입니다.</p>
        <div class="legend"><span><i style="--c:var(--s-buy)"></i>매수</span><span><i style="--c:var(--s-rent)"></i>${c.i.rentMonthly > 0 ? '월세' : '전세'}</span></div>
        <div id="nwChart"></div>
      </div>
      <div class="grid2">
        <div class="card">
          <h3>${c.i.years}년 뒤 순자산 차이 (기본 가정)</h3>
          <p class="big ${diffCls}">${esc(won(b.diff, { sign: true }))}</p>
          <div class="tbl-wrap"><table><tbody>
            <tr><td>매수 최종 순자산</td><td class="n">${esc(won(b.buyFinal))}</td></tr>
            <tr><td>임차 최종 순자산</td><td class="n">${esc(won(b.rentFinal))}</td></tr>
            <tr><td>누적 주거비용 — 매수 (이자·보유세·수선비)</td><td class="n">${esc(won(b.buyHousingCost))}</td></tr>
            <tr><td>누적 주거비용 — 임차 (월세·대출이자·보증료·이사)</td><td class="n">${esc(won(b.rentHousingCost))}</td></tr>
            <tr class="hl"><td>손익분기 연 집값 상승률</td><td class="n">${c.breakeven == null ? '25% 초과' : pct(c.breakeven, 2)}</td></tr>
          </tbody></table></div>
        </div>
        <div class="card">
          <h3>몬테카를로 ${mc.runs.toLocaleString()}회 — 매수가 유리할 확률 ${pct(mc.buyWinProb, 0)}</h3>
          <p class="muted">매년 집값 상승률 ${pct(c.i.appreciation)} ± ${pct(c.i.appreciationVol)}, 투자수익률 ${pct(c.i.invReturn)} ± ${pct(c.i.invVol)} 무작위 경로. 순자산 차이(매수 − 임차) 분포입니다.</p>
          <div class="legend"><span><i style="--c:var(--s-buy)"></i>매수 유리</span><span><i style="--c:var(--s-rent)"></i>임차 유리</span></div>
          <div id="mcChart"></div>
          <p class="muted" style="font-size:12px">하위 10% ${esc(won(mc.diff.p10, { sign: true }))} · 중앙값 ${esc(won(mc.diff.p50, { sign: true }))} · 상위 10% ${esc(won(mc.diff.p90, { sign: true }))}</p>
        </div>
      </div>`;
    if (c.sens) tab.insertAdjacentHTML('beforeend', tornado(c.sens));
    const yFmt = (v, full) => (full ? won(v) : won(v, { short: true }));
    C.line($('nwChart'), {
      series: [
        { name: '매수', color: '--s-buy', values: b.series.map((p) => ({ x: p.year, y: p.year === c.i.years ? b.buyFinal : p.buy })) },
        { name: c.i.rentMonthly > 0 ? '월세' : '전세', color: '--s-rent', values: b.series.map((p) => ({ x: p.year, y: p.rent })) },
      ],
      xFmt: (x) => `${x}년`, yFmt, ariaLabel: '매수와 임차의 연도별 순자산',
    });
    C.histogram($('mcChart'), {
      bins: mc.histogram, xFmt: (v) => won(v, { short: true }),
      colorFor: (bin) => ((bin.from + bin.to) / 2 >= 0 ? '--s-buy' : '--s-rent'),
      ariaLabel: '순자산 차이 분포',
    });
  }

  // 가정 하나를 흔들 때 매수−임차 차이 변화 (양수 = 매수에 유리)
  function tornado(sens) {
    const max = Math.max(...sens.rows.flatMap((r) => [Math.abs(r.low), Math.abs(r.high)]), 1);
    const side = (v) => {
      const w = (Math.abs(v) / max) * 50;
      return `<span class="tn-bar" style="${v >= 0 ? `left:50%;width:${w}%;background:var(--s-buy);border-radius:0 4px 4px 0` : `right:50%;width:${w}%;background:var(--s-rent);border-radius:4px 0 0 4px`}"></span>`;
    };
    const step = (r) => (r.unit === '년' ? `±${r.step}년` : `±${(r.step * 100).toFixed(r.step < 0.01 ? 1 : 0)}%p`);
    const rows = sens.rows.map((r) => `
      <div class="tn-row">
        <span class="tn-label">${esc(r.label)} <span class="unit">${step(r)}</span></span>
        <span class="tn-track" title="낮추면 ${esc(won(r.low, { sign: true }))}, 높이면 ${esc(won(r.high, { sign: true }))}">${side(r.low)}${side(r.high)}</span>
        <span class="tn-vals num">${esc(won(r.low, { sign: true, short: true }))} / ${esc(won(r.high, { sign: true, short: true }))}</span>
      </div>`).join('');
    return `<div class="card">
      <h3>어떤 가정이 결론을 가장 크게 흔드나</h3>
      <p class="muted">가정 하나를 낮출 때 / 높일 때 매수−임차 순자산 차이가 얼마나 변하는지입니다. 위쪽 항목일수록 신중하게 가정하세요.</p>
      <div class="legend"><span><i style="--c:var(--s-buy)"></i>매수 쪽으로 이동</span><span><i style="--c:var(--s-rent)"></i>임차 쪽으로 이동</span></div>
      <div class="tn">${rows}</div>
    </div>`;
  }

  function renderRisk(c) {
    const s = c.stress;
    const rate = s.rateShocks.map((r) => {
      const st = r.burden <= 0.3 ? 'good' : r.burden <= 0.4 ? 'warning' : 'critical';
      return `<tr><td>${r.shock ? '+' + (r.shock * 100) + '%p' : '현재'}</td><td class="n">${pct(r.rate, 2)}</td><td class="n">${esc(won(r.payment))}</td><td class="n">${pct(r.burden)}</td><td>${chip(st)}</td></tr>`;
    }).join('');
    const price = s.priceShocks.map((p) => {
      const st = p.equity < 0 ? 'critical' : p.ltv > 0.7 ? 'serious' : p.ltv > 0.5 ? 'warning' : 'good';
      return `<tr><td>${p.shock ? (p.shock * 100) + '%' : '현재'}</td><td class="n">${esc(won(p.value))}</td><td class="n">${esc(won(p.equity))}</td><td class="n">${pct(p.ltv)}</td><td>${chip(st)}</td></tr>`;
    }).join('');
    const jr = c.jeonseRatio;
    const rentRisk = c.i.rentDeposit > 0 && c.i.rentMonthly === 0 && jr != null
      ? `<li>임차 대안이 전세라면 보증금 ${won(c.i.rentDeposit)}은 집값의 ${pct(c.i.rentDeposit / c.i.price)}입니다. ${c.i.rentDeposit / c.i.price >= P.RENT.jeonseRiskRatio ? '<b>80% 이상 — 깡통전세 위험, 전세보증보험 필수</b>' : '전세보증보험 가입을 전제로 계산했습니다.'}</li>` : '';
    $('tab-risk').innerHTML = `
      <div class="grid2">
        <div class="card">
          <h3>금리가 오르면 월 상환액</h3>
          <p class="muted">대출 ${esc(won(c.loan))} · ${c.i.rateType === 'fixed' ? '완전 고정금리라면 해당 없음' : '변동·혼합형은 재산정 시점에 반영'}</p>
          <div class="tbl-wrap"><table><thead><tr><th>시나리오</th><th class="n">금리</th><th class="n">월 상환</th><th class="n">소득 대비</th><th>판정</th></tr></thead><tbody>${rate}</tbody></table></div>
        </div>
        <div class="card">
          <h3>집값이 떨어지면 내 지분</h3>
          <p class="muted">대출잔액이 그대로일 때 자기지분과 담보비율</p>
          <div class="tbl-wrap"><table><thead><tr><th>시나리오</th><th class="n">집값</th><th class="n">내 지분</th><th class="n">LTV</th><th>판정</th></tr></thead><tbody>${price}</tbody></table></div>
        </div>
      </div>
      <div class="card">
        <h3>가격 수준 점검</h3>
        <ul class="plain">
          ${c.i.annualIncome > 0 ? `<li>PIR (매매가 ÷ 연소득) ${(c.i.price / c.i.annualIncome).toFixed(1)}배 — 서울 중위 가구는 대체로 10배 이상입니다.</li>` : ''}
          ${jr != null ? `<li>전세가율 ${pct(jr)} — 전세가는 거주 가치, 나머지 ${pct(1 - jr)}는 미래 상승 기대가 반영된 몫입니다.</li>
          <li>임대수익률 환산 (전세 × 전월세전환율 4.5% ÷ 매매가) ${pct((c.i.jeonsePrice * 0.045) / c.i.price, 2)} — 대출 금리 ${pct(c.i.rate, 2)}${(c.i.jeonsePrice * 0.045) / c.i.price < c.i.rate ? '보다 낮아 보유 자체의 현금 수익은 불리합니다.' : ' 이상입니다.'}</li>` : ''}
          ${rentRisk}
          ${c.r.landPermit ? '<li>토지거래허가구역 — 허가 후 2년 실거주 의무가 있어 사정이 바뀌어도 바로 임대로 돌릴 수 없습니다.</li>' : ''}
        </ul>
      </div>`;
  }

  // 실거래가
  let txs = null;
  function renderMarket(c) {
    const out = $('marketOut');
    if (!txs) { out.innerHTML = ''; return; }
    const comp = E.comparables(txs, c.i.areaM2, 3);
    if (!comp) { out.innerHTML = `<div class="card"><p class="muted">전용 ${c.i.areaM2}㎡ ±3㎡ 거래가 2건 미만입니다. 면적을 확인하세요.</p></div>`; return; }
    const t0 = Date.parse(comp.points[0].t.date);
    const nowX = (Date.now() - t0) / (365.25 * 864e5);
    const gap = c.i.price / comp.estimate - 1;
    const st = Math.abs(gap) <= 0.05 ? 'good' : gap > 0.1 ? 'critical' : gap > 0.05 ? 'warning' : 'good';
    out.innerHTML = `
      <div class="grid2">
        <div class="card">
          <h3>추세 기준 적정가 (전용 ${c.i.areaM2}㎡)</h3>
          <p class="big">${esc(won(comp.estimate))}</p>
          <p class="muted">± ${esc(won(comp.band))} (추세선 잔차 1σ) · 최근 5건 중앙값 ${esc(won(comp.recentMedian))} · ㎡당 가격 연 ${pct(comp.annualTrend)} 추세 · 거래 ${comp.count}건</p>
          <p>입력한 매매가는 추세 대비 ${chip(st, (gap >= 0 ? '+' : '') + pct(gap))}</p>
        </div>
        <div class="card">
          <h3>㎡당 거래가격</h3>
          <div class="legend"><span><i style="--c:var(--s-buy)"></i>실거래 · 추세선</span><span><i style="--c:var(--s-rent)"></i>입력 매매가</span></div>
          <div id="scChart"></div>
        </div>
      </div>`;
    C.scatter($('scChart'), {
      points: comp.points.map((p) => ({ x: p.x, y: p.y, tip: `${esc(p.t.date)} · ${esc(p.t.name || '')} ${p.t.floor ?? ''}층<br><b>${esc(won(p.t.price))}</b> (${p.t.area}㎡)` })),
      trend: (x) => comp.intercept + comp.slope * x,
      marker: { x: nowX, y: c.i.price / c.i.areaM2, label: '입력가' },
      xFmt: (x) => String(new Date(t0 + x * 365.25 * 864e5).getFullYear()),
      yFmt: (v) => `${Math.round(v / MAN).toLocaleString()}만`,
      ariaLabel: '제곱미터당 실거래가격 추이',
    });
  }
  function loadCsv(text) {
    try {
      txs = E.parseTransactions(text);
      if (!txs.length) throw new Error('유효한 거래가 없습니다');
    } catch (err) {
      txs = null;
      $('marketOut').innerHTML = `<div class="card"><p class="muted">CSV를 읽지 못했습니다: ${esc(err.message)}. 국토부 실거래가 공개시스템의 아파트 매매 CSV 형식인지 확인하세요.</p></div>`;
      return;
    }
    update();
  }
  function sampleCsv() {
    // 예시: 가상의 84㎡ 단지 36개월 거래 (실제 데이터 아님)
    const rows = ['"NO","시군구","단지명","전용면적(㎡)","계약년월","계약일","거래금액(만원)","층","해제사유발생일"'];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 42; k++) {
      const d = new Date(2023, 9 + Math.floor(k * 0.85), 1 + Math.floor(rnd() * 27));
      const yrs = (d - new Date(2023, 9, 1)) / (365.25 * 864e5);
      const area = rnd() < 0.8 ? 84.9 : 59.9;
      const perM2 = 1050 * MAN * Math.pow(1.045, yrs) * (0.94 + rnd() * 0.12);
      const price = Math.round((perM2 * area) / MAN / 100) * 100;
      rows.push(`${k + 1},"예시시 예시동","예시 단지",${area},"${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}","${d.getDate()}","${price.toLocaleString()}",${1 + Math.floor(rnd() * 20)},"-"`);
    }
    return rows.join('\n');
  }

  function renderNotes() {
    $('notes').innerHTML = [`규정 기준일 ${P.asOf}.`, ...P.notes, '이 계산은 의사결정 참고용이며 세무·대출 확정 판단은 전문가와 금융기관에서 확인하세요.'].map((n) => `<p>${esc(n)}</p>`).join('');
  }

  // ── 매수 시점 ─────────────────────────────────────────────────────────
  function renderTiming(c) {
    const tab = $('tab-timing');
    if (!c.livesIn) {
      tab.innerHTML = '<div class="card"><h3>실거주 매수에서만 비교합니다</h3><p class="muted">매수 시점 비교는 기다리는 동안 임차하는 실거주 가구를 가정합니다. 목적을 거주 또는 거주+투자로 바꾸고 세입자 승계를 끄세요.</p></div>';
      return;
    }
    if (!c.base.feasible) {
      tab.innerHTML = '<div class="card"><h3>지금 매수 조건이 성립하지 않습니다</h3><p class="muted">자금 조달이 가능해야 시점을 비교할 수 있습니다.</p></div>';
      return;
    }
    const i = c.i, hh = c.hh;
    const round = (x) => Math.round(x * 1e4) / 1e4;
    const scenarios = [...new Set([-0.02, 0, i.appreciation, i.appreciation + 0.03].map(round))].sort((a, b) => a - b);
    const loanFor = (price, rate) => {
      const max = E.loanLimit({
        price, regionId: i.regionId, buyerType: i.buyerType, annualIncome: i.annualIncome, existingAnnualDebtService: i.existingDebt,
        rate, termYears: i.termYears, method: i.method, rateType: i.rateType, lender: i.lender,
      }).amount;
      return i.loanWanted != null ? Math.min(i.loanWanted, max) : max;
    };
    const closingFor = (price) => E.closingCosts({
      price, regionId: i.regionId, homesAfter: hh.homesAfter, temporaryTwo: hh.temporaryTwo, areaOver85: i.areaM2 > 85,
      firstTime: i.buyerType === 'first', publicPrice: price * i.publicRatio, bondDiscount: i.bondDiscount, vat: i.vat,
    }).total;
    const t = E.timingCompare(c.sim, { waits: [0, 1, 2, 3], scenarios, rateChange: i.rateChange, loanFor, closingFor });
    const best = scenarios.map((_, k) => Math.max(...t.grid.filter((r) => r.cells[k].feasible).map((r) => r.cells[k].final)));
    const head = scenarios.map((g) => `<th class="n">연 ${pct(g)}${round(g) === round(i.appreciation) ? ' (기본)' : ''}</th>`).join('');
    const rows = t.grid.map((r) => `<tr><td>${r.wait ? `${r.wait}년 뒤 매수` : '지금 매수'}</td>${r.cells.map((cell, k) => {
      if (!cell.feasible) return '<td class="n">자금 부족</td>';
      const d = cell.final - t.grid[0].cells[k].final;
      return `<td class="n${cell.final === best[k] ? ' best' : ''}">${esc(won(cell.final, { short: true }))}${r.wait ? `<br><span class="${d >= 0 ? 'pos' : 'neg'}" style="font-size:11px">${esc(won(d, { sign: true, short: true }))}</span>` : ''}</td>`;
    }).join('')}</tr>`).join('');
    const baseCol = scenarios.findIndex((g) => round(g) === round(i.appreciation));
    const winner = t.grid.filter((r) => r.cells[baseCol].feasible).reduce((a, b) => (b.cells[baseCol].final > a.cells[baseCol].final ? b : a));
    tab.innerHTML = `
      <div class="card">
        <h3>기본 가정에서는 ${winner.wait ? `${winner.wait}년 기다렸다 사는 편` : '지금 사는 편'}이 유리합니다</h3>
        <p class="muted">${i.years}년 뒤 같은 시점의 순자산입니다. 기다리는 동안은 임차하며 차액을 투자하고, 매수 시점의 집값·대출한도·부대비용을 다시 계산합니다. 대기 중 금리 변화 ${i.rateChange >= 0 ? '+' : ''}${(i.rateChange * 100).toFixed(2)}%p 가정(입력 패널에서 변경).</p>
        <div class="tbl-wrap"><table>
          <thead><tr><th>시나리오 (연 집값 상승률)</th>${head}</tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="muted" style="font-size:12px">강조된 칸이 각 시나리오에서 가장 유리한 시점입니다. 작은 숫자는 지금 매수 대비 차이입니다.</p>
      </div>`;
  }

  // ── 실거래가 자동 조회 ─────────────────────────────────────────────────
  let lawdTouched = false;
  async function initApi() {
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      const r = await fetch('api/health');
      if (!r.ok) return;
      const h = await r.json();
      if (!h.ok) return;
      $('apiForm').hidden = false;
      $('apiKeyWrap').hidden = !!h.hasKey;
      $('apiStatus').textContent = h.hasKey
        ? '서버에 인증키가 설정되어 있습니다. 시군구와 단지명을 확인하고 불러오세요.'
        : '공공데이터포털(data.go.kr)에서 "국토교통부_아파트 매매 실거래가 자료"를 활용신청하고 받은 일반 인증키를 입력하세요. 키는 이 브라우저에만 저장됩니다.';
      try { $('apiKey').value = localStorage.getItem('rea-api-key') || ''; } catch (_) { /* 무시 */ }
      if (h.live) {
        liveState.available = true;
        await refreshRegulation(false);
        setInterval(() => refreshRegulation(false), 30 * 60e3); // 열어둔 동안 30분마다 다시 확인
        if ($('parcelAddress').value.trim()) fetchLandUse(false);
      }
    } catch (_) { /* 서버 없음: CSV만 사용 */ }
  }
  function recentMonths(n) {
    const out = [];
    const d = new Date();
    for (let k = 0; k < n; k++) {
      const x = new Date(d.getFullYear(), d.getMonth() - k, 1);
      out.push(`${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}`);
    }
    return out;
  }
  async function fetchRtms() {
    const lawd = $('apiLawd').value.trim();
    const status = $('apiStatus');
    if (!/^\d{5}$/.test(lawd)) { status.textContent = '시군구 코드는 5자리 숫자입니다 (예: 마포구 11440).'; return; }
    const key = $('apiKey').value.trim();
    try { if (key) localStorage.setItem('rea-api-key', key); } catch (_) { /* 무시 */ }
    const months = recentMonths(Number($('apiMonths').value));
    const btn = $('apiFetch');
    btn.disabled = true;
    const all = [];
    let done = 0, failed = null;
    const queue = months.slice();
    const worker = async () => {
      while (queue.length && !failed) {
        const ym = queue.shift();
        try {
          const res = await fetch(`api/rtms?lawd=${lawd}&ym=${ym}${key ? `&key=${encodeURIComponent(key)}` : ''}`);
          const text = await res.text();
          if (!res.ok) throw new Error(text);
          all.push(...E.parseRtmsXml(text).items);
        } catch (err) { failed = err; }
        status.textContent = `불러오는 중 ${++done} / ${months.length}개월`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    btn.disabled = false;
    if (failed) { status.textContent = `불러오지 못했습니다: ${failed.message}. 인증키와 활용신청 승인 여부를 확인하세요.`; return; }
    const name = $('apiName').value.trim();
    const picked = name ? all.filter((t) => t.name.includes(name)) : all;
    if (!picked.length) {
      const counts = {};
      all.forEach((t) => { counts[t.name] = (counts[t.name] || 0) + 1; });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, k]) => `${n}(${k})`).join(', ');
      status.textContent = `"${name}" 거래가 없습니다. 거래가 많은 단지: ${top || '없음'}`;
      return;
    }
    txs = picked.sort((a, b) => a.date.localeCompare(b.date));
    status.textContent = `${name ? `"${name}" ` : ''}거래 ${picked.length}건을 불러왔습니다 (해제거래 제외).`;
    update();
  }

  // ── 후보 비교 ─────────────────────────────────────────────────────────
  const CAND_KEY = 'rea-candidates-v1';
  let candidates = [];
  try { candidates = JSON.parse(localStorage.getItem(CAND_KEY) || '[]'); } catch (_) { candidates = []; }
  const persistCands = () => { try { localStorage.setItem(CAND_KEY, JSON.stringify(candidates)); } catch (_) { /* 무시 */ } };
  function saveCandidate() {
    const out = $('candOut');
    if (candidates.length >= 4) { out.insertAdjacentHTML('afterbegin', '<div class="card"><p class="muted">후보는 4개까지 저장됩니다. 하나를 지우고 다시 저장하세요.</p></div>'); return; }
    const V = formValues();
    const i = read(V);
    const name = $('candName').value.trim() || `${E.region(i.regionId).name} ${won(i.price, { short: true })}`;
    candidates.push({ id: Date.now(), name, values: V });
    $('candName').value = '';
    persistCands();
    renderCandidates();
  }
  function renderCandidates() {
    const out = $('candOut');
    if (!candidates.length) { out.innerHTML = '<div class="card"><p class="muted">저장된 후보가 없습니다. 조건을 입력하고 "현재 조건을 후보로 저장"을 누르세요.</p></div>'; return; }
    const res = candidates.map((cd) => {
      const cond = readConditions(cd.values);
      return { cd, r: COND.missing(cond).length || COND.valueErrors(cond).length ? null : compute(read(cd.values), cond) };
    }).filter((x) => x.r);
    if (!res.length) { out.innerHTML = '<div class="card"><p class="muted">저장된 후보에 빠진 필수 조건이 있어 비교할 수 없습니다. 불러와서 채운 뒤 다시 저장하세요.</p></div>'; return; }
    const metrics = [
      ['종합 점수', (r) => r.v.score, (x) => `${x}점`, 'high'],
      ['매매가', (r) => r.i.price, won, null],
      ['대출 가능액', (r) => r.loan, won, 'high'],
      ['필요 자기자본', (r) => r.need, won, 'low'],
      ['자금 여유(부족)', (r) => -r.fundingGap, (x) => won(x, { sign: true }), 'high'],
      ['월 상환액', (r) => r.monthlyPayment, won, 'low'],
      ['월 소득 대비 상환', (r) => r.monthlyPayment / (r.i.annualIncome / 12), (x) => pct(x), 'low'],
      ['금리 +2%p 부담률', (r) => r.stress.rateShocks[2].burden, (x) => pct(x), 'low'],
      ['취득 부대비용', (r) => r.closing.total, won, 'low'],
      ['연 보유세', (r) => r.holding.total, won, 'low'],
      ['매수 − 임차 (기본 가정)', (r) => (r.base.feasible ? r.base.diff : NaN), (x) => (isFinite(x) ? won(x, { sign: true }) : '—'), 'high'],
      ['매수 유리 확률', (r) => (r.base.feasible ? r.mc.buyWinProb : NaN), (x) => pct(x, 0), 'high'],
      ['손익분기 상승률', (r) => (r.breakeven == null ? Infinity : r.breakeven), (x) => (isFinite(x) ? pct(x, 2) : '25% 초과'), 'low'],
    ];
    const head = res.map(({ cd, r }) => `<th class="cand">${esc(cd.name)}<br>${chip(r.v.tone, r.v.label)}<div class="cand-actions"><button type="button" class="ghost" data-load="${cd.id}">불러오기</button><button type="button" class="ghost" data-del="${cd.id}">삭제</button></div></th>`).join('');
    const rows = metrics.map(([label, get, fmt, better]) => {
      const vals = res.map(({ r }) => get(r));
      const valid = vals.filter((v) => isFinite(v));
      const target = better === 'high' ? Math.max(...valid) : better === 'low' ? Math.min(...valid) : null;
      return `<tr><td>${label}</td>${vals.map((v) => `<td class="n${res.length > 1 && target != null && v === target ? ' best' : ''}">${esc(fmt(v))}</td>`).join('')}</tr>`;
    }).join('');
    out.innerHTML = `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>항목</th>${head}</tr></thead><tbody>
      <tr><td>지역</td>${res.map(({ r }) => `<td>${esc(r.r.name)}</td>`).join('')}</tr>${rows}</tbody></table></div>
      <p class="muted" style="font-size:12px">강조된 칸이 해당 항목에서 가장 나은 후보입니다. 후보별로 저장 당시의 소득·현금·가정이 그대로 쓰입니다.</p></div>`;
  }
  function applyValues(V) {
    for (const [k, v] of Object.entries(V)) {
      const e = $(k);
      if (!e || e.type === 'file') continue;
      if (e.type === 'checkbox') e.checked = !!v; else e.value = v;
    }
    update();
  }

  // ── 흐름 ──────────────────────────────────────────────────────────────
  let timer = null;
  function update() {
    const V = formValues();
    const i = read(V);
    const cond = readConditions(V);
    const r = E.region(i.regionId);
    const permit = r.landPermit && P.PROPERTY.landPermitTypes.includes(i.propertyType);
    $('regionHint').textContent = [r.regulated ? '규제지역' : '비규제', r.capital ? '수도권' : '지방', permit ? '토지거래허가구역' : null].filter(Boolean).join(' · ');
    $('reconFields').hidden = !V.reconTarget;
    const list = COND.checklist(cond);
    const errors = COND.valueErrors(cond);
    const missingIds = new Set(list.filter((x) => !x.done).map((x) => REQ_INPUT[x.path]));
    form.querySelectorAll('input, select').forEach((e) => e.classList.toggle('missing', missingIds.has(e.id)));
    if (missingIds.size || errors.length) { renderMissing(list, errors); persist(); return; }
    const c = compute(i, cond);
    renderVerdict(c); renderKpis(c); renderConditions(c); renderRecon(c); renderLoan(c); renderCost(c); renderCompare(c); renderTiming(c); renderRisk(c); renderMarket(c);
    if (!lawdTouched) $('apiLawd').value = r.lawd || '';
    persist();
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 180); };

  function selectTab(name) {
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== 'tab-' + name; });
    try { localStorage.setItem('rea-tab', name); } catch (_) { /* 무시 */ }
    if (name === 'candidates') renderCandidates();
  }

  initRegions();
  snapshotDefaults();
  restore();
  renderNotes();
  form.addEventListener('input', schedule);
  form.addEventListener('change', schedule);
  $('reset').addEventListener('click', () => {
    for (const [k, v] of Object.entries(defaults)) { const e = $(k); if (e.type === 'checkbox') e.checked = v; else e.value = v; }
    update();
  });
  // 전세 시세를 바꾸면 임차 보증금 기본값도 따라간다 (사용자가 따로 바꾸지 않은 경우)
  let depositTouched = $('rentDeposit').value !== $('jeonsePrice').value;
  $('rentDeposit').addEventListener('input', () => { depositTouched = true; });
  $('jeonsePrice').addEventListener('input', () => { if (!depositTouched) $('rentDeposit').value = $('jeonsePrice').value; });
  document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) selectTab(b.dataset.tab); });
  $('csvFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let text = reader.result;
      // 국토부 CSV는 EUC-KR인 경우가 많다
      if (!/거래금액/.test(text)) {
        const r2 = new FileReader();
        r2.onload = () => loadCsv(r2.result);
        r2.readAsText(f, 'euc-kr');
        return;
      }
      loadCsv(text);
    };
    reader.readAsText(f, 'utf-8');
  });
  $('csvText').addEventListener('input', (e) => { if (e.target.value.trim()) loadCsv(e.target.value); });
  $('csvSample').addEventListener('click', () => { $('csvText').value = sampleCsv(); loadCsv($('csvText').value); });
  $('apiLawd').addEventListener('input', () => { lawdTouched = true; });
  $('apiFetch').addEventListener('click', fetchRtms);
  $('landUseFetch').addEventListener('click', () => fetchLandUse(true));
  $('redevFetch').addEventListener('click', fetchRedev);
  $('redevPick').addEventListener('change', (e) => { if (e.target.value !== '') applyRedev(Number(e.target.value)); });
  document.addEventListener('click', (e) => { if (e.target.id === 'regRefresh') refreshRegulation(true); });
  $('candSave').addEventListener('click', saveCandidate);
  $('candOut').addEventListener('click', (e) => {
    const load = e.target.closest('[data-load]'), del = e.target.closest('[data-del]');
    if (load) { const cd = candidates.find((x) => String(x.id) === load.dataset.load); if (cd) { applyValues(cd.values); selectTab('loan'); } }
    if (del) { candidates = candidates.filter((x) => String(x.id) !== del.dataset.del); persistCands(); renderCandidates(); }
  });
  initApi();
  // 주택 유형에 맞춰 공시가격 비율 기본값을 바꾼다 (단독주택은 현실화율이 낮다)
  $('propertyType').addEventListener('change', () => { $('publicRatio').value = P.PROPERTY.publicRatio[$('propertyType').value] ?? 69; });
  let tab = 'conditions';
  try { tab = location.hash.slice(1) || localStorage.getItem('rea-tab') || 'conditions'; } catch (_) { /* 무시 */ }
  if (!document.getElementById('tab-' + tab)) tab = 'conditions';
  selectTab(tab);
  update();
})();
