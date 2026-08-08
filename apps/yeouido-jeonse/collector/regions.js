/* regions.js — 법정동코드(cortarNo) 해석
   regions/list 드릴다운(시도 → 구 → 동) + 동 이름 접두어 매칭 확장 + 캐시.

   왜 하드코딩하지 않는가
   - "여의도동 = 1156011000"은 제3자 덤프에서 본 값이며 라이브 확인되지 않았다.
     틀린 코드로 조용히 빈 결과를 내놓는 대신, 드릴다운으로 얻고 캐시에 남긴다.
   - 당산동·영등포동·문래동·양평동은 법정동이 1가~8가로 쪼개져 있다.
     설정에는 "당산동" 하나만 적고, 여기서 접두어 매칭으로 하위 코드를 모두 펼친다.

   ⚠️ regions/list가 Authorization을 요구하는지는 미검증이다(spec V3).
      요구하면 auth 에러로 명확히 드러내고, config.regions.manual 로 우회하는 길을 안내한다. */
'use strict';

var fs = require('node:fs');
var path = require('node:path');
var client = require('./naver-client.js');

var ROOT_CORTAR_NO = '0000000000'; // 최상위 = 시도 목록
var CACHE_SCHEMA_VERSION = 1;

// ------------------------------------------------------------------
// 캐시 입출력 — 깨진 캐시는 무시하고 새로 만든다(조용히 잘못된 코드를 쓰지 않기 위해)
// ------------------------------------------------------------------
function loadCache(cachePath, log) {
  try {
    if (!fs.existsSync(cachePath)) return null;
    var parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (!parsed || parsed.schemaVersion !== CACHE_SCHEMA_VERSION) {
      log('지역 캐시의 schemaVersion이 다르다 → 무시하고 다시 조회한다.');
      return null;
    }
    return parsed;
  } catch (e) {
    log('지역 캐시를 읽을 수 없다(' + e.message + ') → 무시하고 다시 조회한다.');
    return null;
  }
}

function saveCache(cachePath, cache) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  var tmp = cachePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n');
  fs.renameSync(tmp, cachePath);
}

function isCacheFresh(cache, ttlDays) {
  if (!cache || !cache.fetchedAt) return false;
  var ageMs = Date.now() - new Date(cache.fetchedAt).getTime();
  if (!isFinite(ageMs) || ageMs < 0) return false;
  return ageMs < ttlDays * 24 * 60 * 60 * 1000;
}

// ------------------------------------------------------------------
// 응답 검증 — 스펙과 다르면 추측하지 않고 에러를 던진다
// ------------------------------------------------------------------
function extractRegionList(json, label) {
  if (!json || !Array.isArray(json.regionList)) {
    throw client.ApiError(
      'parse',
      label + ' 응답에 regionList 배열이 없다. 네이버 API 스펙이 바뀐 것으로 보인다. ' +
        '(--verify 로 응답 구조를 확인하고 상위 세션에 보고해야 한다)'
    );
  }
  return json.regionList;
}

function isValidCortarNo(v) {
  return typeof v === 'string' && /^\d{10}$/.test(v);
}

/** 이름이 정확히 일치하는 항목 1개 (시도·구 선택용) */
function findExact(list, name) {
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].cortarName === name) return list[i];
  }
  return null;
}

/** 접두어 매칭 (동 확장용): "당산동" → 당산동, 당산동1가 … */
function findByPrefix(list, prefix) {
  return list.filter(function (r) {
    return r && typeof r.cortarName === 'string' && r.cortarName.indexOf(prefix) === 0;
  });
}

/** 동 항목을 우리 스키마로 정규화. 좌표가 없으면 bbox를 만들 수 없으므로 버리고 경고한다. */
function toRegion(raw, guName, warnings) {
  if (!isValidCortarNo(raw.cortarNo)) {
    warnings.push('cortarNo 형식이 10자리 숫자가 아니다: ' + JSON.stringify(raw.cortarNo) + ' → 제외');
    return null;
  }
  var lat = Number(raw.centerLat);
  var lon = Number(raw.centerLon);
  if (!isFinite(lat) || !isFinite(lon) || lat === 0 || lon === 0) {
    warnings.push(
      (raw.cortarName || raw.cortarNo) + ': centerLat/centerLon이 없어 bbox를 만들 수 없다 → 제외'
    );
    return null;
  }
  return {
    cortarNo: raw.cortarNo,
    name: String(raw.cortarName || raw.cortarNo),
    gu: guName,
    centerLat: lat,
    centerLon: lon
  };
}

// ------------------------------------------------------------------
// 메인: 대상 지역 해석
// ------------------------------------------------------------------

/**
 * config.regions.include 의 (구, 동) 목록을 cortarNo 목록으로 해석한다.
 * @param {object} o client(createClient 결과 또는 null), config, cachePath, log, allowNetwork
 * @returns {Promise<{regions:Array, source:string, warnings:string[], cacheUsed:boolean}>}
 */
async function resolveRegions(o) {
  var cfg = o.config;
  var log = o.log || function () {};
  var warnings = [];
  var maxCodes = o.maxRegionCodes;
  var include = (cfg.regions && cfg.regions.include) || [];

  if (!include.length) {
    throw client.ApiError('parse', 'config.json의 regions.include가 비어 있다. 대상 지역이 없다.');
  }

  // 0) 수동 지정이 있으면 드릴다운을 건너뛴다 (spec V3 실패 대응 경로)
  var manual = (cfg.regions && cfg.regions.manual) || [];
  if (manual.length) {
    var manualRegions = [];
    manual.forEach(function (m) {
      var r = toRegion(
        { cortarNo: m.cortarNo, cortarName: m.name, centerLat: m.centerLat, centerLon: m.centerLon },
        m.gu || '',
        warnings
      );
      if (r) manualRegions.push(r);
    });
    if (!manualRegions.length) {
      throw client.ApiError('parse', 'config.regions.manual에 유효한 항목이 없다 (cortarNo 10자리·좌표 필수).');
    }
    log('지역: config.regions.manual 사용 (' + manualRegions.length + '개) — regions/list를 호출하지 않는다.');
    return capRegions(manualRegions, maxCodes, warnings, 'config.regions.manual');
  }

  // 1) 캐시
  var cache = loadCache(o.cachePath, log);
  var ttlDays = (cfg.regions && cfg.regions.cacheTtlDays) || 7;
  var needed = requiredGuNames(include);

  if (cache && isCacheFresh(cache, ttlDays) && cache.sido === cfg.regions.sido && hasAllGu(cache, needed)) {
    var fromCache = pickFromCache(cache, include, warnings);
    if (fromCache.length) {
      log('지역: 캐시 사용 (' + fromCache.length + '개 법정동, 조회 시각 ' + cache.fetchedAt + ')');
      return capRegions(fromCache, maxCodes, warnings, 'cache');
    }
    warnings.push('캐시에 대상 동이 없어 다시 조회한다.');
  }

  // 2) 네트워크 드릴다운
  if (!o.client || o.allowNetwork === false) {
    throw client.ApiError(
      'parse',
      '지역 캐시가 없고 네트워크 조회가 허용되지 않았다. ' +
        '(--dry-run은 캐시가 있어야 실제 cortarNo를 보여줄 수 있다)'
    );
  }

  var c = o.client;
  var sidoName = (cfg.regions && cfg.regions.sido) || '서울특별시';

  var sidoList = extractRegionList(
    (await c.get(client.buildRegionListUrl(ROOT_CORTAR_NO), { label: 'regions/list 시도 목록' })).json,
    'regions/list(시도)'
  );
  var sido = findExact(sidoList, sidoName);
  if (!sido || !isValidCortarNo(sido.cortarNo)) {
    throw client.ApiError(
      'parse',
      '시도 목록에서 "' + sidoName + '"을(를) 찾지 못했다. 응답에 있던 이름: ' +
        sidoList
          .slice(0, 20)
          .map(function (r) {
            return r.cortarName;
          })
          .join(', ')
    );
  }

  var guList = extractRegionList(
    (await c.get(client.buildRegionListUrl(sido.cortarNo), { label: 'regions/list ' + sidoName + ' 구 목록' }))
      .json,
    'regions/list(구)'
  );

  var newCache = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    fetchedAt: new Date().toISOString(),
    sido: sidoName,
    sidoCortarNo: sido.cortarNo,
    gu: {}
  };

  var resolved = [];
  for (var i = 0; i < needed.length; i++) {
    var guName = needed[i];
    var gu = findExact(guList, guName);
    if (!gu || !isValidCortarNo(gu.cortarNo)) {
      warnings.push(sidoName + ' 안에서 "' + guName + '"을(를) 찾지 못했다 → 이 구의 동은 모두 제외');
      continue;
    }
    var dongList = extractRegionList(
      (await c.get(client.buildRegionListUrl(gu.cortarNo), { label: 'regions/list ' + guName + ' 법정동 목록' }))
        .json,
      'regions/list(동)'
    );
    var dongs = [];
    dongList.forEach(function (raw) {
      var r = toRegion(raw, guName, warnings);
      if (r) dongs.push(r);
    });
    newCache.gu[guName] = { cortarNo: gu.cortarNo, dongs: dongs };
  }

  saveCache(o.cachePath, newCache);
  resolved = pickFromCache(newCache, include, warnings);

  if (!resolved.length) {
    throw client.ApiError(
      'parse',
      '설정한 동 이름에 해당하는 법정동을 하나도 찾지 못했다. config.json의 지역 이름을 확인해야 한다.'
    );
  }

  log('지역: regions/list 드릴다운으로 ' + resolved.length + '개 법정동 해석 → 캐시 저장');
  return capRegions(resolved, maxCodes, warnings, 'regions/list');
}

function requiredGuNames(include) {
  var seen = [];
  include.forEach(function (e) {
    if (e && e.gu && seen.indexOf(e.gu) === -1) seen.push(e.gu);
  });
  return seen;
}

function hasAllGu(cache, guNames) {
  return guNames.every(function (g) {
    return cache.gu && cache.gu[g] && Array.isArray(cache.gu[g].dongs);
  });
}

/** 캐시(또는 방금 만든 캐시)에서 include 조건에 맞는 동을 접두어 매칭으로 뽑는다 */
function pickFromCache(cache, include, warnings) {
  var out = [];
  var seen = Object.create(null);
  include.forEach(function (entry) {
    if (!entry || !entry.gu || !entry.dong) {
      warnings.push('regions.include 항목 형식 오류: ' + JSON.stringify(entry) + ' → 무시');
      return;
    }
    var bucket = cache.gu && cache.gu[entry.gu];
    if (!bucket) {
      warnings.push(entry.gu + ' 정보가 없어 ' + entry.dong + '을(를) 해석할 수 없다');
      return;
    }
    var matched = findByPrefixOnRegions(bucket.dongs, entry.dong);
    if (!matched.length) {
      // 조용히 넘기면 "매물 0건"으로 오해하게 된다. 반드시 경고로 드러낸다.
      warnings.push(
        entry.gu + '에서 "' + entry.dong + '"으로 시작하는 법정동을 찾지 못했다 → 이 지역은 수집되지 않는다'
      );
      return;
    }
    matched.forEach(function (r) {
      if (seen[r.cortarNo]) return;
      seen[r.cortarNo] = true;
      out.push(r);
    });
  });
  return out;
}

function findByPrefixOnRegions(regions, prefix) {
  return (regions || []).filter(function (r) {
    return r && typeof r.name === 'string' && r.name.indexOf(prefix) === 0;
  });
}

/** 대상 코드 수 상한 적용 — 넘치면 잘라내고 무엇이 빠졌는지 경고한다 */
function capRegions(regions, maxCodes, warnings, source) {
  var limited = regions;
  if (typeof maxCodes === 'number' && regions.length > maxCodes) {
    limited = regions.slice(0, maxCodes);
    warnings.push(
      '대상 법정동이 ' + regions.length + '개로 상한(' + maxCodes + ')을 넘었다 → 앞 ' + maxCodes +
        '개만 수집한다. 제외됨: ' +
        regions
          .slice(maxCodes)
          .map(function (r) {
            return r.name;
          })
          .join(', ')
    );
  }
  return { regions: limited, source: source, warnings: warnings, cacheUsed: source === 'cache' };
}

module.exports = {
  ROOT_CORTAR_NO: ROOT_CORTAR_NO,
  CACHE_SCHEMA_VERSION: CACHE_SCHEMA_VERSION,
  resolveRegions: resolveRegions,
  loadCache: loadCache,
  saveCache: saveCache,
  isCacheFresh: isCacheFresh,
  extractRegionList: extractRegionList,
  findExact: findExact,
  findByPrefix: findByPrefix,
  isValidCortarNo: isValidCortarNo
};
