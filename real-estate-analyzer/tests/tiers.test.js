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

test('정비사업: 단계 보정, 지번·이름으로 사업장 찾기, 주변 사례 완료 비율로 가능성·입주까지 기간', () => {
  assert.equal(T.normStage('사업시행자지정'), '조합설립인가');
  assert.equal(T.normStage('정비계획 수립'), '기본계획수립');
  assert.equal(T.normStage('조합해산'), '준공');
  const rows = [
    ['강남구', '재건축', '은하아파트 재건축정비사업조합', '가동 316', '사업시행인가', 'eunha', '11680A'],
    ['강남구', '재건축', '특별계획구역③ 재건축정비사업 조합', '나동 369-1', '조합설립인가', 'zone3', ''],
    ...Array.from({ length: 6 }, (_, i) => ['강남구', '재건축', `완료${i}`, `다동 ${i}`, '조합해산', '', '']),
    ...Array.from({ length: 4 }, (_, i) => ['강남구', '재건축', `진행${i}`, `라동 ${i}`, '추진위원회승인', '', '']),
    ['강남구', '가로주택정비', '빌라', '가동 1', '착공', '', ''],
  ];
  const ri = T.redevIndex({ cols: ['자치구', '사업구분', '사업장명', '대표지번', '진행단계', 'cafe', 'rec'], rows });
  assert.equal(ri.projects.length, rows.length - 1); // 가로주택정비는 뺀다
  const byName = T.matchProject({ regionId: 'seoul-강남구', dong: '가동', name: '은하', jibun: '' }, ri);
  assert.equal(byName.cafe, 'eunha');
  const byLot = T.matchProject({ regionId: 'seoul-강남구', dong: '나동', name: '현대1차', jibun: '369-1' }, ri);
  assert.equal(byLot.stage, '조합설립인가');
  const ch = T.redevChance({ regionId: 'seoul-강남구', dong: '가동', name: '은하', jibun: '316' }, ri, new Map());
  assert.equal(ch.stage, '사업시행인가');
  assert.equal(ch.years, 6);
  assert.ok(ch.chance > 0.5 && ch.doneN === 6); // 사업시행인가 이상 7곳 중 6곳 완료
  const none = T.redevChance({ regionId: 'seoul-강남구', dong: '마동', name: '없는단지', jibun: '9' }, ri, new Map([['강남구', { total: 10, registered: 5 }]]));
  assert.ok(!none.project && Math.abs(none.startRate - 0.5) < 1e-9 && none.chance < ch.chance);
});

test('재건축 가정 우선순위: 직접 입력 > 정비사업 단계·주변 사례 > 내 기준 기본값', () => {
  const p = profile({ reconChance: 0.6, reconYears: 10, reconShareM2: 300 * MAN, reconOverrides: { X: { years: 4 } } });
  assert.equal(T.reconAssume({ id: 'Y' }, p).source, '내 기준 기본값');
  const est = T.reconAssume({ id: 'Y', redev: { chance: 0.37, years: 8 } }, p);
  assert.equal(est.chance, 0.37); assert.equal(est.years, 8); assert.match(est.source, /주변 사례/);
  const ov = T.reconAssume({ id: 'X', redev: { chance: 0.37, years: 8 } }, p);
  assert.equal(ov.years, 4); assert.equal(ov.chance, 0.37); assert.equal(ov.source, '직접 입력');
});

test('순위 규칙: 기본값은 요청한 정의, 바꾼 항목만 덮어쓰고 추천이 그 조건으로 바뀐다', () => {
  const p = profile();
  const d = T.rulesFor(p);
  assert.equal(d.t1.loan, 'bank'); assert.equal(d.t1.pay, p.payMax); assert.equal(d.t1.minPct, 100);
  assert.equal(d.t4.homeOnly, true); assert.equal(d.t5.vsBest, 1.3); assert.equal(d.t1.custom, false);
  const f = T.funds(p);
  const list = [cand({ name: '12억', price: 12 * EOK }), cand({ name: '13억', price: 13 * EOK }), cand({ name: '7억', price: 7 * EOK })].map((c) => T.evaluate(c, p, reg, f));
  const names = (res, id) => res.tiers.find((t) => t.id === id).items.map((x) => x.e.c.name);
  const base = T.classify(list, p);
  assert.ok(names(base, 't1').includes('12억'));
  // 1순위 월 상환 한도를 아주 낮추면 대출이 필요한 곳이 빠진다
  const low = T.classify(list, { ...p, tierRules: { t1: { pay: 50 * MAN, comment: '메모' } } });
  assert.deepEqual(names(low, 't1'), []);
  assert.equal(T.rulesFor({ ...p, tierRules: { t1: { pay: 50 * MAN, comment: '메모' } } }).t1.comment, '메모');
  // 1순위를 '대출 없이'로 바꾸면 현금으로 사는 곳이 들어온다
  const none = T.classify(list, { ...p, tierRules: { t1: { loan: 'none', minPct: 0 } } });
  assert.deepEqual(names(none, 't1'), ['7억']);
  // 메모만 바꾸면 결과는 그대로
  const memo = T.classify(list, { ...p, tierRules: { t1: { comment: '아무 글' } } });
  assert.deepEqual(names(memo, 't1'), names(base, 't1'));
  assert.equal(T.rulesFor({ ...p, tierRules: { t1: { comment: '아무 글' } } }).t1.custom, false);
});

test('노후 월소득: 집을 줄여 옮긴 차액 인출과 주택연금 중 큰 값 (현재 가치)', () => {
  const p = profile();
  const r = T.retirement(20 * EOK, 0, p, 15);
  const real = 20 * EOK / Math.pow(1.02, 15);
  assert.ok(Math.abs(r.homeReal - real) < 1);
  assert.equal(Math.round(r.monthly), Math.round(Math.max((real - 5 * EOK) * 0.04 / 12, Math.min(real, 17 * EOK) * 0.0022)));
});

test('대출 한도: 금리 유형별 스트레스 반영비율, 한도를 정한 기준을 알려 준다', () => {
  const p = profile({ annualIncome: 1 * EOK });
  const periodic = T.bankLimit(15 * EOK, 'seoul-송파구', p, 30);
  const variable = T.bankLimit(15 * EOK, 'seoul-송파구', { ...p, rateType: 'variable' }, 30);
  assert.equal(periodic.rateType, 'periodic');
  assert.ok(periodic.dsr > variable.dsr); // 주기형은 스트레스 금리를 40%만 반영
  assert.equal(periodic.amount, 6 * EOK);
  assert.match(periodic.by, /LTV|한도/);
  assert.match(T.bankLimit(16 * EOK, 'seoul-송파구', p, 30).by, /4억/);
});

test('거주 계획: 토지거래허가 중에는 2026-05-12부터 계속 무주택이 아니면 입주를 미룰 수 없다', () => {
  const p = profile({ residence: 'defer', tempHousing: 8000 * MAN, buyDate: '2026-11', annualIncome: 1 * EOK });
  const f = T.funds(p);
  assert.equal(f.cashDefer, f.cash - 8000 * MAN);
  const e = T.evaluate(cand({ name: '갭', price: 12 * EOK, jeonse: 6 * EOK }), p, reg, f);
  assert.equal(e.plan.mode, 'now');
  assert.ok(e.plan.forced);
  assert.match(e.plan.why, /2026-05-12/);
  // 바로 입주로 계산할 때는 따로 살 집 전세금이 필요 없다
  assert.equal(e.need, 12 * EOK + e.costs - f.cash);
});

test('거주 계획: 토지거래허가가 해제되면 전세 끼고 사서 미루는 동안 모은 돈 + 전세퇴거자금 대출(1억 한도)로 입주', () => {
  const p = profile({ residence: 'defer', deferMonths: 24, tempHousing: 8000 * MAN, buyDate: '2027-03', permitAfter: 'lift', annualIncome: 1 * EOK, pay: 300 * MAN, cashReturn: 0 });
  const f = T.funds(p);
  const e = T.evaluate(cand({ name: '갭', price: 14 * EOK, jeonse: 8 * EOK }), p, reg, f);
  assert.equal(e.plan.mode, 'defer');
  assert.equal(e.plan.loanNow, 0); // 해제돼도 수도권 주담대는 6개월 전입의무 → 매수 때 대출 없이
  const left = f.cashDefer - (14 * EOK + e.costs - 8 * EOK);
  assert.equal(Math.round(e.plan.fundsAt), Math.round(8000 * MAN + left + 300 * MAN * 24));
  assert.equal(Math.round(e.need), Math.round(8 * EOK - e.plan.fundsAt));
  assert.ok(e.plan.loanLate <= 1 * EOK);
  assert.equal(Math.round(e.plus), Math.round(Math.max(0, e.need - e.plan.loanLate)));
  // 현금이 모자라면 바로 입주로
  const tooBig = T.evaluate(cand({ name: '큰', price: 25 * EOK, jeonse: 8 * EOK }), p, reg, f);
  assert.equal(tooBig.plan.mode, 'now');
  assert.match(tooBig.plan.why, /더 필요/);
  // 2026-05-12부터 계속 무주택이면 허가구역에서도 미룰 수 있다
  const eligible = T.evaluate(cand({ name: '유예', price: 14 * EOK, jeonse: 8 * EOK }), { ...p, permitAfter: 'extend', buyDate: '2026-11', nohomeSince: '2025-01-01' }, reg, f);
  assert.equal(eligible.plan.mode, 'defer');
});

test('메모 → 조건: 권역·구·동·가격·평형·연식·역세권을 읽고, 일반 문장은 조건으로 바꾸지 않는다', () => {
  const d = ['대치동', '서초동', '잠실동', '목동'];
  const a = T.parseMemo('강남3구 15억 이하 신축', d);
  assert.deepEqual(a.gus.sort(), ['강남구', '서초구', '송파구']);
  assert.equal(a.maxPrice, 15 * EOK);
  assert.equal(a.maxAge, 10);
  const b = T.parseMemo('서초동 30평대 역 7분', d);
  assert.deepEqual(b.dongs, ['서초동']);
  assert.deepEqual(b.gus, []); // '서초동'의 '서초'를 서초구로 읽지 않는다
  assert.ok(b.minArea >= 74 && b.maxArea <= 102);
  assert.equal(b.maxSubway, 7);
  const c = T.parseMemo('대출 상환 능력 안에서 · 바로 입주 · 60세 노후 준비 · 재건축 기대 반영 · 월 300만원', d);
  assert.deepEqual(c.labels, []);
  assert.equal(T.parseMemo('10~14억 마용성', d).minPrice, 10 * EOK);
});

test('메모 지역 조건: 그 지역에 추천이 없으면 같은 조건으로 추천이 나오는 구·동을 안내', () => {
  const p = profile({ tierRules: { t3: { comment: '강남구' } } });
  const f = T.funds(p);
  const cs = [
    cand({ name: '송파A', price: 7 * EOK }), cand({ name: '송파B', price: 7.5 * EOK, dong: '가락동' }),
    cand({ name: '강남C', price: 30 * EOK, regionId: 'seoul-강남구', dong: '대치동' }),
  ];
  const res = T.classify(cs.map((c) => T.evaluate(c, p, reg, f)), p);
  const t3 = res.tiers.find((t) => t.id === 't3');
  assert.deepEqual(t3.memo.gus, ['강남구']);
  assert.equal(t3.items.length, 0);
  assert.equal(t3.regionAlt[0].gu, '송파구');
  assert.equal(t3.regionAlt[0].n, 2);
  assert.deepEqual(t3.regionAlt[0].dongs.map((x) => x.dong).sort(), ['가락동', '잠실동']);
});

test('순위별 내 여유자금: 그 순위만 현금을 늘려 다시 평가하고, 다른 순위는 그대로', () => {
  const p0 = profile({ annualIncome: 1 * EOK });
  const cs = [cand({ name: '9억', price: 9 * EOK }), cand({ name: '11억', price: 11 * EOK }), cand({ name: '13억', price: 13 * EOK })];
  const ev = (p) => (x) => cs.map((c) => T.evaluate(c, p, reg, T.withExtra(T.funds(p), x)));
  const without = T.classify(ev(p0)(0), p0, ev(p0));
  const p1 = profile({ annualIncome: 1 * EOK, tierRules: { t4: { extra: 4 * EOK } } });
  const withExtra = T.classify(ev(p1)(0), p1, ev(p1));
  const t4a = without.tiers.find((t) => t.id === 't4'), t4b = withExtra.tiers.find((t) => t.id === 't4');
  assert.ok(t4b.items.length > t4a.items.length); // 대출 없이 살 수 있는 곳이 늘어난다
  assert.ok(t4b.items.every((x) => x.e.extraCash === 4 * EOK));
  assert.equal(t4b.rule.extra, 4 * EOK);
  assert.ok(t4b.rule.custom);
  // 다른 순위 계산은 여유자금 없이
  const t1 = withExtra.tiers.find((t) => t.id === 't1');
  assert.ok(t1.items.every((x) => !x.e.extraCash));
  assert.ok(T.cautions(t4b.items[0].e, p1).some((s) => /여유자금/.test(s)));
});

test('추가 동원 가능 자금: 내 기준 현금에 더해 모든 순위 계산에 쓰인다', () => {
  const a = T.funds(profile()), b = T.funds(profile({ extraFunds: 2 * EOK, tempHousing: 8000 * MAN }));
  assert.equal(b.add, 2 * EOK);
  assert.equal(b.cash, a.cash + 2 * EOK);
  assert.equal(b.cashDefer, b.cash - 8000 * MAN);
  const c = cand({ name: '12억', price: 12 * EOK });
  const e1 = T.evaluate(c, profile(), reg, a), e2 = T.evaluate(c, profile({ extraFunds: 2 * EOK }), reg, b);
  assert.equal(Math.round(e1.need - e2.need), 2 * EOK);
  assert.ok(e2.loan < e1.loan);
});

test('취득세 등 매수 비용은 내 현금에서: 현금이 비용보다 적으면 대출로 못 내고 추가 자금으로 남는다', () => {
  const poor = profile({ homes: [{ name: 'A', value: 3 * EOK, loan: 2.9 * EOK, jeonse: 0 }] });
  const f = T.funds(poor);
  const e = T.evaluate(cand({ name: '12억', price: 12 * EOK }), poor, reg, f);
  assert.ok(f.cash < e.costs);
  assert.equal(Math.round(e.plan.taxShort), Math.round(e.costs - f.cash));
  assert.ok(e.loan <= T.bankLimit(12 * EOK, 'seoul-송파구', poor, e.term).amount);
  assert.ok(e.plus >= e.plan.taxShort);
  assert.ok(T.cautions(e, poor).some((s) => /취득세/.test(s)));
});

test('나중에 입주 + 전세 시세 없음: 빌라는 세입자 없이 내 현금으로, 허가 대상 아파트는 바로 입주', () => {
  const p = profile({ residence: 'defer', deferMonths: 24, tempHousing: 8000 * MAN, buyDate: '2026-11', annualIncome: 1 * EOK });
  const f = T.funds(p);
  const villa = T.evaluate(cand({ name: '빌라', kind: '빌라', price: 6 * EOK, jeonse: null }), p, reg, f);
  assert.equal(villa.plan.mode, 'defer');
  assert.ok(villa.plan.noTenant);
  assert.equal(villa.loan, 0);
  assert.equal(Math.round(villa.plan.cashNow), Math.round(6 * EOK + villa.costs));
  const apt = T.evaluate(cand({ name: '아파트', price: 6 * EOK, jeonse: null }), { ...p, nohomeSince: '2025-01-01' }, reg, f);
  assert.equal(apt.plan.mode, 'now');
  assert.match(apt.plan.why, /세입자/);
});

test('순위 월 상환 한도 칸을 비우면 제한 없음 (기본값 되돌리기는 따로)', () => {
  const p = profile({ tierRules: { t1: { pay: null } } });
  const r = T.rulesFor(p).t1;
  assert.equal(r.pay, null);
  assert.ok(r.custom);
  assert.equal(T.rulesFor(profile()).t1.pay, profile().payMax);
});
