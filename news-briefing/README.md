# 아침 뉴스 브리핑

매일 새벽 주요 신문 헤드라인, 농업 신문 헤드라인, 비료 관련 뉴스, 국제 정세·경제 뉴스를 모아 **차에서 음성으로 듣는** 원고를 만듭니다.
차 블루투스가 연결되면 휴대폰이 원고를 자동으로 읽어 줍니다.

- 화면: `https://kimyh1981.github.io/Personal-Project/news/` (기사 목록, 듣기·건너뛰기·속도)
- 음성 원고: `https://kimyh1981.github.io/Personal-Project/news/briefing.txt`
- 데이터: `news/briefing.json`

## 어떻게 만들어지나

1. `.github/workflows/pages.yml`이 매일 한국 시간 새벽 5시(그리고 6시간마다 배포할 때)에 `node tools/collect.js`를 실행합니다.
2. `feeds.json`의 섹션별 출처를 읽습니다. 언론사 RSS가 막히거나 비어 있으면 같은 언론사를 구글 뉴스 검색(`site:` + 최근 1일)으로 대신 읽습니다.
3. 36시간 넘은 기사, 사진·영상·부고·인사 기사, 다른 신문과 거의 같은 제목은 뺍니다.
4. 말머리(`[단독]`, `(종합)`), 따옴표, 말줄임표, 화살표를 소리 내어 읽기 좋게 다듬어 원고를 만듭니다. 기본 설정으로 약 4~6분 분량입니다.

신문사나 검색어를 바꾸려면 `feeds.json`만 고치면 됩니다 (`take`: 출처별 기사 수, `limit`: 섹션 전체 기사 수).

## 차에 타면 자동으로 듣기

기본값은 **월~금 아침 6~8시**입니다.

- 요일·공휴일은 서버가 판단합니다: 주말과 공휴일(대체공휴일·선거일·임시공휴일 포함)에는 `briefing.txt`를 비워 두어 휴대폰이 아무것도 읽지 않습니다. 공휴일은 공공데이터포털 특일 정보(한국천문연구원 `getRestDeInfo`, 저장소 비밀값 `DATA_GO_KR_KEY`로 활용신청 필요)로 확인하고, 조회가 안 되면 `tools/holidays.js`의 내장 목록(고정 공휴일 + 2026년 음력·대체공휴일·선거일)을 씁니다. 화면(`briefing.json`)에서는 쉬는 날에도 들을 수 있습니다.
- 시간(6~8시)은 휴대폰 자동화가 확인합니다.

**아이폰 (터치 없이 자동)** — 단축어 앱 → 자동화 → 새로운 자동화 → 블루투스 → 차 블루투스 → 연결될 때, 즉시 실행:

1. 현재 날짜 → 날짜 형식 지정 (사용자 지정 `H`)
2. 만약: 형식이 지정된 날짜가 6과 7 사이 (6:00~7:59)
3. 만약 안에: URL `https://kimyh1981.github.io/Personal-Project/news/briefing.txt` → URL의 콘텐츠 가져오기 → 텍스트 말하기 (한국어)

**갤럭시 (터치 없이 자동, Tasker)** — 플레이스토어에서 Tasker를 설치하고, 근처 기기(블루투스) 권한을 허용하고, 배터리 최적화에서 Tasker를 '제한 없음'으로 둡니다.

1. 프로필 + → State → Net → **BT Connected** → Name: 차 블루투스. 같은 프로필에 **Time** 06:00~08:00, **Day** 월~금을 더합니다.
2. 작업 '아침 뉴스':
   1. Task → **Wait** 5초 (차 오디오 연결 대기)
   2. Net → **HTTP Request**: GET `https://kimyh1981.github.io/Personal-Project/news/briefing.txt`, Timeout 30
   3. Alert → **Say**: Text `%http_data`, Engine:Voice 구글 한국어, Stream **Media**, Respect Audio Focus 체크, If `%http_data` Is Set (공휴일의 빈 원고는 건너뜀)
3. 프로필 길게 누르기 → Add Exit Task → Alert → **Shut Up** (블루투스가 끊기면 읽기 중지)

안드로이드 음성 엔진은 한 번에 약 4,000자까지 읽습니다. 원고는 기본 설정에서 1,300자 안팎이고, 수집 로그가 3,900자를 넘으면 경고합니다.
Tasker 없이 쓰려면 모드 및 루틴으로 블루투스 연결 시 '아침 뉴스' 앱(크롬 → 앱 설치)을 열고 **듣기**를 한 번 누릅니다.

## 개발

```
npm test           # 파서·원고·수집 테스트 (네트워크 없이)
npm run collect    # 실제 RSS를 모아 dist/에 briefing.json·briefing.txt 생성
```

PR마다 `.github/workflows/news-check.yml`이 테스트하고 실제 RSS를 모아 출처별 결과와 원고를 로그에 남깁니다.
