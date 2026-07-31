# 채널톡 고객 신원 추정 — 새 세션 인수인계

이전 세션(2026-07-31)에서 `api.channel.io` 가 환경 네트워크 정책에 막혀 새 세션으로 이관한다.
**목표**: 채널톡 통화로그(Meet)·상담내역(UserChat) + Gmail 메일내역을 근거로 연락처 864건의
신원(회사/이름/역할)과 고객 유형을 추정 → 검토용 Excel + 옵시디언 노트 산출.
**채널톡 API는 조회 전용** — 프로필 반영은 사용자가 Excel을 보고 수기로 한다.

## 새 세션 시작 조건 (사용자 준비물)

1. 환경 설정 Network access에 `api.channel.io` 허용 (또는 Allow all) — 새 세션부터 적용됨
2. 채널톡 연락처 xlsx 재업로드 ("User data" 시트, 23컬럼, 864행)
3. 채널톡 Open API Access Key/Secret 전달 (환경변수로만 사용, 저장소 커밋 금지)

## 작업 순서

1. `python3 tools/channeltalk/collect_channeltalk.py check` — 연결 확인 (`GET /open/channel`)
2. `python3 tools/channeltalk/prepare_contacts.py <xlsx> <workdir>` — 세그먼트 생성
   - 지난 실행 결과: 전체 864 / 이름없음 362(이메일 41, 휴대폰만 91, 유선만 229, 연락처없음 1)
     / 이름있음·태그없음 324 / 이름·태그 있음 178
3. `collect_channeltalk.py call-log <workdir>` — **통화내역**. 발신·수신 번호를 연락처와 매칭
   (유선번호만 있는 229건의 핵심 증거원)
4. `collect_channeltalk.py user-chats <workdir>/contacts.json <workdir>` — 상담 대화 수집
5. Gmail 증거 수집 (Gmail MCP, 배치·서브에이전트 병렬):
   - 이메일 보유: `from:X OR to:X` 검색 → 제목/스니펫에서 회사·역할·업무유형 추출
   - 전화번호만: `"010-1234-5678"`, `"1234-5678"`(끝 8자리 하이픈), 4자리 조각 조합 검색 → 서명 매칭
   - 검증됨: salt7942@nate.com → 엘티더인베스트 급여대장 메일, "3578" → 서명 매칭 성공
6. 추정·분류 → 검토용 Excel + 옵시디언 노트 (아래 규칙)

## 추정 규칙

**고객명(name) 제안** — 기존 502건의 명명 패턴을 따른다:
- 법인 `(주)회사명_이름_역할`, 개인사업자 `(개인)상호명_이름_역할`
- 역할: `대표`, `실무자`, `실무자(사내이사)`, `대표배우자`, `前대표(실무자)` 등 기존 표기 재사용
- 회사 불명 시 `이름_역할` 또는 `이름(추정)` + 확신도 표기

**신설 태그(제안)** — 기존 태그(법인설립센터 76 / 히든머니 102 / 류재상·이동희)와 병행:
- 서비스유형: 기장, 급여-원천세, 법인설립, 외부감사, 법인세-세무조정, 종합소득세, 부가세,
  양도-상속-증여, M&A-실사, 컨설팅
- 고객상태: 진행중고객, 과거고객, 잠재고객(리드), 무관-스팸
- 접촉경로: 전화문의(통화로그), 메일교신(Gmail), 채널톡상담(UserChat)

**확신도**: 높음(서명/직접교신 일치) / 중간(간접 근거) / 낮음 / 불명(증거 없음)

## 산출물

1. **검토용 Excel**: 원본 컬럼 + [추정name, 추정태그, 추정설명, 근거(출처·제목·날짜), 확신도,
   통화횟수, 최근통화일] — user id 포함, 수기 반영용
2. **옵시디언 노트**: frontmatter(`category`, `tags[]`, 관계 프로퍼티) + `> 한 줄 정의:` 형식.
   종합 MOC 1개 + 고객 유형별 정리 노트. 볼트가 세션에 없으면 zip으로 전달

## 채널톡 API 요약 (Reference PDF ko-2026-06-01)

- Base `https://api.channel.io`, 헤더 `x-access-key`/`x-access-secret`/`Channel-Version: 2026-06-01`
- Rate limit: Leaky Bucket, 일반 초당 10건(버킷 1000), `GET /open/user-chats`(목록)만 버킷 100 —
  유저별 엔드포인트(`/open/users/{id}/user-chats`)를 사용할 것. 429 시 Retry-After 대기
- 주요 조회 엔드포인트: `GET /open/channel`, `GET /open/meet/call/log`,
  `GET /open/users/{userId}`, `GET /open/users/{userId}/user-chats`,
  `GET /open/user-chats/{chatId}/messages`, 통화 녹음 `GET /open/user-chats/{chatId}/meets/{messageId}/recording`

## 주의

- 고객 PII(연락처·수집 데이터)와 API 키는 **절대 git에 커밋하지 않는다** — workdir는 스크래치패드에 둔다
- 채널톡에 쓰기 요청(POST/PATCH/PUT/DELETE)을 보내지 않는다
