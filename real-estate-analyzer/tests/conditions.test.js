const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/conditions.js');
const E = require('../js/engine.js');

const EOK = 1e8, MAN = 1e4;

function base(over = {}) {
  const c = {
    purpose: '거주', regionId: 'incheon', propertyType: '아파트', areaM2: 84, price: 5 * EOK,
    recentTrades: [], jeonse: null, assumeTenant: false, cash: 3 * EOK, ownedHomes: 0, willSellExisting: false,
    annualIncome: 8000 * MAN, annualSavings: 0,
    location: { jobCommuteMin: 30, schoolWalkMin: 5, subwayWalkMin: null, amenities: [], negatives: [] },
    recon: { target: false }, timing: { purchaseDate: '2026-11', holdingYears: null, moveInBy: null },
    loan: { rate: 0.04, termYears: 30, method: 'amortized' },
  };
  for (const [k, v] of Object.entries(over)) c[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...c[k], ...v } : v;
  return c;
}
const fund = (over = {}) => ({ price: 5 * EOK, loanUsed: 2 * EOK, tenantDeposit: 0, requiredCash: 3.2 * EOK, surplus: 1000 * MAN, totalCost: 5.2 * EOK, dsr: 0.2, ...over });
const paths = (list) => list.map((r) => r.path);

test('필수 조건: 완전한 입력은 누락 없음', () => {
  assert.deepEqual(C.missing(base()), []);
  assert.equal(C.assess(base(), fund()).ready, true);
});

test('필수 조건: 목적별로 달라진다', () => {
  const live = paths(C.missing(base({ location: { jobCommuteMin: null, schoolWalkMin: null } })));
  assert.ok(live.includes('location.jobCommuteMin') && live.includes('location.schoolWalkMin'));
  const inv = paths(C.missing(base({ purpose: '투자', location: { jobCommuteMin: null } })));
  assert.ok(!inv.includes('location.jobCommuteMin'));
  for (const p of ['location.subwayWalkMin', 'recentTrades', 'jeonse', 'timing.holdingYears']) assert.ok(inv.includes(p), p);
});

test('필수 조건: 재건축·세입자 승계 상황별 항목', () => {
  const r = paths(C.missing(base({ recon: { target: true } })));
  assert.ok(r.includes('recon.stage') && r.includes('recon.expectedContribution'));
  const r2 = paths(C.missing(base({ recon: { target: true, stage: '관리처분인가', expectedContribution: 1 * EOK } })));
  assert.ok(r2.includes('recon.priorAssetValue'));
  assert.ok(paths(C.missing(base({ assumeTenant: true }))).includes('jeonse'));
  const res = C.assess(base({ price: null }), fund());
  assert.equal(res.ready, false);
  assert.ok(paths(res.missing).includes('price'));
});

test('형식 오류', () => {
  assert.ok(C.valueErrors(base({ propertyType: '상가' })).length);
  assert.ok(C.valueErrors(base({ timing: { purchaseDate: '2026/11' } })).length);
});

test('토지거래허가: 아파트만, 전세 낀 매수 차단', () => {
  const gap = C.assess(base({ regionId: 'seoul-송파구', purpose: '투자', assumeTenant: true, jeonse: 2 * EOK, recentTrades: [5 * EOK], location: { subwayWalkMin: 5 }, timing: { holdingYears: 5 } }), fund({ tenantDeposit: 2 * EOK }));
  assert.equal(gap.verdict, '불가');
  assert.ok(gap.flags.some((f) => f.level === 'block' && f.message.includes('토지거래허가')));
  const villa = C.assess(base({ regionId: 'seoul-송파구', propertyType: '빌라', purpose: '투자', assumeTenant: true, jeonse: 2 * EOK, recentTrades: [5 * EOK], location: { subwayWalkMin: 5 }, timing: { holdingYears: 5 } }), fund({ tenantDeposit: 2 * EOK }));
  assert.ok(!villa.flags.some((f) => f.level === 'block' && f.category === '규제'));
});

test('자금 부족은 차단', () => {
  const r = C.assess(base(), fund({ surplus: -5000 * MAN }));
  assert.equal(r.verdict, '불가');
});

test('비거주 수도권: 전입의무로 주담대 불가', () => {
  const r = E.loanLimit({ price: 5 * EOK, regionId: 'incheon', buyerType: 'nohome', annualIncome: 1 * EOK, rate: 0.04, termYears: 30, method: 'amortized', rateType: 'variable', lender: 'bank', livesIn: false });
  assert.equal(r.amount, 0);
  assert.match(r.blockedReason, /전입/);
  const local = E.loanLimit({ price: 3 * EOK, regionId: 'local', buyerType: 'nohome', annualIncome: 1 * EOK, rate: 0.04, termYears: 30, method: 'amortized', rateType: 'variable', lender: 'bank', livesIn: false });
  assert.ok(local.amount > 0);
});

test('오피스텔 취득세 4.6%', () => {
  const t = E.acquisitionTax({ price: 3 * EOK, regionId: 'local', homesAfter: 1, propertyType: '오피스텔' });
  assert.equal(t.total, 3 * EOK * 0.046);
});

test('재건축: 투기과열지구 조합설립인가 이후 지위양도 제한, 매도인 예외', () => {
  const c = base({ regionId: 'seoul-송파구', recon: { target: true, stage: '조합설립인가', priorAssetValue: 18 * EOK, expectedContribution: 5 * EOK, ownerHeldYears: 12, ownerLivedYears: 3 } });
  const r = C.reconstruction(c, fund(), { regulated: true, capital: true, landPermit: true });
  assert.equal(r.transferBlocked, true);
  const ok = C.reconstruction({ ...c, recon: { ...c.recon, ownerLivedYears: 6 } }, fund(), { regulated: true, capital: true, landPermit: true });
  assert.equal(ok.transferBlocked, false);
  const unreg = C.reconstruction(c, fund(), { regulated: false, capital: false, landPermit: false });
  assert.equal(unreg.transferBlocked, false);
});

test('재건축 이주비: 주담대 대환 후 순수령으로 임시거주 보증금 마련', () => {
  const c = base({ regionId: 'seoul-노원구', price: 7.2 * EOK, jeonse: 2.8 * EOK, annualSavings: 4000 * MAN,
    recon: { target: true, stage: '관리처분인가', priorAssetValue: 6 * EOK, expectedContribution: 3.5 * EOK, newUnitValue: 13 * EOK } });
  const f = fund({ price: 7.2 * EOK, loanUsed: 2.88 * EOK, surplus: 5000 * MAN, requiredCash: 4.6 * EOK, totalCost: 7.5 * EOK });
  const r = C.reconstruction(c, f, { regulated: true, capital: true, landPermit: true });
  assert.equal(r.relocationLoan, 3 * EOK); // 6억 × 50%
  assert.ok(r.yearsUntilRelocation > 0 && r.yearsUntilRelocation < 1);
  assert.ok(Math.abs(r.netRelocation - (3 * EOK - r.balanceAtRelocation)) < 1);
  assert.ok(Math.abs(r.cashAtRelocation - (2.8 * EOK - r.netRelocation)) < 1);
  assert.ok(r.expectedGain != null);
});

test('재건축 이주비: 다주택 조합원은 0, 이주 재원 부족은 차단', () => {
  const c = base({ regionId: 'seoul-노원구', ownedHomes: 1, jeonse: 4 * EOK, recon: { target: true, stage: '관리처분인가', priorAssetValue: 6 * EOK, expectedContribution: 1 * EOK } });
  const r = C.reconstruction(c, fund({ surplus: 0 }), { regulated: true, capital: true, landPermit: false });
  assert.equal(r.relocationLoan, 0);
  assert.ok(r.blockers.some((b) => b.includes('재원 부족')));
});

test('시기: 단기 보유·희망 입주 지연 경고', () => {
  const t = C.timing(base({ timing: { purchaseDate: '2026-11', holdingYears: 1 } }), null);
  assert.ok(t.warnings.some((w) => w.includes('단기')));
  const recon = { yearsToMoveIn: 4, yearsUntilRelocation: 0 };
  const t2 = C.timing(base({ timing: { purchaseDate: '2026-11', moveInBy: '2027-06' } }), recon);
  assert.ok(t2.warnings.some((w) => w.includes('늦게')));
  assert.deepEqual(t2.events.map((e) => e.label), ['매수', '신축 입주 (예상)']);
});

test('입지 점수와 투자 점수', () => {
  const live = C.residenceScore(base({ location: { jobCommuteMin: 20, schoolWalkMin: 5 } }));
  assert.equal(live.score, 100);
  const villa = C.residenceScore(base({ propertyType: '빌라', location: { jobCommuteMin: 20, schoolWalkMin: 5 } }));
  assert.equal(villa.score, 95);
  const inv = C.investmentScore(base({ location: { subwayWalkMin: 5 } }), { premium: 0, jeonseRatio: 0.5 }, null, 0.2);
  assert.equal(inv.score, Math.round((60 + 70 + 100 + 80) / 4));
});

test('갭 투자 수익: 상승률이 높을수록 초과수익 증가', () => {
  const s = { price: 10 * EOK, deposit: 6 * EOK, closing: 3500 * MAN, years: 6, appreciation: 0.03, rentGrowth: 0.03, invReturn: 0.035,
    regionId: 'local', homesAfter: 2, oneHouse: false, publicRatio: 0.69, age: 45 };
  const lo = E.gapInvestment({ ...s, appreciation: 0 });
  const hi = E.gapInvestment({ ...s, appreciation: 0.06 });
  assert.ok(hi.excess > lo.excess);
  assert.equal(hi.series.length, 7);
  assert.ok(Math.abs(lo.equity - (4 * EOK + 3500 * MAN)) < 1);
});
