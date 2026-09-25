/*
 * 분석 필수 조건: 지역·입지·주택유형·확보자금·매매단가·필요자금·이주비(재건축)·시기·규제
 * (claude/analyzer-essential-conditions 브랜치의 re_analyzer를 이 분석기로 옮긴 것)
 *
 * 입력 c (금액 단위 원):
 *  purpose('거주'|'투자'|'거주+투자'), regionId, propertyType, areaM2, price, recentTrades[], jeonse, assumeTenant,
 *  cash, ownedHomes, willSellExisting, annualIncome, annualSavings,
 *  location{subwayWalkMin, jobCommuteMin, schoolWalkMin, amenities[], negatives[]},
 *  recon{target, stage, priorAssetValue, expectedContribution, newUnitValue, relocationLtv, tempHousingDeposit, ownerHeldYears, ownerLivedYears},
 *  timing{purchaseDate:'YYYY-MM', holdingYears, moveInBy:'YYYY-MM'}, loan{rate, termYears}
 */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const mod = factory(node ? require('./policy.js') : root.REA_POLICY, node ? require('./engine.js') : root.REA);
  if (node) module.exports = mod;
  else root.REA_COND = mod;
})(typeof self !== 'undefined' ? self : this, function (P, E) {
  const PURPOSES = ['거주', '투자', '거주+투자'];
  const PYEONG = 3.3058;
  const R = P.RECON;

  const isInvest = (c) => c.purpose === '투자' || c.purpose === '거주+투자';
  const isLive = (c) => c.purpose === '거주' || c.purpose === '거주+투자';
  const livesIn = (c) => (c.livesIn != null ? c.livesIn : isLive(c)) && !c.assumeTenant;
  const isRecon = (c) => !!(c.recon && (c.recon.target || (c.recon.stage && c.recon.stage !== '해당없음')));
  const stageIndex = (st) => Math.max(0, R.stages.indexOf(st));

  // ── 필수 조건 ─────────────────────────────────────────────────────────
  // scope: 공통 / 거주 / 투자 / 재건축 / 세입자승계
  const REQUIREMENTS = [
    { path: 'purpose', label: '매수 목적', category: '목적', why: '목적에 따라 대출·세금·실거주 의무·평가 기준이 달라집니다' },
    { path: 'regionId', label: '지역 (시·군·구)', category: '지역', why: '규제지역·토지거래허가구역·수도권 대출규제 판정' },
    { path: 'propertyType', label: '주택 유형', category: '주택유형', why: '유형별로 토지거래허가 적용·환금성·취득세율이 다릅니다' },
    { path: 'areaM2', label: '전용면적', category: '주택유형', why: '85㎡ 초과 농특세, 단가 산출' },
    { path: 'price', label: '매매가', category: '매매단가', why: '필요자금·세금·대출한도 계산의 기준' },
    { path: 'cash', label: '확보 가능 자기자금', category: '확보자금', why: '필요자금 대비 부족액 판정' },
    { path: 'ownedHomes', label: '현재 보유 주택 수', category: '확보자금', why: '취득세 중과, 다주택자 대출 금지, 처분조건 판정' },
    { path: 'annualIncome', label: '본인 연소득 (세전)', category: '소득·상환', why: 'DSR 기반 대출한도 산정' },
    { path: 'netMonthlyIncome', label: '월 실수령액 (세후)', category: '소득·상환', why: '실제로 매달 갚을 수 있는지 판단' },
    { path: 'employment', label: '고용 형태', category: '소득·상환', why: '소득 안정성과 비상자금 권장 수준 판단' },
    { path: 'timing.purchaseDate', label: '매수 예정 시점', category: '시기', why: '규정 적용 시점, 입주·이주·보유기간 계산' },
    { path: 'location.jobCommuteMin', label: '주요 업무지구 통근시간', category: '입지', why: '거주 만족도의 핵심 지표', when: isLive, scope: '거주' },
    { path: 'location.schoolWalkMin', label: '초등학교 도보시간', category: '입지', why: '거주 수요·학군', when: isLive, scope: '거주' },
    { path: 'location.subwayWalkMin', label: '역까지 도보시간', category: '입지', why: '환금성과 가격 방어력의 핵심 지표', when: isInvest, scope: '투자' },
    { path: 'recentTrades', label: '같은 평형 최근 실거래가', category: '매매단가', why: '매매가가 비싼지 싼지 판단', when: isInvest, scope: '투자' },
    { path: 'jeonse', label: '전세 시세', category: '매매단가', why: '전세가율·갭 규모·하방 위험 판단', when: isInvest, scope: '투자' },
    { path: 'timing.holdingYears', label: '계획 보유기간', category: '시기', why: '재건축 입주 시점·양도세 비과세 요건과 맞는지 판단', when: isInvest, scope: '투자' },
    { path: 'recon.stage', label: '정비사업 단계', category: '재건축', why: '이주 시점·조합원 지위양도 제한·입주 예상 시점', when: (c) => !!(c.recon && c.recon.target), scope: '재건축' },
    { path: 'recon.priorAssetValue', label: '종전자산 감정가 (추정치 가능)', category: '재건축', why: '이주비 대출 한도 산정', when: (c) => isRecon(c) && ['사업시행인가', '관리처분인가', '이주철거'].includes(c.recon.stage), scope: '재건축' },
    { path: 'recon.expectedContribution', label: '예상 분담금', category: '재건축', why: '입주 때 추가로 필요한 돈', when: isRecon, scope: '재건축' },
    { path: 'jeonse', label: '승계할 전세보증금', category: '필요자금', why: '세입자 승계 시 필요자금에서 차감', when: (c) => !!c.assumeTenant, scope: '세입자승계' },
  ];

  const get = (c, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), c);
  const empty = (v) => v == null || v === '' || (typeof v === 'number' && !isFinite(v)) || (Array.isArray(v) && !v.length);

  /** 적용되는 필수 조건별 입력 상태 목록 */
  function checklist(c) {
    const seen = new Set();
    const out = [];
    for (const req of REQUIREMENTS) {
      let applies = true;
      try { applies = req.when ? req.when(c) : true; } catch (_) { applies = false; }
      if (!applies) continue;
      const done = !empty(get(c, req.path));
      if (seen.has(req.path)) continue;
      seen.add(req.path);
      out.push({ ...req, scope: req.scope || '공통', done });
    }
    return out;
  }
  const missing = (c) => checklist(c).filter((r) => !r.done);

  const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
  function valueErrors(c) {
    const errs = [];
    if (c.purpose != null && !PURPOSES.includes(c.purpose)) errs.push(`매수 목적은 ${PURPOSES.join('/')} 중 하나여야 합니다`);
    if (c.propertyType != null && !P.PROPERTY_TYPES.includes(c.propertyType)) errs.push(`주택 유형은 ${P.PROPERTY_TYPES.join('/')} 중 하나여야 합니다`);
    if (c.recon && c.recon.stage != null && !R.stages.includes(c.recon.stage)) errs.push('정비사업 단계가 올바르지 않습니다');
    for (const [k, label] of [['purchaseDate', '매수 예정 시점'], ['moveInBy', '입주 희망 시점']]) {
      const v = c.timing && c.timing[k];
      if (v != null && v !== '' && !YM.test(String(v))) errs.push(`${label}은 YYYY-MM 형식이어야 합니다`);
    }
    for (const [k, label] of [['price', '매매가'], ['cash', '자기자금'], ['annualIncome', '연소득'], ['areaM2', '전용면적']]) {
      if (c[k] != null && c[k] < 0) errs.push(`${label}은 0 이상이어야 합니다`);
    }
    if (c.price === 0) errs.push('매매가는 0보다 커야 합니다');
    return errs;
  }

  // ── 매매단가 ──────────────────────────────────────────────────────────
  function unitPrice(c) {
    const out = { perM2: c.price / c.areaM2, perPyeong: c.price / (c.areaM2 / PYEONG) };
    if (c.recentTrades && c.recentTrades.length) {
      out.recentAvg = c.recentTrades.reduce((a, b) => a + b, 0) / c.recentTrades.length;
      out.premium = c.price / out.recentAvg - 1;
    }
    if (c.jeonse) {
      out.jeonseRatio = c.jeonse / c.price;
      out.gap = c.price - c.jeonse;
    }
    return out;
  }

  // ── 입지 점수 ─────────────────────────────────────────────────────────
  const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
  function residenceScore(c) {
    const L = c.location || {};
    const parts = {};
    if (L.jobCommuteMin != null) parts['통근'] = clamp(100 - Math.max(0, L.jobCommuteMin - 20) * 2);
    if (L.schoolWalkMin != null) parts['학교'] = clamp(100 - Math.max(0, L.schoolWalkMin - 5) * 5);
    if (L.subwayWalkMin != null) parts['역세권'] = clamp(100 - Math.max(0, L.subwayWalkMin - 5) * 4);
    const vals = Object.values(parts);
    const base = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 50;
    let adj = 3 * (L.amenities || []).length - 5 * (L.negatives || []).length;
    if (c.propertyType === '빌라' || c.propertyType === '단독주택') adj -= 5; // 관리·보안·주차 열위(평균 가정)
    return { score: clamp(base + adj), parts, adj };
  }
  function investmentScore(c, unit, recon, dsr) {
    const L = c.location || {};
    const parts = {};
    if (unit.premium != null) parts['가격적정성'] = clamp(60 - unit.premium * 100 * 4);
    if (unit.jeonseRatio != null) parts['전세가율'] = clamp(unit.jeonseRatio * 100 * 1.4);
    if (L.subwayWalkMin != null) parts['환금성'] = clamp(100 - Math.max(0, L.subwayWalkMin - 5) * 4);
    parts['유형'] = P.PROPERTY.liquidity[c.propertyType] ?? 50;
    if (recon && recon.expectedGain != null) parts['재건축수익'] = clamp(50 + (recon.expectedGain / Math.max(recon.totalCashCommitted, 1)) * 50);
    const vals = Object.values(parts);
    let adj = 3 * (L.amenities || []).length - 5 * (L.negatives || []).length;
    if (dsr > 0.35) adj -= 5;
    return { score: clamp(vals.reduce((a, b) => a + b, 0) / vals.length + adj), parts, adj };
  }

  // ── 재건축: 지위양도·이주비·분담금 ────────────────────────────────────
  /**
   * fund: { loanUsed, tenantDeposit, requiredCash, surplus, totalCost }
   */
  function reconstruction(c, fund, reg) {
    const r = c.recon || {};
    const stage = r.stage || '해당없음';
    const idx = stageIndex(stage);
    const notes = [], blockers = [];
    // 현재 단계에 들어선 날짜가 있으면 경과 기간만큼 줄인다. 다음 단계의 남은 기간보다 짧아지지는 않는다
    let years = R.yearsToMoveIn[stage] ?? 0;
    let elapsed = 0;
    const since = parseDate(r.stageDate);
    const buy = c.timing && c.timing.purchaseDate ? c.timing.purchaseDate + '-01' : null;
    if (since && buy && buy > since) {
      elapsed = (Date.parse(buy) - Date.parse(since)) / (365.25 * 864e5);
      const next = R.stages[idx + 1];
      years = Math.max(next ? R.yearsToMoveIn[next] ?? 0 : 0, years - elapsed);
      years = Math.round(years * 10) / 10;
    }
    const untilRelocation = idx < stageIndex('이주철거') ? Math.max(years - R.constructionYears, 0) : 0;
    const sch = E.schedule(fund.loanUsed, c.loan.rate, c.loan.termYears, c.loan.method);
    const k = Math.min(Math.round(untilRelocation * 12), sch.balance.length);
    const balance = k > 0 ? sch.balance[k - 1] : fund.loanUsed;
    const interestBefore = sch.interest.slice(0, k).reduce((a, b) => a + b, 0);

    // 조합원 지위양도 제한 (투기과열지구 재건축: 조합설립인가 이후)
    let transferBlocked = false;
    if (reg.regulated && idx >= stageIndex(R.transferRestrictionStage) && stage !== '준공') {
      const held = r.ownerHeldYears || 0, lived = r.ownerLivedYears || 0;
      if (held >= R.transferException.heldYears && lived >= R.transferException.livedYears) {
        notes.push(`조합원 지위양도 제한 단계지만 매도인이 ${held}년 보유·${lived}년 거주해 1세대1주택 장기보유 예외 요건을 충족할 수 있습니다 (조합 확인 필수).`);
      } else {
        transferBlocked = true;
        blockers.push(`투기과열지구 재건축 '${stage}' 이후 매수 → 조합원 지위 승계 불가, 현금청산 위험 (매도인 예외 요건 ${R.transferException.heldYears}년 보유·${R.transferException.livedYears}년 거주 확인 전 계약 금지)`);
      }
    }

    // 이주비 대출
    let base = r.priorAssetValue;
    if (base == null) {
      base = c.price * R.priorAssetDefaultRatio;
      notes.push(`종전자산 감정가 미입력 → 매매가의 ${R.priorAssetDefaultRatio * 100}%로 가정했습니다.`);
    }
    const ltv = r.relocationLtv != null ? r.relocationLtv : R.relocationLtv;
    let reloc = base * ltv;
    const homesAfter = (c.ownedHomes || 0) + 1;
    if ((reg.capital || reg.regulated) && homesAfter >= 2 && !c.willSellExisting) {
      reloc = 0;
      blockers.push('수도권·규제지역 다주택 조합원은 이주비 대출이 제한될 수 있어 이주비를 0으로 가정했습니다.');
    } else if (reg.capital || reg.regulated) {
      const cap = reg.regulated
        ? P.LOAN.regulatedCaps.find((x) => c.price <= x.upTo).cap
        : P.LOAN.capitalCap;
      if (reloc > cap) {
        notes.push(`이주비에도 주담대 금액 한도가 적용된다고 보고 ${Math.round(cap / 1e8)}억원으로 제한했습니다.`);
        reloc = cap;
      }
      if (balance > 0) notes.push(`이주 시점 주담대 잔액 ${fmt(balance)}은 이주비 대출로 대환해야 하므로 순증액만 쓸 수 있습니다.`);
    }
    notes.push(R.relocationNote);

    let timing;
    if (idx >= stageIndex('이주철거')) timing = '이미 이주 단계 이후 (이주비 수령·승계 가능 여부 확인)';
    else if (idx >= stageIndex('관리처분인가')) timing = '관리처분인가 후 이주 개시 시 (보통 6개월~1년 내)';
    else timing = `관리처분인가 이후 (현재 '${stage}', 약 ${untilRelocation.toFixed(1)}년 후 예상)`;

    // 이주 시점 현금흐름
    const netReloc = reloc - balance; // 기존 주담대 대환 후 순수령액
    let cashAtReloc, tempDeposit = null;
    if (fund.tenantDeposit) {
      cashAtReloc = fund.tenantDeposit - netReloc;
      notes.push(`이주 때 세입자 보증금 ${fmt(fund.tenantDeposit)}을 돌려줘야 합니다. 이주비 순수령 ${fmt(netReloc)}으로 충당하고 차액 ${fmt(cashAtReloc)}은 자기자금이 필요합니다.`);
    } else if (livesIn(c)) {
      tempDeposit = r.tempHousingDeposit;
      if (tempDeposit == null) {
        tempDeposit = c.jeonse || 0;
        notes.push(`임시거주 보증금 미입력 → 지금 전세 시세 ${fmt(tempDeposit)}으로 가정했습니다.`);
      }
      cashAtReloc = tempDeposit - netReloc;
      if (netReloc < 0) notes.push(`이주비(${fmt(reloc)})가 기존 주담대보다 작아 이주 때 ${fmt(-netReloc)}을 상환해야 합니다.`);
    } else {
      cashAtReloc = -Math.max(netReloc, 0);
    }

    const landPermit = reg.landPermit;
    if (landPermit && idx >= stageIndex('이주철거')) blockers.push('토지거래허가구역 실거주 의무가 있는데 이미 이주·철거 단계 → 실거주 불가, 허가가 나지 않을 수 있습니다.');
    else if (landPermit && years < 3 && idx > 0) notes.push('토지거래허가 실거주 2년 의무 기간 중에 이주가 시작될 수 있습니다. 구청 허가 조건을 확인하세요.');

    const contribution = r.expectedContribution || 0;
    const totalCashCommitted = fund.requiredCash + Math.max(cashAtReloc, 0) + Math.max(contribution, 0);
    // 이주 전은 원리금균등 이자, 이주 후는 이주비 대출 이자(단순) 가정
    const interest = interestBefore + Math.max(reloc, balance) * c.loan.rate * (years - untilRelocation);
    let expectedGain = null;
    if (r.newUnitValue) expectedGain = r.newUnitValue - (fund.totalCost + contribution + interest);
    notes.push(R.excessProfitNote);

    // 재원 점검: 매수 후 여유 + 연 저축
    const savings = c.annualSavings || 0;
    const atReloc = Math.max(fund.surplus, 0) + savings * untilRelocation;
    const needReloc = Math.max(cashAtReloc, 0);
    const warnings = [];
    if (needReloc > atReloc) {
      blockers.push(`이주 때 ${fmt(needReloc)}이 필요한데 그때까지 확보 예상액은 ${fmt(atReloc)} (매수 후 여유 + 연 저축 ${fmt(savings)} × ${untilRelocation.toFixed(1)}년) → 재원 부족`);
    }
    const atMoveIn = atReloc - needReloc + savings * (years - untilRelocation);
    if (contribution > Math.max(atMoveIn, 0)) {
      warnings.push(`입주 때 분담금 ${fmt(contribution)} 중 ${fmt(contribution - Math.max(atMoveIn, 0))}을 추가로 마련해야 합니다 (중도금 대출 등).`);
    }

    return {
      stage, stageIndex: idx, stageDate: since, elapsedInStage: elapsed, yearsToMoveIn: years, yearsUntilRelocation: untilRelocation, transferBlocked,
      relocationBase: base, relocationLtv: ltv, relocationLoan: reloc, balanceAtRelocation: balance, netRelocation: netReloc,
      tempDeposit, cashAtRelocation: cashAtReloc, contribution, totalCashCommitted, interest, expectedGain,
      fundsAtRelocation: atReloc, fundsAtMoveIn: atMoveIn, relocationTiming: timing, notes, blockers, warnings,
    };
  }

  function fmt(x) {
    const v = Math.round(Math.abs(x) / 1e4);
    const eok = Math.floor(v / 1e4), man = v % 1e4;
    const s = eok && man ? `${eok}억 ${man.toLocaleString()}만` : eok ? `${eok}억` : `${man.toLocaleString()}만`;
    return (x < 0 ? '−' : '') + s + '원';
  }

  // ── 시기 ──────────────────────────────────────────────────────────────
  const toYears = (ym) => { const [y, m] = ym.split('-').map(Number); return y + (m - 1) / 12; };
  const fromYears = (t) => { const mo = Math.round(t * 12); return `${Math.floor(mo / 12)}-${String((mo % 12) + 1).padStart(2, '0')}`; };
  function timing(c, recon) {
    const t = c.timing || {};
    const out = { events: [], warnings: [] };
    if (!t.purchaseDate || !YM.test(t.purchaseDate)) return out;
    const now = toYears(t.purchaseDate);
    out.events.push({ label: '매수', date: t.purchaseDate });
    const moveInYears = recon ? recon.yearsToMoveIn : 0;
    if (recon) {
      if (recon.yearsUntilRelocation > 0) out.events.push({ label: '이주 (예상)', date: fromYears(now + recon.yearsUntilRelocation) });
      out.events.push({ label: '신축 입주 (예상)', date: fromYears(now + moveInYears) });
    } else if (livesIn(c)) out.events.push({ label: '입주 가능', date: t.purchaseDate });
    if (t.holdingYears) out.events.push({ label: '매도 (계획)', date: fromYears(now + t.holdingYears) });
    const canLiveNow = !recon || recon.yearsUntilRelocation > 0;
    if (t.moveInBy && YM.test(t.moveInBy) && livesIn(c) && !canLiveNow && now + moveInYears > toYears(t.moveInBy)) {
      out.warnings.push(`희망 입주 시점(${t.moveInBy})보다 약 ${(now + moveInYears - toYears(t.moveInBy)).toFixed(1)}년 늦게 입주할 것으로 보입니다.`);
    }
    if (t.moveInBy && YM.test(t.moveInBy) && toYears(t.moveInBy) < now) out.warnings.push('입주 희망 시점이 매수 예정 시점보다 앞섭니다.');
    if (t.holdingYears != null && t.holdingYears < 2) out.warnings.push('2년 미만 보유 후 팔면 양도세 단기세율(60~70%)이 적용됩니다.');
    if (recon && t.holdingYears != null && t.holdingYears < moveInYears) {
      out.warnings.push(`보유기간 ${t.holdingYears}년 < 입주까지 ${moveInYears}년 → 준공 전에 팔아야 하고, 지위양도 제한으로 매도 자체가 막힐 수 있습니다.`);
    }
    return out;
  }

  // 공공데이터의 추진단계 문구 → 분석기 단계
  const STAGE_PATTERNS = [
    [/준공|이전고시|입주|청산|해산/, '준공'], [/일반분양|분양승인|입주자모집/, '일반분양승인'], [/착공/, '착공'], [/이주|철거/, '이주철거'],
    [/관리처분/, '관리처분인가'], [/사업시행/, '사업시행인가'], [/조합설립/, '조합설립인가'], [/추진위/, '추진위원회승인'],
    [/기본계획/, '기본계획수립'], [/정비구역|구역지정|예정구역|정비계획/, '정비구역지정'], [/안전진단|재건축진단/, '재건축진단'],
  ];
  function stageFromText(text) {
    const t = String(text || '');
    for (const [re, stage] of STAGE_PATTERNS) if (re.test(t)) return stage;
    return null;
  }

  // 'YYYY-MM-DD' | 'YYYYMMDD' | 'YYYY.MM.DD' | 'YY.MM.DD' → 'YYYY-MM-DD'
  function parseDate(v) {
    const t = String(v == null ? '' : v).trim();
    let m = t.match(/^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})/);
    if (!m) { m = t.match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})$/); if (m) m[1] = '20' + m[1]; }
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 1970 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /**
   * 공공데이터 행의 '단계별 날짜' 열(예: 추진위원회승인일, 조합설립인가일)로 단계 이력을 만든다.
   * 현재 단계 = 날짜가 있는 가장 늦은 단계. 날짜 열이 없으면 추진단계 문구로 판정.
   */
  function stageTimeline(row, stageText) {
    const reached = {};
    for (const [k, v] of Object.entries(row || {})) {
      const date = parseDate(v);
      if (!date) continue;
      const stage = stageFromText(k);
      if (stage && (!reached[stage] || date < reached[stage])) reached[stage] = date;
    }
    const steps = R.stages.slice(1).map((stage) => ({ stage, label: R.stageLabels[stage] || stage, date: reached[stage] || null }));
    let currentIdx = -1;
    steps.forEach((st, k) => { if (st.date) currentIdx = k; });
    let current = currentIdx >= 0 ? steps[currentIdx].stage : null;
    const fromText = stageFromText(stageText);
    if (fromText && (!current || stageIndex(fromText) > stageIndex(current))) current = fromText;
    steps.forEach((st) => { st.current = st.stage === current; st.done = current ? stageIndex(st.stage) < stageIndex(current) : false; });
    return { steps, current, currentDate: current ? reached[current] || null : null };
  }

  // ── 종합 ──────────────────────────────────────────────────────────────
  /**
   * 규제 판정 + 조건 플래그. level: block(차단) / warn(주의) / info(정보)
   * fund: { price, loanUsed, tenantDeposit, requiredCash, surplus, totalCost, dsr, loanBlockedReason, taxHeavy, taxRate, homesAfter }
   */
  function assess(c, fund) {
    const list = checklist(c);
    const miss = list.filter((r) => !r.done);
    const errors = valueErrors(c);
    const res = { checklist: list, missing: miss, errors, flags: [], unit: null, scores: {}, recon: null, timing: null, region: null, ready: false };
    if (miss.length || errors.length) return res;
    res.ready = true;

    const region = E.region(c.regionId);
    const live = c.live || {};
    const flag0 = [];
    // 최신 공공데이터가 있으면 규정 파일보다 우선한다
    let permitZone = region.landPermit;
    if (live.landUse) {
      permitZone = !!live.landUse.landPermit;
      if (permitZone !== region.landPermit) flag0.push(['info', '최신성', `필지 토지이용계획(${live.landUse.fetchedAt.slice(0, 10)} 조회) 기준으로 토지거래허가구역 ${permitZone ? '지정' : '미지정'}으로 판정했습니다 (규정 파일과 다름).`]);
      if (live.landUse.redevZone && !isRecon(c)) flag0.push(['warn', '재건축', `이 필지는 정비 관련 구역(${live.landUse.zones.filter((z) => /정비|재건축|재개발|재정비/.test(z)).join(', ')})에 있습니다. 재건축 대상이면 재건축 항목을 채우세요.`]);
      if (live.landUse.speculativeOverheated && !region.regulated) flag0.push(['warn', '최신성', '필지 토지이용계획에 투기과열지구가 표시됩니다. 규정 파일의 비규제 판정이 오래됐을 수 있습니다.']);
    }
    if (!live.regulation) {
      flag0.push(['warn', '최신성', `최신 규제 고시·법령 변경을 확인하지 못했습니다 (${live.unavailable || '로컬 서버 필요'}). 규정 기준일 ${P.asOf} 값으로 계산했습니다.`]);
    } else {
      const done = live.regulation.changes.filter((x) => !x.upcoming);
      if (done.length) flag0.push(['warn', '최신성', `규정 기준일(${P.asOf}) 이후 규제 관련 고시·법령 변경 ${done.length}건이 감지됐습니다: ${done.slice(0, 3).map((x) => `${x.date} ${x.title}`).join(' / ')}. 규정 파일 갱신 전 결과는 참고만 하세요.`]);
      if (!live.regulation.ok) flag0.push(['warn', '최신성', `일부 출처를 확인하지 못했습니다: ${live.regulation.errors.join(' / ')}`]);
    }
    const landPermit = permitZone && P.PROPERTY.landPermitTypes.includes(c.propertyType);
    const reg = { regulated: region.regulated, capital: region.capital, landPermit };
    res.region = { ...reg, name: region.name };
    const flag = (level, category, message) => res.flags.push({ level, category, message });
    flag0.forEach(([l, cat, m]) => flag(l, cat, m));

    if (c.jeonse && c.jeonse >= c.price) flag('warn', '입력', '전세가가 매매가 이상입니다 (깡통전세 위험 또는 입력 오류).');

    // 규제
    if (landPermit) {
      if (!livesIn(c)) flag('block', '규제', '토지거래허가구역: 허가 후 2년 실거주 의무 → 전세 낀 매수·비거주 매수 불가');
      else flag('info', '규제', '토지거래허가구역: 계약 전 구청 허가 필요, 2년 실거주 의무');
    } else if (permitZone) {
      flag('info', '규제', `토지거래허가구역이지만 ${c.propertyType}는 허가 대상이 아닙니다 (아파트만 해당).`);
    }
    if (region.regulated) flag('info', '규제', '규제지역: 자금조달계획서(증빙 포함) 제출, 양도세 비과세에 2년 거주 요건');
    if (c.propertyType === '오피스텔') flag('info', '주택유형', '오피스텔: 취득세 4.6%, 주거용이면 주택 수에 포함돼 다른 주택 세금에 영향');
    if (c.propertyType === '빌라' || c.propertyType === '단독주택') flag('info', '주택유형', `${c.propertyType}: 실거래 비교가 어렵고 환금성이 낮아 시세 확인(감정가·KB시세) 필요`);

    // 단가
    const unit = unitPrice(c);
    res.unit = unit;
    if (unit.premium != null && unit.premium > 0.05) flag('warn', '매매단가', `최근 실거래 평균보다 ${(unit.premium * 100).toFixed(1)}% 비쌉니다.`);

    // 자금
    if (fund.loanBlockedReason && !fund.tenantDeposit) flag('warn', '대출', fund.loanBlockedReason);
    if (fund.taxHeavy) flag('warn', '세금', `취득세 중과 ${(fund.taxRate * 100).toFixed(0)}% (취득 후 ${fund.homesAfter}주택)`);
    if (fund.surplus < 0) flag('block', '확보자금', `매수 시 자기자금 ${fmt(-fund.surplus)} 부족`);
    if (fund.tenantDeposit && fund.tenantDeposit / c.price > P.RENT.jeonseRiskRatio) flag('warn', '필요자금', '전세가율 80% 초과: 역전세·보증금 반환 위험');

    // 재건축
    if (isRecon(c)) {
      res.recon = reconstruction(c, fund, reg);
      res.recon.blockers.forEach((b) => flag('block', '재건축', b));
      res.recon.warnings.forEach((w) => flag('warn', '재건축', w));
    }

    // 시기
    res.timing = timing(c, res.recon);
    res.timing.warnings.forEach((w) => flag('warn', '시기', w));

    // 점수
    if (isLive(c)) res.scores['거주'] = residenceScore(c);
    if (isInvest(c)) res.scores['투자'] = investmentScore(c, unit, res.recon, fund.dsr);

    const levels = new Set(res.flags.map((f) => f.level));
    res.verdict = levels.has('block') ? '불가' : levels.has('warn') ? '조건부' : '진행가능';
    return res;
  }

  return { PURPOSES, REQUIREMENTS, stageFromText, stageTimeline, parseDate, checklist, missing, valueErrors, unitPrice, residenceScore, investmentScore, reconstruction, timing, assess, livesIn, isRecon, isLive, isInvest, stageIndex };
});
