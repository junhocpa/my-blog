// 클라이언트 스크립트 — 테마 토글과 태그 필터만 담당한다.
// JS가 없어도 콘텐츠 열람에는 지장이 없어야 한다(프로그레시브 인핸스먼트).
(function () {
  'use strict';

  var root = document.documentElement;

  // --- 테마 토글 ---
  var toggle = document.querySelector('.theme-toggle');

  function updateToggleIcon() {
    if (!toggle) return;
    toggle.textContent = root.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
  }

  if (toggle) {
    updateToggleIcon();
    toggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem('theme', next);
      } catch (e) { /* 저장 실패 시 현재 페이지에서만 적용 */ }
      updateToggleIcon();
    });
  }

  // --- 태그 필터 (목록 페이지, 다중 선택 가능) ---
  // 켜진 태그를 전부 가진 글만 표시한다(AND). 전부 끄면 전체 표시.
  var chips = document.querySelectorAll('.tag-filter .tag-chip');
  var posts = document.querySelectorAll('.post-list .post-item');

  function applyFilter() {
    var activeTags = [];
    chips.forEach(function (c) {
      if (c.classList.contains('active')) {
        activeTags.push(c.getAttribute('data-tag'));
      }
    });

    posts.forEach(function (p) {
      if (activeTags.length === 0) {
        p.hidden = false;
        return;
      }
      var tags = (p.getAttribute('data-tags') || '').split(' ');
      p.hidden = !activeTags.every(function (t) {
        return tags.indexOf(t) !== -1;
      });
    });
  }

  if (chips.length && posts.length) {
    chips.forEach(function (chip) {
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', function () {
        var nowActive = !chip.classList.contains('active');
        chip.classList.toggle('active', nowActive);
        chip.setAttribute('aria-pressed', String(nowActive));
        applyFilter();
      });
    });
  }
})();
