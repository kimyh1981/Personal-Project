const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../tools/live-data.js');
const C = require('../js/conditions.js');

const cfg = (over = {}) => ({
  dataGoKrKey: '', vworldKey: 'VK', vworldDomain: 'localhost', seoulKey: 'SK', seoulRedevService: 'redevSvc',
  ggKey: 'GK', ggRedevService: 'ggSvc', lawOc: 'oc', newsFeeds: ['https://news.example/rss'],
  ttl: { landUse: 3600e3, redev: 3600e3, regulation: 3600e3 }, ...over,
});
function mock(routes) {
  const calls = [];
  L.setFetcher(async (url) => {
    calls.push(url);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return { status: 404, body: 'not mocked' };
    const body = typeof hit[1] === 'function' ? hit[1](url) : hit[1];
    return { status: 200, body: typeof body === 'string' ? body : JSON.stringify(body) };
  });
  return calls;
}
test.beforeEach(() => L.clearCache());
test.after(() => L.setFetcher(null));

test('단계 이력: 날짜 열로 현재 단계와 날짜를 잡는다 (호갱노노식 12단계)', () => {
  const t = C.stageTimeline({ 구역명: '방배 임광3차', 정비구역지정일: '2024-05-02', 추진위원회승인일: '20260123', 조합설립인가일: '' });
  assert.equal(t.current, '추진위원회승인');
  assert.equal(t.currentDate, '2026-01-23');
  assert.equal(t.steps.length, 11);
  assert.deepEqual(t.steps.filter((s) => s.done).map((s) => s.stage), ['기본계획수립', '재건축진단', '정비구역지정']);
  assert.equal(C.stageTimeline({}, '관리처분인가 완료').current, '관리처분인가');
  assert.equal(C.parseDate('26.01.23'), '2026-01-23');
  assert.equal(C.stageFromText('일반분양승인일'), '일반분양승인');
});

test('재건축 입주 예상: 현재 단계 경과 기간만큼 줄되 다음 단계 기간보다 짧아지지 않는다', () => {
  const base = { price: 7e8, jeonse: 3e8, ownedHomes: 0, purpose: '거주', annualSavings: 0, location: {}, loan: { rate: 0.04, termYears: 30, method: 'amortized' }, timing: { purchaseDate: '2026-10' } };
  const fund = { loanUsed: 0, tenantDeposit: 0, requiredCash: 7e8, surplus: 1e8, totalCost: 7.2e8 };
  const reg = { regulated: false, capital: true, landPermit: false };
  const fresh = C.reconstruction({ ...base, recon: { target: true, stage: '추진위원회승인', stageDate: '2026-01-23', expectedContribution: 0 } }, fund, reg);
  assert.ok(fresh.yearsToMoveIn < 9 && fresh.yearsToMoveIn >= 8, String(fresh.yearsToMoveIn));
  const stalled = C.reconstruction({ ...base, recon: { target: true, stage: '추진위원회승인', stageDate: '2016-01-01', expectedContribution: 0 } }, fund, reg);
  assert.equal(stalled.yearsToMoveIn, 8); // 다음 단계(조합설립인가) 기준 8년이 하한
});

test('토지이용계획: 주소 → PNU → 지역지구, 토지거래허가·정비구역 판정', async () => {
  const calls = mock([
    [/req\/search/, { response: { status: 'OK', result: { items: [{ id: '1165010100100010000', address: { parcel: '서울 서초구 방배동 1' } }] } } }],
    [/getLandUseAttr/, { landUses: { field: [
      { prposAreaDstrcCodeNm: '제3종일반주거지역' }, { prposAreaDstrcCodeNm: '토지거래계약에관한허가구역' }, { prposAreaDstrcCodeNm: '정비구역' },
    ] } }],
  ]);
  const r = await L.landUse(cfg(), '서울 서초구 방배동 1');
  assert.equal(r.pnu, '1165010100100010000');
  assert.equal(r.landPermit, true);
  assert.equal(r.redevZone, true);
  assert.ok(r.fetchedAt);
  const again = await L.landUse(cfg(), '서울 서초구 방배동 1');
  assert.equal(again.cached, true);
  await L.landUse(cfg(), '서울 서초구 방배동 1', true);
  assert.equal(calls.filter((u) => /getLandUseAttr/.test(u)).length, 2, 'fresh=1이면 캐시를 건너뛴다');
});

test('토지이용계획: 키가 없으면 미설정 오류', async () => {
  await assert.rejects(L.landUse(cfg({ vworldKey: '' }), '서울 서초구 방배동 1'), (e) => e.code === 'NOT_CONFIGURED');
});

test('서울 정비사업: 페이지 조회, 검색, 단계 이력', async () => {
  mock([[/openapi\.seoul\.go\.kr/, { redevSvc: { list_total_count: 2, RESULT: { CODE: 'INFO-000' }, row: [
    { 자치구: '서초구', 구역명: '방배 임광3차 재건축', 사업구분: '재건축', 위치: '방배동 1000', 추진위원회승인일: '2026-01-23', 정비구역지정일: '2024-05-02' },
    { 자치구: '노원구', 구역명: '상계주공5단지', 사업구분: '재건축', 위치: '상계동 721', 추진단계: '사업시행인가' },
  ] } }]]);
  const r = await L.redevSearch(cfg(), '서울', '임광');
  assert.equal(r.total, 2);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].currentStage, '추진위원회승인');
  assert.equal(r.items[0].currentStageDate, '2026-01-23');
  const r2 = await L.redevSearch(cfg(), '서울', '상계');
  assert.equal(r2.items[0].currentStage, '사업시행인가');
});

test('경기 정비사업: 경기데이터드림 응답 형식', async () => {
  mock([[/openapi\.gg\.go\.kr/, { ggSvc: [{ head: [{ list_total_count: 1 }, { RESULT: { CODE: 'INFO-000', MESSAGE: 'OK' } }] }, { row: [{ SIGUN_NM: '성남시', 정비구역명: '수진1구역', 사업단계: '관리처분인가' }] }] }]]);
  const r = await L.redevSearch(cfg(), '경기', '수진');
  assert.equal(r.items[0].currentStage, '관리처분인가');
  assert.equal(r.items[0].district, '성남시');
});

test('정비사업 API 오류 코드는 그대로 알린다', async () => {
  mock([[/openapi\.seoul\.go\.kr/, { RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다.' } }]]);
  await assert.rejects(L.redevSearch(cfg(), '서울', ''), /인증키가 유효하지 않습니다/);
});

test('규제 변경 감지: 기준일 이후 규제 보도자료와 법령 시행을 찾는다', async () => {
  const rss = `<rss><channel>
    <item><title><![CDATA[수도권 일부 조정대상지역 추가 지정]]></title><link>https://news.example/1</link><pubDate>Mon, 12 Oct 2026 09:00:00 +0900</pubDate></item>
    <item><title>도로 개통 안내</title><link>https://news.example/2</link><pubDate>Mon, 12 Oct 2026 09:00:00 +0900</pubDate></item>
    <item><title>투기과열지구 지정 (옛 기사)</title><link>https://news.example/3</link><pubDate>Mon, 01 Jun 2026 09:00:00 +0900</pubDate></item>
  </channel></rss>`;
  mock([
    [/news\.example/, rss],
    [/lawSearch\.do.*%EC%A7%80%EB%B0%A9%EC%84%B8%EB%B2%95/, { LawSearch: { law: { 법령명한글: '지방세법', 시행일자: '20261001', 공포일자: '20260915' } } }],
    [/lawSearch\.do/, { LawSearch: { law: [{ 법령명한글: '기타', 시행일자: '20250101' }] } }],
  ]);
  const r = await L.regulationCheck(cfg(), false, '2026-09-25');
  const titles = r.changes.map((c) => c.title);
  assert.ok(titles.includes('수도권 일부 조정대상지역 추가 지정'));
  assert.ok(!titles.includes('도로 개통 안내'));
  assert.ok(!titles.includes('투기과열지구 지정 (옛 기사)'));
  assert.ok(r.changes.some((c) => c.kind.startsWith('법령') && c.title.includes('지방세법')));
});

test('규제 변경 감지: 출처를 못 읽으면 ok=false', async () => {
  mock([]);
  const r = await L.regulationCheck(cfg({ lawOc: '' }), false, '2026-09-25');
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 2);
});

test('조건 판정: 최신 데이터 우선, 미확인이면 경고', () => {
  const base = {
    purpose: '거주', regionId: 'incheon', propertyType: '아파트', areaM2: 84, price: 5e8, recentTrades: [], jeonse: null,
    cash: 3e8, ownedHomes: 0, annualIncome: 8e7, netMonthlyIncome: 5.5e6, employment: 'regular', location: { jobCommuteMin: 30, schoolWalkMin: 5 }, recon: { target: false },
    timing: { purchaseDate: '2026-11' }, loan: { rate: 0.04, termYears: 30 },
  };
  const fund = { price: 5e8, loanUsed: 2e8, tenantDeposit: 0, requiredCash: 3e8, surplus: 1e7, totalCost: 5.2e8, dsr: 0.2 };
  const none = C.assess(base, fund);
  assert.ok(none.flags.some((f) => f.category === '최신성' && f.level === 'warn'));
  const ok = C.assess({ ...base, live: { regulation: { ok: true, changes: [], errors: [] } } }, fund);
  assert.ok(!ok.flags.some((f) => f.category === '최신성'));
  // 인천(규정 파일상 비허가)인데 필지 조회 결과 허가구역 + 비거주 → 차단
  const live = { regulation: { ok: true, changes: [], errors: [] }, landUse: { landPermit: true, redevZone: false, zones: ['토지거래계약에관한허가구역'], fetchedAt: '2026-09-25T00:00:00Z' } };
  const gap = C.assess({ ...base, purpose: '투자', assumeTenant: true, jeonse: 3e8, recentTrades: [5e8], location: { subwayWalkMin: 5 }, timing: { purchaseDate: '2026-11', holdingYears: 5 }, live }, { ...fund, tenantDeposit: 3e8 });
  assert.equal(gap.verdict, '불가');
  const changed = C.assess({ ...base, live: { regulation: { ok: true, changes: [{ title: '조정대상지역 추가', date: '2026-10-12' }], errors: [] } } }, fund);
  assert.ok(changed.flags.some((f) => f.message.includes('조정대상지역 추가')));
});

test('카카오: 주소 → 좌표, 주변 가장 가까운 역·초등학교', async () => {
  const calls = [];
  L.setFetcher(async (url, headers) => {
    calls.push({ url, headers });
    const j = (o) => ({ status: 200, body: JSON.stringify(o) });
    if (/address\.json/.test(url)) return j({ documents: [{ x: '126.95', y: '37.55', address_name: '서울 마포구 아현동 777' }] });
    if (/SW8/.test(url)) return j({ documents: [{ place_name: '아현역 2호선', distance: '420' }] });
    if (/SC4/.test(url)) return j({ documents: [{ place_name: '예시중학교', distance: '200' }, { place_name: '아현초등학교', distance: '350' }] });
    return { status: 404, body: '' };
  });
  const c = cfg({ kakaoKey: 'KK' });
  const g = await L.geocode(c, '서울 마포구 아현동 777');
  assert.deepEqual([g.lat, g.lng], [37.55, 126.95]);
  assert.equal(calls[0].headers.Authorization, 'KakaoAK KK');
  const n = await L.nearby(c, g.lat, g.lng);
  assert.equal(n.station.name, '아현역 2호선');
  assert.equal(n.station.meters, 420);
  assert.equal(n.school.name, '아현초등학교'); // 중학교는 건너뛴다
  await assert.rejects(L.nearby(cfg({ kakaoKey: '' }), 37.5, 127), (e) => e.code === 'NOT_CONFIGURED');
});

test('전월세 XML 파싱: 보증금·월세', () => {
  const E = require('../js/engine.js');
  const r = E.parseRtmsRentXml('<response><header><resultCode>000</resultCode></header><body><items><item><aptNm>예시</aptNm><deposit>60,000</deposit><monthlyRent>0</monthlyRent><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>3</dealDay><excluUseAr>84.9</excluUseAr><umdNm>아현동</umdNm></item></items></body></response>');
  assert.deepEqual([r.items[0].deposit, r.items[0].monthly, r.items[0].date], [6e8, 0, '2026-08-03']);
});
