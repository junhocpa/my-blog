/* 픽셀 아트 에디터 — 상태 관리, 그리기 이벤트, PNG 내보내기
   file:// 로 직접 열어도 동작하도록 ES 모듈이 아닌 일반 스크립트로 작성. */
"use strict";

(function () {
  // ------------------------------------------------------------------
  // 상수
  // ------------------------------------------------------------------
  var GRID_SIZE = 16;                        // 16×16 고정 (확장 여지용 상수)
  var CELL_COUNT = GRID_SIZE * GRID_SIZE;    // 256
  var EXPORT_SCALE = 20;                     // 16 × 20 = 320px PNG
  var DEFAULT_COLOR = "#1e88e5";             // 기본 선택 색 (파랑)

  // 기본 팔레트 16색 (이름은 스와치 aria-label에 사용)
  var PALETTE = [
    { name: "검정", hex: "#000000" },
    { name: "흰색", hex: "#ffffff" },
    { name: "회색", hex: "#9e9e9e" },
    { name: "빨강", hex: "#e53935" },
    { name: "주황", hex: "#fb8c00" },
    { name: "노랑", hex: "#fdd835" },
    { name: "연두", hex: "#8bc34a" },
    { name: "초록", hex: "#2e7d32" },
    { name: "청록", hex: "#00acc1" },
    { name: "하늘", hex: "#4fc3f7" },
    { name: "파랑", hex: "#1e88e5" },
    { name: "남색", hex: "#283593" },
    { name: "보라", hex: "#8e24aa" },
    { name: "분홍", hex: "#f06292" },
    { name: "갈색", hex: "#6d4c41" },
    { name: "살구", hex: "#ffcc80" }
  ];

  // ------------------------------------------------------------------
  // 상태
  // ------------------------------------------------------------------
  var state = {
    grid: new Array(CELL_COUNT).fill(null),  // 색상 문자열 또는 null(투명)
    color: DEFAULT_COLOR,                    // 현재 선택 색
    tool: "pen",                             // "pen" | "eraser"
    drawing: false                           // 드래그 페인팅 중 여부
  };

  // ------------------------------------------------------------------
  // DOM 참조
  // ------------------------------------------------------------------
  var gridEl = document.getElementById("grid");
  var paletteEl = document.getElementById("palette");
  var currentSwatchEl = document.getElementById("current-swatch");
  var currentHexEl = document.getElementById("current-hex");
  var pickerEl = document.getElementById("color-picker");
  var penBtn = document.getElementById("pen-btn");
  var eraserBtn = document.getElementById("eraser-btn");
  var clearBtn = document.getElementById("clear-btn");
  var saveBtn = document.getElementById("save-btn");

  var cells = [];         // index → 셀 DOM
  var swatchBtns = [];    // 팔레트 스와치 버튼들

  // ------------------------------------------------------------------
  // 격자 생성 (256개 DOM 셀, CSS Grid 배치)
  // ------------------------------------------------------------------
  function buildGrid() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < CELL_COUNT; i++) {
      var cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.index = String(i);
      frag.appendChild(cell);
      cells.push(cell);
    }
    gridEl.appendChild(frag);
  }

  // ------------------------------------------------------------------
  // 팔레트 생성
  // ------------------------------------------------------------------
  function buildPalette() {
    PALETTE.forEach(function (entry) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "swatch";
      btn.style.backgroundColor = entry.hex;
      btn.dataset.hex = entry.hex;
      btn.setAttribute("aria-label", entry.name + " (" + entry.hex + ")");
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", function () {
        setColor(entry.hex, btn);
        setTool("pen"); // 색을 고르면 바로 그릴 수 있도록 펜으로 전환
      });
      paletteEl.appendChild(btn);
      swatchBtns.push(btn);
    });
  }

  // ------------------------------------------------------------------
  // 색·도구 상태 갱신
  // ------------------------------------------------------------------
  // selectedBtn: 눌린 팔레트 스와치(커스텀 색이면 null)
  function setColor(hex, selectedBtn) {
    state.color = hex;
    currentSwatchEl.style.backgroundColor = hex;
    currentHexEl.textContent = hex;
    pickerEl.value = hex;
    swatchBtns.forEach(function (b) {
      b.setAttribute("aria-pressed", b === selectedBtn ? "true" : "false");
    });
  }

  function setTool(tool) {
    state.tool = tool;
    penBtn.setAttribute("aria-pressed", tool === "pen" ? "true" : "false");
    eraserBtn.setAttribute("aria-pressed", tool === "eraser" ? "true" : "false");
  }

  // ------------------------------------------------------------------
  // 그리기 (상태 배열 + 해당 셀만 부분 업데이트)
  // ------------------------------------------------------------------
  function paintAt(index) {
    var value = state.tool === "eraser" ? null : state.color;
    if (state.grid[index] !== value) {
      state.grid[index] = value;
      cells[index].style.backgroundColor = value === null ? "" : value;
    }
  }

  // 좌표 아래의 셀을 찾아 칠한다.
  // (터치 드래그에서는 event.target이 시작 셀에 고정되므로 elementFromPoint 사용)
  function paintFromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    if (el && el.parentElement === gridEl && el.dataset.index !== undefined) {
      paintAt(Number(el.dataset.index));
    }
  }

  // ------------------------------------------------------------------
  // Pointer Events — 마우스·터치·펜 통합
  // ------------------------------------------------------------------
  function bindDrawingEvents() {
    gridEl.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return; // 좌클릭만
      e.preventDefault();
      state.drawing = true;
      paintFromPoint(e.clientX, e.clientY);
    });

    gridEl.addEventListener("pointermove", function (e) {
      if (!state.drawing) return;
      // 창 밖에서 버튼을 떼면 pointerup이 문서에 전달되지 않을 수 있으므로
      // 버튼이 눌려 있지 않은 마우스 이동이면 드래그를 종료한다.
      if (e.pointerType === "mouse" && e.buttons === 0) {
        state.drawing = false;
        return;
      }
      paintFromPoint(e.clientX, e.clientY);
    });

    // 격자 밖에서 손을 떼도 종료되도록 문서 레벨에서 감지
    document.addEventListener("pointerup", function () {
      state.drawing = false;
    });
    document.addEventListener("pointercancel", function () {
      state.drawing = false;
    });

    // 브라우저 기본 드래그 방지
    gridEl.addEventListener("dragstart", function (e) {
      e.preventDefault();
    });
  }

  // ------------------------------------------------------------------
  // 전체 지우기
  // ------------------------------------------------------------------
  function clearAll() {
    if (!window.confirm("그림을 전부 지울까요? 되돌릴 수 없습니다.")) return;
    state.grid.fill(null);
    cells.forEach(function (cell) {
      cell.style.backgroundColor = "";
    });
  }

  // ------------------------------------------------------------------
  // PNG 내보내기 (오프스크린 canvas, 320×320, 빈 칸은 투명)
  // ------------------------------------------------------------------
  function exportPNG() {
    var canvas = document.createElement("canvas");
    canvas.width = GRID_SIZE * EXPORT_SCALE;   // 320
    canvas.height = GRID_SIZE * EXPORT_SCALE;  // 320
    var ctx = canvas.getContext("2d");
    // 배경을 채우지 않음 → null 칸은 투명 픽셀로 남는다
    for (var i = 0; i < CELL_COUNT; i++) {
      var color = state.grid[i];
      if (color !== null) {
        ctx.fillStyle = color;
        ctx.fillRect(
          (i % GRID_SIZE) * EXPORT_SCALE,
          Math.floor(i / GRID_SIZE) * EXPORT_SCALE,
          EXPORT_SCALE,
          EXPORT_SCALE
        );
      }
    }
    var a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "pixel-art.png";
    a.click();
  }

  // ------------------------------------------------------------------
  // 초기화
  // ------------------------------------------------------------------
  function init() {
    buildGrid();
    buildPalette();
    bindDrawingEvents();

    // 기본 색이 팔레트에 있으면 해당 스와치를 선택 표시
    var defaultBtn = null;
    for (var i = 0; i < swatchBtns.length; i++) {
      if (swatchBtns[i].dataset.hex === DEFAULT_COLOR) {
        defaultBtn = swatchBtns[i];
        break;
      }
    }
    setColor(DEFAULT_COLOR, defaultBtn);
    setTool("pen");

    pickerEl.addEventListener("input", function () {
      setColor(pickerEl.value, null); // 커스텀 색 → 팔레트 선택 해제
      setTool("pen");
    });
    penBtn.addEventListener("click", function () {
      setTool("pen");
    });
    eraserBtn.addEventListener("click", function () {
      setTool("eraser");
    });
    clearBtn.addEventListener("click", clearAll);
    saveBtn.addEventListener("click", exportPNG);
  }

  init();
})();
