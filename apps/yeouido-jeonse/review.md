# 리뷰 결과 — 여의도 전세 매물 수집기

- 리뷰: Review 서브에이전트 / 2026-08-08
- 대상 커밋/상태: `29c49d5 메인 페이지에 여의도 전세 매물 수집기 카드 추가 (2026-08-08T07:53:31+00:00)`
  - 리뷰 시작 시점의 HEAD는 `0a4d94d`였고, 리뷰 중 상위 세션이 Embed 커밋(`29c49d5`)을 올렸다. 두 상태 모두 검증했다.
- 결론: **조건부 통과**
  - 코드 결함 3건(높음 1 / 보통 2)을 찾아 **직접 고쳤다.**
  - 남은 조건은 코드가 아니라 **검증 부재**다. 이 환경에서는 네이버 응답을 한 건도 볼 수 없으므로,
    사용자 PC에서 `--verify`가 통과하기 전까지 이 수집기는 "동작이 확인된 도구"가 아니다.

---

## 1. 검증 환경과 한계

- **`*.naver.com`이 게이트웨이 정책으로 차단(403)**되어 있다. 리뷰 중 실제로 재확인했다:
  `--verify` 실행 → 첫 요청(robots.txt)에서 `HTTP 403`, V7 FAIL, 종료 코드 1.
  따라서 **V1~V8 전부 이 환경에서는 확인불가**이며, 우회는 시도하지 않았다.
- 확인할 수 없는 것(= 사용자 PC에서만 판정 가능한 것)
  - 모바일 `articleList`가 UA+Referer만으로 200을 주는지(V1)
  - `wprcMin/wprcMax`가 보증금 필터인지, 단위가 만원인지(V2) — **금액 표시의 근간**
  - `regions/list`가 토큰을 요구하는지, 여의도동 `cortarNo`의 실제 값(V3)
  - 페이지당 건수·`more` 동작(V4), bbox 커버리지(V5·V8), 429 임계(V6)
- **Playwright 모듈은 설치되어 있지 않다**(`require('playwright')` → MODULE_NOT_FOUND, `npm install` 금지).
  대신 `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`을 `--headless --dump-dom` / `--screenshot`으로
  직접 구동해 **실제 브라우저 렌더 결과로** 웹앱을 검증했다.
  헤드리스 창 최소 폭이 500px로 강제되므로, 320px는 **320px 폭 iframe 안에서 문서 폭을 측정**해 확인했다.
- 검증에 쓴 임시 스크립트·스크린샷·스텁 서버는 모두 스크래치패드에 두었고 저장소에 남기지 않았다.
  (남은 `run-logs/last-run.json`·`verification.json`은 내가 실행한 결과물이며 gitignore 대상이다)

### 검증 방법 요약 (재현 가능하게)

| 무엇 | 어떻게 |
|---|---|
| dry-run 무네트워크 | `globalThis.fetch`·`http/https.request`·`net.connect`를 전부 예외로 바꾼 preload로 실행 → 정상 종료(0) |
| 누락률 30% 초과 | 앱 폴더를 스크래치패드로 복사 + fetch 스텁으로 합성 응답 주입(누락 0%/20%/40%) → md5로 보존 확인 |
| 단위 불일치 | 스텁이 `hanPrc:"7,100만"`을 100% 주입 → 경고·중단·보존 여부 확인 |
| diff 부분 실패 | `diff.computeDiff()`를 손으로 만든 스냅샷으로 8가지 케이스 단독 호출 |
| 429/403·지연·타임아웃 | `fetch` 스텁이 상태코드를 지정, fetch 호출 횟수와 경과 시간을 계측 |
| 웹앱 | Chromium `--dump-dom`으로 필터 URL 9종·폴백 5종의 렌더 결과를 직접 파싱 |

---

## 2. 체크리스트 결과

### A. 규칙 준수

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| A1 | `apps/yeouido-jeonse/` 밖 파일 생성·수정 없음 | **PASS(Build)** | Build 커밋 4개(`e08c369`·`c867c35`·`a31ae74`·`0a4d94d`)는 앱 폴더만 건드렸다. 단 HEAD `29c49d5`는 `src/templates/index.html`을 수정했다 — Build 위반이 아니라 **상위 세션의 Embed 단계가 Review 완료 전에 선행 실행된 것**(§4 관찰) |
| A2 | npm 의존성 없음 | PASS | `package.json`·`node_modules` 없음. `require`는 `node:fs`·`node:path`·`node:process`뿐 |
| A3 | 웹앱에 외부 CDN·라이브러리 없음 | PASS | `index.html`/`style.css`/`app.js`/`sample.json`의 `http(s)://` 전수 검사 → `app.js:160`의 `http://localhost:8642/...` 안내 문자열 1건이 유일 |
| A4 | `spec.md` 무변경 | PASS | `git diff HEAD -- spec.md` 비어 있음. `PLAN/BUILD/REVIEW-INSTRUCTIONS.md`도 무변경 |

### B. 승인된 결정사항 (D1~D8)

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| D1 | 실데이터 gitignore | PASS | `data/.gitignore`에 `listings.json`·`history.json`·`regions.cache.json`·`*.tmp`, `!sample.json`. `run-logs/.gitignore`에 실행 로그 3종 + `!.gitkeep` |
| D1' | 공개 사이트에 실데이터가 안 올라가는가 | PASS(조건부) | `build.js`는 `apps/`를 `.md`만 빼고 **통째로 복사**하므로 로컬에 `listings.json`이 있으면 `dist/`에 들어간다. 그러나 배포는 `.github/workflows/deploy.yml`이 **클린 체크아웃 후 `node build.js`** 를 돌리므로 gitignore된 실데이터는 애초에 존재하지 않는다 → 공개 사이트에는 `sample.json`만 간다. **로컬 `dist/`를 손으로 배포하면 이 방어가 깨진다**(§4 의견) |
| D2 | `.github/workflows/`에 추가 없음 | PASS | 기존 `deploy.yml` 1개뿐이며 무변경 |
| D3 | 기본 활성 7곳 + 비활성 3곳 | PASS | `config.json`의 `include` 7곳 정확, `available_but_off`에 도화·공덕·흑석, 켜는 방법은 `_comment`와 README 3-1에 있다. **단 하위 법정동 확장 시 상한에 걸리는 문제는 결함 #3** |
| D4 | 1일 2회(08·20시) 예시 | PASS | README 4장: cron `0 8,20 * * * …`, Windows 작업 스케줄러 절차. `index.html` 푸터 도움말에도 동일 |
| D5 | 오피스텔 전용 30㎡ 하한 + 조정 가능 | PASS | `config.criteria.officetelMinExclusiveM2: 30`, `filterByCriteria`가 적용. 면적 불명 건은 **버리지 않고 카운트**(판단 불가를 삭제로 위장하지 않음) |
| D7 | `wprcMin=40000`·`wprcMax=70000` | PASS | dry-run이 출력한 실제 URL에서 확인 |
| D8 | 지도 SDK 없음 | PASS | 지도 관련 코드·스크립트 태그 없음. `lat`/`lng`는 수집·보관만 |

### C. 정적 검증 (직접 실행)

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| C1 | 모든 `.js` `node --check` | PASS | 6개 파일(app.js + collector 5개), 수정 후 재확인 |
| C2 | `--dry-run`이 네트워크를 타지 않는가 | PASS | fetch/http/https/net을 전부 예외로 바꾼 preload로 실행해도 **exit 0**. 캐시 있을 때(실 코드 8개)·없을 때(자리표시자 7개) 두 경로 모두 |
| C3 | `--verify`가 사람이 읽는 안내를 내는가 | PASS | 403에서 스택 트레이스 없이 원인 유형·확인 절차·"D6에 따라 중단, 상위 세션 보고" 출력, `verification.json` 기록, **exit 1** |
| C4 | 기본 수집이 기존 데이터를 파괴하지 않는가 | PASS | 차단 상태에서 실행 → 요청 1회로 중단, 8개 지역 전부 `regionsFailed`, `listings.json`·`history.json` **md5 동일**, `.tmp` 잔여 없음, exit 1 |
| C5 | `node build.js` | PASS | 빌드 성공, `dist/apps/yeouido-jeonse/`에 `index.html`·`style.css`·`app.js`·`data/sample.json` 복사, **`.md`는 0건** |
| C6 | `tools/serve.js` HTTP 200 | PASS | `/apps/yeouido-jeonse/` 200 + 실제 HTML, `app.js`·`style.css`·`data/sample.json` 모두 200. serve.js에 `.json` MIME이 없어 `application/octet-stream`으로 오지만 `Response.json()`은 Content-Type과 무관하므로 동작에 영향 없음(§4 의견) |

### D. 로직 검증 (직접 시험)

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| D-1 | `prc`↔`hanPrc` 교차검증이 실제로 동작하는가 | **FAIL → 수정함** | **결함 #1.** `prc:71000` + `hanPrc:"7,100만"`을 넣으면 경고가 **하나도 안 나왔다**(`unitSuspect=false`). `parseHanPrc`가 말미의 `만`을 못 읽어 `null`을 돌려주고, `null`은 조용히 통과했기 때문. 스텁으로 이 값을 100% 주입해 E2E로 재현한 결과 **10건 전부 경고 없이 저장**되었고 카드에는 `7,100만`이 대표 금액으로 찍혔다(실제 7억1천 → 10배 오표시). 수정 후 재현: 경고 발생 + 불일치율 100% > 30% → **중단·보존(md5 동일)** |
| D-2 | 층 표기 처리 | PASS | `"7/10"`→7, `"고/10"`→null, `"-"`→null, `""`→null, 없음→null, `"B1/10"`→-1. 크래시 없음 |
| D-3 | 필드가 없는 객체 | PASS | `{}`→`missing-atclNo`, `{atclNo}`→`missing-prc`, `null`·문자열→`not-an-object`. 전부 스킵 카운트로만 처리 |
| D-4 | 누락률 30% 초과 시 보존하며 실패 | PASS | 40% 주입 → `■ 수집을 실패로 처리합니다: 필수 필드 누락률 40% … listings.json 을 덮어쓰지 않았다`, exit 1, **md5 동일**, `.tmp` 없음. 20% 주입 → 정상 저장(exit 0)으로 경계 동작 확인 |
| D-5 | diff 신규/사라짐/가격변동 | PASS | 3케이스 동시 주입 → `new:1, priceChanged:1, disappeared:1` 정확. 가격변동은 `55000→52000/down`으로 방향까지 맞다 |
| D-6 | 부분 실패 지역이 "사라짐"으로 오판되지 않는가 | **PASS(+엣지 FAIL → 수정함)** | 실패 지역(R2)의 이전 매물은 `status=active`·`heldDueToFailure=true`·`disappeared:0`·`heldForFailure:1`로 **보류**되고 안내 노트도 나온다. `failedRegionCodes`를 숫자로 줘도 `String()` 강제 변환으로 방어된다. **다만 `regionCode`가 null인 이전 매물은 전 지역이 실패해도 "사라짐"으로 판정되었다(결함 #2)** — `filterByRegion`이 `cortarNo` 없는 건을 남기므로 실제로 도달 가능한 경로다. 수정 후 보류로 바뀜 |
| D-7 | 매물 0건이 에러가 아니고 기존 데이터를 지우지 않는가 | PASS | `collect.js`가 0건 + 기존 데이터 존재 시 `computeDiff`를 아예 호출하지 않고 보존·종료. 웹앱도 0건을 "오류가 아닙니다"로 표시 |
| D-8 | 접두어 매칭이 `당산동1가~6가`를 모두 잡는가 / 상한이 걸리는가 | **PASS(+결함 #3 수정함)** | 실제 법정동 구성(29개)을 모사한 캐시로 시험: 당산동1~6가 전부 매칭, `도림동`은 오매칭 없음, 상한 25·5 모두 실제 적용되고 제외 목록이 경고로 나온다. **그런데 기본 7곳은 30개 코드로 펼쳐져 상한 25에 걸리고, 앞에서부터 자르는 방식이라 `신길동`·`노량진동`(= D3 승인 지역 2곳)이 통째로 빠졌다** |
| D-9 | 429/403에서 재시도 없이 즉시 중단 | PASS | 429·403 각각 **fetch 호출 1회**, `kind=blocked`, `state.aborted=true`, 이후 호출은 즉시 거부. 401은 `kind=auth`. 500은 스펙(9.2)대로 3회 재시도(1+2+4초 백오프)하고 `kind=http` |
| D-10 | 지연·1일 요청 상한·타임아웃, 우회 경로 없음 | PASS | `delayMs=0`을 넣으면 하드 하한 1000ms로 클램프되고 경고. 실측 요청 간격 1001ms. `maxRequestsPerRun=2`에서 3번째부터 `kind=budget`. 타임아웃은 `AbortController`로 1001ms에 `kind=network/cause=timeout`. `fetch` 호출 지점은 `naver-client.js:218` **단 1곳** |
| D-11 | 원자적 저장 | PASS | `tmp → renameSync` 확인. 실패 경로에서 `.tmp` 잔여 없음. 지역 캐시도 동일 방식 |

### E. 웹앱 검증 (실제 Chromium 렌더)

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| E-1 | `is_sample: true` → "예시 데이터" 배너가 실제로 렌더되는가 | PASS | DOM에 `banner--sample` 1개 + `데이터 출처: 예시 데이터 (data/sample.json)` 확인 |
| E-2 | `sample.json`이 명백한 자리표시자인가 | PASS | 단지명 `예시아파트 A~H`·`샘플오피스텔 C/D/G`, 매물번호 `SAMPLE-01~08`, 중개사 `표시용 중개사무소(예시)`, `sourceUrl: null`(화면에 "원본 링크 없음(예시 데이터)"), 최상위 `sampleNotice` 문구까지 있다. 실재 아파트명 없음 |
| E-3 | 폴백 순서 `listings.json → sample.json → 안내` | PASS | 4가지를 실제로 시험: ① listings.json 있음 → 실데이터 10건 + "데이터 출처: 수집 데이터" + 예시 배너 없음 ② 0건 + `partialFailure` → 경고 배너 + "수집된 매물이 0건입니다" ③ listings.json이 깨진 JSON → sample 폴백 + 예시 배너 ④ 둘 다 404 → "표시할 데이터가 없습니다" + 시도 경로 목록 |
| E-4 | `file://` 안내 | PASS | `file://`로 열면 "file:// 로 열면 데이터를 읽을 수 없습니다" + `node build.js` / `node tools/serve.js` / 접속 주소 안내 |
| E-5 | 필터·정렬·배지 동작 | PASS | URL 쿼리로 9종 실측 — 신규만 2건, 사라짐 포함 8건, 아파트 4건, 오피스텔 3건, 가격내림 2건, 보증금 6~7억 3건, 전용 100㎡ 이상 1건, 신규+내림 교집합 0건, `sort=deposit-asc` 정렬 순서 정확(41000→70000). 배지도 신규 2·내림 2·오름 1로 데이터와 일치 |
| E-6 | 0건·에러·오프라인 구분 표시 | PASS / 오프라인은 **확인불가** | 0건("수집된 매물이 0건입니다")과 로드 실패("표시할 데이터가 없습니다" + 시도 경로)는 실제로 구분 확인. 오프라인 분기는 `navigator.onLine === false` 코드 경로만 읽어 확인했고 헤드리스에서 재현하지 않았다 |
| E-7 | 320px 반응형 | PASS | 320px 폭 iframe에서 측정: `clientWidth=305 == scrollWidth=305 == body.scrollWidth=305` → **페이지 가로 넘침 없음**. 넘치는 요소는 전부 `.chips`(의도된 `overflow-x:auto` 스크롤 띠) 내부의 칩 버튼뿐. 카드 1열, 텍스트 정상 줄바꿈(스크린샷 확인). CSS도 `min-width:0`·`overflow-wrap:anywhere`·`flex-wrap:wrap`으로 대비되어 있다 |
| E-8 | 푸터 출처 표기 | PASS | "네이버 부동산 공개 매물 정보를 개인 열람 목적으로 수집. 정확한 정보는 원본을 확인하세요." |
| E-9 | 접근성 기본 | PASS(경미한 개선 여지) | `<img>`가 아예 없어 `alt` 대상 없음. 칩은 `<button aria-pressed>`, select·range는 `<label>`로 감싸 암시적 연결, `aria-live`가 배너·목록에, `aria-label`이 필터 섹션·목록에 있다. 칩 묶음에 `role="group"`+`aria-label`이 없는 점만 개선 여지(§4) |

### F. 안전·윤리 검증

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| F-1 | 차단 회피 기능 없음 | PASS | `Promise.all`·`allSettled`·프록시·`X-Forwarded`·UA 무작위 회전 코드 없음(전수 grep). UA는 `naver-client.js:36`에 상수 1개, `fetch`도 1곳. 언제나 순차 1요청 |
| F-2 | 전국·대량 수집 경로 없음 | PASS | `HARD_LIMITS.maxRegionCodes=40`·`maxRequestsPerRun=300`·`maxPagesPerRegion=10`·`minDelayMs=1000`이 config보다 우선하며, 클램프 동작을 실측 확인 |
| F-3 | 토큰·쿠키 마스킹 | PASS | `maskSecrets('Bearer …; NID_AUT=…; NNB=…')` → 전부 `***MASKED***`. 로그·에러·`last-run.json` 경로 모두 이 함수를 통과한다 |
| F-4 | `.secrets.json` gitignore | PASS | `collector/.gitignore`에 `.secrets.json`·`*.log` |

---

## 3. 발견한 결함과 조치

| # | 심각도 | 파일:줄 | 문제 | 조치 |
|---|---|---|---|---|
| 1 | **높음** | `collector/normalize.js:49`(`parseHanPrc`), `:127`(교차검증) | `prc`↔`hanPrc` 교차검증이 **가장 그럴듯한 불일치 형태에서 침묵**했다. `parseHanPrc("7,100만")`이 `만` 접미를 못 읽어 `null`을 반환하고, 코드가 `fromHan !== null`일 때만 비교하므로 **불일치가 경고 없이 통과**했다. E2E로 100% 주입 시 20건이 그대로 저장되고 카드 대표 금액이 `7,100만`(실제 7억1천의 1/10)으로 표시됐다. BUILD 지침이 "4억이 4조로 표시된다"며 최우선으로 막으라 한 바로 그 구멍 | **수정함.** ① 정규식을 `^(?:(\d+)억)?(?:(\d+)만?)?$`로 바꿔 `7,100만`·`1억5,000만`을 해석 ② `hanPrc`가 있는데 **해석 실패하면** 그것도 경고 + `unitSuspect=true`로 표시(교차검증 못 한 것을 "했다"로 위장하지 않는다). 재현 결과 경고 발생 → 불일치율 100% > 30% → 중단·기존 데이터 보존 확인. 정상 데이터(`7억 1,000`, `prc 7100`+`7,100만`)는 그대로 통과(회귀 없음) |
| 2 | 보통 | `collector/diff.js:134` | 부분 실패 보류가 `prevItem.regionCode`가 있을 때만 동작했다. **응답에 `cortarNo`가 없던 매물(`regionCode: null`)은 전 지역이 실패해도 "사라짐"으로 판정**됐다. `normalize.filterByRegion`이 그런 건을 의도적으로 남기므로 실제 도달 가능한 경로다 | **수정함.** 실패 지역이 하나라도 있으면 `regionCode`가 없는 이전 매물도 보류한다. 재현 결과 `disappeared:0 / heldForFailure:1`로 바뀜 |
| 3 | 보통 | `collector/regions.js:293`(`capRegions`) | 기본 7곳은 하위 법정동까지 펼치면 **30개 코드**(영등포동 9, 당산동·문래동·양평동 각 6, 여의도동·신길동·노량진동 각 1)가 되어 기본 상한 25를 넘는다. 그런데 상한 적용이 **앞에서부터 자르는 방식**이어서 설정 뒤쪽의 `양평동4~6가`·`신길동`·`노량진동`이 잘렸다 — **D3에서 승인된 대상 지역 2곳이 아예 수집되지 않는다**(경고는 나오지만 기본값이 곧 잘못된 결과) | **수정함.** 설정한 동마다 **돌아가며(round-robin)** 뽑도록 바꿔, 코드가 1개인 지역(신길동·노량진동)이 통째로 빠지지 않게 했다. 경고 문구에 "전부 수집하려면 `maxRegionCodes`를 올리세요(하드 상한 40)"를 넣고 README 3-1에 계산 근거와 함께 안내를 추가했다. **`maxRegionCodes`·`maxRequestsPerRun` 기본값(25/150)은 스펙이 정한 값이므로 건드리지 않았다** |
| 4 | 보통 (환경) | `data/listings.json`·`data/history.json`·`data/regions.cache.json`·`run-logs/last-run.json`·`run-logs/last-raw-sample.json` | Build가 fetch 스텁으로 E2E 시험한 **잔여 파일이 작업트리에 남아 있었다.** ① `listings.json`에 `여의도테스트 0`·`테스트단지 1156012100`·중개사 `테스트중개` 20건이 `is_sample:false`로 들어 있어, **웹앱이 이를 최우선 로드해 "마지막 수집 …전체 20건"의 실제 데이터처럼 표시**했다 ② `regions.cache.json`은 `fetchedAt`이 실제 조회처럼 찍힌 **손으로 만든 캐시**여서, TTL 7일 동안 `regions/list` 드릴다운을 건너뛰고 **미검증 하드코딩 `cortarNo`로 수집**하게 된다(spec 2.4가 금지한 하드코딩) ③ `last-run.json`은 `ok:true, "정상 수집"`으로 남아 있었다 | **리뷰 중(약 07:56) 상위 세션이 이미 삭제**해 현재는 존재하지 않는다(`data/`에 `sample.json`만 남음). 모두 gitignore 대상이라 **커밋되지는 않았다.** 내가 지운 것이 아니므로 조치는 "확인·기록"이며, §5에 사용자 확인 항목으로 올렸다 |
| 5 | 낮음 | `collector/naver-client.js:266~283` | 요청 예산 검사가 `get()` 진입 시 1회뿐이어서, **재시도 루프는 예산을 다시 확인하지 않는다.** `maxRequestsPerRun`을 최대 `maxRetries`(3)만큼 초과할 수 있다 | **고치지 않았다.** 초과 폭이 3요청이고 429/403은 재시도하지 않으므로 예의 있는 수집 원칙을 실질적으로 깨지 않는다. 고치려면 루프 안에 예산 검사를 추가하면 된다 |
| 6 | 낮음 | `collector/collect.js:841~851` + `diff.js` | **필수 필드 누락으로 건너뛴 매물이 다음 diff에서 "사라짐"으로 판정된다.** 20% 주입 시험에서 실제로 `사라짐 2`가 나왔다. 매물은 네이버에 그대로 있는데 우리가 파싱을 못 한 것이므로, 결함 #2와 같은 계열의 오독이다 | **고치지 않았다.** 건너뛴 `atclNo`를 diff까지 넘겨 보류 대상에 넣는 인터페이스 변경이 필요해, 리뷰 단계에서 손대는 것보다 스펙 반영이 맞다고 판단했다. 누락률 30% 초과 시에는 실행 자체가 중단되므로 대량 오독은 이미 막혀 있다 |
| 7 | 낮음 | `collector/collect.js:921~934` | **전 지역이 실패해 결과가 0건일 때** 콘솔은 "수집 결과 0건 — 기존 데이터를 보존"만 말하고, 실패 지역 목록과 "■ 일부 지역 수집에 실패했습니다"를 출력하지 않는다(정상 경로에는 있다). `last-run.json`에는 8개 실패가 정확히 기록되고 종료 코드도 1이라 조용한 실패는 아니다 | **고치지 않았다.** 출력 문구 배치 문제이고 종료 코드·로그 파일이 사실을 보존한다 |
| 8 | 낮음 | `tools/serve.js`(앱 폴더 밖) | `.json` MIME이 없어 `application/octet-stream`으로 응답한다 | **고칠 수 없다**(수정 금지 범위). `Response.json()`은 Content-Type과 무관하므로 실제 동작에는 영향이 없음을 브라우저로 확인했다 |

---

## 4. 고치지 않고 남긴 의견

- **`build.js`의 `apps/` 전량 복사와 D1의 관계.** `build.js`는 `.md`만 제외하고 복사하므로, 로컬에 실데이터가 있는 상태로
  `node build.js`를 돌리면 `dist/apps/yeouido-jeonse/data/listings.json`·`run-logs/*`까지 만들어진다(리뷰 중 실제로 확인).
  GitHub Actions는 클린 체크아웃이라 공개 사이트는 안전하지만, **`dist/`를 손으로 배포하는 순간 D1이 깨진다.**
  근본 방어는 `build.js` 필터에 `data/listings.json`·`data/history.json`·`run-logs/`를 추가하는 것인데,
  그 파일은 앱 폴더 밖이라 Review가 손대지 않았다. **Embed/상위 세션에서 판단할 사항**으로 남긴다.
- **Embed가 Review보다 먼저 커밋되었다.** `CLAUDE.md`의 작업 사이클은 3) Review → 4) Embed 순서인데,
  HEAD `29c49d5`가 이미 메인 페이지 카드를 넣었다. 카드 내용 자체는 적절하다(기존 카드와 동일 구조, iframe 미리보기,
  설명에 "공개 화면은 예시 데이터입니다" 명시). 순서만 어긋났고 되돌릴 필요는 없다고 본다.
- `stats.total`이 **보류(`heldDueToFailure`) 매물을 active로 계산**한다. "실패 지역이라 확인 못 한 건"을
  "지금 있는 매물"과 같은 수에 넣는 셈이다. 배너·배지로 구분 표시되므로 오해 소지는 작지만, 별도 카운트가 더 정직하다.
- `parseConfirmDate`가 두 자리 연도에 항상 `20`을 붙인다(`"99.01.01."` → `2099-01-01`). 매물 확인일이 과거 세기일 수 없어 실질 문제는 없다.
- 웹앱 헤더의 "마지막 수집" 시각이 **브라우저 로컬 타임존**으로 표시된다(UTC 브라우저에서 `20:00+09:00`이 `11:00`으로 보였다).
  KST 고정 표기 또는 타임존 병기가 사용자 의도에 더 맞을 수 있다.
- 칩 묶음(`.chips`)에 `role="group"` + `aria-label`이 없다. 스크린리더로 "지역 필터 묶음"임을 알기 어렵다.
- `sample.json`의 `regions[].cortarNo`가 `0000000001`처럼 실재하지 않는 값이다. 예시임을 드러내는 좋은 선택이라고 본다(개선 요구 아님).

---

## 5. 사용자가 로컬에서 반드시 확인해야 할 것

1. **`node apps/yeouido-jeonse/collector/collect.js --verify` 를 가정용 네트워크에서 먼저 실행하세요.**
   이 환경에서는 첫 요청부터 `HTTP 403`(게이트웨이 차단)이라 V1~V8이 전부 미확인입니다.
   - `V7 FAIL`(robots.txt 금지) → **그 자리에서 멈추고 알려주세요.** 수집을 진행하면 안 됩니다.
   - `V1 FAIL` → 모바일 API 차단입니다. D6에 따라 중단하고 보고해 주세요(우회 시도 금지).
   - `V2 FAIL/SKIP` → 보증금 필터가 서버에서 안 걸린다는 뜻입니다. 결과는 자체 필터로 안전하지만 요청량이 늘어납니다.
   - `V3`의 여의도동 `cortarNo`가 `1156011000`과 **다르게** 나오면 그 값을 알려주세요(스펙 추정값이 틀린 것입니다).
   - 출력의 "첫 매물 1건 주요 필드"에서 **`prc`와 `hanPrc`가 같은 금액인지 눈으로 대조**해 주세요. 금액 단위 전제의 유일한 실증입니다.
2. **`data/` 안에 `listings.json`·`history.json`·`regions.cache.json`이 있으면 지우고 시작하세요.**
   리뷰 중 Build의 테스트 잔여 파일(`여의도테스트 0`, 중개사 `테스트중개` 20건과 손으로 만든 지역 캐시)이 발견되었습니다.
   지금은 사라진 상태지만, 남아 있으면 **가짜 데이터가 실제 수집 결과처럼 화면에 뜨고**,
   가짜 지역 캐시가 7일간 유효해 `regions/list` 드릴다운을 건너뜁니다.
   `run-logs/last-run.json`의 시각이 방금 실행한 것과 맞는지도 함께 확인해 주세요.
3. **첫 실제 수집 뒤 `run-logs/last-run.json`과 콘솔 경고를 읽어 주세요.** 특히
   - `대상 법정동이 30개로 상한(25)을 넘었다 …` → 전부 수집하려면 `config.json`의 `politeness.maxRegionCodes`를 30~40으로 올리세요.
   - `보증금 범위 밖 N건을 자체 필터로 제외했다` → V2가 사실상 FAIL이라는 신호입니다.
   - `hanPrc를 해석할 수 없어 … 교차검증을 하지 못했다` → 금액 표기 형식이 바뀐 것입니다. 그 문자열을 알려주세요.
4. **화면 확인은 `node build.js` → `node tools/serve.js` → `http://localhost:8642/apps/yeouido-jeonse/`** 로 하세요.
   `file://`로 직접 열면 데이터를 못 읽습니다(그 경우 안내가 뜹니다).
5. **`dist/`를 손으로 배포하지 마세요.** 실데이터가 함께 올라갈 수 있습니다(§4 첫 항목). 배포는 main 푸시 → Actions로만.
6. 라이브 검증이 필요한 전제 목록: 모바일 API 토큰 불필요(V1) / `wprc*`=보증금·만원 단위(V2) /
   `regions/list` 무인증(V3) / 페이지당 20건·`more` 동작(V4) / bbox 커버리지(V5·V8) / 429 임계(V6) / robots.txt 허용(V7).
   **이 7가지는 전부 제3자 관찰에 근거한 추정이며, 이 리뷰가 확인해 준 것이 하나도 없습니다.**

---

## 6. Embed 단계로 넘어가도 되는가

**넘어가도 된다(조건부).** 근거와 조건:

- **넘어가도 되는 이유**
  1. 규칙 위반이 없다. Build는 앱 폴더 밖을 건드리지 않았고, 의존성 0·CDN 0·지도 SDK 0, `spec.md` 무변경이다.
  2. 공개 사이트에 나가는 것은 `sample.json`뿐이며, 이는 명백한 자리표시자다. 실데이터는 gitignore + 클린 빌드로 이중 차단된다.
     즉 **네이버 API가 동작하든 안 하든 블로그 카드로서의 결과물은 이미 완성되어 있다.**
  3. 필터·정렬·배지·폴백·0건/에러 상태·320px 반응형을 실제 브라우저로 검증했고 전부 동작한다.
  4. 차단 환경에서도 데이터를 파괴하지 않고 종료 코드 1로 실패를 드러낸다(직접 재현).
  5. Embed 커밋(`29c49d5`)의 카드 내용 자체에 문제가 없다.

- **조건**
  1. **이번 리뷰가 고친 4개 파일이 커밋에 포함되어야 한다** — `collector/normalize.js`, `collector/diff.js`,
     `collector/regions.js`, `README.md`. 특히 `normalize.js` 수정 없이 배포되면 **금액이 1/10로 표시될 수 있다.**
     (Review는 커밋하지 않았다. 상위 세션이 처리해야 한다.)
  2. **`--verify`가 통과하기 전까지 "동작하는 수집기"라고 소개하지 말 것.** 현재 카드 설명은
     "공개 화면은 예시 데이터입니다"라고 명시하고 있어 이 조건을 이미 만족한다.
  3. `build.js`의 실데이터 복사 문제(§4)를 Embed/상위 세션에서 판단할 것. 지금 당장 공개 사이트가 위험하지는 않다.
