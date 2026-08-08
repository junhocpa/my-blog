/* naver-client.js — HTTP 계층
   요청 조립 / 순차 지연 / 재시도·백오프 / 429·403 즉시 중단 / 타임아웃 / 요청 카운터.

   설계 원칙
   - 병렬 요청·프록시 로테이션·IP 우회 기능을 넣지 않는다. 언제나 순차 1요청이다.
   - 429/403은 재시도하지 않는다. 밀어붙이면 차단이 길어진다.
   - 상한은 설정이 아니라 코드(HARD_LIMITS)가 최종 결정한다.
   - dryRun 모드에서는 네트워크를 절대 타지 않는다(시도하면 예외를 던져 버그를 드러낸다).

   ⚠️ 이 파일의 모든 요청 스펙은 라이브 검증되지 않았다.
      작성 환경이 *.naver.com 을 차단(gateway 403)했기 때문이다.
      실제 동작 확인은 `node collector/collect.js --verify` 로 사용자가 수행한다. */
'use strict';

// ------------------------------------------------------------------
// 하드 상한 — config.json이 이보다 느슨한 값을 적어도 이 값으로 클램프된다
// ------------------------------------------------------------------
var HARD_LIMITS = {
  minDelayMs: 1000,        // 요청 간 최소 지연 (이보다 짧게 못 내린다)
  maxPagesPerRegion: 10,   // 지역당 페이지 상한
  maxRegionCodes: 40,      // 대상 법정동 코드 수 상한 (전국 수집을 구조적으로 불가능하게)
  maxRequestsPerRun: 300,  // 1회 실행 총 요청 상한
  maxRetries: 3,           // 재시도 상한
  maxTimeoutMs: 30000      // 타임아웃 상한
};

var MOBILE_ORIGIN = 'https://m.land.naver.com';
var PC_ORIGIN = 'https://new.land.naver.com';
var ARTICLE_LIST_PATH = '/cluster/ajax/articleList';
var REGION_LIST_PATH = '/api/regions/list';
var ROBOTS_URL = MOBILE_ORIGIN + '/robots.txt';
var ARTICLE_INFO_PREFIX = MOBILE_ORIGIN + '/article/info/';

// 모바일 프런트엔드가 보내는 최소 헤더. Authorization·Cookie 없음.
var MOBILE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  Referer: MOBILE_ORIGIN + '/',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  Accept: '*/*'
};

// ------------------------------------------------------------------
// 에러 — kind로 상위에서 분기한다. 스택을 사용자에게 토하지 않기 위해 message를 사람 말로 쓴다.
//   'blocked'  429/403 → 즉시 중단, 재시도 금지
//   'auth'     401 또는 인증 요구 응답 → PC 계열 토큰 문제 (spec V3/D6)
//   'http'     그 밖의 4xx/5xx
//   'network'  연결 실패·타임아웃 (이 작성 환경의 게이트웨이 차단도 여기로 온다)
//   'parse'    JSON 파싱 실패 (HTML 안내 페이지를 받은 경우 등)
//   'budget'   요청 예산 초과
//   'dryrun'   dry-run 모드에서 네트워크를 시도함 (코드 버그)
// ------------------------------------------------------------------
function ApiError(kind, message, extra) {
  var err = new Error(message);
  err.name = 'ApiError';
  err.kind = kind;
  if (extra) {
    Object.keys(extra).forEach(function (k) {
      err[k] = extra[k];
    });
  }
  return err;
}

/** 로그·저장 파일에 토큰/쿠키가 새지 않게 마스킹한다 (PC 계열 폴백 대비). */
function maskSecrets(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***MASKED***')
    .replace(/(NID_AUT|NID_SES|NNB)=[^;\s]+/gi, '$1=***MASKED***');
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/** 설정의 politeness를 하드 상한으로 클램프한다. 조정된 항목은 warnings에 남긴다. */
function clampPoliteness(raw) {
  var p = raw || {};
  var warnings = [];
  function clamp(name, value, fallback, min, max) {
    var v = typeof value === 'number' && isFinite(value) ? value : fallback;
    if (min !== undefined && v < min) {
      warnings.push('politeness.' + name + ' = ' + v + ' → 하드 하한 ' + min + '(으)로 조정');
      v = min;
    }
    if (max !== undefined && v > max) {
      warnings.push('politeness.' + name + ' = ' + v + ' → 하드 상한 ' + max + '(으)로 조정');
      v = max;
    }
    return v;
  }
  return {
    values: {
      delayMsBetweenRequests: clamp(
        'delayMsBetweenRequests', p.delayMsBetweenRequests, 2000, HARD_LIMITS.minDelayMs, 60000
      ),
      delayJitterMs: clamp('delayJitterMs', p.delayJitterMs, 800, 0, 10000),
      maxPagesPerRegion: clamp('maxPagesPerRegion', p.maxPagesPerRegion, 5, 1, HARD_LIMITS.maxPagesPerRegion),
      maxRegionCodes: clamp('maxRegionCodes', p.maxRegionCodes, 25, 1, HARD_LIMITS.maxRegionCodes),
      maxRequestsPerRun: clamp('maxRequestsPerRun', p.maxRequestsPerRun, 150, 1, HARD_LIMITS.maxRequestsPerRun),
      maxRetries: clamp('maxRetries', p.maxRetries, 3, 0, HARD_LIMITS.maxRetries),
      retryBackoffMs: clamp('retryBackoffMs', p.retryBackoffMs, 5000, 1000, 60000),
      requestTimeoutMs: clamp('requestTimeoutMs', p.requestTimeoutMs, 15000, 1000, HARD_LIMITS.maxTimeoutMs)
    },
    warnings: warnings
  };
}

// ------------------------------------------------------------------
// URL 조립 — dry-run에서 그대로 출력되는 문자열이므로 여기 한 곳에만 둔다
// ------------------------------------------------------------------

/** 중심 좌표 + 델타 → 모바일 API가 요구하는 bbox */
function makeBbox(centerLat, centerLon, dLat, dLon) {
  return {
    btm: round6(centerLat - dLat),
    top: round6(centerLat + dLat),
    lft: round6(centerLon - dLon),
    rgt: round6(centerLon + dLon)
  };
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * 모바일 매물 목록 URL.
 * @param {object} o cortarNo, centerLat, centerLon, zoom, dLat, dLon, page,
 *                   tradeType[], realEstateType[], depositMin, depositMax,
 *                   areaMinM2, areaMaxM2, withDepositFilter(false면 wprc* 생략 — V2 비교용)
 */
function buildArticleListUrl(o) {
  var bbox = makeBbox(Number(o.centerLat), Number(o.centerLon), Number(o.dLat), Number(o.dLon));
  var q = new URLSearchParams();
  q.set('view', 'atcl');
  q.set('z', String(o.zoom));
  q.set('lat', String(round6(Number(o.centerLat))));
  q.set('lon', String(round6(Number(o.centerLon))));
  q.set('btm', String(bbox.btm));
  q.set('lft', String(bbox.lft));
  q.set('top', String(bbox.top));
  q.set('rgt', String(bbox.rgt));
  if (o.cortarNo) q.set('cortarNo', String(o.cortarNo));
  if (o.realEstateType && o.realEstateType.length) q.set('rletTpCd', o.realEstateType.join(':'));
  if (o.tradeType && o.tradeType.length) q.set('tradTpCd', o.tradeType.join(':'));
  // 전세 보증금 필터는 wprcMin/wprcMax다. dprc*(매매가)와 혼동하면 조용히 엉뚱한 결과가 나온다.
  if (o.withDepositFilter !== false) {
    if (isNum(o.depositMin)) q.set('wprcMin', String(o.depositMin));
    if (isNum(o.depositMax)) q.set('wprcMax', String(o.depositMax));
  }
  if (isNum(o.areaMinM2)) q.set('spcMin', String(o.areaMinM2));
  if (isNum(o.areaMaxM2)) q.set('spcMax', String(o.areaMaxM2));
  q.set('page', String(o.page || 1));
  return MOBILE_ORIGIN + ARTICLE_LIST_PATH + '?' + q.toString();
}

/** 지역 목록(법정동 드릴다운) URL. cortarNo가 상위 코드다. */
function buildRegionListUrl(cortarNo) {
  return PC_ORIGIN + REGION_LIST_PATH + '?cortarNo=' + encodeURIComponent(String(cortarNo));
}

function articleInfoUrl(atclNo) {
  return ARTICLE_INFO_PREFIX + String(atclNo);
}

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

// ------------------------------------------------------------------
// 클라이언트
// ------------------------------------------------------------------

/**
 * @param {object} opts politeness(클램프된 값), log(function), dryRun(boolean)
 */
function createClient(opts) {
  var politeness = opts.politeness;
  var log = opts.log || function () {};
  var dryRun = !!opts.dryRun;

  var state = {
    requests: 0,          // 실제로 보낸 요청 수
    aborted: false,       // 429/403을 만나 이번 실행을 포기했는가
    abortReason: null,
    lastRequestAt: 0,
    urls: []              // 조립된(또는 조립될) URL 기록 — dry-run 출력·로그용
  };

  function remainingBudget() {
    return politeness.maxRequestsPerRun - state.requests;
  }

  function nextDelayMs() {
    var jitter = politeness.delayJitterMs > 0 ? Math.floor(Math.random() * politeness.delayJitterMs) : 0;
    return politeness.delayMsBetweenRequests + jitter;
  }

  /** 순차 실행 보장 + 요청 간 최소 지연 */
  async function waitTurn() {
    if (state.lastRequestAt === 0) return;
    var elapsed = Date.now() - state.lastRequestAt;
    var need = nextDelayMs() - elapsed;
    if (need > 0) await sleep(need);
  }

  async function rawFetch(url, expect) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, politeness.requestTimeoutMs);
    try {
      var res = await fetch(url, {
        method: 'GET',
        headers: MOBILE_HEADERS,
        redirect: 'follow',
        signal: controller.signal
      });
      var text = await res.text();
      return { status: res.status, text: text, expect: expect };
    } catch (e) {
      // AbortError = 타임아웃, 그 외 = 연결 실패(이 작성 환경의 게이트웨이 차단 포함)
      var isTimeout = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
      throw ApiError(
        'network',
        isTimeout
          ? '요청 시간 초과 (' + politeness.requestTimeoutMs + 'ms)'
          : '네트워크 연결 실패: ' + maskSecrets(String((e && e.message) || e)),
        { cause: isTimeout ? 'timeout' : 'connect' }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * GET 1회 (재시도 포함). 성공하면 { json } 또는 { text } 를 돌려준다.
   * @param {string} url
   * @param {object} o label(로그용 이름), expect('json'|'text')
   */
  async function get(url, o) {
    var options = o || {};
    var expect = options.expect === 'text' ? 'text' : 'json';
    var label = options.label || 'request';

    state.urls.push({ label: label, url: url });

    if (dryRun) {
      throw ApiError('dryrun', 'dry-run 모드에서 네트워크 요청이 시도되었다 (코드 버그): ' + label);
    }
    if (state.aborted) {
      throw ApiError('blocked', '이미 중단된 실행이다: ' + state.abortReason);
    }
    var attempt = 0;
    for (;;) {
      attempt += 1;
      // 예산 검사는 매 시도마다 한다. 루프 바깥에서 한 번만 검사하면
      // 재시도가 상한을 우회해 maxRequestsPerRun을 최대 maxRetries 만큼 넘긴다.
      if (remainingBudget() <= 0) {
        throw ApiError(
          'budget',
          '요청 예산 소진 (maxRequestsPerRun=' + politeness.maxRequestsPerRun + ').' +
            (attempt > 1 ? ' 재시도 중 예산이 소진되었다.' : '') +
            ' 이번 실행을 중단한다.'
        );
      }
      await waitTurn();
      state.lastRequestAt = Date.now();
      state.requests += 1;
      log('  → [' + state.requests + '/' + politeness.maxRequestsPerRun + '] ' + label);

      var result;
      try {
        result = await rawFetch(url, expect);
      } catch (e) {
        // 네트워크 오류: 재시도 대상
        if (attempt > politeness.maxRetries) throw e;
        var waitMs = politeness.retryBackoffMs * Math.pow(2, attempt - 1);
        log('    · ' + e.message + ' → ' + waitMs + 'ms 후 재시도 (' + attempt + '/' + politeness.maxRetries + ')');
        await sleep(waitMs);
        continue;
      }

      // 429/403: 재시도하지 않고 즉시 물러난다
      if (result.status === 429 || result.status === 403) {
        state.aborted = true;
        state.abortReason = 'HTTP ' + result.status;
        throw ApiError(
          'blocked',
          'HTTP ' + result.status + ' — 네이버가 요청을 거부했다. 재시도하지 않고 즉시 중단한다. ' +
            '다음 주기까지 기다리는 것이 안전하다.',
          { status: result.status }
        );
      }
      if (result.status === 401) {
        throw ApiError('auth', 'HTTP 401 — 인증(Authorization)이 필요한 응답이다.', { status: 401 });
      }
      if (result.status >= 500) {
        if (attempt > politeness.maxRetries) {
          throw ApiError('http', 'HTTP ' + result.status + ' — 서버 오류가 재시도 후에도 계속된다.', {
            status: result.status
          });
        }
        var backoff = politeness.retryBackoffMs * Math.pow(2, attempt - 1);
        log('    · HTTP ' + result.status + ' → ' + backoff + 'ms 후 재시도');
        await sleep(backoff);
        continue;
      }
      if (result.status !== 200) {
        throw ApiError('http', 'HTTP ' + result.status + ' — 예상치 못한 응답 코드.', { status: result.status });
      }

      if (expect === 'text') return { text: result.text, status: 200 };

      var json;
      try {
        json = JSON.parse(result.text);
      } catch (e2) {
        // JSON 대신 HTML(차단 안내·점검 페이지)을 받는 경우가 실제로 있다.
        var head = maskSecrets(result.text.slice(0, 200)).replace(/\s+/g, ' ');
        throw ApiError(
          'parse',
          'JSON 파싱 실패 — API가 JSON이 아닌 응답을 돌려주었다. 앞부분: ' + head,
          { bodyHead: head }
        );
      }
      return { json: json, status: 200 };
    }
  }

  return {
    get: get,
    state: state,
    politeness: politeness,
    remainingBudget: remainingBudget,
    buildArticleListUrl: buildArticleListUrl,
    buildRegionListUrl: buildRegionListUrl
  };
}

module.exports = {
  HARD_LIMITS: HARD_LIMITS,
  MOBILE_ORIGIN: MOBILE_ORIGIN,
  PC_ORIGIN: PC_ORIGIN,
  ARTICLE_LIST_PATH: ARTICLE_LIST_PATH,
  REGION_LIST_PATH: REGION_LIST_PATH,
  ROBOTS_URL: ROBOTS_URL,
  MOBILE_HEADERS: MOBILE_HEADERS,
  ApiError: ApiError,
  maskSecrets: maskSecrets,
  clampPoliteness: clampPoliteness,
  createClient: createClient,
  buildArticleListUrl: buildArticleListUrl,
  buildRegionListUrl: buildRegionListUrl,
  articleInfoUrl: articleInfoUrl,
  makeBbox: makeBbox,
  sleep: sleep
};
