# 여의도 전세 매물 수집기 — 구현 스펙 (spec.md)

여의도 및 인근 지역의 **전세 아파트·주거용 오피스텔(보증금 4억~7억)** 매물을 주기적으로 수집해
블로그 웹앱(`apps/yeouido-jeonse/`)에서 보기 좋게 확인하는 도구의 구현 계획서.

- 작성: Plan 서브에이전트 / 2026-08-08
- 상태: **사용자 승인 대기** (11장의 열린 결정 사항 확정 후 Build 착수)

> **표기 규칙**
> - `[검증]` — 실제 캡처된 응답, 네이버가 내려주는 HTML, 또는 서로 독립적인 다수 구현체에서 교차 확인한 사실
> - `[추정]` — 직접 확인은 못 했으나 여러 근거로 강하게 추론되는 것
> - `[미검증]` — 확인하지 못함. Build 단계 첫 작업으로 실제 요청을 보내 확인 필요
>
> **이 문서의 조사 환경 한계 (중요)**
> Plan 단계 실행 환경의 네트워크 이그레스 정책이 `*.naver.com` 전체를 차단한다
> (`new.land.naver.com:443` CONNECT → `403 policy denial`, `land.naver.com` 동일).
> 따라서 **네이버 서버에 대한 실제 응답 확인은 단 한 건도 수행할 수 없었다.**
> 아래 `[검증]` 항목은 모두 *제3자가 캡처해 공개한 실제 응답 데이터·네이버가 내려준 필터 HTML·
> 서로 독립적인 다수 구현체의 코드*를 교차 대조해 얻은 것이다. 라이브 확인은 Build 0단계에서 수행한다.

---

## 1. 목표와 범위

### 1.1 사용자 요구사항
> 네이버 부동산 정보를 크롤링해서 가져오고 싶다. 특정 지역을 선택하고, 거래 조건이나 내용을 선택할 수 있고,
> 주기적으로 정보를 가져올 수 있으면 좋겠다. 서울 여의도 인근의 아파트 또는 주거용 오피스텔로
> 전세 4~7억 수준의 주택을 찾고 있다.

### 1.2 넣을 것 (In scope)
| # | 항목 | 비고 |
|---|------|------|
| G1 | 지역 선택 (기본: 여의도동 + 인근 법정동) | 설정 파일에서 추가·제거 |
| G2 | 거래 조건 선택 (기본: 전세 `B1`, 보증금 4억~7억, `APT`+`OPST`) | 설정 파일 |
| G3 | 주기적 자동 수집 (기본 1일 2회) | OS 스케줄러 |
| G4 | 수집 결과를 목록·필터·정렬로 열람하는 정적 웹앱 | 모바일 지원 |
| G5 | 신규 매물 / 사라진 매물 / 가격 변동 표시 | 스냅샷 비교 |
| G6 | 매물별 네이버 원본 링크 | `m.land.naver.com/article/info/{atclNo}` |
| G7 | 예의 있는 수집 (지연·상한·백오프·로그) | 9장 |

### 1.3 안 넣을 것 (Out of scope)
- 실거래가 조회, 단지 상세 정보(세대수·준공년도 등) 보강 수집 → 2차 확장 후보
- 로그인이 필요한 정보(중개사 연락처 전체, 관심매물 등)
- 지도 표시 — `lat`/`lng`는 수집·저장하되 v1 UI에서는 지도 렌더링 없음 (외부 지도 SDK = 의존성 증가)
- 알림(이메일·슬랙·푸시) → 3차 확장 후보
- **브라우저에서 네이버를 직접 호출하는 기능** (3장 참조 — 구조적으로 불가능)
- 대량 수집·재배포·상업적 이용 (9.4 참조)

---

## 2. 조사 결과: 네이버 부동산 API 스펙

네이버 부동산은 **공식 공개 API가 없다** `[검증]`. 아래는 웹/모바일 프런트엔드가 사용하는 내부 API다.
따라서 **사전 통보 없이 언제든 바뀔 수 있다**는 전제로 설계한다(9.3).

### 2.1 두 계열의 목록 API — 이 프로젝트의 핵심 분기점

| | **A. PC 계열** | **B. 모바일 계열 ← 권고** |
|---|---|---|
| 엔드포인트 | `GET https://new.land.naver.com/api/articles` | `GET https://m.land.naver.com/cluster/ajax/articleList` |
| 지역 지정 | `cortarNo` (법정동 단위) | `cortarNo` + 지도 bbox |
| **Authorization** | **`Bearer <JWT>` 필수** `[검증]` | **불필요** `[검증]` |
| Cookie | 일부 구현이 첨부 (필수 여부 `[미검증]`) | 불필요 `[검증]` |
| 페이지당 건수 | 20건 `[검증]` | 20건 `[추정]` |
| 마지막 페이지 판별 | `isMoreData` `[검증]` | `more` `[검증]` |
| 필드명 | 서술형 (`articleNo`, `dealOrWarrantPrc`) | 약어형 (`atclNo`, `prc`) |

> **결론: 모바일 계열(B)을 1차 경로로 채택한다.**
> 근거는 단 하나로 충분하다 — **토큰이 필요 없으므로 "사람 개입 없는 자동 갱신" 문제 자체가 사라진다.**
> PC 계열은 폴백/보강용으로만 남긴다(2.5).

#### 단지 단위 조회 엔드포인트 (참고)
법정동 단위가 아니라 특정 단지의 매물만 볼 때 쓰는 별도 계열이 존재한다 `[검증]`.
- `GET https://new.land.naver.com/api/articles/complex/{complexNo}` — 아파트/오피스텔 단지
- `GET https://new.land.naver.com/api/articles/house/{houseNo}` — 빌라 등
- `GET https://new.land.naver.com/api/complexes/overview?realEstateType=APT&query={단지명}` — 단지명 → `complexNo`

v1은 "여의도 인근 전체"를 훑는 것이 목적이므로 **법정동 단위**를 쓴다.
단지 계열은 "특정 단지만 집중 추적" 기능을 넣을 때(3차 확장) 사용한다.

### 2.2 모바일 목록 API 상세 `[검증]`

```
GET https://m.land.naver.com/cluster/ajax/articleList
```

**요청 헤더 — 이것만으로 동작한다** `[검증]` (서로 독립적인 4개 구현체에서 동일 확인)

```
User-Agent:      Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) ... Mobile/15E148 Safari/604.1
Referer:         https://m.land.naver.com/
Accept-Language: ko-KR,ko;q=0.9
Accept:          */*
```
- `Authorization` **없음**, `Cookie` **없음** `[검증]`
- `Referer`가 없으면 차단된다는 보고가 있으나 정확한 필수 여부는 `[미검증]` → 항상 붙인다.

**쿼리 파라미터** `[검증]` — 출처: 타입이 지정된 요청 DTO(한국어 주석 포함) + 다수 구현체 교차 확인

| 파라미터 | 필수 | 의미 | 이 프로젝트의 값 |
|---|---|---|---|
| `z` | O | 지도 축척(zoom) | `13` (동 단위에 적합) `[추정]` |
| `lat`, `lon` | O | 중심 좌표 | `regions/list`의 `centerLat`/`centerLon` |
| `btm`, `lft`, `top`, `rgt` | O | 지도 경계 박스 (하/좌/상/우) | 중심 ± 델타 (2.4) |
| `cortarNo` | X | **법정동코드 10자리** | 대상 동 코드 |
| `rletTpCd` | X | 매물종류 코드, `:` 다중 지정 | `APT:OPST` |
| `tradTpCd` | X | 거래유형 코드, `:` 다중 지정 | `B1` (전세) |
| `wprcMin`, `wprcMax` | X | **보증금** 최소/최대 | `40000` / `70000` (만원) |
| `dprcMin`, `dprcMax` | X | 매매가 최소/최대 | 미사용 |
| `rprcMin`, `rprcMax` | X | 월세 최소/최대 | 미사용 |
| `spcMin`, `spcMax` | X | 면적(㎡) 최소/최대 | 설정값 (기본 미지정) |
| `page` | O | 페이지 번호 (1부터) | 1..상한 |
| `sort` | X | 정렬 | 미지정(기본) `[미검증]` |
| `showR0` | X | 용도 불명 | 미사용 |

> **전세 보증금 필터는 `wprcMin`/`wprcMax`다** `[검증]` — DTO 주석이 명시적으로 `보증금(최소)`/`보증금(최대)`.
> `dprc*`는 매매가이므로 전세 조회에 쓰면 안 된다. **혼동 주의.**

**금액 단위 = 만원** `[검증]` — 3중 교차 확인:
1. 요청 DTO/실사용 예: `tradTpCd=B1`(전세) + `priceMin=7000&priceMax=16000` → 7천만~1.6억
2. 응답 필드 사전: `prc: '매매(전세)가(만원)'` (한국어 라벨 그대로)
3. 실제 응답 대조: `'prc': 71000` ↔ `'hanPrc': '7억 1,000'`

→ **보증금 4억~7억 = `wprcMin=40000&wprcMax=70000`** `[추정: 단위는 검증, wprc에 적용됨은 강한 추론]`

**응답 봉투** `[검증]` (실제 캡처된 응답 원문)
```json
{ "code": "success", "more": true, "TIME": false, "z": 7, "page": 1, "body": [ /* 매물 20건 */ ] }
```
- `more: true`면 다음 페이지 존재 → `page`를 1 증가시켜 반복
- `more: false`이거나 `body`가 빈 배열이면 종료

**`body[]` 원소 필드** `[검증]` (실제 캡처 응답에서 확인된 것만)

| 필드 | 의미 | 예시 |
|---|---|---|
| `atclNo` | 매물번호 (고유키) | `"1928565103"` |
| `cortarNo` | 법정동코드 | `"1168011300"` |
| `atclNm` | 매물/단지명 | `"강남훼미리타운"` |
| `atclStatCd` | 매물 상태 | `"R0"` |
| `rletTpCd` | 매물종류 코드 (**응답은 `A01`계**) | `"A02"` |
| `rletTpNm` | 매물종류명 | `"오피스텔"` |
| `tradTpCd` / `tradTpNm` | 거래유형 | `"A1"` / `"매매"` |
| `vrfcTpCd` | 확인 유형 | `"OWNER"`, `"DOC"`, `"SITE"` |
| `flrInfo` | 층/총층 | `"7/10"`, `"고/10"`, `"-"` |
| `prc` | 보증금(전세금) **만원 정수** | `71000` |
| `rentPrc` | 월세 만원 | `0` |
| `hanPrc` | 금액 한글 표기 | `"7억 1,000"` |
| `spc1` | 공급(계약)면적 ㎡ | `153` |
| `spc2` | **전용면적 ㎡** | `74` |
| `direction` | 향 | `"남향"` |
| `atclCfmYmd` | 매물확인일자 | `"19.11.25."` |
| `tagList` | 태그 배열 | `["4년이내","역세권"]` |
| `atclFetrDesc` | 매물 특징 설명 | `"로얄층, 남향..."` |
| `bildNm` | 동 | `"B동"` |
| `lat`, `lng` | 위/경도 | `37.474159`, `127.107065` |
| `rltrNm` | 중개사무소명 | `"DK공인중개사사무소"` |
| `cpid` / `cpNm` | 정보제공업체 | `"NEONET"` / `"부동산뱅크"` |
| `sameAddrCnt` | 동일주소 매물 수 | `1` |
| `sameAddrMinPrc` / `sameAddrMaxPrc` | 동일주소 최저/최고가 | `"7억 5,000"` |
| `repImgUrl` | 대표 이미지 경로(상대) | `"/20191125_96/land_naver_...JPG"` |
| `directTradYn` | 직거래 여부 | `"N"` |
| `etRoomCnt`, `minute`, `cpLinkVO` | 기타 | — |

> **주의: `rletTpCd`가 요청과 응답에서 코드 체계가 다르다** `[검증]`
> - 요청: `APT`, `OPST`, `VL` …
> - 응답: `A01`(아파트), `A02`(오피스텔), `C02`(빌라), `D01`(사무실), `E03`(토지) …
> 정규화 시 `rletTpNm`(한글명)을 신뢰하고, 코드는 매핑 테이블로 처리한다.

**매물 상세 페이지 URL** `[검증]`
```
https://m.land.naver.com/article/info/{atclNo}
```

### 2.3 코드 값 표

**`tradTpCd` (거래유형)** `[검증]` — 다수 구현체의 한국어 주석에서 일치
| 코드 | 의미 |
|---|---|
| `A1` | 매매 |
| **`B1`** | **전세** ← 이 프로젝트 |
| `B2` | 월세 |
| `B3` | 단기임대 |

**`rletTpCd` (매물종류, 요청용)** `[검증]` — **네이버 모바일 필터 HTML의 `<input name="rletTpCd" value="...">`를 그대로 채록**
| 코드 | 의미 | | 코드 | 의미 |
|---|---|---|---|---|
| **`APT`** | **아파트** ← | | `OR` | 원룸 |
| **`OPST`** | **오피스텔** ← | | `GSW` | 고시원 |
| `VL` | 빌라 | | `SG` | 상가 |
| `ABYG` | 아파트분양권 | | `SMS` | 사무실 |
| `OBYG` | 오피스텔분양권 | | `GJCG` | 공장/창고 |
| `JGC` | 재건축 | | `GM` | 건물 |
| `JGB` | 재개발 | | `TJ` | 토지 |
| `JWJT` | 전원주택 | | `APTHGJ` | 지식산업센터 |
| `DDDGG` | 단독/다가구 | | `SGJT` | 상가주택 |
| `HOJT` | 한옥주택 | | | |

→ 이 프로젝트: **`rletTpCd=APT:OPST`**

### 2.4 법정동 코드(`cortarNo`) 확보 방법 — 하드코딩 금지

**지역 목록 API** `[검증]`
```
GET https://new.land.naver.com/api/regions/list?cortarNo={상위코드}
```
**응답** `[검증]`
```json
{ "regionList": [
  { "cortarNo": "1150000000", "cortarName": "강서구", "cortarType": "dvsn",
    "centerLat": 37.550985, "centerLon": 126.849534 }
]}
```
| 필드 | 의미 |
|---|---|
| `cortarNo` | 법정동코드 10자리 |
| `cortarName` | 지역명 |
| `cortarType` | `dvsn`(시도/구) / `sec`(동) `[추정]` |
| `centerLat` / `centerLon` | 중심 좌표 → **bbox 계산의 기준** |

**드릴다운 절차** `[검증]`
```
cortarNo=0000000000  → 시도 목록 (서울특별시 = 1100000000)
cortarNo=1100000000  → 서울 구 목록 (영등포구 = 1156000000)
cortarNo=1156000000  → 영등포구 법정동 목록 (여의도동 = 1156011000)
```
- 여의도동 `1156011000`, 영등포구 `1156000000` — 제3자가 공개한 지역 덤프 파일에서 확인 `[추정]`.
  **하드코딩하지 않고** Build 0단계에서 위 드릴다운으로 재확인한 뒤 캐시에 기록한다.
- `regions/list`가 `Authorization`을 요구하는지 **`[미검증]`**. 일부 구현체는 Bearer를 붙이고, 일부는 안 붙인다.
  → **Build 0단계 필수 확인 항목.** 요구할 경우의 폴백은 2.5 / 11장 D6.

**bbox 계산** — 모바일 API는 `btm/lft/top/rgt`가 필수인데 `regions/list`는 중심 좌표만 준다.
```
btm = centerLat - dLat,  top = centerLat + dLat
lft = centerLon - dLon,  rgt = centerLon + dLon
기본값: dLat = 0.012, dLon = 0.020   (동 하나를 넉넉히 덮는 크기) [추정]
```
- bbox를 넉넉히 잡고 **`cortarNo`로 1차 제한 + 응답의 `cortarNo` 필드로 2차 자체 필터링**한다.
  bbox가 인접 동을 물어 들어와도 결과가 오염되지 않게 하는 안전장치다.
- `dLat`/`dLon`/`z`는 설정 파일에서 조정 가능하게 한다.

**"여의도 인근" 기본 대상 지역 후보** — 여의도동을 중심으로 지하철 1정거장 또는 다리 하나 거리

| # | 법정동 | 자치구 | 선정 근거 | 기본 포함 |
|---|---|---|---|---|
| 1 | 여의도동 | 영등포구 | 목표 지역 본체 (5·9호선, 여의나루/여의도/샛강) | ✅ |
| 2 | 당산동 (1~6가 포함) | 영등포구 | 2·9호선 당산역, 여의도 1정거장. 아파트 밀집 | ✅ |
| 3 | 문래동 (1~6가) | 영등포구 | 2호선 문래, 신축 아파트·오피스텔 다수 | ✅ |
| 4 | 영등포동 (1~8가) | 영등포구 | 1·5호선, 여의도 인접 생활권 | ✅ |
| 5 | 양평동 (1~6가) | 영등포구 | 9호선 선유도, 오피스텔 공급 많음 | ✅ |
| 6 | 신길동 | 영등포구 | 1·7호선 신길, 여의도 도보/1정거장 | ✅ |
| 7 | 노량진동 | 동작구 | 1·9호선 노량진, 한강 건너 1정거장 | ✅ |
| 8 | 도화동 | 마포구 | 5호선 마포역, 마포대교 건너 | ⬜ |
| 9 | 공덕동 | 마포구 | 5·6·경의중앙·공항철도 4중 환승 | ⬜ |
| 10 | 흑석동 | 동작구 | 9호선, 여의도 접근 양호 | ⬜ |

- ✅ 7곳을 기본 활성, ⬜ 3곳은 설정 파일에 주석 처리해 두고 사용자가 쉽게 켤 수 있게 한다.
- **주의: `당산동1가`~`6가`, `영등포동1가`~`8가`처럼 법정동이 여러 개로 쪼개진 지역이 있다** `[검증: 법정동 체계]`.
  "당산동" 하나가 최대 7개 `cortarNo`가 될 수 있어 **요청 수가 빠르게 늘어난다.**
  → 설정은 *동 이름*으로 적고, 스크립트가 `regions/list` 결과에서 접두어 매칭으로 하위 법정동을 모두 찾아
  펼친 뒤 **총 대상 코드 수 상한(기본 25개)** 을 적용한다(9.1).

### 2.5 PC 계열 API와 Authorization 토큰 — 자동 갱신 가능성 (집중 조사 결과)

이 절이 원래 프로젝트의 최대 리스크였다. **결론: 모바일 계열을 쓰면 이 리스크는 회피된다.**
그럼에도 폴백 판단을 위해 조사 결과를 남긴다.

**엔드포인트와 파라미터** `[검증]`
```
GET https://new.land.naver.com/api/articles
  ?cortarNo=1156011000
  &order=rank
  &realEstateType=APT%3AOPST
  &tradeType=B1
  &tag=%3A%3A%3A%3A%3A%3A%3A%3A
  &rentPriceMin=0&rentPriceMax=900000000
  &priceMin=40000&priceMax=70000
  &areaMin=0&areaMax=900000000
  &oldBuildYears=&recentlyBuildYears=
  &minHouseHoldCount=&maxHouseHoldCount=
  &showArticle=false&sameAddressGroup=false
  &minMaintenanceCost=&maxMaintenanceCost=
  &priceType=RETAIL&directions=&page=1&articleState=
```
- `realEstateType`은 `:`(URL 인코딩 `%3A`)로 다중 지정 `[검증]`
- `900000000`은 "상한 없음" 센티넬로 관용적으로 쓰이는 값 `[검증: 다수 구현체 일치]`
- `sameAddressGroup=false` → 동일주소 매물을 묶지 않고 개별 반환 `[추정]`
- **응답** `[검증]`: `{ "isMoreData": bool, "articleList": [20건], "mapExposedCount": int, "nonMapExposedIncluded": bool }`
- `articleList[]` 필드 `[검증]`: `articleNo`, `articleName`, `articleStatus`, `realEstateTypeCode/Name`,
  `articleRealEstateTypeCode/Name`, `tradeTypeCode/Name`, `verificationTypeCode`, `floorInfo`,
  **`priceChangeState`**(`SAME`/`INCREASE`/`DECREASE`), `isPriceModification`, **`dealOrWarrantPrc`**(`"2억 7,000"`),
  `areaName`, `area1`(공급), `area2`(전용), `direction`, `articleConfirmYmd`(`"20250322"`),
  `articleFeatureDesc`, `tagList`, `buildingName`, `sameAddrCnt`, `sameAddrMinPrc`/`sameAddrMaxPrc`,
  `cpid`/`cpName`, `cpPcArticleUrl`, `latitude`/`longitude`, `realtorName`/`realtorId`,
  `siteImageCount`, `elevatorCount`, `isDirectTrade`, `isVrExposed`
- **PC 응답에는 `priceChangeState`가 있다** `[검증]` — 모바일 응답에는 없다. 우리는 자체 스냅샷 비교로 대체한다(8.3).

**필수 헤더** `[검증]`
```
authorization:    Bearer <JWT>
referer:          https://new.land.naver.com/...
user-agent:       Mozilla/5.0 ...
accept-language:  ko-KR,ko;q=0.9
accept:           */*
cookie:           NNB=...; NID_AUT=...; NID_SES=...   ← 첨부하는 구현체와 안 하는 구현체가 갈림 [미검증]
```

**JWT 구조와 유효기간 — 직접 디코딩해 확인** `[검증]`

공개된 4개 저장소에서 각각 유출된 실제 토큰의 payload를 base64 디코딩한 결과:
```
{"id":"REALESTATE","iat":1679978380,"exp":1679989180}   exp-iat = 10800초
{"id":"REALESTATE","iat":1743162809,"exp":1743173609}   exp-iat = 10800초
{"id":"REALESTATE","iat":1743919148,"exp":1743929948}   exp-iat = 10800초
{"id":"REALESTATE","iat":1742893393,"exp":1742904193}   exp-iat = 10800초
```
- 헤더: `{"alg":"HS256","typ":"JWT"}`
- **유효기간 = 정확히 10,800초 = 3시간** `[검증]` (4개 샘플이 예외 없이 일치, 2023년~2025년 샘플 모두 동일)
- **payload에 사용자 식별 정보가 전혀 없다** `[검증]` — `id`는 항상 상수 `"REALESTATE"`.
  즉 이 토큰은 *로그인 자격증명이 아니라 프런트엔드 앱 공용 토큰*이다.

**핵심 질문: 사람 개입 없이 자동 획득·갱신이 가능한가?**

| 방법 | 평가 | 근거 |
|---|---|---|
| ① 페이지를 GET 해서 HTML/JS 번들/쿠키에서 토큰 추출 | **`[미검증]`** | 이 방식으로 성공했다고 명확히 기술한 공개 구현을 찾지 못했다. 대다수는 사람이 DevTools에서 복사한 값을 하드코딩한다. |
| ② **서명 검증을 하지 않는다면 직접 생성** | **`[미검증]` — 그러나 가장 유망** | 어떤 공개 저장소가 `os.urandom(32)`로 만든 **무작위 시크릿**으로 `{"id":"REALESTATE","iat":now,"exp":now+10800}`을 HS256 서명해 사용한다. payload가 상수 스키마인 점과 합치면, **네이버가 서명을 검증하지 않고 `exp`만 확인할 가능성**이 있다. 사실이면 토큰을 영구히 자체 생성할 수 있어 사람 개입이 완전히 사라진다. |
| ③ 3시간마다 사람이 DevTools에서 복사 | 확실하지만 **실용성 없음** | TTL이 3시간이므로 1일 2회 수집이면 **매 수집마다 사람이 붙어야 한다.** 사실상 "자동 수집"이 성립하지 않는다. |
| ④ 브라우저 자동화(Playwright 등)로 토큰 캡처 | 동작하지만 **원칙 위배** | 공개 구현이 실제로 이 방식을 쓴다(요청 인터셉트로 헤더 채록). 그러나 `CLAUDE.md`의 **"외부 라이브러리 최소화"** 와 정면 충돌한다(브라우저 바이너리 수백 MB + 의존성 트리). v1 채택 불가. |

> **판단**
> ③이 실용성 없고 ④가 원칙 위배이며 ①②가 미검증이라는 것은,
> **PC 계열을 1차 경로로 삼으면 프로젝트가 "3시간마다 사람이 토큰을 붙여주는 도구"로 전락할 위험**이 크다는 뜻이다.
> **반면 모바일 계열은 토큰이 아예 필요 없다** `[검증]`.
> → **모바일 계열 채택. 2.5의 모든 문제를 우회한다.** 이것이 이 스펙의 가장 중요한 설계 결정이다.
>
> PC 계열은 (a) 모바일 계열이 막히거나 (b) `priceChangeState` 등 추가 필드가 필요할 때만
> 폴백으로 검토하고, 그 시점에 ②를 먼저 실험한다(②가 성립하면 자동화가 유지된다).

**시크릿 취급 원칙 (폴백을 쓰게 될 경우)**
- 토큰·쿠키는 **어떤 경우에도 저장소에 커밋하지 않는다.**
- 로컬: `apps/yeouido-jeonse/collector/.secrets.json` (앱 폴더 내 `.gitignore`로 제외) 또는 환경변수 `NAVER_LAND_TOKEN`
- GitHub Actions: `secrets.NAVER_LAND_TOKEN` → 워크플로에서 `env:`로 주입
- 수집 로그·에러 메시지·커밋되는 JSON에 토큰이 절대 새지 않도록 마스킹 유틸을 둔다.

### 2.6 미검증 항목 총정리 — Build 0단계 체크리스트

| # | 확인할 것 | 실패 시 대응 |
|---|---|---|
| V1 | 모바일 `articleList`가 UA+Referer만으로 200을 주는가 | PC 계열 + ② 실험으로 전환 |
| V2 | `wprcMin`/`wprcMax`가 전세 보증금을 만원 단위로 필터하는가 | 필터 없이 받아 `prc`로 자체 필터 |
| V3 | `regions/list`가 Authorization을 요구하는가 | 요구 시: 1회 수동 조회한 `cortarNo`를 캐시에 커밋(코드는 시크릿 아님) |
| V4 | 모바일 페이지당 건수와 `more` 동작 | 안전하게 페이지 상한으로 방어 |
| V5 | `cortarNo`+bbox 조합이 해당 동으로 제한되는가 | 응답 `cortarNo` 자체 필터로 이미 방어됨 |
| V6 | 429 발생 임계 (요청 간격 몇 초부터 안전한가) | 지연을 늘리며 이진 탐색, 보수적으로 확정 |
| V7 | `m.land.naver.com/robots.txt` 내용 | 9.4 참조 — 금지 시 사용자에게 즉시 보고 후 중단 |
| V8 | `z` 값과 bbox 델타가 동 전체를 덮는가 | 델타 증가 또는 동 내 격자 분할 |

---

## 3. 아키텍처 권고안과 선택 근거

### 3.1 왜 브라우저에서 직접 못 하는가 `[검증]`
정적 블로그(GitHub Pages)의 JS가 네이버 API를 직접 호출하면 실패한다:
1. **CORS** — 네이버는 `Access-Control-Allow-Origin`을 우리 도메인에 주지 않는다
2. **Referer/UA 위조 불가** — 브라우저가 `Referer`를 강제로 자기 도메인으로 설정
3. (PC 계열이면) **Authorization/Cookie** 를 프런트에 둘 수 없음

→ **수집은 반드시 브라우저 밖(Node 스크립트)에서 일어나고, 웹앱은 그 결과 JSON만 읽는다.**

### 3.2 A/B/C 비교

| 기준 | **A. GitHub Actions 크론** | **B. 로컬 + OS 스케줄러 ← 권고** | **C. Claude Code 세션 내** |
|---|---|---|---|
| PC 꺼져도 동작 | ✅ | ❌ | ❌ |
| **네이버 IP 차단 위험** | 🔴 **높음** — Azure 데이터센터 IP. "네이버는 비한국 IP를 적극 차단하며 한국 프록시가 필요하다"는 보고 `[검증: 제3자 조사 문서]` | 🟢 **낮음** — 한국 가정용 IP, 일반 사용자와 구별 불가 | 🟢 낮음 |
| 요청 성격의 정당성 | 🟡 서버가 자동 수집 | 🟢 본인 PC에서 본인이 열람하는 것에 가장 가까움 | 🟢 유사 |
| 설정 난이도 | 🟢 워크플로 파일 1개 | 🟡 cron/작업스케줄러 등록 1회 | 🔴 세션 유지 필요 |
| 시크릿 관리 | GitHub Secrets 필요(폴백 시) | 로컬 파일/환경변수 | 세션 내 |
| 결과 배포 | 자동 커밋 → Pages | 로컬 커밋·푸시 → Pages | 동일 |
| 지속 가능성 | 🟢 방치 가능 | 🟢 스케줄러가 처리 | 🔴 세션 종료 시 중단 |

### 3.3 권고: **B안 (로컬 실행 + OS 스케줄러)**

**근거**
1. **IP 차단 위험이 이 프로젝트의 실질 1순위 리스크다.** 토큰 문제는 모바일 API로 해소했으므로,
   남은 최대 실패 요인은 차단이다. 데이터센터 IP에서 반복 수집하는 A안은 그 위험을 자진해서 안는다.
2. **"본인이 열람 가능한 공개 정보를 본인 주거 탐색 목적으로 소량 조회"** 라는 이 도구의 정당성은
   사용자 PC에서 사용자 IP로 실행될 때 가장 잘 유지된다(9.4).
3. 모바일 API는 시크릿이 없으므로 B안의 유일한 단점이던 "시크릿 로컬 관리"조차 사라진다.
4. 사용자는 여의도 전세를 실제로 찾는 중이므로 하루 2회 정도면 충분하고, PC가 늘 켜져 있지 않아도
   **다음 실행 때 따라잡으면 되는** 성격의 데이터다(분 단위 실시간성 불필요).

**A안은 "선택적 2단계"로 남긴다.** 수집 스크립트를 실행 환경에 무관하게 작성하므로(3.4),
사용자가 나중에 A안을 원하면 `.github/workflows/` 파일 하나를 추가하는 것으로 전환된다.
단, 전환 시 **차단 여부를 관찰할 수 있게 실패 로그를 커밋하도록** 설계한다.

**C안은 채택하지 않는다.** 세션 수명이 수집 주기보다 짧아 "주기적 자동 수집" 요구를 충족하지 못한다.

### 3.4 실행 환경 독립 원칙
수집 스크립트는 다음만 가정한다.
- Node 18+ 내장 모듈만 사용 (`node:fs`, `node:path`, 전역 `fetch`) — **의존성 0**, 저장소의 `build.js`와 동일 기조
- 설정은 `config.json` + 환경변수 오버라이드
- 출력은 정해진 경로의 JSON 파일
- 종료 코드로 성공/실패 전달 (스케줄러·Actions 공통)

→ `node collector/collect.js` 한 줄이 로컬·Actions·수동 실행에서 똑같이 동작한다.

---

## 4. 파일 구조

### 4.1 `apps/yeouido-jeonse/` 하위 (전부 이 폴더에 자체 완결)

```
apps/yeouido-jeonse/
├── PLAN-INSTRUCTIONS.md        # (기존) Plan 지침 — 배포 제외(.md)
├── spec.md                     # (본 문서) — 배포 제외(.md)
│
├── index.html                  # 웹앱 화면: 헤더/필터바/요약/매물 목록/푸터
├── style.css                   # 디자인 토큰, 카드 레이아웃, 반응형(모바일 1열)
├── app.js                      # 목록 렌더링·필터·정렬·배지 계산 (일반 script, ES모듈 아님)
│
├── collector/                  # 브라우저 밖에서 도는 수집기 (Node, 의존성 0)
│   ├── collect.js              # 엔트리: 설정 로드 → 지역 해석 → 수집 → 정규화 → 비교 → 저장
│   ├── naver-client.js         # HTTP 계층: 요청 조립, 지연, 재시도/백오프, 429 감지
│   ├── regions.js              # regions/list 드릴다운, 동 이름 → cortarNo 해석, 캐시 관리
│   ├── normalize.js            # 원본 응답 → 6장 스키마로 변환 (금액·면적·날짜 파싱)
│   ├── diff.js                 # 이전 스냅샷과 비교 → 신규/삭제/가격변동 판정
│   ├── config.json             # ★ 사용자가 만지는 유일한 설정 파일 (5장)
│   └── .gitignore              # .secrets.json, *.log 제외 (폴백 대비)
│
├── data/                       # 수집 산출물 (build.js가 dist로 복사)
│   ├── listings.json           # 최신 스냅샷 = 웹앱이 읽는 파일
│   ├── history.json            # 매물별 first_seen/last_seen/가격 이력 (압축 보관)
│   ├── regions.cache.json      # cortarNo 해석 결과 캐시 (재조회 최소화)
│   ├── sample.json             # 공개 사이트용 소량 예시 데이터 (11장 D1 결정에 따름)
│   └── .gitignore              # listings.json/history.json 커밋 여부를 D1 결정에 따라 설정
│
└── run-logs/
    └── last-run.json           # 마지막 실행 결과 요약(시각·건수·에러) — 조용한 실패 방지
```

**설계 의도**
- `collector/`와 `data/`를 앱 폴더 안에 두어 **`CLAUDE.md`의 "앱은 `/apps/{앱이름}/`에 자체 완결" 규칙을 지킨다.**
- `.gitignore`를 **앱 폴더 안에 중첩 배치**한다(git이 지원). 저장소 루트 `.gitignore`를 건드리지 않으므로
  **블로그의 다른 파일을 수정하지 않는다**는 규칙을 만족한다.
- `app.js`는 기존 앱들(`2048`, `pixel-art`)과 동일하게 **`<script defer>` 일반 스크립트**로 로드한다.

### 4.2 이 폴더 밖에 필요한 파일

**v1(B안 권고)에서는 없다.** 저장소의 다른 어떤 파일도 만들거나 수정하지 않는다.

| 대상 | 필요 시점 | 이유 |
|---|---|---|
| `.github/workflows/collect-yeouido.yml` | 사용자가 **A안**을 선택할 때만 | Actions 크론은 `.github/workflows/`에만 둘 수 있다(GitHub 제약). B안에서는 불필요. |
| 루트 `index.html` (블로그 메인) | **Embed 단계** | 웹앱 카드 추가. 이는 `CLAUDE.md`가 정한 4단계 작업이며 **Build 서브에이전트의 범위가 아니다.** |

> `build.js`는 `apps/`를 재귀 복사하며 `.md`만 제외한다 `[검증: build.js:498-505]`.
> 따라서 `data/*.json`은 자동으로 `dist/apps/yeouido-jeonse/data/`에 배포된다. **build.js 수정 불필요.**

---

## 5. 검색 조건 설정 구조

`collector/config.json` 하나만 편집하면 된다. 주석이 필요하므로 **각 항목에 `_comment` 키를 병기**한다
(JSON은 주석을 지원하지 않으므로).

```json
{
  "regions": {
    "_comment": "동 이름으로 적는다. 스크립트가 regions/list에서 cortarNo를 찾아 하위 법정동(1가~6가 등)까지 자동 확장한다.",
    "sido": "서울특별시",
    "include": [
      { "gu": "영등포구", "dong": "여의도동" },
      { "gu": "영등포구", "dong": "당산동" },
      { "gu": "영등포구", "dong": "문래동" },
      { "gu": "영등포구", "dong": "영등포동" },
      { "gu": "영등포구", "dong": "양평동" },
      { "gu": "영등포구", "dong": "신길동" },
      { "gu": "동작구",   "dong": "노량진동" }
    ],
    "available_but_off": [
      { "gu": "마포구", "dong": "도화동" },
      { "gu": "마포구", "dong": "공덕동" },
      { "gu": "동작구", "dong": "흑석동" }
    ]
  },

  "criteria": {
    "_comment": "tradeType: A1 매매 / B1 전세 / B2 월세 / B3 단기임대. 금액 단위는 만원.",
    "tradeType": ["B1"],
    "realEstateType": ["APT", "OPST"],
    "depositMin": 40000,
    "depositMax": 70000,
    "areaMinM2": null,
    "areaMaxM2": null,
    "excludeNonResidentialOfficetel": true,
    "officetelMinExclusiveM2": 30
  },

  "politeness": {
    "_comment": "예의 있는 수집 상한. 임의로 올리지 말 것.",
    "delayMsBetweenRequests": 2000,
    "delayJitterMs": 800,
    "maxPagesPerRegion": 5,
    "maxRegionCodes": 25,
    "maxRequestsPerRun": 150,
    "maxRetries": 3,
    "retryBackoffMs": 5000,
    "requestTimeoutMs": 15000
  },

  "map": {
    "_comment": "모바일 API가 요구하는 bbox 계산 파라미터",
    "zoom": 13,
    "bboxDeltaLat": 0.012,
    "bboxDeltaLon": 0.020
  },

  "output": {
    "historyMaxSnapshots": 60,
    "keepDisappearedDays": 14
  }
}
```

**환경변수 오버라이드** (스케줄러/Actions에서 편리)
`YJ_DEPOSIT_MIN`, `YJ_DEPOSIT_MAX`, `YJ_MAX_PAGES`, `YJ_DELAY_MS`, `NAVER_LAND_TOKEN`(폴백 전용)

**웹앱에서의 조건 변경**
정적 사이트이므로 **수집 조건(무엇을 가져올지)** 은 브라우저에서 바꿀 수 없다.
웹앱의 필터는 **이미 수집된 데이터를 좁혀 보는 용도**다(7.2). 이 구분을 UI에 명시한다
("수집 조건은 config.json에서 변경").

---

## 6. 데이터 스키마

### 6.1 `data/listings.json`
```json
{
  "schemaVersion": 1,
  "collectedAt": "2026-08-08T11:30:00+09:00",
  "criteria": {
    "tradeType": ["B1"], "realEstateType": ["APT","OPST"],
    "depositMin": 40000, "depositMax": 70000
  },
  "regions": [
    { "cortarNo": "1156011000", "name": "여의도동", "gu": "영등포구", "count": 23 }
  ],
  "stats": { "total": 87, "new": 5, "priceChanged": 3, "disappeared": 2, "errors": 0 },
  "listings": [ /* 6.2 */ ]
}
```

### 6.2 매물 객체
| 필드 | 타입 | 출처 (모바일) | 설명 |
|---|---|---|---|
| `id` | string | `atclNo` | **고유키.** 스냅샷 비교 기준 |
| `name` | string | `atclNm` | 단지/매물명 |
| `buildingName` | string\|null | `bildNm` | 동 |
| `regionCode` | string | `cortarNo` | 법정동코드 |
| `regionName` | string | 캐시 조회 | 법정동명 |
| `typeCode` | string | `rletTpCd` | `A01`/`A02` … |
| `typeName` | string | `rletTpNm` | `아파트`/`오피스텔` |
| `tradeType` | string | `tradTpNm` | `전세` |
| `deposit` | number | `prc` | **보증금(만원 정수)** — 정렬·필터의 기준 |
| `depositText` | string | `hanPrc` | `"5억 3,000"` 표시용 |
| `monthlyRent` | number | `rentPrc` | 전세는 0 |
| `areaSupplyM2` | number | `spc1` | 공급/계약면적 |
| `areaExclusiveM2` | number | `spc2` | **전용면적** — 주거용 판별·정렬 기준 |
| `areaExclusivePyeong` | number | 계산 | `spc2 / 3.3058`, 소수1자리 |
| `floor` | string | `flrInfo` | `"7/10"` |
| `floorNum` | number\|null | 파싱 | `"고"`/`"저"`/`"-"`는 null → 정렬 시 뒤로 |
| `direction` | string\|null | `direction` | 향 |
| `confirmedDate` | string | `atclCfmYmd` | `"25.08.06."` → `"2025-08-06"` 정규화 |
| `tags` | string[] | `tagList` | `["역세권","10년이내"]` |
| `featureDesc` | string\|null | `atclFetrDesc` | 매물 특징 |
| `realtorName` | string\|null | `rltrNm` | 중개사무소 |
| `providerName` | string\|null | `cpNm` | 정보제공업체 |
| `lat`, `lng` | number\|null | `lat`,`lng` | 좌표 (v1 UI 미사용, 보관) |
| `sameAddrCnt` | number | `sameAddrCnt` | 동일주소 매물 수 |
| `sourceUrl` | string | 생성 | `https://m.land.naver.com/article/info/{atclNo}` |
| **`firstSeenAt`** | string | history | 최초 관측 시각 |
| **`lastSeenAt`** | string | history | 최근 관측 시각 |
| **`status`** | enum | diff | `active` / `disappeared` |
| **`isNew`** | boolean | diff | 직전 스냅샷에 없었음 |
| **`priceChange`** | object\|null | diff | `{ "from": 55000, "to": 52000, "direction": "down", "changedAt": "..." }` |

### 6.3 `data/history.json` (용량 억제형)
스냅샷 전체를 누적하지 않는다. **매물별 요약만** 남긴다.
```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-08-08T11:30:00+09:00",
  "items": {
    "2515248328": {
      "firstSeenAt": "2026-07-20T08:00:00+09:00",
      "lastSeenAt":  "2026-08-08T11:30:00+09:00",
      "priceHistory": [
        { "at": "2026-07-20T08:00:00+09:00", "deposit": 55000 },
        { "at": "2026-08-05T20:00:00+09:00", "deposit": 52000 }
      ],
      "status": "active"
    }
  },
  "runs": [ { "at": "...", "total": 87, "new": 5, "errors": 0 } ]
}
```
- `priceHistory`는 **값이 바뀔 때만** 추가(매 실행마다 쌓지 않음)
- `runs`는 최근 `historyMaxSnapshots`(60)개만 유지
- `disappeared` 매물은 `keepDisappearedDays`(14일) 경과 후 제거

---

## 7. 웹앱 화면 설계

### 7.1 레이아웃
```
┌────────────────────────────────────────────┐
│ 여의도 전세 매물                            │
│ 마지막 수집: 2026-08-08 11:30 · 전체 87건   │  ← 데이터 신선도를 최상단에
│ 🆕 신규 5 · 💰 가격변동 3 · 🚫 사라짐 2      │
├────────────────────────────────────────────┤
│ [지역 ▾][종류 ▾][보증금 ━━●━━][면적 ▾]      │  ← 필터바 (sticky)
│ [신규만] [가격내림만]   정렬:[확인일 최신 ▾] │
├────────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐  │
│ │ 🆕  여의도자이            아파트      │  │
│ │ 5억 3,000                💰 5.5억→5.3억│  │
│ │ 전용 59.9㎡ (18.1평) · 7/15층 · 남향   │  │
│ │ 여의도동 · 확인 2026-08-06            │  │
│ │ [역세권][10년이내]                    │  │
│ │ ○○공인중개사        네이버에서 보기 ↗ │  │
│ └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

### 7.2 필터·정렬 (클라이언트 사이드, 이미 수집된 데이터 대상)
- **필터**: 지역(복수 체크) / 매물종류(아파트·오피스텔) / 보증금 범위(이중 슬라이더) /
  전용면적 최소 / 층(지상만) / `신규만` / `가격내림만` / `사라진 매물 포함`(기본 off)
- **정렬**: 확인일 최신순(기본) / 보증금 낮은순·높은순 / 전용면적 넓은순 / 최초등록 최신순
- 필터 상태를 URL 쿼리스트링에 반영 → 새로고침·공유 시 유지
- 조건에 맞는 매물이 0건이면 "조건에 맞는 매물이 없습니다 + 필터 초기화" 안내

### 7.3 배지
| 배지 | 조건 |
|---|---|
| 🆕 신규 | `isNew === true` |
| 💰 가격 내림 | `priceChange.direction === "down"` — `5.5억 → 5.3억` 함께 표기 |
| 📈 가격 오름 | `priceChange.direction === "up"` |
| 🚫 사라짐 | `status === "disappeared"` — 카드를 흐리게 + 취소선 |
| 🏢 오피스텔 / 🏬 아파트 | `typeName` |

### 7.4 모바일 (필수 요구사항)
- 카드 **1열**, 최소 터치 타깃 44×44px
- 필터바는 `position: sticky` + 가로 스크롤 칩(chip) 형태
- 보증금 슬라이더는 모바일에서 조작이 어려우므로 **프리셋 칩**(`4~5억` `5~6억` `6~7억`)을 병행
- `prefers-color-scheme` 다크모드 대응
- 폰트·이미지 외부 로드 없음 → 오프라인/저속에서도 목록 열람 가능

### 7.5 데이터 로딩과 폴백 (중요)
```
fetch('data/listings.json')
  → 성공: 렌더링
  → 404/파싱 실패: fetch('data/sample.json')  → "예시 데이터입니다" 배너 표시
  → 둘 다 실패: "수집된 데이터가 없습니다. collector/collect.js를 먼저 실행하세요." 안내
```
- `listings.json`이 gitignore되는 경우(11장 D1) 공개 사이트에서는 `sample.json`이 뜬다.
  **UI가 깨지지 않고, 블로그 카드로서의 포트폴리오 가치도 유지된다.**
- `file://`로 직접 열면 `fetch`가 CORS로 막히므로, 안내문에 `tools/serve.js` 사용을 명시한다.

---

## 8. 주기 실행 설계

### 8.1 주기
- **기본 1일 2회 — 08:00 / 20:00 (KST)**
- 근거: 전세 매물은 분 단위로 바뀌지 않고, 중개사 등록/확인이 주로 업무시간에 일어난다.
  하루 2회면 신규 매물을 반나절 안에 포착하면서 요청량을 최소로 유지한다.
- 등록 방법 (Build 산출물 `collector/README` 대신 `spec` 기준을 앱 화면 하단 도움말에 안내)
  - macOS/Linux: `crontab -e` → `0 8,20 * * * cd <repo> && /usr/bin/node apps/yeouido-jeonse/collector/collect.js >> apps/yeouido-jeonse/run-logs/cron.log 2>&1`
  - Windows: 작업 스케줄러 → 매일 08:00/20:00, `node.exe` + 스크립트 경로

### 8.2 1회 실행 시 요청 예산
```
regions/list 드릴다운  : 캐시 적중 시 0회 / 최초·주 1회 갱신 시 최대 3회
매물 목록             : 대상 코드 수(≤25) × 페이지(≤5) = 최대 125회
합계 상한             : maxRequestsPerRun = 150회에서 하드 컷
소요 시간             : 125 × (2.0초 + jitter) ≈ 4~6분
```
→ 하루 2회면 **1일 최대 300 요청.** 사람이 브라우저로 여의도 매물을 훑는 것과 비슷한 수준이며,
   실제로는 조건 필터가 적용되어 대부분 지역이 1~2페이지에서 끝날 것으로 예상된다 `[추정]`.

### 8.3 신규/사라진 매물 비교 (스냅샷 누적 없이)
```
1. 이전 listings.json을 읽어 id 집합 prev 구성 (없으면 최초 실행으로 처리)
2. 이번 수집 결과 id 집합 curr 구성
3. isNew        = curr - prev
   disappeared  = prev - curr        → status='disappeared', listings에 유지(설정 기간)
   priceChange  = curr ∩ prev 중 deposit 값이 다른 것
4. history.json 갱신: firstSeenAt/lastSeenAt/priceHistory(변경 시에만 append)
5. listings.json 원자적 교체 (temp 파일 → rename) — 중간 상태를 웹앱이 읽지 않게
```
- **최초 실행에서는 전부 `isNew`로 표시하지 않는다** (87건이 모두 신규로 뜨면 무의미).
  `prev`가 없으면 `isNew=false`로 두고 `stats.new`를 `null`로 기록 → UI는 "기준 스냅샷 생성" 표시.
- **부분 실패 시 삭제 판정을 하지 않는다** — 어떤 지역 수집이 실패했으면 그 지역 매물은
  `disappeared` 판정에서 제외한다. **차단·오류를 "매물이 사라졌다"로 오독하면 안 된다.** (핵심 방어)

### 8.4 실패를 조용히 넘기지 않기
`run-logs/last-run.json`에 매 실행 결과를 남긴다.
```json
{ "at": "2026-08-08T11:30:00+09:00", "ok": false,
  "requests": 42, "collected": 61,
  "regionsFailed": [{ "cortarNo": "1156011000", "reason": "HTTP 429", "attempts": 3 }],
  "message": "1개 지역 수집 실패 — 삭제 판정 보류" }
```
- `ok: false`이면 **종료 코드 1** → cron 로그/Actions에서 실패가 눈에 보인다
- 웹앱 상단에도 "마지막 수집에 일부 실패가 있었습니다" 경고 배너를 띄운다
- 429/403이 연속 감지되면 **즉시 중단하고 다음 주기까지 재시도하지 않는다** (밀어붙이지 않음)

---

## 9. 예의 있는 수집 설계

### 9.1 상한을 코드에 박아둔다
설정으로 조정 가능하지만, **`collect.js`가 하드 상한을 강제**한다. 설정이 이를 넘으면 경고 후 클램프.
| 항목 | 기본 | 하드 상한 |
|---|---|---|
| 요청 간 지연 | 2,000ms + 지터 0~800ms | 최소 1,000ms 미만으로 내릴 수 없음 |
| 지역당 페이지 | 5 | 10 |
| 대상 법정동 코드 수 | 25 | 40 |
| 1회 실행 총 요청 | 150 | 300 |
| 동시 요청 | **1 (순차)** | 병렬 금지 |

### 9.2 재시도·백오프
- 네트워크 오류/5xx: 최대 3회, `5초 → 10초 → 20초` 지수 백오프
- **429/403: 재시도하지 않는다.** 해당 실행을 중단하고 로그에 남긴다 (밀어붙이면 차단이 길어진다)
- 타임아웃 15초 (`AbortController`)
- 매 요청에 지터를 넣어 기계적 규칙성을 줄인다

### 9.3 스키마 변경 대비
- 응답 파싱은 **필드 부재를 허용**한다. 필수 필드(`atclNo`, `prc`)가 없으면 그 건만 건너뛰고 카운트
- 필수 필드 누락률이 30%를 넘으면 **"스키마 변경 의심"으로 실행 실패 처리** 하고 `listings.json`을 덮어쓰지 않는다
  (깨진 데이터로 정상 데이터를 날리지 않기)
- 원본 응답 1건을 `run-logs/last-raw-sample.json`에 저장해 디버깅을 돕는다 (개인정보 없음 — 공개 매물 정보)

### 9.4 robots.txt·이용약관 고려

네이버 서비스 이용약관은 **자동화된 수단에 의한 데이터 수집을 제한**하며, 부동산 매물 정보의
**무단 복제·재배포·상업적 이용**은 정보 제공 중개업체와 네이버 양측의 권리를 침해할 수 있다 `[검증: 다수 조사 문서의 일관된 지적]`.
`m.land.naver.com/robots.txt`의 실제 내용은 이 환경에서 확인할 수 없었다 `[미검증]` →
**Build 0단계에서 반드시 확인하고, 목록 경로가 명시적으로 금지되어 있으면 진행을 멈추고 사용자에게 보고한다.**

이 도구는 다음 범위를 **넘지 않도록 설계에 상한을 박아둔다.**
- **목적**: 사용자 본인의 주거(전세) 탐색. 상업적 이용·재판매·광고 없음
- **분량**: 1일 최대 300 요청, 관심 지역 7~10개 동에 한정. 전국·대량 수집 기능을 **의도적으로 넣지 않는다**
  (`maxRegionCodes` 하드 상한 40이 전국 수집을 구조적으로 불가능하게 한다)
- **속도**: 순차 요청 + 최소 1초 지연. 병렬·프록시 로테이션·IP 우회 기능을 **넣지 않는다**
- **차단 존중**: 429/403을 받으면 재시도 없이 물러난다
- **재배포**: 수집 데이터의 공개 웹 게시는 **기본 비활성**(11장 D1). 원본 링크를 항상 병기해 트래픽을 네이버로 되돌린다
- **표시**: 웹앱 푸터에 "네이버 부동산 공개 매물 정보를 개인 열람 목적으로 수집. 정확한 정보는 원본 확인" 명시

> 요약: **"내가 브라우저로 여의도 매물을 하루 두 번 훑어보는 것"을 자동화한 수준을 넘지 않는다.**
> 이 선을 넘는 기능(대량·전국·실시간·프록시)은 v1에 넣지 않으며, 요청받아도 이 문서를 근거로 재검토한다.

---

## 10. 구현 단계 분할 (Build 서브에이전트용)

### 0단계 — 스펙 라이브 검증 (**가장 먼저, 여기서 막히면 즉시 보고**)
1. `m.land.naver.com/robots.txt` 확인 (9.4) — 금지 시 **중단하고 사용자에게 보고**
2. `regions/list?cortarNo=0000000000` → 서울 코드 확보. Authorization 필요 여부 확인 (V3)
3. 드릴다운으로 **여의도동 `cortarNo` 실제 확인** (2.4의 `1156011000` 검증)
4. `articleList`에 UA+Referer만으로 1회 요청 → 200/응답 구조 확인 (V1, V4)
5. `wprcMin/wprcMax`를 넣은 요청과 안 넣은 요청을 비교해 **보증금 필터 동작·단위 확인** (V2)
6. 결과를 `run-logs/verification.json`에 기록. **V1이 실패하면 진행을 멈추고 2.5의 폴백을 사용자와 상의**

> 0단계 요청은 총 6~8회를 넘기지 않는다. 실패하면 사람에게 물어본다 — 파라미터를 무작위로 바꿔가며 재시도하지 않는다.

### 1단계 — 수집기 골격
`config.json` 스키마 → `naver-client.js`(지연·재시도·429 중단·타임아웃·요청 카운터) → `regions.js`(드릴다운, 접두어 매칭 확장, `regions.cache.json`)
- 검증: `node collector/collect.js --dry-run`이 요청 URL 목록만 출력하고 네트워크를 타지 않을 것

### 2단계 — 수집·정규화
`collect.js` 페이지 루프(`more` 기반, 상한 적용) → `normalize.js`(6.2 스키마, 금액/면적/날짜/층 파싱) → 응답 `cortarNo` 자체 필터 → `listings.json` 원자적 저장
- 검증: 실제 1개 지역 1페이지 수집으로 정규화 결과 눈으로 확인

### 3단계 — 비교·이력
`diff.js`(8.3) → `history.json` 갱신 → **부분 실패 시 삭제 판정 보류** 로직 → `last-run.json` + 종료 코드
- 검증: `listings.json`을 손으로 편집해 신규/삭제/가격변동 3가지 케이스를 재현

### 4단계 — 웹앱 UI
`index.html` / `style.css` / `app.js` → 목록 렌더 → 필터·정렬 → 배지 → URL 쿼리 동기화 → `sample.json` 폴백(7.5) → 0건·에러·오프라인 상태
- 검증: `node tools/serve.js`로 띄워 데스크톱/모바일 폭(320px) 양쪽 확인

### 5단계 — 마무리
`sample.json` 생성(소량·손으로 확인) → 중첩 `.gitignore` 배치 → 도움말(수집 실행법·주기 등록법) → 스케줄러 등록 안내

**범위 제한 (Build 서브에이전트가 지켜야 할 것)**
- `apps/yeouido-jeonse/` **밖의 어떤 파일도 만들거나 수정하지 않는다** (루트 `index.html`·`build.js`·`.gitignore`·`.github/` 포함)
- Embed(메인 페이지 카드)와 커밋은 Build의 일이 아니다 — `CLAUDE.md`의 4단계에서 처리
- 외부 라이브러리·CDN·npm 의존성 0. Node 내장 모듈만
- `spec.md`를 수정하지 않는다. 스펙과 현실이 다르면 `run-logs/verification.json`에 기록하고 보고한다

---

## 11. 사용자 승인이 필요한 열린 결정 사항

| # | 결정 사항 | 선택지 | Plan의 권고 |
|---|---|---|---|
| **D1** | **수집한 실제 매물 데이터를 공개 블로그에 게시할 것인가?** GitHub Pages는 누구나 볼 수 있고, 네이버 매물 데이터의 공개 재배포는 개인 열람보다 법적·윤리적 노출이 크다(9.4). | (a) **비공개**: `listings.json`을 gitignore, 공개 사이트는 `sample.json`으로 UI만 시연 / (b) 공개: 실데이터 커밋 | **(a)** — 수집 목적이 본인 주거 탐색이고, 포트폴리오 가치는 sample로 충분히 확보된다 |
| **D2** | 아키텍처 확정 | A(Actions) / **B(로컬+스케줄러)** / C(세션) | **B** — 3.3 (IP 차단 위험 회피 + 시크릿 불필요). A는 나중에 파일 1개 추가로 전환 가능 |
| **D3** | 기본 대상 지역 7곳(여의도·당산·문래·영등포·양평·신길·노량진)이 적절한가? 마포(도화·공덕)·흑석 포함 여부 | 목록 조정 | 제안대로 7곳 시작 → 결과 보고 조정. 지역이 늘면 요청 수가 비례 증가(8.2) |
| **D4** | 수집 주기 | 1일 2회(08/20시) / 1일 1회 / 6시간마다 | **1일 2회** — 전세 매물 갱신 속도에 충분하고 요청량이 적다 |
| **D5** | "주거용 오피스텔" 판별 기준 | 전용면적 하한(기본 30㎡) / 하한 없음 / 태그 기반 | **전용 30㎡ 이상** — 업무용·원룸형 오피스텔을 걸러낸다. 값 조정 가능 |
| **D6** | 0단계에서 **모바일 API가 막히거나** `regions/list`가 토큰을 요구하면? | (a) 사용자에게 보고하고 중단 / (b) PC 계열 + 토큰 자체생성 실험(2.5-②) / (c) 브라우저 자동화 도입 | **(a) 보고 후 (b) 실험**. (c)는 "외부 라이브러리 최소화" 원칙 위배로 별도 승인 없이는 하지 않는다 |
| **D7** | 보증금 범위 4억~7억을 하드 기본값으로? | 그대로 / 조정 | 그대로. `config.json`에서 즉시 변경 가능 |
| **D8** | 지도 표시를 v1에 넣을 것인가? | 넣음(외부 지도 SDK 필요) / **안 넣음** | **안 넣음** — 좌표는 수집·보관하므로 나중에 추가 가능 |

---

## 12. 리스크와 대응 요약

| 리스크 | 가능성 | 영향 | 대응 |
|---|---|---|---|
| **모바일 API가 실제로는 토큰을 요구** | 낮음 (`[검증]` 다수 구현체) | 치명 | 0단계에서 최우선 확인. 실패 시 D6 |
| **IP 차단 / 429** | 중 | 큼 | B안(가정용 IP) + 순차·지연·상한 + 429 즉시 중단(9.2). 데이터센터 IP 회피가 A안을 배제한 이유 |
| **응답 스키마 변경** | 중 (공식 API 아님) | 큼 | 필드 부재 허용 + 누락률 30% 초과 시 기존 데이터 보존하며 실패 처리(9.3) |
| **PC 폴백 시 토큰 3시간 만료** | 해당 시 확실 | 큼 | 2.5 — ②자체생성 실험이 유일한 자동화 경로. 실패하면 자동 수집 자체를 재설계해야 함 |
| **매물 0건** | 중 (4~7억 조건이 좁을 수 있음) | 중 | 정상 상태로 처리(에러 아님). UI에 "조건 완화" 안내. `stats.total=0`이어도 이전 데이터를 지우지 않음 |
| **부분 실패를 "매물 사라짐"으로 오독** | 중 | 중 | 실패 지역은 삭제 판정에서 제외(8.3) |
| **데이터 파일 무한 증가** | 낮음 | 중 | history는 요약만·변경 시에만 append·60회/14일 보관(6.3) |
| **`file://`로 열어 fetch 실패** | 높음 | 낮음 | `tools/serve.js` 사용 안내 + 명확한 에러 메시지(7.5) |
| **공개 재배포 리스크** | D1에 따름 | 큼 | D1을 (a)로 결정하면 구조적으로 회피 |

---

## 부록: 조사 출처

`[검증]` 항목의 근거는 다음 유형의 자료를 교차 대조해 얻었다 (Plan 환경에서 naver.com 직접 접근 불가).

- **실제 캡처된 응답 원문** — 모바일 `articleList` 응답 전문이 커밋된 공개 노트북(`JeeheeMin/land_crawl`),
  PC `articles` 응답 JSON 파일(`jhseo808/crawling_naverland`)
- **네이버가 내려준 HTML** — 모바일 필터의 `<input name="rletTpCd" value="APT|OPST|...">` 전체 채록
  (`w00jji/-Real_Estate_Recommendation_System`) → 2.3의 매물종류 코드표
- **타입이 지정된 요청 DTO(한국어 주석)** — `jissp/naver-land-crawler`의 `article-list.request.dto.ts`
  → 2.2의 `wprcMin`/`wprcMax`(보증금) 등 파라미터 의미
- **응답 필드 한국어 사전** — `seungwoo-woo/donnammu`의 `keysInfo` (`prc: '매매(전세)가(만원)'`) → 금액 단위
- **유출된 실제 JWT 4건** — `suwho18/dabom_app`, `erinboy/naver_crawler`, `koogk7/naver-landing-collector`,
  `jhseo808/crawling_naverland`. base64 디코딩으로 TTL 10,800초·상수 payload 직접 확인
- **무작위 시크릿으로 JWT를 생성하는 구현** — `jihaein/realestate`의 `build_windows.py`
  (`generate_secret_key()` = `base64(os.urandom(32))`) → 2.5-② 가설의 출처
- **헤더 없는 모바일 호출 구현 4종** — `junbbbb/realestate-crm`, `hoonnamkoong/real-estate-bot`,
  `GoodgatewayGoodgateway/AI`, `moderated-coder/real-estate-agent` → Authorization 불필요 교차 확인
- **`regions/list` 사용·필드 정의** — `syshin0116/LazyEstate`, `kdu9303/apt_real_estate`,
  `DeveloperChoi90/estate_naver`, `yygs321/homefinder`(여의도동 코드 포함 지역 덤프)
- **차단·레이트리밋 관찰 기록** — `twbeatles/naverland-scrapper`의 조사 문서(2026-08-04)
  ("browser session 없이 연속 요청 시 429 빈번"), `nickujung-art/danjiondo`의 스크래핑 가이드
  (동시 워커 4 초과 시 IP 밴 위험, 이용약관상 자동 크롤링 제한)

> 위 자료는 모두 제3자의 관찰이며 네이버의 공식 문서가 아니다.
> **0단계 라이브 검증 없이는 어떤 항목도 최종 확정으로 취급하지 않는다.**
