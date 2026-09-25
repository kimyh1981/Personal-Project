const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const P = require('../js/policy.js');

const EOK = 1e8, MAN = 1e4;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`);

test('원리금균등 월 상환액', () => {
  near(E.pmt(1 * EOK, 0.04, 360), 477415, 1);
  near(E.pv(E.pmt(3 * EOK, 0.05, 360), 0.05, 360), 3 * EOK, 1);
  const s = E.schedule(1 * EOK, 0.04, 30, 'equalPrincipal');
  near(s.payment[0], 1 * EOK / 360 + 1 * EOK * 0.04 / 12, 1);
  near(s.balance[359], 0, 1);
});

test('지역 데이터: 서울 25구 + 경기 규제 15곳', () => {
  assert.equal(P.REGIONS.filter((r) => r.id.startsWith('seoul-')).length, 25);
  assert.equal(P.REGIONS.filter((r) => r.id.startsWith('gg-') && r.regulated).length, 15);
  assert.ok(E.region('gg-화성시 동탄구').regulated);
  assert.equal(E.region('incheon').regulated, false);
});

test('취득세: 구간별 세율', () => {
  assert.equal(E.generalAcqRate(5 * EOK), 0.01);
  near(E.generalAcqRate(7.5 * EOK), 0.02, 1e-9);
  assert.equal(E.generalAcqRate(12 * EOK), 0.03);

  const a = E.acquisitionTax({ price: 5 * EOK, regionId: 'seoul-마포구', homesAfter: 1 });
  assert.equal(a.acquisition, 500 * MAN);
  assert.equal(a.education, 50 * MAN);

  const f = E.acquisitionTax({ price: 5 * EOK, regionId: 'seoul-마포구', homesAfter: 1, firstTime: true });
  assert.equal(f.acquisition, 300 * MAN);

  const big = E.acquisitionTax({ price: 12 * EOK, regionId: 'seoul-마포구', homesAfter: 1, areaOver85: true });
  assert.deepEqual([big.acquisition, big.education, big.rural], [3600 * MAN, 360 * MAN, 240 * MAN]);

  const heavy = E.acquisitionTax({ price: 10 * EOK, regionId: 'seoul-강남구', homesAfter: 2 });
  assert.equal(heavy.rate, 0.08);
  assert.equal(heavy.education, 400 * MAN);
  const temp = E.acquisitionTax({ price: 10 * EOK, regionId: 'seoul-강남구', homesAfter: 2, temporaryTwo: true });
  assert.equal(temp.rate, 0.03);
  assert.equal(E.acquisitionTax({ price: 10 * EOK, regionId: 'local', homesAfter: 2 }).rate, 0.03);
  assert.equal(E.acquisitionTax({ price: 10 * EOK, regionId: 'local', homesAfter: 3 }).rate, 0.08);
});

test('중개보수 상한', () => {
  assert.equal(E.brokerFee(10 * EOK, 'sale'), 500 * MAN);
  assert.equal(E.brokerFee(1 * EOK, 'sale'), 50 * MAN);
  assert.equal(E.brokerFee(3000 * MAN, 'sale'), 18 * MAN);
  assert.equal(E.brokerFee(20 * EOK, 'sale', true), Math.round(1400 * MAN * 1.1));
  assert.equal(E.brokerFee(7 * EOK, 'lease'), 280 * MAN);
});

const baseLoan = { annualIncome: 1 * EOK, existingAnnualDebtService: 0, rate: 0.04, termYears: 30, method: 'amortized', rateType: 'variable', lender: 'bank' };

test('대출한도: 서울 무주택 LTV 40%', () => {
  const r = E.loanLimit({ ...baseLoan, price: 12 * EOK, regionId: 'seoul-마포구', buyerType: 'nohome' });
  assert.equal(r.binding.key, 'ltv');
  assert.equal(r.amount, 4.8 * EOK);
  near(r.dsrRate, 0.07, 1e-12);
});

test('대출한도: 생애최초 70%지만 6억 한도', () => {
  const r = E.loanLimit({ ...baseLoan, annualIncome: 2 * EOK, price: 12 * EOK, regionId: 'seoul-마포구', buyerType: 'first' });
  assert.equal(r.binding.key, 'cap');
  assert.equal(r.amount, 6 * EOK);
});

test('대출한도: 규제지역 15~25억 4억, 25억 초과 2억', () => {
  const hi = { ...baseLoan, annualIncome: 5 * EOK, regionId: 'seoul-강남구', buyerType: 'first' };
  assert.equal(E.loanLimit({ ...hi, price: 20 * EOK }).amount, 4 * EOK);
  assert.equal(E.loanLimit({ ...hi, price: 30 * EOK }).amount, 2 * EOK);
});

test('대출한도: DSR이 묶이는 경우 & 1주택 유지 불가', () => {
  const r = E.loanLimit({ ...baseLoan, annualIncome: 5000 * MAN, price: 5 * EOK, regionId: 'local', buyerType: 'nohome' });
  assert.equal(r.binding.key, 'dsr');
  // 연 2000만 상환여력, 4.75% 30년
  near(r.dsrAmount, E.pv(2000 * MAN / 12, 0.0475, 360), 1);
  const one = E.loanLimit({ ...baseLoan, price: 8 * EOK, regionId: 'gg-other', buyerType: 'one' });
  assert.equal(one.amount, 0);
  assert.ok(one.conditions.some((c) => c.includes('처분')));
  const fixed = E.loanLimit({ ...baseLoan, rateType: 'fixed', price: 8 * EOK, regionId: 'gg-other', buyerType: 'nohome' });
  near(fixed.stress, 0, 1e-12);
});

test('재산세: 공시 3억 1세대1주택 ≈ 29.9만원', () => {
  const h = E.holdingTax({ publicPrice: 3 * EOK, oneHouse: true });
  assert.equal(h.property, 99000);
  near(h.total, 299400, 20);
  assert.equal(h.cpt, 0);
});

test('종부세: 공시 20억 1주택', () => {
  const h = E.holdingTax({ publicPrice: 20 * EOK, oneHouse: true, age: 50, yearsHeld: 0 });
  assert.equal(h.property, 2970000);
  near(h.cpt, 2400000, 20);
  near(h.cptRural, 480000, 20);
  const old = E.holdingTax({ publicPrice: 20 * EOK, oneHouse: true, age: 72, yearsHeld: 16 });
  near(old.cpt, 2400000 * 0.2, 20); // 40% + 50% → 최대 80%
  const reform = E.holdingTax({ publicPrice: 13 * EOK, oneHouse: true, reform2026: true, resident: true });
  assert.equal(reform.cpt, 0);
});

test('양도세: 1주택 비과세·고가주택·단기', () => {
  const ex = E.capitalGainsTax({ buyPrice: 8 * EOK, sellPrice: 11 * EOK, yearsHeld: 3, yearsResided: 3, oneHouse: true, regulatedAtPurchase: true });
  assert.equal(ex.exempt, true);
  assert.equal(ex.total, 0);

  const hi = E.capitalGainsTax({ buyPrice: 10 * EOK, sellPrice: 15 * EOK, yearsHeld: 5, yearsResided: 5, oneHouse: true, regulatedAtPurchase: true });
  near(hi.taxableGain, 1 * EOK, 1);
  near(hi.ltRate, 0.4, 1e-12);
  assert.equal(hi.tax, 804 * MAN);
  assert.equal(hi.local, 80.4 * MAN);

  const noReside = E.capitalGainsTax({ buyPrice: 8 * EOK, sellPrice: 11 * EOK, yearsHeld: 3, yearsResided: 1, oneHouse: true, regulatedAtPurchase: true });
  assert.equal(noReside.exempt, false);
  assert.ok(noReside.total > 0);

  const short = E.capitalGainsTax({ buyPrice: 5 * EOK, sellPrice: 6 * EOK, yearsHeld: 1.5, yearsResided: 1.5, oneHouse: true });
  assert.equal(short.tax, Math.floor(((1 * EOK) - 250 * MAN) * 0.6 / 10) * 10);
});

const sim = {
  years: 10, cash: 6 * EOK, price: 10 * EOK, loan: 4 * EOK, rate: 0.04, termYears: 30, method: 'amortized',
  closing: 3500 * MAN, regionId: 'seoul-마포구', homesAfter: 1, maintenanceRate: 0.002,
  appreciation: 0.03, invReturn: 0.035, rentDeposit: 6 * EOK, rentMonthly: 0, rentLoan: 0, rentLoanRate: 0.04,
  rentGrowth: 0.03, moveCost: 300 * MAN, oneHouse: true, age: 40,
};

test('매수 vs 임차: 상승률이 높을수록 매수 유리, 손익분기 존재', () => {
  const lo = E.simulate({ ...sim, appreciation: -0.02 });
  const hi = E.simulate({ ...sim, appreciation: 0.08 });
  assert.ok(hi.diff > lo.diff);
  assert.ok(lo.diff < 0 && hi.diff > 0);
  assert.equal(hi.series.length, 11);
  const be = E.breakevenAppreciation(sim);
  assert.ok(be > -0.02 && be < 0.08);
  near(E.simulate({ ...sim, appreciation: be }).diff, 0, 1e5);
});

test('몬테카를로: 재현성과 확률 범위', () => {
  const a = E.monteCarlo(sim, { runs: 200, seed: 7, appreciationVol: 0.06, invVol: 0.1 });
  const b = E.monteCarlo(sim, { runs: 200, seed: 7, appreciationVol: 0.06, invVol: 0.1 });
  assert.equal(a.buyWinProb, b.buyWinProb);
  assert.ok(a.buyWinProb >= 0 && a.buyWinProb <= 1);
  assert.ok(a.diff.p10 <= a.diff.p50 && a.diff.p50 <= a.diff.p90);
  assert.equal(a.histogram.reduce((s, h) => s + h.count, 0), 200);
});

test('실거래가 CSV 파싱 및 비교사례', () => {
  const csv = '﻿"국토교통부 실거래가"\n"NO","시군구","단지명","전용면적(㎡)","계약년월","계약일","거래금액(만원)","층","해제사유발생일"\n' +
    '1,"서울 마포구 아현동","마래푸",84.59,"202401","05","150,000",10,"-"\n' +
    '2,"서울 마포구 아현동","마래푸",84.59,"202501","15","165,000",12,"-"\n' +
    '3,"서울 마포구 아현동","마래푸",84.59,"202502","15","999,000",3,"20250301"\n' +
    '4,"서울 마포구 아현동","마래푸",59.9,"202506","15","120,000",5,"-"\n' +
    '5,"서울 마포구 아현동","마래푸",84.9,"202601","20","180,000",8,"-"\n';
  const tx = E.parseTransactions(csv);
  assert.equal(tx.length, 4); // 해제거래 제외
  assert.equal(tx[0].price, 15 * EOK);
  const c = E.comparables(tx, 84.6, 3);
  assert.equal(c.count, 3);
  assert.ok(c.annualTrend > 0);
});

test('종합 판정', () => {
  const good = E.verdict({ fundingGap: 0, burden: 0.25, stressBurden: 0.33, buyWinProb: 0.7, breakeven: 0.01, expectedAppreciation: 0.03, emergencyMonths: 8, jeonseRatio: 0.6, pir: 9 });
  assert.equal(good.label, '매수 적극 검토');
  const bad = E.verdict({ fundingGap: 1 * EOK, burden: 0.25, stressBurden: 0.33, buyWinProb: 0.7, breakeven: 0.01, expectedAppreciation: 0.03, emergencyMonths: 8, jeonseRatio: 0.6, pir: 9 });
  assert.equal(bad.tone, 'critical');
});

test('중개보수 경계값은 상위 요율 (N 미만 기준)', () => {
  assert.equal(E.brokerFee(9 * EOK, 'sale'), 450 * MAN);
  assert.equal(E.brokerFee(12 * EOK, 'sale'), 720 * MAN);
  assert.equal(E.brokerFee(15 * EOK, 'sale'), 1050 * MAN);
  assert.equal(E.brokerFee(6 * EOK, 'lease'), 240 * MAN);
  assert.equal(E.brokerFee(5.99 * EOK, 'lease'), Math.round(5.99 * EOK * 0.003));
  assert.equal(E.leaseBase(500 * MAN, 30 * MAN), 500 * MAN + 30 * MAN * 70); // 3,500만 < 5천만 → ×70
  assert.equal(E.leaseBase(1 * EOK, 50 * MAN), 1 * EOK + 50 * MAN * 100);
});

test('취득세 6~9억 세율 반올림: 7억 → 1.67%', () => {
  assert.equal(E.generalAcqRate(7 * EOK), 0.0167);
  assert.equal(E.generalAcqRate(8 * EOK), 0.0233);
});

test('단기 양도 + 중과: 단기세율과 기본세율+중과 중 큰 값', () => {
  const t = E.capitalGainsTax({ buyPrice: 10 * EOK, sellPrice: 15 * EOK, yearsHeld: 1.5, yearsResided: 0, oneHouse: false, homesAtSale: 3, regulatedAtSale: true });
  const base = 5 * EOK - 250 * MAN;
  // 과세표준 4.975억: 40% 구간(누진공제 2,594만) + 3주택 중과 30%p > 단기 60%
  assert.equal(t.tax, Math.floor(Math.max(base * 0.6, base * 0.4 - 2594 * MAN + base * 0.3) / 10) * 10);
});

test('DSR: 총 대출 1억 이하 미적용', () => {
  const r = E.loanLimit({ ...baseLoan, annualIncome: 1000 * MAN, price: 1.4 * EOK, regionId: 'local', buyerType: 'nohome' });
  assert.equal(r.binding.key, 'ltv');
  assert.equal(r.amount, 0.98 * EOK);
});

test('계약갱신청구권: 첫 갱신은 5% 상한·비용 없음', () => {
  const s = { ...sim, rentGrowth: 0.06, years: 4 };
  const withRight = E.simulate(s);
  const without = E.simulate({ ...s, useRenewalRight: false });
  assert.ok(withRight.rentFinal > without.rentFinal);
  assert.ok(withRight.rentHousingCost < without.rentHousingCost);
});

test('몬테카를로: 극단적 변동성에서도 NaN 없음', () => {
  const r = E.monteCarlo(sim, { runs: 100, seed: 0, appreciationVol: 0.8, invVol: 0.8 });
  assert.ok(Number.isFinite(r.diff.p50));
});

test('최대 매수 가능가: 경계에서 자금이 딱 맞는다', () => {
  const i = { ...baseLoan, regionId: 'seoul-마포구', buyerType: 'nohome', cash: 6 * EOK, moveCost: 300 * MAN, homesAfter: 1, publicRatio: 0.69, bondDiscount: 0.08 };
  const r = E.maxAffordablePrice(i);
  // LTV 40%이므로 대략 현금 / 0.6 근처, 부대비용 때문에 조금 낮다
  assert.ok(r.price > 9 * EOK && r.price < 10 * EOK, String(r.price));
  const loan = E.loanLimit({ ...i, price: r.price }).amount;
  const cl = E.closingCosts({ ...i, price: r.price, publicPrice: r.price * 0.69 }).total;
  assert.ok(r.price - loan + cl + 300 * MAN <= 6 * EOK);
});

test('민감도: 집값 상승률을 올리면 매수 쪽 차이가 커진다', () => {
  const r = E.sensitivity(sim);
  const a = r.rows.find((x) => x.key === 'appreciation');
  assert.ok(a.high > 0 && a.low < 0);
  const rate = r.rows.find((x) => x.key === 'rate');
  assert.ok(rate.high < 0);
  assert.equal(r.rows.length, 6);
});
