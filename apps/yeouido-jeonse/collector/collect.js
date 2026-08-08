#!/usr/bin/env node
/* collect.js — 여의도 전세 매물 수집기 엔트리
   사용법
     node collector/collect.js            평소 수집 (1일 2회 스케줄러가 호출)
     node collector/collect.js --verify   ★ 처음 한 번은 반드시 이것부터. 스펙 라이브 검증 (요청 8회 이하)
     node collector/collect.js --dry-run  네트워크를 전혀 타지 않고 보낼 요청 URL만 출력
     node collector/collect.js --help

   ⚠️ 정직한 고지
   이 코드는 *.naver.com 이 차단된 환경(게이트웨이 403)에서 작성되었다.
   따라서 네이버 응답으로 확인된 것이 하나도 없고, "스펙이 맞다면 동작한다" 상태다.
   --verify 가 그 간극을 메우기 위한 명령이며, 실행 결과를 상위 세션에 보고해야 한다.

   의존성 0 — Node 18+ 내장 모듈과 전역 fetch만 사용한다. */
'use strict';

var fs = require('node:fs');
var path = require('node:path');
var process = require('node:process');

var client = require('./naver-client.js');
var regionsMod = require('./regions.js');
var normalizeMod = require('./normalize.js');
var diffMod = require('./diff.js');

// ------------------------------------------------------------------
// 경로
// ------------------------------------------------------------------
var COLLECTOR_DIR = __dirname;
var APP_DIR = path.join(COLLECTOR_DIR, '..');
var DATA_DIR = path.join(APP_DIR, 'data');
var RUN_LOGS_DIR = path.join(APP_DIR, 'run-logs');
var CONFIG_PATH = path.join(COLLECTOR_DIR, 'config.json');
var LISTINGS_PATH = path.join(DATA_DIR, 'listings.json');
var HISTORY_PATH = path.join(DATA_DIR, 'history.json');
var REGION_CACHE_PATH = path.join(DATA_DIR, 'regions.cache.json');
var LAST_RUN_PATH = path.join(RUN_LOGS_DIR, 'last-run.json');
var VERIFICATION_PATH = path.join(RUN_LOGS_DIR, 'verification.json');
var RAW_SAMPLE_PATH = path.join(RUN_LOGS_DIR, 'last-raw-sample.json');

var SCHEMA_VERSION = 1;
var VERIFY_REQUEST_BUDGET = 8;      // V모드 총 요청 상한 (지침)
var SPEC_YEOUIDO_CORTAR_NO = '1156011000'; // spec 2.4의 [추정] 값 — 검증 대상
var SCHEMA_CHANGE_THRESHOLD = 0.3;  // 필수 필드 누락률·단위 불일치율 상한

// ------------------------------------------------------------------
// 로그
// ------------------------------------------------------------------
function log(msg) {
  process.stdout.write(client.maskSecrets(String(msg)) + '\n');
}
function warn(msg) {
  process.stdout.write('  [경고] ' + client.maskSecrets(String(msg)) + '\n');
}
function line() {
  log('------------------------------------------------------------');
}

// ------------------------------------------------------------------
// 파일 입출력 (원자적 저장)
// ------------------------------------------------------------------
function readJsonOrNull(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    warn(path.basename(file) + ' 을 읽을 수 없다: ' + e.message);
    return null;
  }
}

/** 임시 파일에 쓰고 rename — 중간에 죽어도 기존 파일이 깨지지 않는다 */
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// ------------------------------------------------------------------
// 설정
// ------------------------------------------------------------------
function loadConfig() {
  var raw = readJsonOrNull(CONFIG_PATH);
  if (!raw) {
    throw client.ApiError('parse', 'config.json 을 읽을 수 없다: ' + CONFIG_PATH);
  }
  var cfg = {
    regions: raw.regions || {},
    criteria: Object.assign(
      {
        tradeType: ['B1'],
        realEstateType: ['APT', 'OPST'],
        depositMin: 40000,
        depositMax: 70000,
        areaMinM2: null,
        areaMaxM2: null,
        excludeNonResidentialOfficetel: true,
        officetelMinExclusiveM2: 30,
        selfFilterDeposit: true
      },
      raw.criteria || {}
    ),
    politeness: raw.politeness || {},
    map: Object.assign({ zoom: 13, bboxDeltaLat: 0.012, bboxDeltaLon: 0.02 }, raw.map || {}),
    output: Object.assign({ historyMaxSnapshots: 60, keepDisappearedDays: 14 }, raw.output || {})
  };

  // 환경변수 오버라이드 (스케줄러에서 편리)
  var envNotes = [];
  function numEnv(name, apply) {
    var v = process.env[name];
    if (v === undefined || v === '') return;
    var n = Number(v);
    if (!isFinite(n)) {
      envNotes.push(name + '=' + v + ' 은 숫자가 아니라 무시했다');
      return;
    }
    apply(n);
    envNotes.push(name + '=' + n + ' 적용');
  }
  numEnv('YJ_DEPOSIT_MIN', function (n) {
    cfg.criteria.depositMin = n;
  });
  numEnv('YJ_DEPOSIT_MAX', function (n) {
    cfg.criteria.depositMax = n;
  });
  numEnv('YJ_MAX_PAGES', function (n) {
    cfg.politeness.maxPagesPerRegion = n;
  });
  numEnv('YJ_DELAY_MS', function (n) {
    cfg.politeness.delayMsBetweenRequests = n;
  });

  // 조건 정합성 검증 — 조용히 엉뚱한 조건으로 수집하지 않게
  var problems = [];
  if (!Array.isArray(cfg.criteria.tradeType) || !cfg.criteria.tradeType.length) {
    problems.push('criteria.tradeType 이 비어 있다');
  }
  if (!Array.isArray(cfg.criteria.realEstateType) || !cfg.criteria.realEstateType.length) {
    problems.push('criteria.realEstateType 이 비어 있다');
  }
  if (typeof cfg.criteria.depositMin === 'number' && typeof cfg.criteria.depositMax === 'number') {
    if (cfg.criteria.depositMin > cfg.criteria.depositMax) {
      problems.push('depositMin(' + cfg.criteria.depositMin + ') > depositMax(' + cfg.criteria.depositMax + ')');
    }
    if (cfg.criteria.depositMax > 500000) {
      problems.push(
        'depositMax=' + cfg.criteria.depositMax + ' — 단위는 만원이다. 7억은 70000이며 700000000이 아니다'
      );
    }
  }
  (cfg.criteria.realEstateType || []).forEach(function (code) {
    if (!normalizeMod.REQUEST_TYPE_CODE_NAMES[code]) {
      problems.push('알 수 없는 realEstateType 코드: ' + code + ' (APT/OPST 등 요청용 코드를 쓴다)');
    }
  });
  (cfg.criteria.tradeType || []).forEach(function (code) {
    if (!normalizeMod.TRADE_CODE_NAMES[code]) {
      problems.push('알 수 없는 tradeType 코드: ' + code + ' (전세는 B1)');
    }
  });
  if (problems.length) {
    throw client.ApiError('parse', 'config.json 설정 오류\n  - ' + problems.join('\n  - '));
  }

  var clamped = client.clampPoliteness(cfg.politeness);
  return { config: cfg, politeness: clamped.values, clampWarnings: clamped.warnings, envNotes: envNotes };
}

// ------------------------------------------------------------------
// 공통: 지역별 요청 파라미터 조립
// ------------------------------------------------------------------
function articleListParams(cfg, region, page, withDepositFilter) {
  return {
    cortarNo: region.cortarNo,
    centerLat: region.centerLat,
    centerLon: region.centerLon,
    zoom: cfg.map.zoom,
    dLat: cfg.map.bboxDeltaLat,
    dLon: cfg.map.bboxDeltaLon,
    page: page,
    tradeType: cfg.criteria.tradeType,
    realEstateType: cfg.criteria.realEstateType,
    depositMin: cfg.criteria.depositMin,
    depositMax: cfg.criteria.depositMax,
    areaMinM2: cfg.criteria.areaMinM2,
    areaMaxM2: cfg.criteria.areaMaxM2,
    withDepositFilter: withDepositFilter !== false
  };
}

// ==================================================================
// 모드 1: --dry-run  (네트워크 접촉 0)
// ==================================================================
async function runDryRun(loaded) {
  var cfg = loaded.config;
  var politeness = loaded.politeness;

  log('=== dry-run — 네트워크 요청을 전혀 보내지 않는다 ===');
  line();
  log('설정: ' + CONFIG_PATH);
  loaded.envNotes.forEach(function (n) {
    log('  환경변수 ' + n);
  });
  loaded.clampWarnings.forEach(warn);
  log(
    '조건: ' +
      cfg.criteria.tradeType.join(',') +
      ' / ' +
      cfg.criteria.realEstateType.join(',') +
      ' / 보증금 ' +
      cfg.criteria.depositMin +
      '~' +
      cfg.criteria.depositMax +
      '만원'
  );
  log(
    '상한: 지역당 ' +
      politeness.maxPagesPerRegion +
      '페이지, 대상 코드 ' +
      politeness.maxRegionCodes +
      '개, 총 ' +
      politeness.maxRequestsPerRun +
      '요청, 요청 간격 ' +
      politeness.delayMsBetweenRequests +
      'ms(+지터 ' +
      politeness.delayJitterMs +
      'ms)'
  );
  line();

  // 1) 지역 해석 요청 (캐시가 있으면 실제로는 생략된다)
  var manual = (cfg.regions.manual || []).length > 0;
  var cache = regionsMod.loadCache(REGION_CACHE_PATH, function () {});
  log('[1] 지역 해석 (regions/list 드릴다운)');
  if (manual) {
    log('  · config.regions.manual 이 설정되어 있어 regions/list 를 호출하지 않는다');
  } else if (cache) {
    log('  · 지역 캐시가 있으므로 (TTL 내라면) 요청 0회');
    log('    캐시: ' + REGION_CACHE_PATH + ' (조회 ' + cache.fetchedAt + ')');
  } else {
    log('  · 캐시가 없으므로 아래 요청이 발생한다');
  }
  if (!manual) {
    var regionListBase = client.PC_ORIGIN + client.REGION_LIST_PATH + '?cortarNo=';
    log('  GET ' + client.buildRegionListUrl(regionsMod.ROOT_CORTAR_NO) + '   ← 시도 목록');
    log('  GET ' + regionListBase + '{' + cfg.regions.sido + ' 코드}   ← 구 목록');
    var guNames = [];
    (cfg.regions.include || []).forEach(function (e) {
      if (e && e.gu && guNames.indexOf(e.gu) === -1) guNames.push(e.gu);
    });
    guNames.forEach(function (gu) {
      log('  GET ' + regionListBase + '{' + gu + ' 코드}   ← ' + gu + ' 법정동 목록');
    });
  }
  line();

  // 2) 매물 목록 요청
  log('[2] 매물 목록 (m.land.naver.com/cluster/ajax/articleList)');
  var regions = [];
  if (manual) {
    regions = (cfg.regions.manual || []).map(function (m) {
      return {
        cortarNo: m.cortarNo,
        name: m.name,
        gu: m.gu,
        centerLat: m.centerLat,
        centerLon: m.centerLon
      };
    });
  } else if (cache) {
    try {
      var picked = await regionsMod.resolveRegions({
        client: null,
        config: cfg,
        cachePath: REGION_CACHE_PATH,
        log: function () {},
        allowNetwork: false,
        maxRegionCodes: politeness.maxRegionCodes
      });
      regions = picked.regions;
      picked.warnings.forEach(warn);
    } catch (e) {
      warn('캐시에서 지역을 해석하지 못했다: ' + e.message);
    }
  }

  if (!regions.length) {
    log('  · 실제 cortarNo·중심좌표를 아직 모른다(캐시 없음) → 자리표시자로 URL 형태만 보여준다');
    regions = (cfg.regions.include || []).map(function (e) {
      return {
        cortarNo: '{' + e.dong + ' cortarNo}',
        name: e.dong + '(및 하위 법정동)',
        gu: e.gu,
        centerLat: 37.5225,
        centerLon: 126.9245,
        placeholder: true
      };
    });
  }

  var planned = 0;
  regions.forEach(function (r) {
    var url = client.buildArticleListUrl(articleListParams(cfg, r, 1, true));
    if (r.placeholder) {
      url = url.replace(/lat=[\d.]+/, 'lat={centerLat}').replace(/lon=[\d.]+/, 'lon={centerLon}');
      url = url.replace(/btm=[-\d.]+/, 'btm={centerLat-dLat}').replace(/top=[-\d.]+/, 'top={centerLat+dLat}');
      url = url.replace(/lft=[-\d.]+/, 'lft={centerLon-dLon}').replace(/rgt=[-\d.]+/, 'rgt={centerLon+dLon}');
      // 자리표시자는 URL 인코딩된 상태로 보여주면 읽기 어렵다
      url = url.replace(/cortarNo=[^&]*/, 'cortarNo={' + r.name.replace(/\(.*\)/, '') + ' cortarNo}');
    }
    log('  ' + r.name + (r.gu ? ' (' + r.gu + ')' : '') + ' — page 1');
    log('  GET ' + url);
    log(
      '    · more=true 이면 page 2..' +
        politeness.maxPagesPerRegion +
        ' 까지 같은 URL의 page 만 바꿔 반복 (최대 ' +
        politeness.maxPagesPerRegion +
        '회)'
    );
    planned += politeness.maxPagesPerRegion;
  });
  line();
  log('예상 최대 요청 수: 지역 ' + regions.length + '개 × 페이지 ' + politeness.maxPagesPerRegion + ' = ' + planned + '회');
  log('             (하드 컷 ' + politeness.maxRequestsPerRun + '회에서 중단)');
  log(
    '예상 소요 시간: 약 ' +
      Math.round(
        (Math.min(planned, politeness.maxRequestsPerRun) *
          (politeness.delayMsBetweenRequests + politeness.delayJitterMs / 2)) /
          1000
      ) +
      '초'
  );
  line();
  log('dry-run 종료 — 네트워크 요청 0회. 실제 동작 확인은 --verify 로 하세요.');
  return 0;
}

// ==================================================================
// 모드 2: --verify  (라이브 검증. 요청 8회 이하, 실패 시 즉시 중단)
// ==================================================================

/** robots.txt 를 파싱해 특정 경로가 User-agent:* 에게 금지되었는지 본다 */
function robotsBlocks(robotsText, targetPath) {
  var lines = String(robotsText).split(/\r?\n/);
  var inStar = false;
  var disallow = [];
  var allow = [];
  lines.forEach(function (rawLine) {
    var l = rawLine.replace(/#.*$/, '').trim();
    if (!l) return;
    var m = l.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) return;
    var key = m[1].toLowerCase();
    var value = m[2].trim();
    if (key === 'user-agent') {
      inStar = value === '*';
      return;
    }
    if (!inStar) return;
    if (key === 'disallow' && value !== '') disallow.push(value);
    if (key === 'allow' && value !== '') allow.push(value);
  });
  function longestMatch(rules) {
    var best = -1;
    rules.forEach(function (r) {
      if (targetPath.indexOf(r) === 0 && r.length > best) best = r.length;
    });
    return best;
  }
  var d = longestMatch(disallow);
  var a = longestMatch(allow);
  return {
    blocked: d >= 0 && d > a,
    disallowRules: disallow,
    allowRules: allow
  };
}

function fmtCheck(c) {
  var pad = c.result + '     '.slice(0, Math.max(0, 5 - c.result.length));
  return '  ' + c.id + '  ' + pad + '  ' + c.title + (c.detail ? '\n          ↳ ' + c.detail : '');
}

async function runVerify(loaded) {
  var cfg = loaded.config;
  // 검증은 재시도하지 않는다(실패하면 파라미터를 바꿔가며 두드리지 않는다)
  var politeness = Object.assign({}, loaded.politeness, {
    maxRequestsPerRun: VERIFY_REQUEST_BUDGET,
    maxRetries: 0
  });
  var c = client.createClient({ politeness: politeness, log: function () {} });

  var checks = [
    { id: 'V7', title: 'm.land.naver.com/robots.txt 가 목록 경로를 허용하는가', result: 'SKIP', detail: '' },
    { id: 'V3', title: 'regions/list 가 Authorization 없이 동작하는가 + 여의도동 cortarNo', result: 'SKIP', detail: '' },
    { id: 'V1', title: '모바일 articleList 가 UA+Referer 만으로 200을 주는가', result: 'SKIP', detail: '' },
    { id: 'V4', title: '페이지당 건수와 more 플래그 동작', result: 'SKIP', detail: '' },
    { id: 'V2', title: 'wprcMin/wprcMax 가 보증금을 만원 단위로 필터하는가', result: 'SKIP', detail: '' },
    { id: 'V5', title: '응답이 대상 cortarNo 로 제한되는가', result: 'SKIP', detail: '' },
    { id: 'V8', title: 'zoom/bbox 가 대상 동을 덮는가', result: 'SKIP', detail: '' },
    { id: 'V6', title: '429 발생 임계 탐색', result: 'SKIP', detail: '의도적으로 수행하지 않는다 — 임계를 찾으려면 일부러 차단을 유발해야 한다' }
  ];
  function set(id, result, detail) {
    checks.forEach(function (ch) {
      if (ch.id === id) {
        ch.result = result;
        ch.detail = detail || '';
      }
    });
  }
  function get(id) {
    return checks.filter(function (ch) {
      return ch.id === id;
    })[0];
  }

  var record = {
    at: new Date().toISOString(),
    note:
      '이 파일은 --verify 실행 결과다. 이 코드는 naver.com 이 차단된 환경에서 작성되어 라이브 검증 없이 만들어졌으므로, ' +
      '아래 결과가 실제 스펙의 유일한 근거다.',
    requestBudget: VERIFY_REQUEST_BUDGET,
    requestsUsed: 0,
    checks: [],
    firstItemSample: null,
    fatal: null
  };

  log('=== --verify — 스펙 라이브 검증 (요청 ' + VERIFY_REQUEST_BUDGET + '회 이하, 재시도 없음) ===');
  log('실패하면 파라미터를 바꿔가며 재시도하지 않고 즉시 멈춥니다.');
  line();

  var targetRegion = null;
  var fatal = null;
  var currentStep = 'V7'; // 예외가 났을 때 어느 항목에서 멈췄는지 표시하기 위해

  try {
    // ---------- V7: robots.txt ----------
    currentStep = 'V7';
    log('[V7] robots.txt 확인 …');
    var robots = null;
    try {
      robots = await c.get(client.ROBOTS_URL, { label: 'robots.txt', expect: 'text' });
    } catch (eRobots) {
      var rStatus = (eRobots && eRobots.status) || null;
      // 403/429 는 "네이버가 우리를 거부했다"는 신호다 → 물러난다.
      if (rStatus === 403 || rStatus === 429) throw eRobots;
      // 404 등 "파일이 없다"는 응답은 차단이 아니다.
      // robots.txt 표준(RFC 9309)에서 robots.txt 부재는 "제한 없음"으로 해석한다.
      if (rStatus && rStatus >= 400 && rStatus < 500) {
        record.robots = { missing: true, status: rStatus, targetPath: client.ARTICLE_LIST_PATH };
        set(
          'V7',
          'PASS',
          'robots.txt 가 없다 (HTTP ' + rStatus + ') → 이 호스트에 공표된 크롤링 제한 규칙이 없다는 뜻이다. ' +
            'RFC 9309 에 따라 "제한 없음"으로 해석하고 계속한다.'
        );
        log('  · robots.txt 없음 (HTTP ' + rStatus + ') — 공표된 제한 규칙이 없다는 뜻이다. 계속한다.');
        log('    (수집 상한·지연은 robots.txt 와 무관하게 그대로 적용된다)');
      } else {
        // 5xx·네트워크 오류는 "확인 실패"다. 차단으로 단정하지 않고, 확인불가로 남기고 계속한다.
        record.robots = {
          unknown: true,
          status: rStatus,
          error: client.maskSecrets((eRobots && eRobots.message) || String(eRobots)),
          targetPath: client.ARTICLE_LIST_PATH
        };
        set('V7', 'SKIP', 'robots.txt 를 확인할 수 없었다 (' + (rStatus || '네트워크 오류') + ') — 나중에 다시 확인할 것');
        log('  · robots.txt 확인 실패 (' + (rStatus || '네트워크 오류') + ') — 확인불가로 남기고 계속한다.');
      }
    }

    if (robots) {
    var verdict = robotsBlocks(robots.text, client.ARTICLE_LIST_PATH);
    record.robots = {
      disallowRules: verdict.disallowRules,
      allowRules: verdict.allowRules,
      targetPath: client.ARTICLE_LIST_PATH
    };
    if (verdict.blocked) {
      set('V7', 'FAIL', 'Disallow 규칙이 ' + client.ARTICLE_LIST_PATH + ' 를 금지한다: ' + verdict.disallowRules.join(' , '));
      log('');
      log('************************************************************');
      log('*  중단: robots.txt 가 매물 목록 경로를 금지하고 있습니다.  *');
      log('*  이후 검증을 진행하지 않습니다.                          *');
      log('*  spec 9.4 에 따라 수집을 진행하지 말고 사용자에게 보고해야 합니다. *');
      log('************************************************************');
      log('');
      fatal = 'robots.txt 금지 — 수집 중단';
      throw client.ApiError('blocked', fatal, { robots: true });
    }
    set('V7', 'PASS', 'User-agent:* 의 Disallow 중 목록 경로에 걸리는 규칙 없음 (규칙 ' + verdict.disallowRules.length + '개 확인)');
    }

    // ---------- V3: regions/list ----------
    currentStep = 'V3';
    log('[V3] regions/list 드릴다운 (시도 → 구 → 동) …');
    var sidoName = cfg.regions.sido || '서울특별시';
    var rootRes = await c.get(client.buildRegionListUrl(regionsMod.ROOT_CORTAR_NO), { label: 'regions/list 시도' });
    var sidoList = regionsMod.extractRegionList(rootRes.json, 'regions/list(시도)');
    var sido = regionsMod.findExact(sidoList, sidoName);
    if (!sido) {
      set('V3', 'FAIL', '시도 목록에 "' + sidoName + '" 이 없다. 받은 이름: ' + sidoList.slice(0, 15).map(function (r) { return r.cortarName; }).join(', '));
      throw client.ApiError('parse', 'regions/list 응답에서 시도를 찾지 못했다');
    }
    var guRes = await c.get(client.buildRegionListUrl(sido.cortarNo), { label: 'regions/list 구' });
    var guList = regionsMod.extractRegionList(guRes.json, 'regions/list(구)');
    var gu = regionsMod.findExact(guList, '영등포구');
    if (!gu) {
      set('V3', 'FAIL', sidoName + ' 안에 "영등포구" 가 없다');
      throw client.ApiError('parse', 'regions/list 응답에서 영등포구를 찾지 못했다');
    }
    var dongRes = await c.get(client.buildRegionListUrl(gu.cortarNo), { label: 'regions/list 법정동' });
    var dongList = regionsMod.extractRegionList(dongRes.json, 'regions/list(동)');
    var yeouido = regionsMod.findExact(dongList, '여의도동');
    if (!yeouido) {
      set('V3', 'FAIL', '영등포구 법정동 목록에 "여의도동" 이 없다. 받은 이름: ' + dongList.slice(0, 20).map(function (r) { return r.cortarName; }).join(', '));
      throw client.ApiError('parse', 'regions/list 응답에서 여의도동을 찾지 못했다');
    }
    var codeMatches = yeouido.cortarNo === SPEC_YEOUIDO_CORTAR_NO;
    record.regions = {
      sido: { name: sidoName, cortarNo: sido.cortarNo },
      gu: { name: '영등포구', cortarNo: gu.cortarNo },
      yeouido: yeouido,
      specGuess: SPEC_YEOUIDO_CORTAR_NO,
      specGuessMatched: codeMatches
    };
    set(
      'V3',
      'PASS',
      'Authorization 없이 동작. 여의도동 cortarNo=' + yeouido.cortarNo +
        (codeMatches ? ' (spec 2.4의 추정값과 일치)' : ' ← spec 추정값 ' + SPEC_YEOUIDO_CORTAR_NO + ' 와 다르다! 스펙 수정 필요') +
        ', center=' + yeouido.centerLat + ',' + yeouido.centerLon
    );
    targetRegion = {
      cortarNo: yeouido.cortarNo,
      name: '여의도동',
      gu: '영등포구',
      centerLat: Number(yeouido.centerLat),
      centerLon: Number(yeouido.centerLon)
    };
    if (!isFinite(targetRegion.centerLat) || !isFinite(targetRegion.centerLon)) {
      set('V3', 'FAIL', 'centerLat/centerLon 이 없어 bbox 를 만들 수 없다');
      throw client.ApiError('parse', 'regions/list 응답에 중심 좌표가 없다');
    }

    // ---------- V1 / V4 / V5 / V8: articleList (필터 적용) ----------
    currentStep = 'V1';
    log('[V1] articleList 1회 요청 (보증금 필터 적용) …');
    var filteredUrl = client.buildArticleListUrl(articleListParams(cfg, targetRegion, 1, true));
    log('     ' + filteredUrl);
    var listRes = await c.get(filteredUrl, { label: 'articleList (wprc 필터 있음)' });
    var envelope = listRes.json;
    var body = envelope && Array.isArray(envelope.body) ? envelope.body : null;
    if (!body) {
      set('V1', 'FAIL', '응답에 body 배열이 없다. 받은 키: ' + Object.keys(envelope || {}).join(', '));
      throw client.ApiError('parse', 'articleList 응답 구조가 스펙과 다르다');
    }
    set(
      'V1',
      'PASS',
      'HTTP 200 + JSON. code=' + JSON.stringify(envelope.code) + ', body ' + body.length + '건, more=' + JSON.stringify(envelope.more)
    );
    set(
      'V4',
      body.length > 0 || envelope.more === false ? 'PASS' : 'FAIL',
      '페이지당 ' + body.length + '건 (스펙 추정 20건), more=' + JSON.stringify(envelope.more) +
        (typeof envelope.more === 'boolean' ? '' : ' ← more 가 boolean 이 아니다. 페이지 루프 종료 조건 재검토 필요')
    );

    // 응답 원문 축약 출력 (첫 1건)
    if (body.length) {
      var f = body[0];
      record.firstItemSample = f;
      log('');
      log('  첫 매물 1건 주요 필드 (눈으로 확인하세요)');
      ['atclNo', 'atclNm', 'cortarNo', 'rletTpCd', 'rletTpNm', 'tradTpNm', 'prc', 'hanPrc', 'spc1', 'spc2', 'flrInfo', 'direction', 'atclCfmYmd'].forEach(
        function (k) {
          log('    ' + k.padEnd(12) + ' = ' + JSON.stringify(f[k]));
        }
      );
      var norm = normalizeMod.normalizeOne(f, { regionName: targetRegion.name, now: new Date().toISOString() });
      if (norm.ok) {
        log('    → 정규화: 보증금 ' + norm.listing.deposit + '만원 (' + norm.listing.depositText + '), 전용 ' +
          norm.listing.areaExclusiveM2 + '㎡ (' + norm.listing.areaExclusivePyeong + '평), ' + norm.listing.typeName);
        norm.warnings.forEach(warn);
      } else {
        warn('첫 건 정규화 실패: ' + norm.reason);
      }
      log('');
    } else {
      log('  · body 가 0건이다 — 조건(보증금 ' + cfg.criteria.depositMin + '~' + cfg.criteria.depositMax + '만원)에 맞는 매물이 없을 수 있다. 에러는 아니다.');
    }

    // V5: 응답 cortarNo 가 대상 동인지
    var offRegion = body.filter(function (it) {
      return String(it.cortarNo) !== targetRegion.cortarNo;
    });
    if (body.length === 0) {
      set('V5', 'SKIP', '매물 0건이라 판단할 수 없다');
      set('V8', 'SKIP', '매물 0건이라 bbox 커버리지를 판단할 수 없다');
    } else if (offRegion.length === 0) {
      set('V5', 'PASS', body.length + '건 모두 cortarNo=' + targetRegion.cortarNo);
      set(
        'V8',
        'PASS',
        'zoom=' + cfg.map.zoom + ', bbox ±(' + cfg.map.bboxDeltaLat + ',' + cfg.map.bboxDeltaLon + ') 로 대상 동 매물이 실제로 조회됨' +
          (envelope.more ? ' (more=true — 동 전체 커버 여부는 페이지 순회로만 확인 가능)' : '')
      );
    } else {
      set(
        'V5',
        'FAIL',
        body.length + '건 중 ' + offRegion.length + '건이 다른 동이다(예: ' + offRegion[0].cortarNo + '). ' +
          '수집기는 응답 cortarNo 2차 필터로 이미 방어하지만, bbox 델타를 줄이는 것이 좋다'
      );
      set('V8', 'PASS', 'bbox 가 대상 동을 덮는다(오히려 넓다 — V5 참고)');
    }

    // ---------- V2: 보증금 필터 유무 비교 ----------
    currentStep = 'V2';
    log('[V2] 보증금 필터 없는 요청과 비교 …');
    var unfilteredUrl = client.buildArticleListUrl(articleListParams(cfg, targetRegion, 1, false));
    log('     ' + unfilteredUrl);
    var plainRes = await c.get(unfilteredUrl, { label: 'articleList (wprc 필터 없음)' });
    var plainBody = plainRes.json && Array.isArray(plainRes.json.body) ? plainRes.json.body : [];
    function prcList(arr) {
      return arr
        .map(function (it) {
          return Number(it.prc);
        })
        .filter(function (n) {
          return isFinite(n);
        });
    }
    var fp = prcList(body);
    var pp = prcList(plainBody);
    var min = cfg.criteria.depositMin;
    var max = cfg.criteria.depositMax;
    var outOfRangeFiltered = fp.filter(function (v) {
      return v < min || v > max;
    });
    var outOfRangePlain = pp.filter(function (v) {
      return v < min || v > max;
    });
    record.depositFilter = {
      filteredCount: body.length,
      unfilteredCount: plainBody.length,
      filteredPrcRange: fp.length ? [Math.min.apply(null, fp), Math.max.apply(null, fp)] : null,
      unfilteredPrcRange: pp.length ? [Math.min.apply(null, pp), Math.max.apply(null, pp)] : null,
      outOfRangeInFiltered: outOfRangeFiltered.length,
      outOfRangeInUnfiltered: outOfRangePlain.length
    };
    if (fp.length === 0 && pp.length === 0) {
      set('V2', 'SKIP', '양쪽 모두 0건이라 비교할 수 없다');
    } else if (outOfRangeFiltered.length > 0) {
      set(
        'V2',
        'FAIL',
        '필터를 걸었는데도 범위 밖 ' + outOfRangeFiltered.length + '건이 왔다 (예: ' + outOfRangeFiltered[0] +
          '만원). wprcMin/wprcMax 가 보증금 필터가 아닐 수 있다 — config 의 selfFilterDeposit 로 자체 필터가 동작하므로 결과는 안전하지만 요청량이 늘어난다. 스펙 수정 필요'
      );
    } else if (outOfRangePlain.length > 0) {
      set(
        'V2',
        'PASS',
        '필터 있음 ' + body.length + '건(모두 ' + min + '~' + max + '만원 범위) vs 필터 없음 ' + plainBody.length +
          '건(범위 밖 ' + outOfRangePlain.length + '건 포함) → wprc 필터가 실제로 동작한다'
      );
    } else {
      set(
        'V2',
        'SKIP',
        '필터 없는 요청에도 범위 밖 매물이 없어(모두 ' + min + '~' + max + '만원) 필터 동작을 증명할 수 없다. 보증금 범위를 좁혀 다시 실행하면 판단 가능'
      );
    }
  } catch (e) {
    // 여기서 나오는 것은 위 단계에서 던진 정돈된 ApiError 이거나 예상 못한 예외다.
    var kind = (e && e.kind) || 'unknown';
    var msg = client.maskSecrets((e && e.message) || String(e));
    fatal = fatal || msg;
    record.fatal = { kind: kind, message: msg, stoppedAt: currentStep };

    // 멈춘 항목을 SKIP 이 아니라 FAIL 로 정직하게 표시한다
    if (get(currentStep) && get(currentStep).result === 'SKIP') {
      set(currentStep, 'FAIL', msg);
    }

    log('');
    log('■ 검증을 계속할 수 없습니다. (' + currentStep + ' 단계에서 중단)');
    log('  원인 유형: ' + kind);
    log('  내용: ' + msg);
    log('');
    if (kind === 'network') {
      log('  네이버 서버에 연결조차 되지 않았습니다. 확인할 것:');
      log('   1) 이 PC의 인터넷 연결 / 사내망·VPN·프록시가 naver.com 을 막고 있는지');
      log('   2) 회사 네트워크라면 가정용 네트워크에서 다시 시도');
      log('   (이 코드를 작성한 환경도 정책상 naver.com 이 차단되어 있어 이 지점에서 멈췄습니다)');
    } else if (kind === 'blocked') {
      log('  403/429 응답입니다. 두 가지 가능성이 있습니다.');
      log('   1) 네이버가 이 요청을 거부했다 → 재시도하지 말고 다음 주기를 기다리세요(spec D6에 따라 보고).');
      log('   2) 중간의 프록시·사내망·보안 게이트웨이가 naver.com 을 막고 403 을 돌려준다');
      log('      → 가정용 네트워크에서 다시 실행해 구분할 수 있습니다.');
      log('      (이 코드를 작성한 환경이 바로 2번이었습니다: 정책상 naver.com CONNECT 가 403 으로 차단됨)');
    } else if (kind === 'auth') {
      log('  Authorization(토큰)이 필요한 응답입니다 → spec V3 실패 경로입니다.');
      log('  브라우저에서 여의도동 cortarNo 를 1회 확인해 config.json 의 regions.manual 에 넣으면');
      log('  regions/list 없이도 수집을 시도할 수 있습니다 (cortarNo 는 시크릿이 아닙니다).');
    } else if (kind === 'parse') {
      log('  응답 구조가 스펙과 다릅니다 = 네이버가 API를 바꿨을 가능성이 큽니다.');
      log('  run-logs/verification.json 을 상위 세션(또는 개발자)에게 전달해 스펙을 갱신해야 합니다.');
    }

    // V1의 상태를 정확히 구분해 보고한다.
    // 시도조차 못 한 것(SKIP)을 "차단"으로 단정하면 원인을 엉뚱한 곳에서 찾게 된다.
    var v1 = get('V1');
    if (v1.result === 'FAIL') {
      log('');
      log('  ★ 모바일 API 가 응답을 거부했습니다 (V1 FAIL) — D6에 따라 수집을 시작하지 않습니다.');
      log('    이 결과를 그대로 보고해 주세요.');
    } else if (v1.result !== 'PASS') {
      log('');
      log('  ★ 모바일 API(V1)는 아직 시험하지 못했습니다 — 앞 단계(' + currentStep + ')에서 멈췄기 때문입니다.');
      log('    따라서 "차단됐다"고 단정할 수 없습니다. 앞 단계의 원인을 먼저 해결해야 합니다.');
    }
  }

  record.requestsUsed = c.state.requests;
  record.checks = checks.map(function (ch) {
    return { id: ch.id, title: ch.title, result: ch.result, detail: ch.detail };
  });

  line();
  log('검증 결과 요약  (요청 ' + c.state.requests + '/' + VERIFY_REQUEST_BUDGET + '회 사용)');
  checks.forEach(function (ch) {
    log(fmtCheck(ch));
  });
  line();

  try {
    writeJsonAtomic(VERIFICATION_PATH, record);
    log('기록: ' + VERIFICATION_PATH);
  } catch (e) {
    warn('verification.json 저장 실패: ' + e.message);
  }

  var v1 = get('V1').result;
  if (v1 !== 'PASS') {
    log('');
    log('결론: 아직 수집을 실행하지 마세요. 위 내용을 그대로 복사해 보고해 주세요.');
    return 1;
  }
  var fails = checks.filter(function (ch) {
    return ch.result === 'FAIL';
  });
  if (fails.length) {
    log('');
    log('결론: 핵심 경로(V1)는 살아 있지만 ' + fails.map(function (ch) { return ch.id; }).join(', ') + ' 가 실패했습니다.');
    log('      위 detail 을 보고해 주세요. 수집은 자체 필터로 방어되지만 스펙 수정이 필요합니다.');
    return 1;
  }
  log('');
  log('결론: 전부 통과. 이제 `node collector/collect.js` 로 수집할 수 있습니다.');
  return 0;
}

// ==================================================================
// 모드 3: 평소 수집
// ==================================================================
async function runCollect(loaded) {
  var cfg = loaded.config;
  var politeness = loaded.politeness;
  var now = new Date().toISOString();
  var startedAt = Date.now();

  log('=== 여의도 전세 매물 수집 ===');
  log('시각: ' + now);
  loaded.envNotes.forEach(function (n) {
    log('환경변수 ' + n);
  });
  loaded.clampWarnings.forEach(warn);

  var c = client.createClient({ politeness: politeness, log: log });
  activeClient = c; // 예외로 죽어도 last-run.json 에 요청 수를 남기기 위해

  // ---------- 1) 지역 해석 ----------
  var resolved = await regionsMod.resolveRegions({
    client: c,
    config: cfg,
    cachePath: REGION_CACHE_PATH,
    log: log,
    maxRegionCodes: politeness.maxRegionCodes
  });
  resolved.warnings.forEach(warn);
  var regions = resolved.regions;
  log('대상 법정동 ' + regions.length + '개: ' + regions.map(function (r) { return r.name; }).join(', '));
  line();

  // ---------- 2) 매물 수집 ----------
  var rawByRegion = [];        // { region, items }
  var failedRegions = [];      // { cortarNo, name, reason, attempts }
  var stoppedEarly = null;
  var firstRawItem = null;

  for (var i = 0; i < regions.length; i++) {
    var region = regions[i];
    if (stoppedEarly) {
      failedRegions.push({
        cortarNo: region.cortarNo,
        name: region.name,
        reason: '앞선 중단(' + stoppedEarly + ')으로 미수집',
        attempts: 0
      });
      continue;
    }

    var items = [];
    var pageError = null;
    for (var page = 1; page <= politeness.maxPagesPerRegion; page++) {
      if (c.remainingBudget() <= 0) {
        pageError = '요청 예산 소진';
        stoppedEarly = pageError;
        break;
      }
      var url = client.buildArticleListUrl(articleListParams(cfg, region, page, true));
      var res;
      try {
        res = await c.get(url, { label: region.name + ' page ' + page });
      } catch (e) {
        pageError = (e.kind || 'error') + ': ' + e.message;
        // 429/403/예산 초과는 실행 전체를 중단한다 (밀어붙이지 않는다)
        if (e.kind === 'blocked' || e.kind === 'budget') stoppedEarly = e.kind === 'blocked' ? '차단(403/429)' : '요청 예산 소진';
        break;
      }
      var envelope = res.json;
      var body = envelope && Array.isArray(envelope.body) ? envelope.body : null;
      if (!body) {
        pageError = 'body 배열이 없다 (응답 키: ' + Object.keys(envelope || {}).join(',') + ') — API 스펙 변경 의심';
        break;
      }
      if (!firstRawItem && body.length) firstRawItem = body[0];
      items = items.concat(body);
      log('    ' + region.name + ' page ' + page + ': ' + body.length + '건 (more=' + JSON.stringify(envelope.more) + ')');
      if (envelope.more !== true || body.length === 0) break;
      if (page === politeness.maxPagesPerRegion) {
        warn(region.name + ': 페이지 상한(' + politeness.maxPagesPerRegion + ')에 도달했다. 더 있을 수 있다.');
      }
    }

    if (pageError && items.length === 0) {
      // 한 건도 못 받았다 → 이 지역은 실패. 삭제 판정에서 제외된다.
      failedRegions.push({ cortarNo: region.cortarNo, name: region.name, reason: pageError, attempts: 1 });
      warn(region.name + ' 수집 실패 — ' + pageError + ' (이 지역 매물은 삭제 판정에서 제외)');
    } else {
      if (pageError) {
        // 일부만 받았다 → 부분 실패로 간주해 역시 삭제 판정에서 제외한다
        failedRegions.push({
          cortarNo: region.cortarNo,
          name: region.name,
          reason: '부분 실패 — ' + pageError,
          attempts: 1
        });
        warn(region.name + ' 부분 실패 — ' + pageError + ' (받은 ' + items.length + '건은 사용, 삭제 판정은 보류)');
      }
      rawByRegion.push({ region: region, items: items });
    }
  }
  line();

  // ---------- 3) 정규화 ----------
  var allListings = [];
  var totalRaw = 0;
  var totalSkipped = 0;
  var totalUnitSuspect = 0;
  var normWarnings = [];
  var skipReasons = Object.create(null);
  var skippedIds = [];

  rawByRegion.forEach(function (bucket) {
    var res = normalizeMod.normalizeMany(bucket.items, { regionName: bucket.region.name, now: now });
    totalRaw += res.total;
    totalSkipped += res.skipped;
    totalUnitSuspect += res.unitSuspectCount;
    normWarnings = normWarnings.concat(res.warnings);
    Object.keys(res.skippedReasons).forEach(function (k) {
      skipReasons[k] = (skipReasons[k] || 0) + res.skippedReasons[k];
    });
    skippedIds = skippedIds.concat(res.skippedIds || []);
    allListings = allListings.concat(res.listings);
  });

  var skipRate = totalRaw ? totalSkipped / totalRaw : 0;
  var unitSuspectRate = allListings.length ? totalUnitSuspect / allListings.length : 0;
  log('정규화: 원본 ' + totalRaw + '건 → ' + allListings.length + '건 (건너뜀 ' + totalSkipped + '건, ' + Math.round(skipRate * 100) + '%)');
  normWarnings.slice(0, 10).forEach(warn);
  if (normWarnings.length > 10) warn('… 경고 ' + (normWarnings.length - 10) + '건 더 있음');

  // 스키마 변경 의심 → 기존 listings.json 을 건드리지 않고 실패로 끝낸다
  if (totalRaw > 0 && skipRate > SCHEMA_CHANGE_THRESHOLD) {
    return finishFailure(
      '필수 필드 누락률 ' + Math.round(skipRate * 100) + '% (기준 ' + SCHEMA_CHANGE_THRESHOLD * 100 + '%) — API 스키마 변경 의심. ' +
        'listings.json 을 덮어쓰지 않았다.',
      { c: c, failedRegions: failedRegions, skipReasons: skipReasons, now: now, startedAt: startedAt, firstRawItem: firstRawItem }
    );
  }
  if (allListings.length > 0 && unitSuspectRate > SCHEMA_CHANGE_THRESHOLD) {
    return finishFailure(
      '금액 단위 불일치(prc vs hanPrc)가 ' + Math.round(unitSuspectRate * 100) + '% — 금액 단위 전제가 틀렸을 수 있다. ' +
        '잘못된 금액으로 기존 데이터를 덮어쓰지 않았다.',
      { c: c, failedRegions: failedRegions, skipReasons: skipReasons, now: now, startedAt: startedAt, firstRawItem: firstRawItem }
    );
  }

  // ---------- 4) 2차 자체 필터 ----------
  var allowedCodes = regions.map(function (r) {
    return r.cortarNo;
  });
  var byRegion = normalizeMod.filterByRegion(allListings, allowedCodes);
  if (byRegion.droppedOtherRegion > 0) {
    log('  · 대상 외 법정동 ' + byRegion.droppedOtherRegion + '건 제외 (bbox가 인접 동을 물어온 것)');
  }
  if (byRegion.unknownRegion > 0) {
    warn('cortarNo 가 없는 ' + byRegion.unknownRegion + '건은 판단 불가로 남겨두었다');
  }
  var byCriteria = normalizeMod.filterByCriteria(byRegion.kept, cfg.criteria);
  if (byCriteria.dropped.deposit > 0) {
    warn(
      '보증금 범위 밖 ' + byCriteria.dropped.deposit + '건을 자체 필터로 제외했다 — ' +
        'wprcMin/wprcMax 가 서버에서 적용되지 않는 것으로 보인다(spec V2 확인 필요)'
    );
  }
  if (byCriteria.dropped.officetelTooSmall > 0) {
    log('  · 전용 ' + cfg.criteria.officetelMinExclusiveM2 + '㎡ 미만 오피스텔 ' + byCriteria.dropped.officetelTooSmall + '건 제외');
  }
  if (byCriteria.officetelUnknownArea > 0) {
    warn('면적을 알 수 없는 오피스텔 ' + byCriteria.officetelUnknownArea + '건은 제외하지 않고 남겼다');
  }
  var finalListings = byCriteria.kept;

  // 중복 제거 (bbox가 겹쳐 같은 매물이 두 지역에서 올 수 있다)
  var seen = Object.create(null);
  var deduped = [];
  finalListings.forEach(function (l) {
    if (seen[l.id]) return;
    seen[l.id] = true;
    deduped.push(l);
  });
  if (deduped.length !== finalListings.length) {
    log('  · 중복 매물 ' + (finalListings.length - deduped.length) + '건 제거');
  }
  finalListings = deduped;
  log('최종 대상: ' + finalListings.length + '건');
  line();

  // ---------- 5) 비교 ----------
  var prev = readJsonOrNull(LISTINGS_PATH);
  var history = readJsonOrNull(HISTORY_PATH);

  // 0건은 에러가 아니다. 단, 기존 데이터가 있으면 지우지 않는다.
  if (finalListings.length === 0 && prev && Array.isArray(prev.listings) && prev.listings.length > 0) {
    log('수집 결과 0건 — 기존 데이터를 보존하고 종료한다(0건은 에러가 아니지만, 덮어쓰지 않는다).');
    log('  조건이 좁을 수 있다: 보증금 ' + cfg.criteria.depositMin + '~' + cfg.criteria.depositMax + '만원');
    // 0건의 원인이 "조건이 좁아서"인지 "전부 실패해서"인지 구분되게 실패 목록을 반드시 출력한다.
    if (failedRegions.length > 0) {
      log('');
      log('■ 0건의 원인은 수집 실패일 수 있습니다 — 실패 지역 ' + failedRegions.length + '개:');
      failedRegions.forEach(function (f) {
        log('   - ' + f.name + ': ' + f.reason);
      });
    }
    writeLastRun({
      at: now,
      ok: failedRegions.length === 0,
      requests: c.state.requests,
      collected: 0,
      regionsFailed: failedRegions,
      message: '수집 0건 — listings.json 을 덮어쓰지 않았다',
      elapsedMs: Date.now() - startedAt
    });
    return failedRegions.length === 0 ? 0 : 1;
  }

  var diffResult = diffMod.computeDiff({
    prev: prev,
    currListings: finalListings,
    history: history,
    now: now,
    failedRegionCodes: failedRegions.map(function (f) {
      return f.cortarNo;
    }),
    // 정규화에 실패해 이번 스냅샷에서 빠진 매물은 "사라짐"이 아니라 판정 보류 대상이다.
    skippedIds: skippedIds,
    keepDisappearedDays: cfg.output.keepDisappearedDays,
    historyMaxSnapshots: cfg.output.historyMaxSnapshots
  });
  diffResult.notes.forEach(function (n) {
    log('  · ' + n);
  });

  // ---------- 6) 저장 ----------
  var regionSummary = regions.map(function (r) {
    var count = finalListings.filter(function (l) {
      return l.regionCode === r.cortarNo;
    }).length;
    var failed = failedRegions.filter(function (f) {
      return f.cortarNo === r.cortarNo;
    })[0];
    return {
      cortarNo: r.cortarNo,
      name: r.name,
      gu: r.gu,
      count: count,
      failed: failed ? failed.reason : null
    };
  });

  var snapshot = {
    schemaVersion: SCHEMA_VERSION,
    collectedAt: now,
    is_sample: false,
    criteria: {
      tradeType: cfg.criteria.tradeType,
      realEstateType: cfg.criteria.realEstateType,
      depositMin: cfg.criteria.depositMin,
      depositMax: cfg.criteria.depositMax,
      officetelMinExclusiveM2: cfg.criteria.officetelMinExclusiveM2
    },
    regions: regionSummary,
    stats: diffResult.stats,
    notes: diffResult.notes,
    partialFailure: failedRegions.length > 0,
    listings: diffResult.listings
  };

  writeJsonAtomic(LISTINGS_PATH, snapshot);
  writeJsonAtomic(HISTORY_PATH, diffResult.history);
  if (firstRawItem) {
    try {
      writeJsonAtomic(RAW_SAMPLE_PATH, { at: now, note: '디버깅용 원본 응답 1건', item: firstRawItem });
    } catch (e) {
      warn('원본 샘플 저장 실패: ' + e.message);
    }
  }

  var ok = failedRegions.length === 0;
  writeLastRun({
    at: now,
    ok: ok,
    requests: c.state.requests,
    collected: finalListings.length,
    regionsFailed: failedRegions,
    stats: diffResult.stats,
    message: ok
      ? '정상 수집'
      : failedRegions.length + '개 지역 수집 실패 — 삭제 판정 보류',
    elapsedMs: Date.now() - startedAt
  });

  log('저장: ' + LISTINGS_PATH);
  log(
    '결과: 전체 ' + diffResult.stats.total + '건 / 신규 ' + (diffResult.stats.new === null ? '기준 스냅샷 생성' : diffResult.stats.new) +
      ' / 가격변동 ' + diffResult.stats.priceChanged + ' / 사라짐 ' + diffResult.stats.disappeared +
      ' / 실패 지역 ' + failedRegions.length
  );
  log('요청 ' + c.state.requests + '회, 소요 ' + Math.round((Date.now() - startedAt) / 1000) + '초');
  if (!ok) {
    log('');
    log('■ 일부 지역 수집에 실패했습니다 (종료 코드 1). run-logs/last-run.json 을 확인하세요.');
    failedRegions.forEach(function (f) {
      log('   - ' + f.name + ': ' + f.reason);
    });
  }
  return ok ? 0 : 1;
}

/** 스키마 변경 등으로 기존 데이터를 지키며 실패 종료 */
function finishFailure(message, ctx) {
  log('');
  log('■ 수집을 실패로 처리합니다: ' + message);
  writeLastRun({
    at: ctx.now,
    ok: false,
    requests: ctx.c.state.requests,
    collected: 0,
    regionsFailed: ctx.failedRegions,
    skipReasons: ctx.skipReasons,
    message: message,
    elapsedMs: Date.now() - ctx.startedAt
  });
  if (ctx.firstRawItem) {
    try {
      writeJsonAtomic(RAW_SAMPLE_PATH, {
        at: ctx.now,
        note: '스키마 변경 의심 — 원본 응답 1건',
        item: ctx.firstRawItem
      });
      log('  원본 응답 1건: ' + RAW_SAMPLE_PATH);
    } catch (e) {
      warn('원본 샘플 저장 실패: ' + e.message);
    }
  }
  return 1;
}

var activeClient = null; // runCollect 가 만든 클라이언트 (실패 로그용)

function writeLastRun(obj) {
  try {
    writeJsonAtomic(LAST_RUN_PATH, obj);
  } catch (e) {
    warn('last-run.json 저장 실패: ' + e.message);
  }
}

// ==================================================================
// 엔트리
// ==================================================================
function printHelp() {
  log('여의도 전세 매물 수집기');
  log('');
  log('  node collector/collect.js --verify    ★ 최초 1회 필수. 네이버 API 스펙을 실제로 확인한다(요청 8회 이하)');
  log('  node collector/collect.js             평소 수집 (스케줄러가 1일 2회 호출)');
  log('  node collector/collect.js --dry-run   네트워크 없이 보낼 요청 URL만 출력');
  log('  node collector/collect.js --help      이 도움말');
  log('');
  log('설정 파일: collector/config.json (지역·보증금·매물종류·상한)');
  log('환경변수 오버라이드: YJ_DEPOSIT_MIN, YJ_DEPOSIT_MAX, YJ_MAX_PAGES, YJ_DELAY_MS');
  log('');
  log('⚠️ 이 코드는 naver.com 접속이 차단된 환경에서 작성되어 라이브 검증되지 않았습니다.');
  log('   반드시 --verify 를 먼저 실행하고 결과를 확인하세요. 자세한 내용은 README.md 참조.');
}

async function main() {
  var argv = process.argv.slice(2);
  var mode = 'collect';
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--help' || a === '-h') mode = 'help';
    else if (a === '--dry-run' || a === '--dryrun') mode = 'dry-run';
    else if (a === '--verify') mode = 'verify';
    else {
      log('알 수 없는 옵션: ' + a);
      printHelp();
      return 2;
    }
  }
  if (mode === 'help') {
    printHelp();
    return 0;
  }

  var loaded = loadConfig();
  if (mode === 'dry-run') return runDryRun(loaded);
  if (mode === 'verify') return runVerify(loaded);

  // 수집 실패도 조용히 넘기지 않는다 — 예외로 죽어도 last-run.json 을 남긴다 (spec 8.4)
  try {
    return await runCollect(loaded);
  } catch (e) {
    writeLastRun({
      at: new Date().toISOString(),
      ok: false,
      requests: activeClient ? activeClient.state.requests : 0,
      collected: 0,
      regionsFailed: [],
      message: ((e && e.kind) || 'error') + ': ' + client.maskSecrets((e && e.message) || String(e)),
      elapsedMs: null
    });
    throw e;
  }
}

/* 종료 코드는 process.exit() 대신 process.exitCode 로 넘긴다.
   Windows에서 process.exit() 가 fetch(undici)의 keep-alive 소켓이 닫히는 도중에 끼면
   libuv가 "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c" 로
   죽는다. 결과 출력은 이미 끝난 뒤라 사용자에게는 원인 없는 크래시로만 보인다.
   exitCode 를 세우고 이벤트 루프가 자연히 비워지도록 두면 이 크래시가 나지 않는다. */
main()
  .then(function (code) {
    process.exitCode = typeof code === 'number' ? code : 0;
  })
  .catch(function (e) {
    // 사용자에게 스택 트레이스를 토하지 않는다. 디버깅이 필요하면 YJ_DEBUG=1.
    var kind = (e && e.kind) || 'unknown';
    process.stderr.write('\n[실패] ' + client.maskSecrets((e && e.message) || String(e)) + '\n');
    if (kind === 'network') {
      process.stderr.write('  네이버 서버에 연결할 수 없습니다. 네트워크/방화벽/VPN 을 확인하세요.\n');
    } else if (kind === 'blocked') {
      process.stderr.write('  네이버가 요청을 거부했습니다(403/429). 재시도하지 말고 다음 주기를 기다리세요.\n');
    } else if (kind === 'parse') {
      process.stderr.write('  응답 구조가 스펙과 다릅니다. `--verify` 로 확인하고 결과를 보고하세요.\n');
    }
    process.stderr.write('  자세한 원인 추적: YJ_DEBUG=1 을 붙여 다시 실행하세요.\n');
    if (process.env.YJ_DEBUG === '1' && e && e.stack) {
      process.stderr.write('\n' + e.stack + '\n');
    }
    process.exitCode = 1;
  });
