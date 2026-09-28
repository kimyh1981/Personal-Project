const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/tiers.js');

const MAN = 1e4, EOK = 1e8;
// 가상의 조건 (실제 개인 값 아님)
const profile = (over = {}) => ({
  ...T.DEFAULTS, saveRest: false,
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

test('평가: 모자라는 돈은 은행 한도까지 대출, 넘는 부분은 추가 자금', () => {
  const p = profile({ loanTerm: 15 });
  const f = T.funds(p);
  const e = T.evaluate(cand({ name: '12억', price: 12 * EOK }), p, reg, f);
  assert.ok(e.need > 0 && e.plus === 0);
  assert.equal(e.term, 15);
  assert.equal(Math.round(e.debt60), 0); // 15년 만기면 60세에 다 갚음
  assert.ok(e.payTotal > 250 * MAN && e.payTotal < 350 * MAN);
  const big = T.evaluate(cand({ name: '22억', price: 22 * EOK }), p, reg, f);
  assert.ok(big.plus > 0 && big.loan === 4 * EOK);
  const cheap = T.evaluate(cand({ name: '7억', price: 7 * EOK }), p, reg, f);
  assert.ok(cheap.need < 0 && cheap.leftover > 0 && cheap.payTotal === 0);
});

test('평가: 30년 만기면 월 상환이 줄고, 60세 남은 대출은 집을 팔아 갚은 뒤 노후 자금을 계산', () => {
  const p15 = profile({ loanTerm: 15 }), p30 = profile({ loanTerm: 30 });
  const c = cand({ name: '12억', price: 12 * EOK });
  const a = T.evaluate(c, p15, reg, T.funds(p15)), b = T.evaluate(c, p30, reg, T.funds(p30));
  assert.equal(b.term, 30);
  assert.ok(b.payTotal < a.payTotal * 0.7);
  const expected = T.balanceAfter(b.loan, p30.loanRate, 360, 180);
  assert.ok(b.debt60 > 0 && Math.abs(b.debt60 - expected) < 1);
  assert.ok(b.ret.monthly < a.ret.monthly); // 남은 대출만큼 노후 자금이 줄어든다
  assert.ok(Math.abs(T.balanceAfter(1e8, 0.04, 360, 360)) < 1e-6);
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

test('상환 여유분 저축: 기본 한도 − 실제 상환을 매달 모아 60세 노후 자금에 더한다', () => {
  const on = profile({ saveRest: true }), off = profile({ saveRest: false });
  const c = cand({ name: '12억', price: 12 * EOK });
  const a = T.evaluate(c, on, reg, T.funds(on)), b = T.evaluate(c, off, reg, T.funds(off));
  assert.ok(Math.abs(a.saveMonthly - (on.pay - a.payTotal)) < 1);
  assert.ok(a.save60 > a.saveMonthly * 180 && a.ret.monthly > b.ret.monthly);
  const cash = T.evaluate(cand({ name: '7억', price: 7 * EOK }), on, reg, T.funds(on));
  assert.equal(cash.saveMonthly, on.pay); // 대출이 없으면 기본 한도 전액 저축
});

test('같은 동 기준: 동 상승률을 섞고, 30년 넘은 단지는 같은 동 신축 ㎡당가 × 면적 − 분담금으로 재건축 가치', () => {
  const p = profile();
  const list = [
    { id: 'n1', name: '신축1', regionId: 'seoul-송파구', dong: '가락동', area: 84, price: 20 * EOK, count: 6, builtYear: 2020, g5: 0.04, g10: 0.06 },
    { id: 'n2', name: '신축2', regionId: 'seoul-송파구', dong: '가락동', area: 84, price: 18 * EOK, count: 4, builtYear: 2018, g5: 0.03, g10: 0.05 },
    { id: 'o1', name: '구축', regionId: 'seoul-송파구', dong: '가락동', area: 84, price: 14 * EOK, count: 5, builtYear: 1988, g5: null, g10: null },
  ];
  const idx = T.dongIndex(list, 2026);
  const d = idx.get('seoul-송파구|가락동');
  assert.equal(d.newN, 2);
  assert.ok(Math.abs(d.newM2 - 19 * EOK / 84) < 1);
  const g = T.growth(list[2], { cagr5: 0.03, cagr10: 0.05 }, p, d);
  assert.equal(g.dongG, d.g);
  assert.match(g.basis, /같은 동/);
  const e = T.evaluate(cand({ ...list[2] }), p, reg, T.funds(p), d);
  assert.ok(e.rebuild && Math.abs(e.rebuild.nowNew - 19 * EOK) < 1);
  assert.ok(e.rebuild.share > 300 * MAN * 84); // 입주까지 물가만큼 증가
  assert.ok(e.v60r > e.v60); // 신축 시세로 수렴 − 분담금이 그대로 두는 것보다 큼
  const lone = T.evaluate(cand({ ...list[2], dong: '없는동' }), p, reg, T.funds(p), undefined);
  assert.ok(!lone.rebuild && lone.gRecon > lone.growth.g); // 같은 동 신축이 없으면 +0.7%p
});

test('노후 월소득: 집을 줄여 옮긴 차액 인출과 주택연금 중 큰 값 (현재 가치)', () => {
  const p = profile();
  const r = T.retirement(20 * EOK, 0, p, 15);
  const real = 20 * EOK / Math.pow(1.02, 15);
  assert.ok(Math.abs(r.homeReal - real) < 1);
  assert.equal(Math.round(r.monthly), Math.round(Math.max((real - 5 * EOK) * 0.04 / 12, Math.min(real, 17 * EOK) * 0.0022)));
});
