# Build 서브에이전트 지침 — 픽셀 아트 에디터

## 역할
`apps/pixel-art/spec.md`에 정의된 스펙대로 픽셀 아트 에디터를 구현한다. **스펙을 먼저 정독한 뒤 구현을 시작한다.**

## 수정 범위 (엄격히 준수)
- **작성 허용**: `apps/pixel-art/index.html`, `apps/pixel-art/style.css`, `apps/pixel-art/editor.js` — 이 3개 파일만.
- spec.md, 지침 파일 및 블로그의 다른 모든 파일(`posts/`, `src/`, `dist/`, `build.js`, `apps/2048/` 등)은 절대 수정·생성하지 않는다.

## 기술 제약
- 순수 HTML/CSS/JavaScript. 외부 라이브러리·CDN·프레임워크 금지. Canvas API 등 브라우저 내장 기능만 사용.
- `index.html`을 브라우저에서 **file:// 로 직접 열어도 동작**해야 한다 — `<script defer src="editor.js">` 일반 스크립트 사용, ES 모듈 금지.
- `lang="ko"`, 시맨틱 태그, 접근성(버튼 라벨, aria-pressed 등 상태 표시, WCAG AA 대비) 준수.
- UI 텍스트는 한국어.

## 구현 필수 사항 (spec.md 요약 — 상세는 spec.md 참조)
1. 16×16 격자: 상태는 길이 256 배열(null=투명), 화면은 CSS Grid DOM 셀. 투명 칸은 체커보드 무늬로 표시.
2. 그리기: Pointer Events(pointerdown/pointermove + elementFromPoint)로 마우스·터치 통합. 드래그로 연속 찍기. 격자에 `touch-action: none`.
3. 팔레트: 기본 16색 + `<input type="color">` 커스텀 피커. 현재 선택 색 표시(선택 스와치 강조 + aria-pressed).
4. 도구: 그리기 / 지우개 전환, 전체 지우기(confirm 후 실행).
5. PNG 저장: 오프스크린 canvas에 셀당 20px(320×320)로 그린 뒤 toDataURL → `<a download="pixel-art.png">` 클릭으로 다운로드. 투명 칸은 PNG에서도 투명 유지.
6. 모바일: 375px에서 가로 스크롤 없음, 격자가 화면 폭에 맞음, 터치 대상(팔레트 스와치·버튼) 최소 44px.
7. 색상 등 디자인 토큰은 `:root` CSS 변수. `prefers-color-scheme: dark` 대응. 블로그 톤(시스템 폰트 스택)과 일관성 유지.

## 자체 확인 (구현 후 코드 수준에서 검증)
- 상태 배열 ↔ PNG 출력 로직을 Node로 단위 검증 가능하면 임시 검증 후 테스트 파일은 남기지 않는다(브라우저 실행 검증은 Review 단계 담당).

## 완료 후
생성한 파일 목록과 구현 특이사항(스펙과 달라진 점이 있으면 반드시 명시)을 요약해 반환한다.
