/* 화면 제어: 입력 → 엔진 → 결과 렌더링 */
(function () {
  const E = window.REA, P = window.REA_POLICY, C = window.REA_CHARTS;
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
      const out = {};
      for (const e of form.elements) if (e.id && e.type !== 'file') out[e.id] = e.type === 'checkbox' ? e.checked : e.value;
      localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch (_) { /* 무시 */ }
  }
  function read() {
    // 빈 칸은 예시 기본값으로 대신한다 (0으로 조용히 바뀌지 않도록)
    const n = (id, scale = 1) => {
      let v = parseFloat($(id).value);
      if (!isFinite(v)) v = parseFloat(defaults[id]);
      return isFinite(v) ? v * scale : 0;
    };
    const opt = (id, scale = 1) => { const v = parseFloat($(id).value); return isFinite(v) ? v * scale : null; };
    return {
      regionId: $('regionId').value,
      price: n('price', MAN), areaM2: n('areaM2'), jeonsePrice: n('jeonsePrice', MAN), publicRatio: n('publicRatio', 0.01),
      buyerType: $('buyerType').value,
      annualIncome: n('annualIncome', MAN), existingDebt: n('existingDebt', MAN), cash: n('cash', MAN),
      monthlyLiving: n('monthlyLiving', MAN), age: n('age'),
      newlywed: $('newlywed').checked, newborn: $('newborn').checked, multichild: $('multichild').checked,
      rate: n('rate', 0.01), termYears: Math.max(1, n('termYears')), rateType: $('rateType').value, method: $('method').value,
      lender: $('lender').value, loanWanted: opt('loanWanted', MAN),
      rentDeposit: n('rentDeposit', MAN), rentMonthly: n('rentMonthly', MAN), rentLoan: n('rentLoan', MAN), rentLoanRate: n('rentLoanRate', 0.01),
      years: Math.min(30, Math.max(1, Math.round(n('years')))), appreciation: n('appreciation', 0.01), appreciationVol: n('appreciationVol', 0.01),
      rentGrowth: n('rentGrowth', 0.01), invReturn: n('invReturn', 0.01), invVol: n('invVol', 0.01),
      maintenanceRate: n('maintenanceRate', 0.01), moveCost: n('moveCost', MAN), bondDiscount: n('bondDiscount', 0.01),
      vat: $('vat').checked, reform2026: $('reform2026').checked, useRenewalRight: $('useRenewalRight').checked,
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
  function compute(i) {
    const hh = household(i);
    const r = E.region(i.regionId);
    const limit = E.loanLimit({
      price: i.price, regionId: i.regionId, buyerType: i.buyerType, annualIncome: i.annualIncome,
      existingAnnualDebtService: i.existingDebt, rate: i.rate, termYears: i.termYears,
      method: i.method, rateType: i.rateType, lender: i.lender,
    });
    const loan = i.loanWanted != null ? Math.max(0, Math.min(i.loanWanted, limit.amount)) : limit.amount;
    const termYears = limit.termYears;
    const publicPrice = i.price * i.publicRatio;
    const closing = E.closingCosts({
      price: i.price, regionId: i.regionId, homesAfter: hh.homesAfter, temporaryTwo: hh.temporaryTwo,
      areaOver85: i.areaM2 > 85, firstTime: i.buyerType === 'first', publicPrice,
      bondDiscount: i.bondDiscount, vat: i.vat,
    });
    const holding = E.holdingTax({ publicPrice, oneHouse: hh.oneHouse, homes: hh.homesAfter, age: i.age, yearsHeld: 0, resident: true, reform2026: i.reform2026 });
    const monthlyPayment = i.method === 'equalPrincipal'
      ? (E.schedule(loan, i.rate, termYears, 'equalPrincipal').payment[0] || 0)
      : E.pmt(loan, i.rate, termYears * 12);
    const need = i.price - loan + closing.total + i.moveCost;
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
    const breakeven = E.breakevenAppreciation(sim);
    const mc = E.monteCarlo(sim, { runs: 800, seed: 20260925, appreciationVol: i.appreciationVol, invVol: i.invVol });
    const policyLoans = E.policyLoanEligibility({
      price: i.price, householdIncome: i.annualIncome, netAsset: i.cash, areaM2: i.areaM2, buyerType: i.buyerType,
      newlywed: i.newlywed, newborn: i.newborn, multichild: i.multichild,
    });
    const afford = E.maxAffordablePrice({
      regionId: i.regionId, buyerType: i.buyerType, annualIncome: i.annualIncome, existingAnnualDebtService: i.existingDebt,
      rate: i.rate, termYears: i.termYears, method: i.method, rateType: i.rateType, lender: i.lender,
      cash: i.cash, moveCost: i.moveCost, homesAfter: hh.homesAfter, temporaryTwo: hh.temporaryTwo,
      areaOver85: i.areaM2 > 85, publicRatio: i.publicRatio, bondDiscount: i.bondDiscount, vat: i.vat,
    });
    const sens = base.feasible ? E.sensitivity(sim) : null;
    const jeonseRatio = i.jeonsePrice > 0 ? i.jeonsePrice / i.price : null;
    const v = E.verdict({
      fundingGap, burden: monthlyIncome > 0 ? monthlyPayment / monthlyIncome : Infinity,
      stressBurden: stress.rateShocks[2].burden,
      buyWinProb: base.feasible ? mc.buyWinProb : null,
      breakeven, expectedAppreciation: i.appreciation,
      emergencyMonths: i.monthlyLiving > 0 ? Math.max(0, leftover) / i.monthlyLiving : 99,
      jeonseRatio, pir: i.annualIncome > 0 ? i.price / i.annualIncome : null,
    });
    return { i, hh, r, afford, sens, limit, loan, termYears, publicPrice, closing, holding, monthlyPayment, need, fundingGap, leftover, stress, sim, base, breakeven, mc, policyLoans, jeonseRatio, v };
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
        <p class="sub">${esc(c.r.name)} · ${esc(won(c.i.price))} · 전용 ${c.i.areaM2}㎡ · ${c.i.years}년 거주 가정</p>
        <ul class="checklist">${v.checks.map((k) => `<li>${chip(k.status)}<span>${esc(k.label)}</span><span class="d">${esc(k.detail)}</span></li>`).join('')}</ul>
      </div>`;
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

  function renderCompare(c) {
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

  // ── 흐름 ──────────────────────────────────────────────────────────────
  let timer = null;
  function update() {
    const i = read();
    const r = E.region(i.regionId);
    $('regionHint').textContent = [r.regulated ? '규제지역' : '비규제', r.capital ? '수도권' : '지방', r.landPermit ? '토지거래허가구역' : null].filter(Boolean).join(' · ');
    if (!(i.price > 0)) {
      $('verdict').dataset.tone = 'warning';
      $('verdict').innerHTML = '<div></div><div><h2>매매가를 입력하세요</h2><p class="sub">매매가가 0보다 커야 계산할 수 있습니다.</p></div>';
      return;
    }
    const c = compute(i);
    renderVerdict(c); renderKpis(c); renderLoan(c); renderCost(c); renderCompare(c); renderRisk(c); renderMarket(c);
    persist();
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 180); };

  function selectTab(name) {
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== 'tab-' + name; });
    try { localStorage.setItem('rea-tab', name); } catch (_) { /* 무시 */ }
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
  let tab = 'loan';
  try { tab = localStorage.getItem('rea-tab') || location.hash.slice(1) || 'loan'; } catch (_) { /* 무시 */ }
  if (!document.getElementById('tab-' + tab)) tab = 'loan';
  selectTab(tab);
  update();
})();
