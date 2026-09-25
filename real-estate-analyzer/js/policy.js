/*
 * 부동산 규제·세제 파라미터 (한국, 기준일 2026-09-25)
 *
 * 모든 정책 수치는 이 파일 한 곳에서만 관리한다. 규정이 바뀌면 여기만 고친다.
 * 출처: 금융위 6·27(2025), 10·15(2025) 대책, 국토부 2026-06-30 규제지역 추가지정(동탄·기흥·구리),
 *       지방세법·소득세법·종합부동산세법 현행 세율, 2026-08-03 세제개편안(미확정, 옵션으로만 반영).
 * 은행·상품별 세부 기준은 다를 수 있으므로 결과는 참고용이다.
 */
(function (root, factory) {
  const policy = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = policy;
  else root.REA_POLICY = policy;
})(typeof self !== 'undefined' ? self : this, function () {
  const EOK = 100000000; // 1억
  const MAN = 10000; // 1만

  // ── 지역 ──────────────────────────────────────────────────────────────
  // capital: 수도권, regulated: 조정대상지역+투기과열지구, landPermit: 토지거래허가구역(아파트),
  // metro: 국민주택채권 매입률 '서울·광역시' 구분
  const SEOUL_GU = [
    '강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구', '노원구',
    '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구', '성북구', '송파구',
    '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구',
  ];
  const GYEONGGI_REGULATED = [
    '과천시', '광명시', '성남시 분당구', '성남시 수정구', '성남시 중원구',
    '수원시 영통구', '수원시 장안구', '수원시 팔달구', '안양시 동안구',
    '용인시 수지구', '의왕시', '하남시',
    // 2026-07-01 추가 지정
    '화성시 동탄구', '용인시 기흥구', '구리시',
  ];

  // 국토부 실거래가 API 법정동 코드(시군구 5자리). 화성시 동탄구는 2026년 구 신설로 코드 확인 필요 → 화성시 코드 사용
  const LAWD = {
    '강남구': '11680', '강동구': '11740', '강북구': '11305', '강서구': '11500', '관악구': '11620', '광진구': '11215',
    '구로구': '11530', '금천구': '11545', '노원구': '11350', '도봉구': '11320', '동대문구': '11230', '동작구': '11590',
    '마포구': '11440', '서대문구': '11410', '서초구': '11650', '성동구': '11200', '성북구': '11290', '송파구': '11710',
    '양천구': '11470', '영등포구': '11560', '용산구': '11170', '은평구': '11380', '종로구': '11110', '중구': '11140', '중랑구': '11260',
    '과천시': '41290', '광명시': '41210', '성남시 분당구': '41135', '성남시 수정구': '41131', '성남시 중원구': '41133',
    '수원시 영통구': '41117', '수원시 장안구': '41111', '수원시 팔달구': '41115', '안양시 동안구': '41173',
    '용인시 수지구': '41465', '용인시 기흥구': '41463', '의왕시': '41430', '하남시': '41450', '구리시': '41310', '화성시 동탄구': '41590',
  };

  const REGIONS = [];
  SEOUL_GU.forEach((gu) => REGIONS.push({
    id: 'seoul-' + gu, group: '서울', name: '서울 ' + gu, lawd: LAWD[gu],
    capital: true, regulated: true, landPermit: true, metro: true,
  }));
  GYEONGGI_REGULATED.forEach((n) => REGIONS.push({
    id: 'gg-' + n, group: '경기 (규제지역)', name: '경기 ' + n, lawd: LAWD[n],
    capital: true, regulated: true, landPermit: true, metro: false,
  }));
  REGIONS.push(
    { id: 'gg-other', group: '경기·인천 (비규제)', name: '경기 기타 (비규제)', capital: true, regulated: false, landPermit: false, metro: false },
    { id: 'incheon', group: '경기·인천 (비규제)', name: '인천', capital: true, regulated: false, landPermit: false, metro: true },
  );
  ['부산', '대구', '광주', '대전', '울산'].forEach((c) => REGIONS.push({
    id: 'metro-' + c, group: '지방', name: c + ' (광역시)', capital: false, regulated: false, landPermit: false, metro: true,
  }));
  REGIONS.push(
    { id: 'sejong', group: '지방', name: '세종', capital: false, regulated: false, landPermit: false, metro: false },
    { id: 'local', group: '지방', name: '기타 지방', capital: false, regulated: false, landPermit: false, metro: false },
  );

  // ── 대출 ──────────────────────────────────────────────────────────────
  const LOAN = {
    // 구입자 유형별 LTV
    ltv: {
      regulated: { first: 0.70, nohome: 0.40, one_dispose: 0.40, one: 0, multi: 0 },
      capital: { first: 0.70, nohome: 0.70, one_dispose: 0.70, one: 0, multi: 0 },
      local: { first: 0.80, nohome: 0.70, one_dispose: 0.70, one: 0.60, multi: 0.60 },
    },
    // 주택가격별 주담대 절대 한도 (10·15 대책, 규제지역)
    regulatedCaps: [
      { upTo: 15 * EOK, cap: 6 * EOK },
      { upTo: 25 * EOK, cap: 4 * EOK },
      { upTo: Infinity, cap: 2 * EOK },
    ],
    capitalCap: 6 * EOK, // 수도권 비규제 주택구입 주담대 한도 (6·27)
    capitalMaxTermYears: 30, // 수도권·규제지역 주담대 만기 상한
    dsrLimit: { bank: 0.40, nonbank: 0.50 },
    // 스트레스 가산금리 (%p): 수도권·규제지역 하한 3.0 (10·15), 지방 0.75
    stressRate: { capital: 3.0, local: 0.75 },
    // 금리유형별 스트레스금리 반영비율
    stressWeight: { variable: 1.0, mixed: 0.8, periodic: 0.4, fixed: 0 },
    moveInMonths: 6, // 수도권·규제지역 주담대 전입의무
  };

  // 정책모기지 (주요 요건 요약, 세부 조건은 주택도시기금·주금공 확인)
  const POLICY_LOANS = [
    {
      id: 'didimdol', name: '디딤돌대출',
      maxIncome: { base: 6000 * MAN, first: 7000 * MAN, newlywed: 8500 * MAN },
      maxPrice: { base: 5 * EOK, newlywed: 6 * EOK },
      maxLoan: { base: 2 * EOK, first: 2.4 * EOK, newlywed: 3.2 * EOK },
      maxNetAsset: 4.88 * EOK, maxAreaM2: 85, rate: '연 2.85~4.15%',
      requireNoHome: true,
    },
    {
      id: 'newborn', name: '신생아 특례 디딤돌',
      maxIncome: { base: 2 * EOK }, maxPrice: { base: 9 * EOK }, maxLoan: { base: 4 * EOK },
      maxNetAsset: 4.88 * EOK, maxAreaM2: 85, rate: '연 1.80~4.50%',
      requireNoHome: true, requireNewborn: true,
    },
    {
      id: 'bogeumjari', name: '보금자리론',
      maxIncome: { base: 7000 * MAN, newlywed: 8500 * MAN, multichild: 1 * EOK },
      maxPrice: { base: 6 * EOK }, maxLoan: { base: 3.6 * EOK, first: 4.2 * EOK },
      maxAreaM2: Infinity, rate: '연 3.9~4.2% (고정)',
      requireNoHome: false,
    },
  ];

  // ── 취득 ──────────────────────────────────────────────────────────────
  const ACQUISITION = {
    generalLow: { upTo: 6 * EOK, rate: 0.01 },
    generalHigh: { from: 9 * EOK, rate: 0.03 },
    heavy: { regulated: { 2: 0.08, 3: 0.12 }, nonRegulated: { 3: 0.08, 4: 0.12 } },
    heavyEduRate: 0.004, // 중과 시 지방교육세
    ruralTax: { general: 0.002, 0.08: 0.006, 0.12: 0.01 }, // 전용 85㎡ 초과 농어촌특별세
    firstTimeCredit: { maxCredit: 200 * MAN, maxPrice: 12 * EOK },
    // 국민주택채권 매입률 (시가표준액 기준)
    bond: {
      metro: [[2000 * MAN, 0], [5000 * MAN, 0.013], [1 * EOK, 0.019], [1.6 * EOK, 0.021], [2.6 * EOK, 0.023], [6 * EOK, 0.026], [Infinity, 0.031]],
      other: [[2000 * MAN, 0], [5000 * MAN, 0.013], [1 * EOK, 0.014], [1.6 * EOK, 0.016], [2.6 * EOK, 0.018], [6 * EOK, 0.021], [Infinity, 0.026]],
    },
    stampDuty: [[1 * EOK, 0], [10 * EOK, 15 * MAN], [Infinity, 35 * MAN]], // 매수인 부담분(계약서 1부)
  };

  // 중개보수 상한요율 (2021-10 개정)
  const BROKER = {
    sale: [[5000 * MAN, 0.006, 25 * MAN], [2 * EOK, 0.005, 80 * MAN], [9 * EOK, 0.004], [12 * EOK, 0.005], [15 * EOK, 0.006], [Infinity, 0.007]],
    lease: [[5000 * MAN, 0.005, 20 * MAN], [1 * EOK, 0.004, 30 * MAN], [6 * EOK, 0.003], [12 * EOK, 0.004], [15 * EOK, 0.005], [Infinity, 0.006]],
  };

  // ── 보유 ──────────────────────────────────────────────────────────────
  const HOLDING = {
    publicPriceRatio: 0.69, // 공시가격 / 시세 (공동주택 추정치)
    propertyFmv: { oneHouse: [[3 * EOK, 0.43], [6 * EOK, 0.44], [Infinity, 0.45]], other: 0.60 },
    // [상한, 누진공제 전 세율, 누진공제액]
    propertyStandard: [[6000 * MAN, 0.001, 0], [1.5 * EOK, 0.0015, 3 * MAN], [3 * EOK, 0.0025, 18 * MAN], [Infinity, 0.004, 63 * MAN]],
    propertySpecial: [[6000 * MAN, 0.0005, 0], [1.5 * EOK, 0.001, 3 * MAN], [3 * EOK, 0.002, 18 * MAN], [Infinity, 0.0035, 63 * MAN]],
    propertySpecialMaxPublic: 9 * EOK,
    urbanRate: 0.0014, // 도시지역분
    localEduRate: 0.2,
    cpt: {
      deduction: { oneHouse: 12 * EOK, other: 9 * EOK },
      reform2026: { oneHouseResident: 14 * EOK, oneHouseNonResident: 9 * EOK }, // 2026 세제개편안(미확정)
      fmv: 0.60,
      rates: [[3 * EOK, 0.005, 0], [6 * EOK, 0.007, 60 * MAN], [12 * EOK, 0.01, 240 * MAN], [25 * EOK, 0.013, 600 * MAN], [50 * EOK, 0.015, 1100 * MAN], [94 * EOK, 0.02, 3600 * MAN], [Infinity, 0.027, 10180 * MAN]],
      ratesHeavy: [[3 * EOK, 0.005, 0], [6 * EOK, 0.007, 60 * MAN], [12 * EOK, 0.01, 240 * MAN], [25 * EOK, 0.02, 1440 * MAN], [50 * EOK, 0.03, 3940 * MAN], [94 * EOK, 0.04, 8940 * MAN], [Infinity, 0.05, 18340 * MAN]],
      ruralRate: 0.2,
      ageCredit: [[60, 0], [65, 0.2], [70, 0.3], [Infinity, 0.4]],
      holdCredit: [[5, 0], [10, 0.2], [15, 0.4], [Infinity, 0.5]],
      maxCredit: 0.8,
    },
  };

  // ── 양도 ──────────────────────────────────────────────────────────────
  const TRANSFER = {
    exemptThreshold: 12 * EOK, // 1세대1주택 고가주택 기준
    minHoldYears: 2,
    minResideYearsRegulated: 2,
    basicDeduction: 250 * MAN,
    brackets: [[1400 * MAN, 0.06, 0], [5000 * MAN, 0.15, 126 * MAN], [8800 * MAN, 0.24, 576 * MAN], [1.5 * EOK, 0.35, 1544 * MAN], [3 * EOK, 0.38, 1994 * MAN], [5 * EOK, 0.40, 2594 * MAN], [10 * EOK, 0.42, 3594 * MAN], [Infinity, 0.45, 6594 * MAN]],
    shortTerm: { under1: 0.70, under2: 0.60 },
    heavySurcharge: { 2: 0.20, 3: 0.30 }, // 규제지역 다주택 중과
    localIncomeRate: 0.1,
  };

  // ── 주택 유형 ─────────────────────────────────────────────────────────
  const PROPERTY_TYPES = ['아파트', '빌라', '단독주택', '오피스텔'];
  const PROPERTY = {
    landPermitTypes: ['아파트'], // 토지거래허가(실거주 의무)는 아파트에만 적용
    officetel: { acqRate: 0.04, eduRate: 0.004, ruralRate: 0.002 }, // 주택 수와 무관하게 4.6%
    liquidity: { 아파트: 80, 오피스텔: 45, 빌라: 35, 단독주택: 40 }, // 환금성 점수
    publicRatio: { 아파트: 69, 빌라: 69, 단독주택: 53, 오피스텔: 69 }, // 공시가격/시세 기본값(%)
  };

  // ── 재건축·정비사업 ───────────────────────────────────────────────────
  const RECON = {
    stages: ['해당없음', '재건축진단', '정비구역지정', '추진위원회승인', '조합설립인가', '사업시행인가', '관리처분인가', '이주철거', '착공', '준공'],
    yearsToMoveIn: { 재건축진단: 12, 정비구역지정: 10, 추진위원회승인: 9, 조합설립인가: 8, 사업시행인가: 6, 관리처분인가: 4.5, 이주철거: 4, 착공: 3, 준공: 0 },
    constructionYears: 4, // 이주 시점부터 신축 입주까지
    relocationLtv: 0.5, // 이주비 대출 LTV (종전자산 감정가 기준)
    priorAssetDefaultRatio: 0.8, // 감정가 미입력 시 매매가 대비
    transferRestrictionStage: '조합설립인가', // 투기과열지구: 이후 조합원 지위양도 제한
    transferException: { heldYears: 10, livedYears: 5 },
    relocationNote: '이주비 대출은 종전자산 감정가 기준 LTV가 적용됩니다. 수도권·규제지역 주담대 한도(6억 등)와 다주택자 대출 제한이 이주비에도 적용되는지 조합·주관 은행에 반드시 확인하세요.',
    excessProfitNote: '재건축초과이익환수(조합원 1인당 초과이익 8천만원 초과분 부과) 대상인지 확인하세요.',
  };

  // ── 임차 ──────────────────────────────────────────────────────────────
  const RENT = {
    renewalCap: 0.05, // 계약갱신청구권 사용 시 인상 상한
    guaranteeFeeRate: 0.0012, // 전세보증보험 연 보증료율(추정)
    jeonseRiskRatio: 0.8, // 전세가율 80% 이상: 깡통전세 위험
  };

  return {
    asOf: '2026-09-25', EOK, MAN,
    REGIONS, LOAN, POLICY_LOANS, PROPERTY_TYPES, PROPERTY, RECON, ACQUISITION, BROKER, HOLDING, TRANSFER, RENT,
    notes: [
      '2026-08-03 세제개편안(종부세 거주 1주택 공제 14억 등)은 국회 통과 전이며 대부분 2027년 이후 시행 예정입니다.',
      '스트레스 DSR 반영비율·정책대출 요건은 은행·상품별로 다를 수 있습니다.',
      '토지거래허가구역 아파트는 허가 후 2년 실거주 의무가 있어 전세 낀 매수(갭투자)가 불가합니다.',
    ],
  };
});
