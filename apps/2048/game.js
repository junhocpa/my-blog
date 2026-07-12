/* ============================================================
   2048 게임 로직 + 렌더링 + 입력 처리 (순수 JavaScript)
   - file:// 직접 실행 지원을 위해 일반 스크립트(defer)로 로드
   ============================================================ */
(function () {
  'use strict';

  // ==== 상수 ======================================================

  var SIZE = 4;
  var WIN_VALUE = 2048;
  var BEST_KEY = 'game2048.best';
  var SWIPE_THRESHOLD = 30; // px — 탭과 스와이프 구분 임계값

  // ==== 게임 로직 (순수 함수) =====================================

  function createEmptyBoard() {
    var board = [];
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) row.push(0);
      board.push(row);
    }
    return board;
  }

  function transpose(m) {
    return m[0].map(function (_, c) {
      return m.map(function (row) { return row[c]; });
    });
  }

  function reverseRows(m) {
    return m.map(function (row) { return row.slice().reverse(); });
  }

  // 방향별 보드 변환: 모든 이동을 "행을 왼쪽으로 밀기"로 환원
  function toLeft(board, dir) {
    if (dir === 'left') return board.map(function (r) { return r.slice(); });
    if (dir === 'right') return reverseRows(board);
    if (dir === 'up') return transpose(board);
    return reverseRows(transpose(board)); // down
  }

  // toLeft의 역변환
  function fromLeft(board, dir) {
    if (dir === 'left') return board;
    if (dir === 'right') return reverseRows(board);
    if (dir === 'up') return transpose(board);
    return transpose(reverseRows(board)); // down
  }

  // 한 행을 왼쪽으로 민다. 1이동당 각 타일 최대 1회 병합(벽 쪽 우선).
  function slideRowLeft(row) {
    var arr = row.filter(function (v) { return v !== 0; });
    var result = [];
    var mergedIdx = []; // 병합이 일어난 결과 인덱스 (애니메이션용)
    var gained = 0;
    var i = 0;
    while (i < arr.length) {
      if (i + 1 < arr.length && arr[i] === arr[i + 1]) {
        var merged = arr[i] * 2;
        mergedIdx.push(result.length);
        result.push(merged);
        gained += merged;
        i += 2; // 병합에 쓰인 두 타일 소비 → 같은 이동 내 재병합 방지
      } else {
        result.push(arr[i]);
        i += 1;
      }
    }
    while (result.length < SIZE) result.push(0);

    var moved = false;
    for (var j = 0; j < SIZE; j++) {
      if (result[j] !== row[j]) { moved = true; break; }
    }
    return { row: result, gained: gained, moved: moved, mergedIdx: mergedIdx };
  }

  function getEmptyCells(board) {
    var cells = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (board[r][c] === 0) cells.push({ r: r, c: c });
      }
    }
    return cells;
  }

  function hasValue(board, value) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (board[r][c] === value) return true;
      }
    }
    return false;
  }

  // 빈 칸이 있거나 인접(우/하)한 같은 값 쌍이 있으면 이동 가능
  function canMove(board) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (board[r][c] === 0) return true;
        if (c + 1 < SIZE && board[r][c] === board[r][c + 1]) return true;
        if (r + 1 < SIZE && board[r][c] === board[r + 1][c]) return true;
      }
    }
    return false;
  }

  // ==== DOM / 게임 상태 ===========================================

  var state = {
    board: createEmptyBoard(),
    score: 0,
    best: 0,
    won: false,
    over: false,
    keepPlaying: false
  };

  // 직전 이동의 애니메이션 메타데이터
  var newTilePos = null;   // {r, c} — 새로 생성된 타일
  var mergedFlags = null;  // boolean[4][4] — 병합이 일어난 칸

  var boardEl = document.getElementById('board');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var overlayEl = document.getElementById('overlay');
  var overlayTitleEl = document.getElementById('overlay-title');
  var overlayScoreEl = document.getElementById('overlay-score');
  var btnNew = document.getElementById('btn-new');
  var btnContinue = document.getElementById('btn-continue');
  var btnOverlayNew = document.getElementById('btn-overlay-new');
  var btnRestart = document.getElementById('btn-restart');

  function loadBest() {
    try {
      var v = parseInt(localStorage.getItem(BEST_KEY), 10);
      return isNaN(v) ? 0 : v;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(v) {
    try {
      localStorage.setItem(BEST_KEY, String(v));
    } catch (e) { /* 저장 불가 환경에서는 무시 */ }
  }

  function spawnRandomTile() {
    var empties = getEmptyCells(state.board);
    if (empties.length === 0) return;
    var cell = empties[Math.floor(Math.random() * empties.length)];
    state.board[cell.r][cell.c] = Math.random() < 0.9 ? 2 : 4;
    newTilePos = cell;
  }

  function startGame() {
    state.board = createEmptyBoard();
    state.score = 0;
    state.won = false;
    state.over = false;
    state.keepPlaying = false;
    newTilePos = null;
    mergedFlags = null;
    spawnRandomTile();
    spawnRandomTile();
    hideOverlay();
    render();
  }

  function move(dir) {
    if (state.over) return;
    if (state.won && !state.keepPlaying) return;

    var work = toLeft(state.board, dir);
    var newRows = [];
    var flags = [];
    var gained = 0;
    var moved = false;

    for (var r = 0; r < SIZE; r++) {
      var res = slideRowLeft(work[r]);
      newRows.push(res.row);
      gained += res.gained;
      if (res.moved) moved = true;
      var f = [false, false, false, false];
      res.mergedIdx.forEach(function (idx) { f[idx] = true; });
      flags.push(f);
    }

    if (!moved) return; // 무효한 수 — 새 타일 미생성

    state.board = fromLeft(newRows, dir);
    mergedFlags = fromLeft(flags, dir);
    state.score += gained;
    if (state.score > state.best) {
      state.best = state.score;
      saveBest(state.best);
    }

    newTilePos = null;
    spawnRandomTile();

    if (!state.won && hasValue(state.board, WIN_VALUE)) {
      state.won = true;
      showWinOverlay();
    }
    if (!canMove(state.board)) {
      state.over = true;
      showGameOverOverlay();
    }

    render();
  }

  // ==== 렌더링 ====================================================

  function render() {
    boardEl.textContent = '';
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        var value = state.board[r][c];
        if (value !== 0) {
          var tile = document.createElement('div');
          tile.className = 'tile';
          tile.setAttribute('data-value', String(value));
          tile.textContent = String(value);
          var len = String(value).length;
          if (len >= 4) tile.classList.add('tile--len4');
          else if (len === 3) tile.classList.add('tile--len3');
          if (newTilePos && newTilePos.r === r && newTilePos.c === c) {
            tile.classList.add('tile--new');
          }
          if (mergedFlags && mergedFlags[r][c]) {
            tile.classList.add('tile--merged');
          }
          cell.appendChild(tile);
        }
        boardEl.appendChild(cell);
      }
    }
    scoreEl.textContent = String(state.score);
    bestEl.textContent = String(state.best);
    mergedFlags = null; // 1회 렌더링에만 사용
  }

  // ==== 오버레이 ==================================================

  function showWinOverlay() {
    overlayTitleEl.textContent = '이겼습니다!';
    overlayScoreEl.hidden = true;
    btnContinue.hidden = false;
    btnOverlayNew.hidden = false;
    btnRestart.hidden = true;
    overlayEl.hidden = false;
  }

  function showGameOverOverlay() {
    overlayTitleEl.textContent = '게임 오버';
    overlayScoreEl.textContent = '최종 점수: ' + state.score;
    overlayScoreEl.hidden = false;
    btnContinue.hidden = true;
    btnOverlayNew.hidden = true;
    btnRestart.hidden = false;
    overlayEl.hidden = false;
  }

  function hideOverlay() {
    overlayEl.hidden = true;
  }

  // ==== 입력 처리 =================================================

  var KEY_TO_DIR = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down'
  };

  window.addEventListener('keydown', function (event) {
    var dir = KEY_TO_DIR[event.key];
    if (!dir) return;
    event.preventDefault(); // 방향키로 페이지가 스크롤되지 않도록
    if (!overlayEl.hidden) return; // 오버레이 표시 중에는 무시
    move(dir);
  });

  var touchStart = null;

  boardEl.addEventListener('touchstart', function (event) {
    if (event.touches.length === 1) {
      touchStart = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY
      };
    }
  }, { passive: true });

  boardEl.addEventListener('touchend', function (event) {
    if (!touchStart) return;
    var touch = event.changedTouches[0];
    var dx = touch.clientX - touchStart.x;
    var dy = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return; // 탭 무시
    if (!overlayEl.hidden) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      move(dx > 0 ? 'right' : 'left');
    } else {
      move(dy > 0 ? 'down' : 'up');
    }
  });

  // ==== 버튼 ======================================================

  btnNew.addEventListener('click', startGame);
  btnOverlayNew.addEventListener('click', startGame);
  btnRestart.addEventListener('click', startGame);
  btnContinue.addEventListener('click', function () {
    state.keepPlaying = true;
    hideOverlay();
  });

  // ==== 초기화 ====================================================

  state.best = loadBest();
  startGame();
})();
