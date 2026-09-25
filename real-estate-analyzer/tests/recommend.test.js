const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/recommend.js');
const G = require('../js/geo.js');

const EOK = 1e8;
const sale = (name, area, price, date, extra = {}) => ({ name, area, price, date, dong: '아현동', builtYear: 2014, ...extra });

test('후보 만들기: 단지·평형별 최근 중위가, 전세 중위, 추세, 지역 대비', () => {
  const sales = [
    sale('A', 84.9, 15 * EOK, '2026-08-10'), sale('A', 84.7, 15.4 * EOK, '2026-07-02'), sale('A', 84.9, 13 * EOK, '2025-09-01'),
    sale('A', 59.9, 11 * EOK, '2026-06-01'),
    sale('B', 84.5, 10 * EOK, '2026-09-01', { builtYear: 1990 }),
    sale('C', 84.0, 9 * EOK, '2024-01-01'), // 최근 거래 없음 → 제외
  ];
  const rents = [{ name: 'A', area: 84.9, deposit: 8 * EOK, monthly: 0, date: '2026-05-01' }, { name: 'A', area: 84.9, deposit: 1 * EOK, monthly: 300e4, date: '2026-05-01' }];
  const c = R.aggregate(sales, rents, { now: '2026-09-25', months: 6, regionId: 'seoul-마포구' });
  assert.equal(c.length, 3);
  const a84 = c.find((x) => x.name === 'A' && x.area > 80);
  assert.equal(a84.count, 2);
  assert.equal(a84.price, 15.2 * EOK);
  assert.equal(a84.jeonse, 8 * EOK); // 월세 제외
  assert.ok(a84.trend > 0.1);
  assert.equal(c.find((x) => x.name === 'B').builtYear, 1990);
  assert.ok(c.find((x) => x.name === 'B').vsRegion < 0);
});

test('통근 추정: 거리 비례, 같은 곳이면 대기·도보 시간만', () => {
  const gbd = G.WORKPLACES.find((w) => w.id === 'gbd').at;
  const near = G.transitMinutes(G.CENTROIDS['seoul-서초구'], gbd);
  const far = G.transitMinutes(G.CENTROIDS['seoul-도봉구'], gbd);
  assert.ok(near < far);
  assert.equal(G.transitMinutes(gbd, gbd), 12);
  assert.ok(Math.abs(G.haversineKm([37.5, 127], [37.6, 127]) - 11.12) < 0.05);
  assert.equal(G.walkMinutes(400), 7);
});

test('순위: 목적별 가중치, 예산 초과·차단 제외, 이유 문구', () => {
  const cands = [
    { id: 1, name: '가까운 신축', regionId: 'seoul-서초구', price: 9 * EOK, area: 84, count: 8, builtYear: 2020, vsRegion: 0.1, jeonse: 5 * EOK, commuteMin: 25, subwayMin: 5 },
    { id: 2, name: '먼 구축', regionId: 'seoul-도봉구', price: 6 * EOK, area: 84, count: 3, builtYear: 1988, vsRegion: -0.15, jeonse: 4 * EOK, commuteMin: 65, subwayMin: 15 },
    { id: 3, name: '비싼 곳', regionId: 'seoul-강남구', price: 20 * EOK, area: 84, count: 5, builtYear: 2010 },
    { id: 4, name: '토허 차단', regionId: 'seoul-강남구', price: 8 * EOK, area: 84, count: 5, builtYear: 2010 },
  ];
  const analyze = (c) => ({
    score: 70, blocked: c.id === 4, blockReason: '토지거래허가', fundingGap: c.price > 12 * EOK ? c.price - 12 * EOK : 0,
    surplus: 200e4, net: 800e4, maxPrice: 12 * EOK, privateUsed: 0,
  });
  const live = R.rank(cands, analyze, { purpose: '거주', thisYear: 2026 });
  assert.equal(live.ranked[0].c.name, '가까운 신축');
  assert.equal(live.excluded.length, 2);
  assert.ok(live.ranked[0].strengths.some((t) => t.includes('25분')));
  const inv = R.rank(cands, analyze, { purpose: '투자', thisYear: 2026 });
  const old = inv.ranked.find((r) => r.c.name === '먼 구축');
  assert.ok(old.strengths.some((t) => t.includes('재건축')) || old.parts.find((p) => p.key === 'recon').score === 85);
  assert.ok(live.ranked.find((r) => r.c.name === '먼 구축').cautions.some((t) => t.includes('65분')));
});

test('예시 데이터는 가상 단지 이름만 쓴다', () => {
  const d = R.demoData(['seoul-마포구'], 3);
  assert.ok(d.sales['seoul-마포구'].length > 20);
  assert.ok(d.sales['seoul-마포구'].every((t) => t.name.startsWith('예시 ')));
});
