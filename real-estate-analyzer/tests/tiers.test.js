const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/tiers.js');

const MAN = 1e4, EOK = 1e8;
// 가상의 조건 (실제 개인 값 아님)
const profile = (over = {}) => ({
  ...T.DEFAULTS,
  age: 45, targetAge: 60,
  homes: [{ name: 'A', value: 10 * EOK, loan: 4 * EOK, jeonse: 0 }, { name: 'B', value: 6 * EOK, loan: 1 * EOK, jeonse: 2 * EOK }],
  cashReserve: 0, cgtReserve: 0,
  ...over,
});
const reg = { cagr5: 0.05, cagr10: 0.07 };
const cand = (o) => ({ id: o.name, regionId: 'seoul-송파구', dong: '잠실동', area: 84, count: 8, builtYear: 2012, g5: 0.05, g10: 0.07, coords: [37.51, 127.08], subwayMin: 6, infra: { mart: 2, hospital: 25, school: 7 }, ...o });

test('자금: 두 채 순자산에서 매도 중개보수·양도세·비상금을 뺀다', () => {
  const f = T.funds(profile({ cgtReserve: 2000 * MAN, cashReserve: 3000 * MAN }));
  assert.equal(f.equity, 9 * EOK); // (10-4) + (6-1-2)
  assert.equal(f.sellCosts, 550 * MAN + 264 * MAN); // 10억 0.5%·6억 0.4%, 부가세 10%
  assert.equal(f.cash, 9 * EOK - 814 * MAN - 5000 * MAN);
});

test('은행 한도: 서울 무주택 LTV 40%, 15억 이하 6억 한도, 연소득이 있으면 DSR', () => {
  const p = profile();
  assert.equal(T.bankLimit(12 * EOK, 'seoul-송파구', p, 15).amount, 4.8 * EOK);
  assert.equal(T.bankLimit(20 * EOK, 'seoul-송파구', p, 15).amount, 4 * EOK); // 15~25억 한도 4억
  const withIncome = T.bankLimit(12 * EOK, 'seoul-송파구', profile({ annualIncome: 6000 * MAN }), 15);
  assert.ok(withIncome.dsrChecked && withIncome.amount < 4.8 * EOK);
});

test('평가: 모자라는 돈은 은행 한도까지 대출, 넘는 부분은 추가 자금, 60세 완납 상환', () => {
  const p = profile();
  const f = T.funds(p);
  const e = T.evaluate(cand({ name: '12억', price: 12 * EOK }), p, reg, f);
  assert.ok(e.need > 0 && e.plus === 0);
  assert.equal(e.years, 15);
  assert.ok(e.payTotal > 250 * MAN && e.payTotal < 350 * MAN);
  const big = T.evaluate(cand({ name: '22억', price: 22 * EOK }), p, reg, f);
  assert.ok(big.plus > 0 && big.loan === 4 * EOK);
  const cheap = T.evaluate(cand({ name: '7억', price: 7 * EOK }), p, reg, f);
  assert.ok(cheap.need < 0 && cheap.leftover > 0 && cheap.payTotal === 0);
});

test('미래가치: 과거 상승률을 보수적으로 깎고 상한을 둔다, 30년 넘으면 재건축 가산', () => {
  const p = profile();
  const g = T.growth({ g5: 0.12, g10: 0.15 }, { cagr5: 0.1, cagr10: 0.12 }, p);
  assert.equal(g.g, 0.055);
  const low = T.growth({ g5: null, g10: null }, { cagr5: 0.03, cagr10: 0.05 }, p);
  assert.ok(Math.abs(low.g - 0.025) < 1e-9);
  const e = T.evaluate(cand({ name: '구축', price: 11 * EOK, builtYear: 1985 }), p, reg, T.funds(p));
  assert.ok(e.recon && e.gRecon > e.growth.g);
});

test('순위: 조건별로 나누고, 입지가 나쁘면 빼고, 한 단지는 한 순위에만', () => {
  const p = profile();
  const f = T.funds(p);
  const list = [
    cand({ name: '대출형 신축', price: 12 * EOK }),
    cand({ name: '현금형', price: 7.5 * EOK }),
    cand({ name: '추가자금 구축', price: 14.3 * EOK, builtYear: 1988 }),
    cand({ name: '고가', price: 30 * EOK }),
    cand({ name: '외곽', price: 7 * EOK, coords: [37.9, 127.6], subwayMin: 60, infra: { mart: 0, hospital: 0, school: 40 } }),
  ].map((c) => T.evaluate(c, p, reg, f));
  const res = T.classify(list, p);
  const names = (id) => res.tiers.find((t) => t.id === id).items.map((x) => x.e.c.name);
  assert.ok(names('t1').includes('대출형 신축'));
  assert.ok(names('t4').includes('현금형') || names('t3').includes('현금형'));
  assert.ok(names('t2').includes('추가자금 구축'));
  assert.ok(!res.tiers.some((t) => t.items.some((x) => x.e.c.name === '외곽')));
  const top = T.topN(res, 5);
  const seen = top.flatMap((t) => t.items.map((x) => x.e.c.name));
  assert.equal(seen.length, new Set(seen).size);
});

test('노후 월소득: 집을 줄여 옮긴 차액 인출과 주택연금 중 큰 값 (현재 가치)', () => {
  const p = profile();
  const r = T.retirement(20 * EOK, 0, p, 15);
  const real = 20 * EOK / Math.pow(1.02, 15);
  assert.ok(Math.abs(r.homeReal - real) < 1);
  assert.equal(Math.round(r.monthly), Math.round(Math.max((real - 5 * EOK) * 0.04 / 12, Math.min(real, 17 * EOK) * 0.0022)));
});
