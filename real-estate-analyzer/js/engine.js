/*
 * 실거주 매수 판단 엔진 — 순수 함수만 둔다 (DOM 의존 없음, Node 테스트 가능).
 * 금액 단위는 모두 원(KRW), 비율은 소수(0.04 = 4%).
 */
(function (root, factory) {
  const P = typeof module !== 'undefined' && module.exports ? require('./policy.js') : root.REA_POLICY;
  const engine = factory(P);
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
  else root.REA = engine;
})(typeof self !== 'undefined' ? self : this, function (P) {
  const { EOK } = P;

  // ── 공통 유틸 ─────────────────────────────────────────────────────────
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const floorWon = (x) => Math.floor(x / 10) * 10; // 세액 10원 미만 절사

  // [[상한, 값], ...] 표에서 x가 속한 행을 찾는다
  function lookup(table, x) {
    for (const row of table) if (x <= row[0]) return row;
    return table[table.length - 1];
  }
  // [[상한, 세율, 누진공제], ...] 누진세
  function progressive(table, base) {
    if (base <= 0) return 0;
    const [, rate, deduction] = lookup(table, base);
    return Math.max(0, base * rate - deduction);
  }

  function region(id) {
    const r = P.REGIONS.find((x) => x.id === id);
    if (!r) throw new Error('알 수 없는 지역: ' + id);
    return r;
  }
  const zoneOf = (r) => (r.regulated ? 'regulated' : r.capital ? 'capital' : 'local');

  // ── 상환 ──────────────────────────────────────────────────────────────
  // 원리금균등 월 상환액
  function pmt(principal, annualRate, months) {
    if (principal <= 0 || months <= 0) return 0;
    const i = annualRate / 12;
    if (i === 0) return principal / months;
    return (principal * i) / (1 - Math.pow(1 + i, -months));
  }
  // 월 상환액 m으로 빌릴 수 있는 원금
  function pv(monthly, annualRate, months) {
    if (monthly <= 0 || months <= 0) return 0;
    const i = annualRate / 12;
    if (i === 0) return monthly * months;
    return (monthly * (1 - Math.pow(1 + i, -months))) / i;
  }

  // 월별 상환 스케줄 → { payment[], interest[], balance[] } (index 0 = 1회차)
  function schedule(principal, annualRate, years, method) {
    const n = Math.round(years * 12);
    const i = annualRate / 12;
    const out = { payment: [], interest: [], balance: [] };
    let bal = principal;
    const level = pmt(principal, annualRate, n);
    for (let k = 0; k < n; k++) {
      const int = bal * i;
      const princ = method === 'equalPrincipal' ? principal / n : level - int;
      bal = Math.max(0, bal - princ);
      out.payment.push(int + princ);
      out.interest.push(int);
      out.balance.push(bal);
    }
    return out;
  }

  // DSR 산정용 연간 원리금 (원금균등은 첫해 상환액 기준 — 보수적)
  function annualDebtService(principal, annualRate, years, method) {
    if (principal <= 0) return 0;
    if (method === 'equalPrincipal') {
      const s = schedule(principal, annualRate, years, method);
      return s.payment.slice(0, 12).reduce((a, b) => a + b, 0);
    }
    return pmt(principal, annualRate, years * 12) * 12;
  }

  // ── 대출 한도 ─────────────────────────────────────────────────────────
  /**
   * @param {object} i
   *  price, regionId, buyerType(first|nohome|one_dispose|one|multi),
   *  annualIncome, existingAnnualDebtService, rate, termYears,
   *  method(amortized|equalPrincipal), rateType(variable|mixed|periodic|fixed), lender(bank|nonbank)
   */
  function loanLimit(i) {
    const r = region(i.regionId);
    const zone = zoneOf(r);
    const ltv = P.LOAN.ltv[zone][i.buyerType] ?? 0;
    const ltvAmount = i.price * ltv;

    let cap = Infinity;
    if (r.regulated) cap = lookup(P.LOAN.regulatedCaps.map((c) => [c.upTo, c.cap]), i.price)[1];
    else if (r.capital) cap = P.LOAN.capitalCap;

    const termYears = r.capital || r.regulated ? Math.min(i.termYears, P.LOAN.capitalMaxTermYears) : i.termYears;
    const stressBase = r.capital || r.regulated ? P.LOAN.stressRate.capital : P.LOAN.stressRate.local;
    const stress = (stressBase * (P.LOAN.stressWeight[i.rateType] ?? 1)) / 100;
    const dsrRate = i.rate + stress;
    const dsrLimit = P.LOAN.dsrLimit[i.lender || 'bank'];
    const room = i.annualIncome * dsrLimit - (i.existingAnnualDebtService || 0);

    let dsrAmount;
    if (room <= 0) dsrAmount = 0;
    else if (i.method === 'equalPrincipal') {
      // 첫해 원리금이 room이 되는 원금을 이분탐색
      let lo = 0, hi = room * termYears * 2;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (annualDebtService(mid, dsrRate, termYears, 'equalPrincipal') > room) hi = mid; else lo = mid;
      }
      dsrAmount = lo;
    } else dsrAmount = pv(room / 12, dsrRate, termYears * 12);

    // 총 대출 1억원 이하는 DSR 적용 제외
    const dsrExempt = !(i.existingAnnualDebtService > 0) && Math.min(ltvAmount, cap) <= 1 * EOK;
    if (dsrExempt) dsrAmount = Infinity;

    const candidates = [
      { key: 'ltv', label: `LTV ${Math.round(ltv * 100)}%`, amount: ltvAmount },
      { key: 'cap', label: '주담대 절대한도', amount: cap },
      { key: 'dsr', label: dsrExempt ? 'DSR (1억 이하 미적용)' : `DSR ${Math.round(dsrLimit * 100)}% (스트레스 +${(stress * 100).toFixed(2)}%p)`, amount: dsrAmount },
    ];
    const binding = candidates.reduce((a, b) => (b.amount < a.amount ? b : a));
    const amount = Math.max(0, Math.floor(binding.amount / 1e6) * 1e6); // 100만원 단위 절사

    const conditions = [];
    if (i.buyerType === 'one' && (r.capital || r.regulated)) conditions.push('수도권·규제지역 1주택자는 기존 주택 처분 약정(6개월) 없이는 주담대 불가');
    if (i.buyerType === 'multi' && (r.capital || r.regulated)) conditions.push('수도권·규제지역 2주택 이상 보유자는 주택구입 주담대 불가');
    if (r.capital || r.regulated) conditions.push(`대출 실행 후 ${P.LOAN.moveInMonths}개월 내 전입 의무`);
    if (r.landPermit) conditions.push('토지거래허가 필요 — 허가 후 2년 실거주 의무, 전세 낀 매수 불가');
    if (r.regulated || i.price >= 6 * EOK) conditions.push('자금조달계획서 제출 대상' + (r.regulated ? ' (증빙자료 포함)' : ''));
    if (termYears < i.termYears) conditions.push(`수도권·규제지역 만기 상한 ${P.LOAN.capitalMaxTermYears}년 적용`);

    return {
      region: r, zone, ltv, ltvAmount, cap, dsrAmount, dsrRate, stress, dsrLimit, termYears,
      binding, candidates, amount, conditions,
      monthlyPayment: i.method === 'equalPrincipal'
        ? schedule(amount, i.rate, termYears, 'equalPrincipal').payment[0] || 0
        : pmt(amount, i.rate, termYears * 12),
    };
  }

  // 정책모기지 자격 간이 판정
  function policyLoanEligibility(i) {
    // i: price, householdIncome, netAsset, areaM2, buyerType, newlywed, newborn, multichild
    const noHome = i.buyerType === 'first' || i.buyerType === 'nohome';
    return P.POLICY_LOANS.map((p) => {
      const reasons = [];
      const tier = (obj) => {
        if (i.newlywed && obj.newlywed != null) return obj.newlywed;
        if (i.multichild && obj.multichild != null) return obj.multichild;
        if (i.buyerType === 'first' && obj.first != null) return obj.first;
        return obj.base;
      };
      if (p.requireNoHome && !noHome) reasons.push('무주택 요건');
      if (p.requireNewborn && !i.newborn) reasons.push('2년 내 출산 요건');
      if (i.householdIncome > tier(p.maxIncome)) reasons.push('소득 초과');
      if (i.price > tier(p.maxPrice)) reasons.push('주택가격 초과');
      if (p.maxNetAsset && i.netAsset > p.maxNetAsset) reasons.push('순자산 초과');
      if (i.areaM2 > p.maxAreaM2) reasons.push('전용면적 초과');
      return { id: p.id, name: p.name, eligible: reasons.length === 0, reasons, maxLoan: tier(p.maxLoan), rate: p.rate };
    });
  }

  // ── 취득 비용 ─────────────────────────────────────────────────────────
  function generalAcqRate(price) {
    const { generalLow, generalHigh } = P.ACQUISITION;
    if (price <= generalLow.upTo) return generalLow.rate;
    if (price > generalHigh.from) return generalHigh.rate;
    // 6억~9억: (취득가액 × 2/3억 − 3) %, 세율을 소수점 다섯째 자리에서 반올림 (7억 → 1.67%)
    return Math.round(((price / EOK) * (2 / 3) - 3) * 100) / 1e4;
  }

  /**
   * i: price, regionId, homesAfter(취득 후 주택 수), temporaryTwo(일시적 2주택), areaOver85, firstTime
   */
  function acquisitionTax(i) {
    const r = region(i.regionId);
    const A = P.ACQUISITION;
    const n = i.temporaryTwo && i.homesAfter === 2 ? 1 : i.homesAfter;
    let rate = generalAcqRate(i.price);
    let heavy = false;
    const table = r.regulated ? A.heavy.regulated : A.heavy.nonRegulated;
    const heavyKeys = Object.keys(table).map(Number).sort((a, b) => a - b);
    for (const k of heavyKeys) if (n >= k) { rate = table[k]; heavy = true; }

    let acq = i.price * rate;
    let credit = 0;
    if (i.firstTime && !heavy && i.price <= A.firstTimeCredit.maxPrice) {
      credit = Math.min(acq, A.firstTimeCredit.maxCredit);
      acq -= credit;
    }
    const edu = heavy ? i.price * A.heavyEduRate : i.price * rate * 0.1;
    const rural = i.areaOver85 ? i.price * (heavy ? A.ruralTax[rate] : A.ruralTax.general) : 0;
    return {
      rate, heavy, credit,
      acquisition: floorWon(acq), education: floorWon(edu), rural: floorWon(rural),
      total: floorWon(acq) + floorWon(edu) + floorWon(rural),
    };
  }

  // 중개보수 구간은 'N 미만' 기준이므로 경계값에서 상위 요율을 적용한다
  function brokerFee(price, kind, vat) {
    const table = P.BROKER[kind];
    const row = table.find((r) => price < r[0]) || table[table.length - 1];
    const fee = Math.min(price * row[1], row[2] ?? Infinity);
    return Math.round(fee * (vat ? 1.1 : 1));
  }

  // 국민주택채권 즉시매도 손실 (시가표준액 × 매입률 × 할인율)
  // 월세가 있는 임대차의 환산보증금: 보증금 + 월세×100, 5천만원 미만이면 월세×70
  function leaseBase(deposit, monthly) {
    const v = deposit + monthly * 100;
    return v < 5000 * 1e4 ? deposit + monthly * 70 : v;
  }

  function bondCost(publicPrice, regionId, discountRate) {
    const r = region(regionId);
    const rate = lookup(P.ACQUISITION.bond[r.metro ? 'metro' : 'other'], publicPrice)[1];
    return Math.round(publicPrice * rate * discountRate);
  }

  function closingCosts(i) {
    // i: price, regionId, homesAfter, temporaryTwo, areaOver85, firstTime, publicPrice, bondDiscount, legalFeeRate, vat
    const tax = acquisitionTax(i);
    const broker = brokerFee(i.price, 'sale', i.vat);
    const bond = bondCost(i.publicPrice, i.regionId, i.bondDiscount ?? 0.08);
    const stamp = lookup(P.ACQUISITION.stampDuty, i.price)[1];
    const legal = Math.round(i.price * (i.legalFeeRate ?? 0.0008));
    const items = [
      { label: '취득세', amount: tax.acquisition },
      { label: '지방교육세', amount: tax.education },
      { label: '농어촌특별세', amount: tax.rural },
      { label: '중개보수', amount: broker },
      { label: '국민주택채권 할인', amount: bond },
      { label: '인지세', amount: stamp },
      { label: '법무사·등기 실비', amount: legal },
    ];
    return { tax, items, total: items.reduce((a, b) => a + b.amount, 0) };
  }

  // ── 보유세 ────────────────────────────────────────────────────────────
  /**
   * i: publicPrice(공시가격), oneHouse(1세대1주택), homes, age, yearsHeld, resident, reform2026
   */
  function holdingTax(i) {
    const H = P.HOLDING;
    const pp = i.publicPrice;
    const fmv = i.oneHouse ? lookup(H.propertyFmv.oneHouse, pp)[1] : H.propertyFmv.other;
    const base = pp * fmv;
    const special = i.oneHouse && pp <= H.propertySpecialMaxPublic;
    const property = progressive(special ? H.propertySpecial : H.propertyStandard, base);
    const urban = base * H.urbanRate;
    const edu = property * H.localEduRate;

    const C = H.cpt;
    let deduction = i.oneHouse ? C.deduction.oneHouse : C.deduction.other;
    if (i.reform2026 && i.oneHouse) deduction = i.resident === false ? C.reform2026.oneHouseNonResident : C.reform2026.oneHouseResident;
    const cptBase = Math.max(0, (pp - deduction) * C.fmv);
    let cpt = progressive((i.homes || 1) >= 3 && cptBase > 12 * EOK ? C.ratesHeavy : C.rates, cptBase);
    // 재산세 중복분 공제
    if (cpt > 0) {
      const std = (b) => progressive(H.propertyStandard, b);
      const overlap = property * (std(cptBase * fmv) / Math.max(1, std(base)));
      cpt = Math.max(0, cpt - overlap);
    }
    let credit = 0;
    if (i.oneHouse && cpt > 0) {
      credit = Math.min(C.maxCredit, ageCredit(i.age) + holdCredit(i.yearsHeld));
      cpt *= 1 - credit;
    }
    const rural = cpt * C.ruralRate;
    const r = (x) => floorWon(x);
    const out = {
      propertyBase: base, special, property: r(property), urban: r(urban), propertyEdu: r(edu),
      cptBase, cpt: r(cpt), cptRural: r(rural), credit,
    };
    out.total = out.property + out.urban + out.propertyEdu + out.cpt + out.cptRural;
    return out;
  }
  function ageCredit(age) {
    const t = P.HOLDING.cpt.ageCredit; // [미만, 공제율]
    for (const [under, rate] of t) if ((age || 0) < under) return rate;
    return 0;
  }
  function holdCredit(years) {
    const t = P.HOLDING.cpt.holdCredit;
    for (const [under, rate] of t) if ((years || 0) < under) return rate;
    return 0;
  }

  // ── 양도세 ────────────────────────────────────────────────────────────
  /**
   * i: buyPrice, sellPrice, expenses(취득세·중개보수 등 필요경비), yearsHeld, yearsResided,
   *    oneHouse, regulatedAtPurchase, homesAtSale, regulatedAtSale
   */
  function capitalGainsTax(i) {
    const T = P.TRANSFER;
    const gain = i.sellPrice - i.buyPrice - (i.expenses || 0);
    const res = { gain, exempt: false, taxableGain: 0, ltDeduction: 0, taxBase: 0, tax: 0, local: 0, total: 0, note: '' };
    if (gain <= 0) { res.note = '양도차익 없음'; return res; }

    const needReside = i.regulatedAtPurchase ? T.minResideYearsRegulated : 0;
    const exemptEligible = i.oneHouse && i.yearsHeld >= T.minHoldYears && i.yearsResided >= needReside;
    let taxable = gain;
    let heavy = 0;
    if (exemptEligible) {
      if (i.sellPrice <= T.exemptThreshold) { res.exempt = true; res.note = '1세대1주택 비과세'; return res; }
      taxable = (gain * (i.sellPrice - T.exemptThreshold)) / i.sellPrice;
      res.note = '12억 초과분 과세';
    } else if (!i.oneHouse && i.regulatedAtSale && (i.homesAtSale || 1) >= 2) {
      heavy = T.heavySurcharge[Math.min(3, i.homesAtSale)];
      res.note = '규제지역 다주택 중과';
    } else if (i.oneHouse) {
      res.note = i.yearsHeld < T.minHoldYears ? '보유기간 2년 미달' : '규제지역 취득 — 거주 2년 미달';
    }

    let ltRate = 0;
    const held = Math.floor(i.yearsHeld);
    const resided = Math.floor(i.yearsResided);
    if (heavy === 0 && held >= 3) {
      if (exemptEligible && resided >= 2) {
        const holdPart = Math.min(0.4, 0.04 * held);
        const residePart = resided >= 3 ? Math.min(0.4, 0.04 * resided) : 0.08; // 보유3년+거주2~3년 8%
        ltRate = holdPart + residePart;
      } else ltRate = Math.min(0.3, 0.02 * held);
    }
    const ltDeduction = taxable * ltRate;
    const taxBase = Math.max(0, taxable - ltDeduction - T.basicDeduction);

    let tax;
    const general = progressive(T.brackets, taxBase) + taxBase * heavy;
    if (i.yearsHeld < 1) tax = Math.max(taxBase * T.shortTerm.under1, general);
    else if (i.yearsHeld < 2) tax = Math.max(taxBase * T.shortTerm.under2, general);
    else tax = general;

    Object.assign(res, { taxableGain: taxable, ltRate, ltDeduction, taxBase, tax: floorWon(tax), local: floorWon(tax * T.localIncomeRate) });
    res.total = res.tax + res.local;
    return res;
  }

  // ── 매수 vs 임차 시뮬레이션 ───────────────────────────────────────────
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * 동일 현금·동일 월 지출 예산 비교. 두 시나리오 중 월 주거비가 적은 쪽이 차액을 투자한다.
   * s: {
   *   years, cash, price, loan, rate, termYears, method, closing, regionId, homesAfter,
   *   publicRatio, maintenanceRate, appreciation(연), appreciationPath?(연도별 배열),
   *   invReturn(연), invPath?(연도별), rentDeposit, rentMonthly, rentLoan, rentLoanRate,
   *   rentGrowth(연), moveCost, oneHouse, age, reform2026, vat
   * }
   */
  function simulate(s) {
    const months = s.years * 12;
    const sch = schedule(s.loan, s.rate, s.termYears, s.method);
    const r = region(s.regionId);

    const buyUpfront = s.price - s.loan + s.closing;
    const rentBroker = brokerFee(leaseBase(s.rentDeposit, s.rentMonthly), 'lease', s.vat);
    const useRenewal = s.useRenewalRight !== false;
    const rentUpfront = s.rentDeposit - s.rentLoan + rentBroker + s.moveCost;

    let buyPort = s.cash - buyUpfront - s.moveCost;
    let rentPort = s.cash - rentUpfront;
    let price = s.price;
    let deposit = s.rentDeposit;
    let monthly = s.rentMonthly;
    let rentLoan = s.rentLoan;
    let rentIndex = 1; // 최초 계약 대비 임차료 배수
    let yearHolding = 0;
    const series = [{ year: 0, buy: s.cash - buyUpfront - s.moveCost + (s.price - s.loan), rent: s.cash - rentUpfront + (s.rentDeposit - s.rentLoan), price }];
    let buyHousingCost = 0, rentHousingCost = 0;

    for (let m = 0; m < months; m++) {
      const y = Math.floor(m / 12);
      if (m % 12 === 0) {
        const pp = price * (s.publicRatio ?? P.HOLDING.publicPriceRatio);
        yearHolding = holdingTax({ publicPrice: pp, oneHouse: s.oneHouse, homes: s.homesAfter, age: (s.age || 40) + y, yearsHeld: y, resident: true, reform2026: s.reform2026 }).total;
      }
      const g = Math.max(-0.95, s.appreciationPath ? s.appreciationPath[y] : s.appreciation);
      const inv = Math.max(-0.95, s.invPath ? s.invPath[y] : s.invReturn);
      const gm = Math.pow(1 + g, 1 / 12) - 1;
      const im = Math.pow(1 + inv, 1 / 12) - 1;

      // 임차 계약 만료 (24개월마다). 계약갱신청구권을 쓰면 2+2년 주기로
      // 갱신 때는 5% 상한·이사 없음, 새 계약 때는 시세 반영·중개보수·이사비 부담
      if (m > 0 && m % 24 === 0) {
        const market = Math.pow(1 + s.rentGrowth, m / 12);
        const renewal = useRenewal && m % 48 === 24;
        const target = renewal ? Math.min(market, rentIndex * (1 + P.RENT.renewalCap)) : market;
        rentIndex = target;
        const newDeposit = s.rentDeposit * target;
        const newMonthly = s.rentMonthly * target;
        rentPort -= newDeposit - deposit; // 보증금 증감분은 투자자산에서 충당
        if (!renewal) {
          const cost = brokerFee(leaseBase(newDeposit, newMonthly), 'lease', s.vat) + s.moveCost;
          rentPort -= cost;
          rentHousingCost += cost;
        }
        deposit = newDeposit;
        monthly = newMonthly;
      }

      const mortgage = m < sch.payment.length ? sch.payment[m] : 0;
      const mortgageInterest = m < sch.interest.length ? sch.interest[m] : 0;
      const buyOut = mortgage + yearHolding / 12 + (price * s.maintenanceRate) / 12;
      const rentOut = monthly + (rentLoan * s.rentLoanRate) / 12 + (deposit * P.RENT.guaranteeFeeRate) / 12;
      buyHousingCost += mortgageInterest + yearHolding / 12 + (price * s.maintenanceRate) / 12;
      rentHousingCost += rentOut;
      const budget = Math.max(buyOut, rentOut);

      buyPort = buyPort * (1 + im) + (budget - buyOut);
      rentPort = rentPort * (1 + im) + (budget - rentOut);
      price *= 1 + gm;

      if ((m + 1) % 12 === 0) {
        const bal = m < sch.balance.length ? sch.balance[m] : 0;
        series.push({ year: (m + 1) / 12, buy: buyPort + price - bal, rent: rentPort + deposit - rentLoan, price });
      }
    }

    const balance = months <= sch.balance.length ? sch.balance[months - 1] ?? s.loan : 0;
    const sellFee = brokerFee(price, 'sale', s.vat);
    const cgt = capitalGainsTax({
      buyPrice: s.price, sellPrice: price, expenses: s.closing + sellFee,
      yearsHeld: s.years, yearsResided: s.years, oneHouse: s.oneHouse,
      regulatedAtPurchase: r.regulated, homesAtSale: s.homesAfter, regulatedAtSale: r.regulated,
    });
    const buyFinal = buyPort + price - balance - sellFee - cgt.total;
    const rentFinal = rentPort + deposit - rentLoan;
    return {
      buyFinal, rentFinal, diff: buyFinal - rentFinal, series,
      salePrice: price, sellFee, cgt, balance, buyUpfront, rentUpfront,
      buyHousingCost, rentHousingCost,
      feasible: buyUpfront + s.moveCost <= s.cash && rentUpfront <= s.cash,
    };
  }

  // 매수=임차가 되는 연 집값 상승률 (이분탐색)
  function breakevenAppreciation(s) {
    let lo = -0.15, hi = 0.25;
    const f = (g) => simulate({ ...s, appreciation: g, appreciationPath: null }).diff;
    if (f(lo) > 0) return lo;
    if (f(hi) < 0) return null;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  // 몬테카를로: 연도별 집값상승률·투자수익률을 정규분포로 샘플링
  function monteCarlo(s, opt) {
    const runs = opt.runs || 1000;
    const rand = mulberry32(opt.seed ?? 42);
    const diffs = [];
    const finals = [];
    for (let k = 0; k < runs; k++) {
      const appreciationPath = [], invPath = [];
      for (let y = 0; y < s.years; y++) {
        appreciationPath.push(s.appreciation + opt.appreciationVol * gaussian(rand));
        invPath.push(s.invReturn + opt.invVol * gaussian(rand));
      }
      const res = simulate({ ...s, appreciationPath, invPath });
      diffs.push(res.diff);
      finals.push(res.buyFinal);
    }
    diffs.sort((a, b) => a - b);
    finals.sort((a, b) => a - b);
    const q = (arr, p) => arr[clamp(Math.floor(p * (arr.length - 1)), 0, arr.length - 1)];
    return {
      runs,
      buyWinProb: diffs.filter((d) => d > 0).length / runs,
      diff: { p10: q(diffs, 0.1), p50: q(diffs, 0.5), p90: q(diffs, 0.9) },
      buyFinal: { p10: q(finals, 0.1), p50: q(finals, 0.5), p90: q(finals, 0.9) },
      histogram: histogram(diffs, 24),
    };
  }
  function histogram(values, bins) {
    const min = values[0], max = values[values.length - 1];
    const w = (max - min) / bins || 1;
    const out = Array.from({ length: bins }, (_, k) => ({ from: min + k * w, to: min + (k + 1) * w, count: 0 }));
    for (const v of values) out[clamp(Math.floor((v - min) / w), 0, bins - 1)].count++;
    return out;
  }

  // ── 최대 매수 가능가 ──────────────────────────────────────────────────
  /**
   * 보유 현금 + 대출 한도 − 취득 부대비용으로 살 수 있는 최고 가격 (이분탐색).
   * i: loanLimit 입력 + cash, moveCost, areaOver85, homesAfter, temporaryTwo, publicRatio, bondDiscount, vat
   */
  function maxAffordablePrice(i) {
    const need = (price) => {
      const loan = loanLimit({ ...i, price }).amount;
      const closing = closingCosts({ ...i, price, firstTime: i.buyerType === 'first', publicPrice: price * (i.publicRatio ?? P.HOLDING.publicPriceRatio) }).total;
      return { loan, gap: price - loan + closing + (i.moveCost || 0) - i.cash };
    };
    let lo = 0, hi = Math.max(1 * EOK, i.cash * 20);
    if (need(hi).gap <= 0) return { price: hi, loan: need(hi).loan, capped: true };
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      if (need(mid).gap <= 0) lo = mid; else hi = mid;
    }
    const price = Math.floor(lo / 1e6) * 1e6;
    return { price, loan: need(price).loan, capped: false };
  }

  // ── 민감도 분석 (토네이도) ────────────────────────────────────────────
  // 가정 하나씩 흔들어 매수−임차 순자산 차이가 얼마나 변하는지 측정
  function sensitivity(s) {
    const base = simulate(s).diff;
    const knobs = [
      { key: 'appreciation', label: '집값 상승률', step: 0.02, unit: '%p' },
      { key: 'invReturn', label: '투자수익률', step: 0.02, unit: '%p' },
      { key: 'rate', label: '대출 금리', step: 0.01, unit: '%p' },
      { key: 'rentGrowth', label: '전월세 상승률', step: 0.02, unit: '%p' },
      { key: 'maintenanceRate', label: '수선·유지비', step: 0.002, unit: '%p' },
    ];
    const rows = knobs.map((k) => {
      const low = simulate({ ...s, [k.key]: s[k.key] - k.step }).diff - base;
      const high = simulate({ ...s, [k.key]: s[k.key] + k.step }).diff - base;
      return { ...k, low, high, range: Math.abs(high - low) };
    });
    const years = [Math.max(1, s.years - 5), s.years + 5].map((y) => simulate({ ...s, years: y }).diff);
    rows.push({ key: 'years', label: '보유 기간', step: 5, unit: '년', low: years[0] - base, high: years[1] - base, range: Math.abs(years[1] - years[0]) });
    rows.sort((a, b) => b.range - a.range);
    return { base, rows };
  }

  // ── 매수 시점 비교 ────────────────────────────────────────────────────
  /**
   * 지금 사기 vs W년 임차 후 사기. 비교 종료 시점(s.years)은 같다.
   * 대기 기간의 임차 순자산이 그대로 매수 시점의 현금이 된다.
   * s: simulate 입력, opt: { waits:[0,1,2,3], scenarios:[연 상승률...], rateChange(대기 중 금리 변화),
   *    loanFor(price, rate) → 대출액, closingFor(price) → 부대비용 }
   */
  function timingCompare(s, opt) {
    const waits = (opt.waits || [0, 1, 2, 3]).filter((w) => w < s.years);
    const scenarios = opt.scenarios || [s.appreciation];
    const run = (g, w) => {
      const base = { ...s, appreciation: g, appreciationPath: null, invPath: null };
      if (w === 0) {
        const r = simulate(base);
        return { final: r.buyFinal, price: s.price, loan: s.loan, feasible: r.feasible };
      }
      const renting = simulate({ ...base, years: w });
      const price = s.price * Math.pow(1 + g, w);
      const rate = Math.max(0, s.rate + (opt.rateChange || 0));
      const loan = opt.loanFor(price, rate);
      const closing = opt.closingFor(price);
      const grow = Math.pow(1 + s.rentGrowth, w);
      const later = simulate({
        ...base, years: s.years - w, cash: renting.rentFinal, price, loan, rate, closing,
        rentDeposit: s.rentDeposit * grow, rentMonthly: s.rentMonthly * grow, age: (s.age || 40) + w,
      });
      // 매수 전 이사비는 이미 임차 시나리오에서 부담했으므로 이사 1회분은 그대로 둔다
      return { final: later.buyFinal, price, loan, feasible: later.feasible };
    };
    return {
      waits, scenarios,
      grid: waits.map((w) => ({ wait: w, cells: scenarios.map((g) => ({ g, ...run(g, w) })) })),
    };
  }

  // ── 국토부 실거래가 API (RTMSDataSvcAptTrade) XML ────────────────────
  function parseRtmsXml(xml) {
    const tag = (src, name) => {
      const m = src.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
      return m ? m[1].trim() : '';
    };
    const code = tag(xml, 'resultCode');
    if (code && !/^0+$/.test(code)) throw new Error(`API 오류 ${code}: ${tag(xml, 'resultMsg')}`);
    const items = xml.split('<item>').slice(1).map((chunk) => chunk.split('</item>')[0]);
    const out = [];
    for (const it of items) {
      if (tag(it, 'cdealType') === 'O') continue; // 해제된 거래
      const price = Number(tag(it, 'dealAmount').replace(/[^0-9]/g, '')) * 1e4;
      const y = tag(it, 'dealYear'), m = tag(it, 'dealMonth'), d = tag(it, 'dealDay');
      if (!price || !y) continue;
      const floor = tag(it, 'floor');
      out.push({
        date: `${y}-${m.padStart(2, '0')}-${(d || '1').padStart(2, '0')}`,
        area: Number(tag(it, 'excluUseAr')) || null, price,
        name: tag(it, 'aptNm'), floor: floor === '' ? null : Number(floor), dong: tag(it, 'umdNm'),
      });
    }
    return { items: out, totalCount: Number(tag(xml, 'totalCount')) || out.length };
  }

  // ── 스트레스 테스트 ───────────────────────────────────────────────────
  function stressTest(i) {
    // i: loan, rate, termYears, method, monthlyIncome, price, equity
    const rateShocks = [0, 0.01, 0.02, 0.03].map((d) => {
      const pay = i.method === 'equalPrincipal'
        ? schedule(i.loan, i.rate + d, i.termYears, 'equalPrincipal').payment[0] || 0
        : pmt(i.loan, i.rate + d, i.termYears * 12);
      return { shock: d, rate: i.rate + d, payment: pay, burden: i.monthlyIncome > 0 ? pay / i.monthlyIncome : Infinity };
    });
    const priceShocks = [0, -0.1, -0.2, -0.3].map((d) => {
      const v = i.price * (1 + d);
      return { shock: d, value: v, equity: v - i.loan, ltv: v > 0 ? i.loan / v : Infinity };
    });
    return { rateShocks, priceShocks };
  }

  // ── 종합 판정 ─────────────────────────────────────────────────────────
  function verdict(ctx) {
    // ctx: fundingGap, burden, stressBurden(+2%p), buyWinProb, breakeven, expectedAppreciation,
    //      emergencyMonths, jeonseRatio, pir
    const checks = [];
    const add = (key, label, status, detail) => checks.push({ key, label, status, detail });
    const pct = (x) => (x * 100).toFixed(1) + '%';

    if (ctx.fundingGap > 0) add('funding', '자금 조달', 'critical', `자기자본이 ${Math.round(ctx.fundingGap / 1e4).toLocaleString()}만원 부족`);
    else add('funding', '자금 조달', 'good', '대출+보유현금으로 매수 가능');

    add('burden', '월 상환 부담률', ctx.burden <= 0.3 ? 'good' : ctx.burden <= 0.4 ? 'warning' : 'critical', `월 소득 대비 ${pct(ctx.burden)} (권장 30% 이하)`);
    add('stress', '금리 +2%p 시 부담률', ctx.stressBurden <= 0.4 ? 'good' : ctx.stressBurden <= 0.5 ? 'warning' : 'critical', pct(ctx.stressBurden));
    add('emergency', '비상자금', ctx.emergencyMonths >= 6 ? 'good' : ctx.emergencyMonths >= 3 ? 'warning' : 'critical', `매수 후 여유자금 ≈ 생활비 ${ctx.emergencyMonths.toFixed(1)}개월분 (권장 6개월)`);

    if (ctx.buyWinProb != null) add('mc', '매수가 임차보다 유리할 확률', ctx.buyWinProb >= 0.6 ? 'good' : ctx.buyWinProb >= 0.4 ? 'warning' : 'critical', pct(ctx.buyWinProb));
    if (ctx.breakeven == null) add('breakeven', '손익분기 집값상승률', 'critical', '연 25% 상승에도 임차가 유리');
    else add('breakeven', '손익분기 집값상승률', ctx.breakeven <= ctx.expectedAppreciation - 0.01 ? 'good' : ctx.breakeven <= ctx.expectedAppreciation + 0.01 ? 'warning' : 'critical', `연 ${pct(ctx.breakeven)} 이상 올라야 매수가 유리 (가정 ${pct(ctx.expectedAppreciation)})`);

    if (ctx.jeonseRatio != null) add('jeonse', '전세가율', ctx.jeonseRatio >= 0.5 ? 'good' : ctx.jeonseRatio >= 0.4 ? 'warning' : 'serious', `${pct(ctx.jeonseRatio)} — ${ctx.jeonseRatio < 0.4 ? '사용가치 대비 기대 프리미엄이 큼' : '사용가치가 가격을 받쳐줌'}`);
    if (ctx.pir != null) add('pir', 'PIR (가격/연소득)', ctx.pir <= 10 ? 'good' : ctx.pir <= 15 ? 'warning' : 'serious', `${ctx.pir.toFixed(1)}배`);

    const weight = { good: 2, warning: 1, serious: 0.5, critical: 0 };
    const score = Math.round((checks.reduce((a, c) => a + weight[c.status], 0) / (checks.length * 2)) * 100);
    const blocked = checks.some((c) => c.key === 'funding' && c.status === 'critical');
    let label, tone;
    if (blocked) { label = '매수 불가 — 자금 부족'; tone = 'critical'; }
    else if (score >= 75 && !checks.some((c) => c.status === 'critical')) { label = '매수 적극 검토'; tone = 'good'; }
    else if (score >= 50) { label = '조건부 검토'; tone = 'warning'; }
    else { label = '보류 권장'; tone = 'critical'; }
    return { score, label, tone, checks };
  }

  // ── 실거래가 CSV (국토부 실거래가 공개시스템 내려받기 형식) ────────────
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', q = false;
    for (let k = 0; k < text.length; k++) {
      const c = text[k];
      if (q) {
        if (c === '"' && text[k + 1] === '"') { field += '"'; k++; }
        else if (c === '"') q = false;
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[k + 1] === '\n') k++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }

  /** 헤더 행을 찾아 {date, area, price, floor, name} 거래 목록 반환. 금액(만원) → 원 */
  function parseTransactions(text) {
    const rows = parseCsv(text.replace(/^﻿/, ''));
    const hi = rows.findIndex((r) => r.some((c) => c.includes('거래금액')) && r.some((c) => c.includes('계약년월')));
    if (hi < 0) throw new Error('거래금액 열을 찾을 수 없습니다');
    const h = rows[hi].map((c) => c.trim());
    const col = (re) => h.findIndex((c) => re.test(c));
    const cPrice = col(/거래금액/), cArea = col(/전용면적/), cYm = col(/계약년월/), cDay = col(/계약일/),
      cName = col(/단지명/), cFloor = col(/^층$/), cCancel = col(/해제사유/);
    const out = [];
    for (const r of rows.slice(hi + 1)) {
      const price = Number(String(r[cPrice] || '').replace(/[^0-9]/g, '')) * 1e4;
      if (!price) continue;
      if (cCancel >= 0 && String(r[cCancel] || '').trim() && String(r[cCancel]).trim() !== '-') continue; // 해제거래 제외
      const ym = String(r[cYm] || '').replace(/[^0-9]/g, '');
      const day = String(r[cDay] || '1').replace(/[^0-9]/g, '') || '1';
      out.push({
        date: ym.length >= 6 ? `${ym.slice(0, 4)}-${ym.slice(4, 6)}-${day.padStart(2, '0')}` : null,
        area: Number(r[cArea]) || null, price,
        name: cName >= 0 ? r[cName] : '', floor: cFloor >= 0 && String(r[cFloor]).trim() !== '' ? Number(r[cFloor]) : null,
      });
    }
    return out.filter((t) => t.date).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** 비교사례: 면적 ±tol 이내 거래로 ㎡당 가격 추세(선형회귀)와 대상 면적 추정가 */
  function comparables(txs, targetArea, tol) {
    const pick = txs.filter((t) => t.area && Math.abs(t.area - targetArea) <= (tol ?? 5));
    if (pick.length < 2) return null;
    const t0 = Date.parse(pick[0].date);
    const pts = pick.map((t) => ({ x: (Date.parse(t.date) - t0) / (365.25 * 864e5), y: t.price / t.area, t }));
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
    const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    const slope = sxx ? pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx : 0;
    const intercept = my - slope * mx;
    const now = (Date.now() - t0) / (365.25 * 864e5);
    const latest = pts.slice(-Math.min(5, n)).map((p) => p.y).sort((a, b) => a - b);
    const median = latest[Math.floor(latest.length / 2)];
    const resid = Math.sqrt(pts.reduce((a, p) => a + (p.y - (intercept + slope * p.x)) ** 2, 0) / Math.max(1, n - 2));
    return {
      count: n, points: pts, slope, intercept,
      annualTrend: my ? slope / my : 0,
      estimate: (intercept + slope * now) * targetArea,
      recentMedian: median * targetArea,
      band: resid * targetArea,
    };
  }

  return {
    pmt, pv, schedule, annualDebtService, loanLimit, policyLoanEligibility,
    generalAcqRate, acquisitionTax, brokerFee, leaseBase, bondCost, closingCosts,
    holdingTax, capitalGainsTax, simulate, breakevenAppreciation, monteCarlo,
    stressTest, verdict, maxAffordablePrice, sensitivity, timingCompare, parseRtmsXml, parseCsv, parseTransactions, comparables, region,
  };
});
