/* 여의도 전세 매물 — 목록 렌더·필터·정렬·배지
   ES 모듈이 아닌 일반 스크립트(<script defer>). 외부 라이브러리·CDN 사용 없음.

   데이터 로딩 순서 (spec 7.5)
     data/listings.json  → 실제 수집 결과 (커밋되지 않으므로 공개 사이트에는 없다)
     data/sample.json    → 예시 데이터. is_sample 이 true면 화면 상단에 배너를 항상 띄운다
     둘 다 실패          → 무엇을 해야 하는지 구체적으로 안내
   file:// 로 열면 fetch 가 막히므로 아예 시도하지 않고 실행 방법을 안내한다. */
'use strict';

(function () {
  // ------------------------------------------------------------------
  // 상수
  // ------------------------------------------------------------------
  var SOURCES = [
    { path: 'data/listings.json', label: '수집 데이터 (data/listings.json)' },
    { path: 'data/sample.json', label: '예시 데이터 (data/sample.json)' }
  ];

  var DEPOSIT_PRESETS = [
    { key: 'all', label: '전체', min: null, max: null },
    { key: '4-5', label: '4~5억', min: 40000, max: 50000 },
    { key: '5-6', label: '5~6억', min: 50000, max: 60000 },
    { key: '6-7', label: '6~7억', min: 60000, max: 70000 }
  ];

  var SORTS = ['confirm-desc', 'deposit-asc', 'deposit-desc', 'area-desc', 'first-desc'];

  // ------------------------------------------------------------------
  // 상태
  // ------------------------------------------------------------------
  var state = {
    data: null,
    sourceLabel: '',
    isSample: false,
    bounds: { min: 0, max: 100000 },
    filters: null
  };

  // ------------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------------
  var el = {
    meta: document.getElementById('meta-line'),
    stat: document.getElementById('stat-line'),
    banners: document.getElementById('banners'),
    filters: document.getElementById('filters'),
    regionChips: document.getElementById('region-chips'),
    typeChips: document.getElementById('type-chips'),
    depositPresets: document.getElementById('deposit-presets'),
    depositMin: document.getElementById('deposit-min'),
    depositMax: document.getElementById('deposit-max'),
    depositMinOut: document.getElementById('deposit-min-out'),
    depositMaxOut: document.getElementById('deposit-max-out'),
    areaMin: document.getElementById('area-min'),
    sort: document.getElementById('sort'),
    toggleChips: document.getElementById('toggle-chips'),
    resetBtn: document.getElementById('reset-btn'),
    resultCount: document.getElementById('result-count'),
    listings: document.getElementById('listings'),
    stateBox: document.getElementById('state-box'),
    stateTitle: document.getElementById('state-title'),
    stateBody: document.getElementById('state-body')
  };

  // ------------------------------------------------------------------
  // 유틸
  // ------------------------------------------------------------------
  function escapeHtml(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 만원 정수 → "5억 3,000" / "9,500만" */
  function formatDeposit(man) {
    if (typeof man !== 'number' || !isFinite(man)) return '금액 미확인';
    var eok = Math.floor(man / 10000);
    var rest = man % 10000;
    if (eok <= 0) return rest.toLocaleString('ko-KR') + '만';
    return eok + '억' + (rest > 0 ? ' ' + rest.toLocaleString('ko-KR') : '');
  }

  /** 만원 정수 → "5.3억" (가격 변동 표기용 짧은 형태) */
  function formatEok(man) {
    if (typeof man !== 'number' || !isFinite(man)) return '?';
    var v = man / 10000;
    return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') + '억';
  }

  function formatDateTime(iso) {
    if (!iso) return '알 수 없음';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    function p(n) {
      return n < 10 ? '0' + n : String(n);
    }
    return (
      d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    );
  }

  function roundDown(n, unit) {
    return Math.floor(n / unit) * unit;
  }
  function roundUp(n, unit) {
    return Math.ceil(n / unit) * unit;
  }

  function uniq(arr) {
    var out = [];
    arr.forEach(function (v) {
      if (v !== null && v !== undefined && out.indexOf(v) === -1) out.push(v);
    });
    return out;
  }

  // ------------------------------------------------------------------
  // 상태 박스 (로딩·에러·안내)
  // ------------------------------------------------------------------
  function showState(title, bodyHtml) {
    el.stateTitle.textContent = title;
    el.stateBody.innerHTML = bodyHtml || '';
    el.stateBox.hidden = false;
  }

  function hideState() {
    el.stateBox.hidden = true;
  }

  // ------------------------------------------------------------------
  // 데이터 로딩
  // ------------------------------------------------------------------
  function loadJson(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) {
        var err = new Error('HTTP ' + res.status);
        err.status = res.status;
        throw err;
      }
      return res.json();
    });
  }

  function looksValid(data) {
    return data && typeof data === 'object' && Array.isArray(data.listings);
  }

  function load() {
    // file:// 은 fetch 가 CORS 로 막힌다 → 시도하지 않고 방법을 안내한다
    if (window.location.protocol === 'file:') {
      showState(
        'file:// 로 열면 데이터를 읽을 수 없습니다',
        '<p>브라우저 보안 정책(CORS) 때문에 로컬 파일에서는 <code>fetch</code>가 차단됩니다. ' +
          '저장소 루트에서 아래 두 줄을 실행하고 주소로 접속하세요.</p>' +
          '<pre>node build.js\nnode tools/serve.js</pre>' +
          '<p>→ <code>http://localhost:8642/apps/yeouido-jeonse/</code></p>'
      );
      return;
    }

    var errors = [];
    var index = 0;

    function tryNext() {
      if (index >= SOURCES.length) {
        showNoData(errors);
        return;
      }
      var src = SOURCES[index++];
      loadJson(src.path).then(
        function (data) {
          if (!looksValid(data)) {
            errors.push(src.path + ': listings 배열이 없는 형식입니다');
            tryNext();
            return;
          }
          state.data = data;
          state.sourceLabel = src.label;
          state.isSample = data.is_sample === true;
          start();
        },
        function (e) {
          errors.push(src.path + ': ' + (e && e.message ? e.message : '읽기 실패'));
          tryNext();
        }
      );
    }

    tryNext();
  }

  function showNoData(errors) {
    var offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    var errorList =
      '<p>시도한 경로</p><ul>' +
      errors
        .map(function (e) {
          return '<li>' + escapeHtml(e) + '</li>';
        })
        .join('') +
      '</ul>';

    if (offline) {
      showState(
        '오프라인 상태입니다',
        '<p>네트워크가 끊겨 데이터 파일을 읽지 못했습니다. 연결을 확인하고 새로고침하세요.</p>' + errorList
      );
      return;
    }
    showState(
      '표시할 데이터가 없습니다',
      '<p>수집 데이터와 예시 데이터를 모두 읽지 못했습니다. 확인 순서:</p>' +
        '<ol>' +
        '<li>처음이라면 스펙 검증을 먼저 실행합니다: <code>node apps/yeouido-jeonse/collector/collect.js --verify</code></li>' +
        '<li>검증이 통과했다면 수집: <code>node apps/yeouido-jeonse/collector/collect.js</code></li>' +
        '<li>정적 서버로 열었는지 확인합니다: <code>node build.js</code> → <code>node tools/serve.js</code></li>' +
        '</ol>' +
        errorList
    );
  }

  // ------------------------------------------------------------------
  // 필터 상태 ↔ URL
  // ------------------------------------------------------------------
  function defaultFilters() {
    return {
      regions: [],
      types: [],
      depositMin: state.bounds.min,
      depositMax: state.bounds.max,
      areaMin: null,
      onlyNew: false,
      onlyDown: false,
      includeGone: false,
      sort: 'confirm-desc'
    };
  }

  function readFiltersFromUrl() {
    var f = defaultFilters();
    var q;
    try {
      q = new URLSearchParams(window.location.search);
    } catch (e) {
      return f;
    }
    function csv(name) {
      var v = q.get(name);
      return v ? v.split(',').filter(Boolean) : [];
    }
    function num(name) {
      var v = q.get(name);
      if (v === null || v === '') return null;
      var n = Number(v);
      return isFinite(n) ? n : null;
    }
    f.regions = csv('r');
    f.types = csv('t');
    var dmin = num('dmin');
    var dmax = num('dmax');
    if (dmin !== null) f.depositMin = clampDeposit(dmin);
    if (dmax !== null) f.depositMax = clampDeposit(dmax);
    if (f.depositMin > f.depositMax) {
      var tmp = f.depositMin;
      f.depositMin = f.depositMax;
      f.depositMax = tmp;
    }
    f.areaMin = num('amin');
    f.onlyNew = q.get('new') === '1';
    f.onlyDown = q.get('down') === '1';
    f.includeGone = q.get('gone') === '1';
    var sort = q.get('sort');
    if (sort && SORTS.indexOf(sort) !== -1) f.sort = sort;
    return f;
  }

  function clampDeposit(n) {
    return Math.min(state.bounds.max, Math.max(state.bounds.min, n));
  }

  function writeFiltersToUrl() {
    var f = state.filters;
    var q = new URLSearchParams();
    if (f.regions.length) q.set('r', f.regions.join(','));
    if (f.types.length) q.set('t', f.types.join(','));
    if (f.depositMin !== state.bounds.min) q.set('dmin', String(f.depositMin));
    if (f.depositMax !== state.bounds.max) q.set('dmax', String(f.depositMax));
    if (f.areaMin !== null) q.set('amin', String(f.areaMin));
    if (f.onlyNew) q.set('new', '1');
    if (f.onlyDown) q.set('down', '1');
    if (f.includeGone) q.set('gone', '1');
    if (f.sort !== 'confirm-desc') q.set('sort', f.sort);
    var qs = q.toString();
    var url = window.location.pathname + (qs ? '?' + qs : '');
    try {
      window.history.replaceState(null, '', url);
    } catch (e) {
      /* file:// 등에서 실패할 수 있다 — 기능에 영향 없음 */
    }
  }

  // ------------------------------------------------------------------
  // 헤더·배너
  // ------------------------------------------------------------------
  function renderHeader() {
    var d = state.data;
    var stats = d.stats || {};
    var criteria = d.criteria || {};
    var parts = ['마지막 수집: ' + formatDateTime(d.collectedAt)];
    parts.push('전체 ' + (typeof stats.total === 'number' ? stats.total : (d.listings || []).length) + '건');
    if (typeof criteria.depositMin === 'number' && typeof criteria.depositMax === 'number') {
      parts.push('수집 조건 ' + formatDeposit(criteria.depositMin) + ' ~ ' + formatDeposit(criteria.depositMax));
    }
    el.meta.textContent = parts.join(' · ');

    var chips = [];
    chips.push('🆕 신규 ' + (stats.new === null || stats.new === undefined ? '—' : stats.new));
    chips.push('💰 가격변동 ' + (stats.priceChanged || 0));
    chips.push('🚫 사라짐 ' + (stats.disappeared || 0));
    if (stats.errors) chips.push('⚠️ 실패 지역 ' + stats.errors);
    el.stat.innerHTML = chips
      .map(function (c) {
        return '<span>' + escapeHtml(c) + '</span>';
      })
      .join('');
    el.stat.hidden = false;
  }

  function renderBanners() {
    var d = state.data;
    var html = [];

    if (state.isSample) {
      html.push(
        '<div class="banner banner--sample"><strong>예시 데이터입니다.</strong> ' +
          '실재하는 매물이 아니라 화면 동작을 보여주기 위해 손으로 만든 가짜 데이터입니다. ' +
          '단지명은 모두 “예시/샘플”로 시작하고 원본 링크도 없습니다. ' +
          '실제 수집 결과는 공개 저장소에 커밋되지 않습니다.</div>'
      );
    }
    if (d.stats && d.stats.baselineCreated) {
      html.push(
        '<div class="banner banner--info">최초 실행으로 <strong>기준 스냅샷</strong>을 만들었습니다. ' +
          '신규·가격변동 판정은 다음 수집부터 표시됩니다.</div>'
      );
    }
    if (d.partialFailure || (d.stats && d.stats.errors)) {
      var failed = (d.regions || [])
        .filter(function (r) {
          return r && r.failed;
        })
        .map(function (r) {
          return r.name;
        });
      html.push(
        '<div class="banner banner--warn"><strong>마지막 수집에 일부 실패가 있었습니다.</strong> ' +
          (failed.length ? '실패 지역: ' + escapeHtml(failed.join(', ')) + '. ' : '') +
          '해당 지역 매물은 “사라짐”으로 판정하지 않았습니다. <code>run-logs/last-run.json</code>을 확인하세요.</div>'
      );
    }
    if (d.stats && d.stats.heldForFailure) {
      html.push(
        '<div class="banner banner--info">' + escapeHtml(String(d.stats.heldForFailure)) +
          '건은 수집 실패 지역의 매물이라 삭제 판정을 보류했습니다(최근 확인 시각이 오래되었을 수 있습니다).</div>'
      );
    }
    html.push('<div class="banner banner--info">데이터 출처: ' + escapeHtml(state.sourceLabel) + '</div>');

    el.banners.innerHTML = html.join('');
  }

  // ------------------------------------------------------------------
  // 필터 UI 구성
  // ------------------------------------------------------------------
  function chipHtml(label, value, pressed, kind) {
    return (
      '<button type="button" class="chip" data-kind="' + kind + '" data-value="' + escapeHtml(value) +
      '" aria-pressed="' + (pressed ? 'true' : 'false') + '">' + escapeHtml(label) + '</button>'
    );
  }

  function buildFilterUi() {
    var listings = state.data.listings || [];
    var f = state.filters;

    // 지역 칩 — 매물 수를 함께 보여준다
    var regionNames = uniq(
      listings.map(function (l) {
        return l.regionName || l.regionCode || null;
      })
    ).sort();
    var counts = {};
    listings.forEach(function (l) {
      var key = l.regionName || l.regionCode;
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    var regionHtml = [chipHtml('전체', '', f.regions.length === 0, 'region-all')];
    regionNames.forEach(function (name) {
      regionHtml.push(chipHtml(name + ' ' + (counts[name] || 0), name, f.regions.indexOf(name) !== -1, 'region'));
    });
    el.regionChips.innerHTML = regionHtml.join('');

    // 종류 칩
    var typeNames = uniq(
      listings.map(function (l) {
        return l.typeName;
      })
    ).sort();
    var typeHtml = [chipHtml('전체', '', f.types.length === 0, 'type-all')];
    typeNames.forEach(function (name) {
      var icon = name === '오피스텔' ? '🏢 ' : name === '아파트' ? '🏬 ' : '';
      typeHtml.push(chipHtml(icon + name, name, f.types.indexOf(name) !== -1, 'type'));
    });
    el.typeChips.innerHTML = typeHtml.join('');

    // 보증금 프리셋 (모바일에서 슬라이더 조작이 어려운 것을 보완)
    el.depositPresets.innerHTML = DEPOSIT_PRESETS.map(function (p) {
      var pressed =
        p.min === null
          ? f.depositMin === state.bounds.min && f.depositMax === state.bounds.max
          : f.depositMin === p.min && f.depositMax === p.max;
      return chipHtml(p.label, p.key, pressed, 'deposit-preset');
    }).join('');

    // 토글 칩
    el.toggleChips.innerHTML = [
      chipHtml('🆕 신규만', 'onlyNew', f.onlyNew, 'toggle'),
      chipHtml('💰 가격내림만', 'onlyDown', f.onlyDown, 'toggle'),
      chipHtml('🚫 사라진 매물 포함', 'includeGone', f.includeGone, 'toggle')
    ].join('');

    // 슬라이더
    el.depositMin.min = String(state.bounds.min);
    el.depositMin.max = String(state.bounds.max);
    el.depositMax.min = String(state.bounds.min);
    el.depositMax.max = String(state.bounds.max);
    el.depositMin.value = String(f.depositMin);
    el.depositMax.value = String(f.depositMax);
    el.depositMinOut.textContent = formatDeposit(f.depositMin);
    el.depositMaxOut.textContent = formatDeposit(f.depositMax);

    el.areaMin.value = f.areaMin === null ? '' : String(f.areaMin);
    el.sort.value = f.sort;
    el.filters.hidden = false;
  }

  // ------------------------------------------------------------------
  // 필터·정렬 적용
  // ------------------------------------------------------------------
  function applyFilters() {
    var f = state.filters;
    var listings = (state.data.listings || []).slice();

    var filtered = listings.filter(function (l) {
      var gone = l.status === 'disappeared';
      if (gone && !f.includeGone) return false;
      if (f.regions.length) {
        var key = l.regionName || l.regionCode;
        if (f.regions.indexOf(key) === -1) return false;
      }
      if (f.types.length && f.types.indexOf(l.typeName) === -1) return false;
      if (typeof l.deposit === 'number') {
        if (l.deposit < f.depositMin || l.deposit > f.depositMax) return false;
      }
      if (f.areaMin !== null) {
        // 면적을 모르는 매물은 "면적 조건"에서 제외한다(모르는 것을 통과시키면 조건이 무의미해진다)
        if (typeof l.areaExclusiveM2 !== 'number' || l.areaExclusiveM2 < f.areaMin) return false;
      }
      if (f.onlyNew && l.isNew !== true) return false;
      if (f.onlyDown && !(l.priceChange && l.priceChange.direction === 'down')) return false;
      return true;
    });

    filtered.sort(makeComparator(f.sort));
    return filtered;
  }

  function makeComparator(sort) {
    function nullsLast(a, b, get) {
      var va = get(a);
      var vb = get(b);
      var na = va === null || va === undefined;
      var nb = vb === null || vb === undefined;
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      return null; // 비교는 호출자가 한다
    }
    return function (a, b) {
      var pre;
      if (sort === 'deposit-asc' || sort === 'deposit-desc') {
        pre = nullsLast(a, b, function (x) {
          return typeof x.deposit === 'number' ? x.deposit : null;
        });
        if (pre !== null) return pre;
        return sort === 'deposit-asc' ? a.deposit - b.deposit : b.deposit - a.deposit;
      }
      if (sort === 'area-desc') {
        pre = nullsLast(a, b, function (x) {
          return typeof x.areaExclusiveM2 === 'number' ? x.areaExclusiveM2 : null;
        });
        if (pre !== null) return pre;
        return b.areaExclusiveM2 - a.areaExclusiveM2;
      }
      if (sort === 'first-desc') {
        pre = nullsLast(a, b, function (x) {
          return x.firstSeenAt || null;
        });
        if (pre !== null) return pre;
        return String(b.firstSeenAt).localeCompare(String(a.firstSeenAt));
      }
      // 기본: 확인일 최신순
      pre = nullsLast(a, b, function (x) {
        return x.confirmedDate || null;
      });
      if (pre !== null) return pre;
      return String(b.confirmedDate).localeCompare(String(a.confirmedDate));
    };
  }

  // ------------------------------------------------------------------
  // 카드 렌더
  // ------------------------------------------------------------------
  function badgesHtml(l) {
    var out = [];
    if (l.isNew === true) out.push('<span class="badge badge--new">🆕 신규</span>');
    if (l.priceChange && l.priceChange.direction === 'down') {
      out.push(
        '<span class="badge badge--down">💰 ' + escapeHtml(formatEok(l.priceChange.from)) + ' → ' +
          escapeHtml(formatEok(l.priceChange.to)) + '</span>'
      );
    }
    if (l.priceChange && l.priceChange.direction === 'up') {
      out.push(
        '<span class="badge badge--up">📈 ' + escapeHtml(formatEok(l.priceChange.from)) + ' → ' +
          escapeHtml(formatEok(l.priceChange.to)) + '</span>'
      );
    }
    if (l.status === 'disappeared') out.push('<span class="badge badge--gone">🚫 사라짐</span>');
    if (l.heldDueToFailure) out.push('<span class="badge badge--held">⚠️ 확인 보류</span>');
    if (l.unitSuspect) out.push('<span class="badge badge--held">⚠️ 금액 확인 필요</span>');
    return out.length ? '<div class="badges">' + out.join('') + '</div>' : '';
  }

  function specLine(l) {
    var parts = [];
    if (typeof l.areaExclusiveM2 === 'number') {
      parts.push(
        '전용 ' + l.areaExclusiveM2 + '㎡' +
          (typeof l.areaExclusivePyeong === 'number' ? ' (' + l.areaExclusivePyeong + '평)' : '')
      );
    } else {
      parts.push('전용면적 미확인');
    }
    if (l.floor) parts.push(l.floor + '층');
    if (l.direction) parts.push(l.direction);
    if (l.buildingName) parts.push(l.buildingName);
    return parts.join(' · ');
  }

  function whereLine(l) {
    var parts = [];
    parts.push(l.regionName || l.regionCode || '지역 미확인');
    parts.push(l.confirmedDate ? '확인 ' + l.confirmedDate : '확인일 미확인');
    if (typeof l.sameAddrCnt === 'number' && l.sameAddrCnt > 1) parts.push('동일주소 ' + l.sameAddrCnt + '건');
    return parts.join(' · ');
  }

  function cardHtml(l) {
    var gone = l.status === 'disappeared';
    var typeIcon = l.typeName === '오피스텔' ? '🏢' : l.typeName === '아파트' ? '🏬' : '·';
    var link = l.sourceUrl
      ? '<a class="source-link" href="' + escapeHtml(l.sourceUrl) + '" target="_blank" rel="noopener noreferrer">네이버에서 보기 ↗</a>'
      : '<span class="source-none">원본 링크 없음(예시 데이터)</span>';

    return (
      '<article class="card' + (gone ? ' card--gone' : '') + '">' +
      '<div class="card-top">' +
      '<h2 class="card-name">' + escapeHtml(l.name || '이름 미확인') + '</h2>' +
      '<span class="card-type">' + typeIcon + ' ' + escapeHtml(l.typeName || '종류 미확인') +
      (l.tradeType ? ' · ' + escapeHtml(l.tradeType) : '') + '</span>' +
      '</div>' +
      badgesHtml(l) +
      '<p class="card-price">' + escapeHtml(l.depositText || formatDeposit(l.deposit)) +
      (typeof l.deposit === 'number' ? '<span class="price-sub">' + l.deposit.toLocaleString('ko-KR') + '만원</span>' : '') +
      '</p>' +
      '<p class="card-spec">' + escapeHtml(specLine(l)) + '</p>' +
      '<p class="card-where">' + escapeHtml(whereLine(l)) + '</p>' +
      (l.featureDesc ? '<p class="card-desc">' + escapeHtml(l.featureDesc) + '</p>' : '') +
      (l.tags && l.tags.length
        ? '<ul class="card-tags">' +
          l.tags
            .map(function (t) {
              return '<li>' + escapeHtml(t) + '</li>';
            })
            .join('') +
          '</ul>'
        : '') +
      '<div class="card-bottom">' +
      '<span class="card-realtor">' + escapeHtml(l.realtorName || '중개사무소 미확인') +
      (l.providerName ? ' · ' + escapeHtml(l.providerName) : '') + '</span>' +
      link +
      '</div>' +
      '</article>'
    );
  }

  function render() {
    var list = applyFilters();
    var total = (state.data.listings || []).length;

    el.resultCount.hidden = false;
    el.resultCount.textContent = '표시 ' + list.length + '건 / 전체 ' + total + '건';

    if (!list.length) {
      el.listings.innerHTML = '';
      if (total === 0) {
        showState(
          '수집된 매물이 0건입니다',
          '<p>조건에 맞는 매물이 없을 수 있습니다(0건은 오류가 아닙니다). ' +
            '<code>collector/config.json</code>의 보증금 범위나 지역을 넓혀 보세요.</p>'
        );
      } else {
        showState(
          '조건에 맞는 매물이 없습니다',
          '<p>필터를 넓히거나 초기화해 보세요.</p>' +
            '<button type="button" class="state-btn" id="state-reset">필터 초기화</button>'
        );
        var btn = document.getElementById('state-reset');
        if (btn) btn.addEventListener('click', resetFilters);
      }
      return;
    }

    hideState();
    el.listings.innerHTML = list.map(cardHtml).join('');
  }

  // ------------------------------------------------------------------
  // 이벤트
  // ------------------------------------------------------------------
  function toggleInArray(arr, value) {
    var i = arr.indexOf(value);
    if (i === -1) arr.push(value);
    else arr.splice(i, 1);
  }

  function onChipClick(e) {
    var btn = e.target.closest ? e.target.closest('.chip') : null;
    if (!btn) return;
    var kind = btn.getAttribute('data-kind');
    var value = btn.getAttribute('data-value');
    var f = state.filters;

    if (kind === 'region-all') f.regions = [];
    else if (kind === 'region') toggleInArray(f.regions, value);
    else if (kind === 'type-all') f.types = [];
    else if (kind === 'type') toggleInArray(f.types, value);
    else if (kind === 'deposit-preset') {
      var preset = DEPOSIT_PRESETS.filter(function (p) {
        return p.key === value;
      })[0];
      if (preset) {
        f.depositMin = preset.min === null ? state.bounds.min : clampDeposit(preset.min);
        f.depositMax = preset.max === null ? state.bounds.max : clampDeposit(preset.max);
      }
    } else if (kind === 'toggle') {
      f[value] = !f[value];
    } else {
      return;
    }
    afterFilterChange();
  }

  function onRangeInput() {
    var f = state.filters;
    var minV = Number(el.depositMin.value);
    var maxV = Number(el.depositMax.value);
    // 두 슬라이더가 교차하면 서로를 밀어낸다
    if (minV > maxV) {
      if (this === el.depositMin) maxV = minV;
      else minV = maxV;
    }
    f.depositMin = minV;
    f.depositMax = maxV;
    el.depositMin.value = String(minV);
    el.depositMax.value = String(maxV);
    el.depositMinOut.textContent = formatDeposit(minV);
    el.depositMaxOut.textContent = formatDeposit(maxV);
    afterFilterChange();
  }

  function afterFilterChange() {
    buildFilterUi();
    writeFiltersToUrl();
    render();
  }

  function resetFilters() {
    state.filters = defaultFilters();
    afterFilterChange();
  }

  function bindEvents() {
    [el.regionChips, el.typeChips, el.depositPresets, el.toggleChips].forEach(function (box) {
      box.addEventListener('click', onChipClick);
    });
    el.depositMin.addEventListener('input', onRangeInput);
    el.depositMax.addEventListener('input', onRangeInput);
    el.areaMin.addEventListener('change', function () {
      state.filters.areaMin = el.areaMin.value === '' ? null : Number(el.areaMin.value);
      afterFilterChange();
    });
    el.sort.addEventListener('change', function () {
      state.filters.sort = el.sort.value;
      afterFilterChange();
    });
    el.resetBtn.addEventListener('click', resetFilters);
  }

  // ------------------------------------------------------------------
  // 시작
  // ------------------------------------------------------------------
  function computeBounds() {
    var deposits = (state.data.listings || [])
      .map(function (l) {
        return typeof l.deposit === 'number' ? l.deposit : null;
      })
      .filter(function (v) {
        return v !== null;
      });
    if (!deposits.length) {
      state.bounds = { min: 0, max: 100000 };
      return;
    }
    var min = roundDown(Math.min.apply(null, deposits), 1000);
    var max = roundUp(Math.max.apply(null, deposits), 1000);
    if (min === max) max = min + 1000; // 슬라이더가 0폭이 되지 않게
    state.bounds = { min: min, max: max };
  }

  function start() {
    computeBounds();
    state.filters = readFiltersFromUrl();
    renderHeader();
    renderBanners();
    buildFilterUi();
    bindEvents();
    writeFiltersToUrl();
    render();
  }

  load();
})();
