# 인계: 분석기 필수 조건 구축 → 부동산 분석기 구축 세션

## 사용자 요구사항
- 분석기의 핵심은 **투자와 거주**. 지역·입지·주택유형(아파트/단독/빌라 등)·확보 가능 자금·매매단가·필요자금·**이주비 지원의 재건축 활용**·시기·고려 규제를 **필수 조건**으로 구축할 것.
- **아이폰(iOS, `PracticeApp`)은 고려하지 말 것.**

## 구현 위치
- 브랜치: `claude/analyzer-essential-conditions-a0cl53` (PR 없음)
- 패키지 `re_analyzer/` — Python 표준 라이브러리만, 금액 단위 만원
- 실행: `python3 -m re_analyzer examples/recon_live_seoul.json [--json]`, `python3 -m re_analyzer --checklist`
- 테스트: `python3 -m unittest discover -s tests` (16개 통과)
- 사용법·구조는 `README.md`

## 필수 조건 (`re_analyzer/validation.py`)
| 단계 | 항목 |
|---|---|
| 공통 | purpose, region.sido, region.sigungu, property.type, property.area_m2, price.asking, buyer.cash, buyer.owned_homes, buyer.annual_income, timing.purchase_date |
| 거주 | location.job_commute_min, location.school_walk_min |
| 투자 | location.subway_walk_min, price.recent_trades, price.jeonse, timing.holding_years |
| 재건축 | reconstruction.stage, reconstruction.prior_asset_value(사업시행인가~이주철거), reconstruction.expected_contribution |
| 세입자 승계 | price.jeonse |

누락 시 판정은 `입력보완필요`이며 누락 항목과 사유를 출력.

## 분석 로직 요약
- **규정 파일** `re_analyzer/rules/kr_default.json` (2025.6.27 + 10.15 대책 기준): 규제지역·토허구역(서울 전역 + 경기 12곳, 토허는 아파트만), LTV, 금액상한(6억/4억/2억), 스트레스 DSR(+3.0%p), 6개월 전입의무, 1주택자 처분조건, 다주택 대출 금지, 취득세(선형구간·중과·일시적2주택·생애최초 감면·교육세·농특세), 중개보수.
- **재건축**: 조합원 지위양도 제한(매도인 10년 보유·5년 거주 예외), 이주비 대출로 이주 시점 주담대 잔액 대환 → 순수령액으로 세입자 보증금 반환(갭) 또는 임시거주 보증금(실거주), 부족분을 매수 후 여유 + 연저축과 비교, 분담금 조달·예상 차익, 토허 실거주 의무와 이주 단계 충돌.
- **시기**: 이주·신축 입주 예상 시점, 단기양도·보유기간 불일치.
- **판정**: 차단 → `불가`, 주의 → `조건부`, 없음 → `진행가능`. 거주·투자 점수 0~100.

## 확인 필요
- 이주비 대출에 6억 한도·다주택 제한 적용 여부 (현재 적용 가정)
- 수도권 생애최초 LTV 70%, 스트레스 가산 3.0%(변동금리 100% 기준, 보수적)
- 규정 기준일 2025-10 → 현재 변경 여부

## 통합 제안
`claude/real-estate-analyzer-setup-b3jp6c` 쪽 분석기와 통합할지, 필수 조건 모델(`conditions.py`, `validation.py`)과 규정 파일만 가져갈지 사용자와 상의 필요.
