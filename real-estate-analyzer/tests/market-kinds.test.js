const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../tools/market.js');
const E = require('../js/engine.js');

const wrap = (item) => `<response><header><resultCode>000</resultCode></header><body><items><item>${item}</item></items><totalCount>1</totalCount></body></response>`;

test('주택 종류: 아파트·빌라·단독주택을 모으고 오피스텔은 모으지 않는다', () => {
  assert.deepEqual(M.KINDS.map((k) => k.kind), ['아파트', '빌라', '단독주택']);
});

test('빌라 실거래: 단지명(mhouseNm)을 아파트 파서로 읽는다', () => {
  const x = wrap('<mhouseNm>예시빌라</mhouseNm><excluUseAr>45.1</excluUseAr><dealAmount>32,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>3</dealDay><umdNm>망원동</umdNm><jibun>12-3</jibun><buildYear>2015</buildYear><floor>3</floor>');
  const t = E.parseRtmsXml(M.KINDS[1].prep(x)).items[0];
  assert.equal(t.name, '예시빌라');
  assert.equal(t.area, 45.1);
  assert.equal(t.price, 3.2e8);
});

test('단독·다가구 실거래: 동 + 유형 + 연면적 30㎡ 구간으로 묶고 연면적을 면적으로', () => {
  const x = wrap('<buildYear>1995</buildYear><dealAmount>145,000</dealAmount><dealDay>2</dealDay><dealMonth>8</dealMonth><dealYear>2026</dealYear><houseType>다가구</houseType><jibun>3**</jibun><plottageAr>165</plottageAr><totalFloorAr>248.5</totalFloorAr><umdNm>망원동</umdNm>');
  const t = E.parseRtmsXml(M.KINDS[2].prep(x)).items[0];
  assert.equal(t.name, '망원동 다가구 연면적 240㎡대');
  assert.equal(t.area, 248.5);
  assert.equal(t.price, 14.5e8);
  assert.equal(t.builtYear, 1995);
});
