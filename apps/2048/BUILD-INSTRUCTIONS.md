# Build 서브에이전트 지침 — 2048 게임

## 역할
`apps/2048/spec.md`에 정의된 스펙대로 2048 게임을 구현한다. **스펙을 먼저 정독한 뒤 구현을 시작한다.**

## 수정 범위 (엄격히 준수)
- **작성 허용**: `apps/2048/index.html`, `apps/2048/style.css`, `apps/2048/game.js` — 이 3개 파일만.
- spec.md, PLAN-INSTRUCTIONS.md 및 블로그의 다른 모든 파일(`posts/`, `src/`, `dist/`, `build.js` 등)은 절대 수정·생성하지 않는다.

## 기술 제약
- 순수 HTML/CSS/JavaScript. 외부 라이브러리·CDN·프레임워크 금지.
- `index.html`을 브라우저에서 **file:// 로 직접 열어도 동작**해야 한다.
  - ES 모듈은 file://에서 CORS로 차단될 수 있으므로 `<script defer src="game.js">` 일반 스크립트를 사용한다.
- `lang="ko"`, 시맨틱 태그, 접근성(aria-live 점수판, 버튼 텍스트 라벨, WCAG AA 대비) 준수.

## 구현 필수 사항 (spec.md 요약 — 상세는 spec.md 참조)
1. 4×4 보드, 방향키 + 터치 스와이프 조작 (보드에 `touch-action: none`).
2. 이동/병합: slideRowLeft 단일 연산 + reverse/transpose 환원. 1이동당 타일별 1회 병합. 무효한 수에는 새 타일 미생성.
3. 새 타일: 2(90%)/4(10%). 점수: 병합 결과값만큼 가산.
4. 점수판: SCORE + BEST, BEST는 localStorage 키 `game2048.best`.
5. 새 게임 버튼, 승리 오버레이(계속하기/새 게임), 게임 오버 오버레이(다시 시작).
6. 새 타일 pop-in, 병합 pulse 애니메이션 (CSS).
7. 모바일: 375px에서 가로 스크롤 없음, 터치 대상 최소 44px.
8. 색상 등 디자인 토큰은 `:root` CSS 변수로 정의. `prefers-color-scheme: dark` 대응(변수 교체).

## 자체 확인 (구현 후 코드 수준에서 검증)
- `[2,2,2,2]` 왼쪽 → `[4,4,0,0]`, `[4,2,2,0]` 왼쪽 → `[4,4,0,0]` 로직 확인.
- Node로 로직 단위 테스트 가능하면 임시 검증 후 테스트 파일은 남기지 않는다(브라우저 실행 검증은 Review 단계 담당).

## 완료 후
생성한 파일 목록과 구현 특이사항(스펙과 달라진 점이 있으면 반드시 명시)을 요약해 반환한다.
