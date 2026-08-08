/* normalize.js — 모바일 API 원본 응답 → spec 6.2 스키마
   방어적 파싱 원칙
   1. 필수 필드(atclNo, prc)가 없으면 그 건만 건너뛰고 이유를 센다. 추측해서 채우지 않는다.
   2. 금액 단위는 prc(숫자)와 hanPrc(한글 표기)를 교차 검증한다.
      "prc는 만원 단위"라는 전제가 틀리면 4억이 4조로 표시되므로, 불일치는 반드시 경고로 드러낸다.
   3. rletTpCd는 요청(APT/OPST)과 응답(A01/A02)의 코드 체계가 다르다.
      응답에서는 rletTpNm(한글명)을 먼저 신뢰하고, 없을 때만 매핑 테이블을 쓴다.
   4. 값이 없으면 null로 남기고, "없음"을 0이나 빈 문자열로 위장하지 않는다. */
'use strict';

var client = require('./naver-client.js');

var PYEONG_PER_M2 = 3.3058;

// 응답 rletTpCd → 한글명 (spec 2.2 주의 사항)
var RESPONSE_TYPE_CODE_NAMES = {
  A01: '아파트',
  A02: '오피스텔',
  B01: '빌라',
  C02: '빌라',
  D01: '사무실',
  E03: '토지'
};

// 요청 rletTpCd → 한글명 (설정 검증·표시용)
var REQUEST_TYPE_CODE_NAMES = {
  APT: '아파트',
  OPST: '오피스텔',
  VL: '빌라',
  ABYG: '아파트분양권',
  OBYG: '오피스텔분양권',
  JGC: '재건축',
  OR: '원룸',
  GSW: '고시원',
  DDDGG: '단독/다가구'
};

var TRADE_CODE_NAMES = { A1: '매매', B1: '전세', B2: '월세', B3: '단기임대' };

// 보증금이 만원 단위라면 이 범위 밖은 비정상이다 (100만원 ~ 200억)
var DEPOSIT_SANE_MIN = 100;
var DEPOSIT_SANE_MAX = 2000000;

// ------------------------------------------------------------------
// 파서들
// ------------------------------------------------------------------

/** "7억 1,000" / "5억" / "9,500" / "1억5000" → 만원 정수. 해석 불가면 null */
function parseHanPrc(text) {
  if (typeof text !== 'string') return null;
  var s = text.replace(/[\s,]/g, '');
  if (!s) return null;
  var m = s.match(/^(?:(\d+)억)?(\d+)?$/);
  if (!m || (!m[1] && !m[2])) return null;
  var eok = m[1] ? parseInt(m[1], 10) : 0;
  var man = m[2] ? parseInt(m[2], 10) : 0;
  // "1억5000" 처럼 억 뒤 숫자는 만원 단위 그대로
  return eok * 10000 + man;
}

/** "7/10" → 7, "고/10"·"저/15"·"-" → null (정렬 시 뒤로 보낸다) */
function parseFloorNum(flrInfo) {
  if (typeof flrInfo !== 'string') return null;
  var head = flrInfo.split('/')[0].trim();
  if (!head || head === '-') return null;
  // 지하(B1 등)는 음수로
  var basement = head.match(/^B(\d+)$/i);
  if (basement) return -parseInt(basement[1], 10);
  var m = head.match(/^-?\d+$/);
  return m ? parseInt(head, 10) : null;
}

/** "25.08.06." → "2025-08-06", "20250322" → "2025-03-22". 해석 불가면 null */
function parseConfirmDate(raw) {
  if (typeof raw !== 'string') return null;
  var s = raw.trim().replace(/\.$/, '');
  var dotted = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (dotted) return '20' + dotted[1] + '-' + dotted[2] + '-' + dotted[3];
  var full = s.match(/^(\d{4})\.?(\d{2})\.?(\d{2})$/);
  if (full) return full[1] + '-' + full[2] + '-' + full[3];
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  return null;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function toStringOrNull(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  return s === '' ? null : s;
}

function m2ToPyeong(m2) {
  if (!isFinite(m2)) return null;
  return Math.round((m2 / PYEONG_PER_M2) * 10) / 10;
}

// ------------------------------------------------------------------
// 1건 정규화
// ------------------------------------------------------------------

/**
 * @param {object} raw body[] 원소
 * @param {object} ctx regionName(코드→이름 조회 결과), now(ISO 문자열)
 * @returns {{ok:true, listing:object, warnings:string[]}|{ok:false, reason:string}}
 */
function normalizeOne(raw, ctx) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not-an-object' };

  var id = toStringOrNull(raw.atclNo);
  if (!id) return { ok: false, reason: 'missing-atclNo' };

  var deposit = toNumberOrNull(raw.prc);
  if (deposit === null) return { ok: false, reason: 'missing-prc' };

  var warnings = [];

  // --- 금액 단위 교차 검증 (이 프로젝트에서 가장 중요한 방어) ---
  var depositText = toStringOrNull(raw.hanPrc);
  var fromHan = parseHanPrc(depositText);
  var unitSuspect = false;
  if (fromHan !== null && Math.abs(fromHan - deposit) > 1) {
    unitSuspect = true;
    warnings.push(
      id + ': prc(' + deposit + ')와 hanPrc("' + depositText + '"→' + fromHan + ')가 일치하지 않는다 ' +
        '— 금액 단위 전제가 틀렸을 수 있다'
    );
  }
  if (deposit < DEPOSIT_SANE_MIN || deposit > DEPOSIT_SANE_MAX) {
    unitSuspect = true;
    warnings.push(
      id + ': prc=' + deposit + ' 이(가) 만원 단위로 볼 수 없는 값이다 (정상 범위 ' +
        DEPOSIT_SANE_MIN + '~' + DEPOSIT_SANE_MAX + ')'
    );
  }

  // --- 매물종류: 한글명을 먼저 신뢰 ---
  var typeCode = toStringOrNull(raw.rletTpCd);
  var typeName = toStringOrNull(raw.rletTpNm);
  if (!typeName && typeCode) {
    typeName = RESPONSE_TYPE_CODE_NAMES[typeCode] || null;
    if (!typeName) warnings.push(id + ': 알 수 없는 매물종류 코드 ' + typeCode);
  }
  if (!typeName) warnings.push(id + ': 매물종류를 알 수 없다(rletTpNm/rletTpCd 모두 없음)');

  var tradeType = toStringOrNull(raw.tradTpNm);
  if (!tradeType) {
    var tradeCode = toStringOrNull(raw.tradTpCd);
    tradeType = (tradeCode && TRADE_CODE_NAMES[tradeCode]) || null;
  }

  var areaExclusive = toNumberOrNull(raw.spc2);
  var regionCode = toStringOrNull(raw.cortarNo);

  var listing = {
    id: id,
    name: toStringOrNull(raw.atclNm),
    buildingName: toStringOrNull(raw.bildNm),
    regionCode: regionCode,
    regionName: (ctx && ctx.regionName) || null,
    typeCode: typeCode,
    typeName: typeName,
    tradeType: tradeType,
    deposit: deposit,
    depositText: depositText || String(deposit) + '만',
    monthlyRent: toNumberOrNull(raw.rentPrc) || 0,
    areaSupplyM2: toNumberOrNull(raw.spc1),
    areaExclusiveM2: areaExclusive,
    areaExclusivePyeong: areaExclusive === null ? null : m2ToPyeong(areaExclusive),
    floor: toStringOrNull(raw.flrInfo),
    floorNum: parseFloorNum(raw.flrInfo),
    direction: toStringOrNull(raw.direction),
    confirmedDate: parseConfirmDate(raw.atclCfmYmd),
    tags: Array.isArray(raw.tagList)
      ? raw.tagList
          .map(function (t) {
            return toStringOrNull(t);
          })
          .filter(Boolean)
      : [],
    featureDesc: toStringOrNull(raw.atclFetrDesc),
    realtorName: toStringOrNull(raw.rltrNm),
    providerName: toStringOrNull(raw.cpNm),
    lat: toNumberOrNull(raw.lat),
    lng: toNumberOrNull(raw.lng),
    sameAddrCnt: toNumberOrNull(raw.sameAddrCnt) || 1,
    sourceUrl: client.articleInfoUrl(id),
    unitSuspect: unitSuspect,
    // diff.js가 채우는 필드 (여기서는 자리만 만들어 둔다)
    firstSeenAt: null,
    lastSeenAt: (ctx && ctx.now) || null,
    status: 'active',
    isNew: false,
    priceChange: null
  };

  return { ok: true, listing: listing, warnings: warnings };
}

// ------------------------------------------------------------------
// 여러 건 정규화 + 스키마 변경 감지
// ------------------------------------------------------------------

/**
 * @param {Array} rawList
 * @param {object} ctx regionName, now
 * @returns {{listings:Array, warnings:string[], skippedReasons:object, total:number,
 *            skipped:number, skipRate:number, unitSuspectCount:number, unitSuspectRate:number,
 *            optionalMissing:object}}
 */
function normalizeMany(rawList, ctx) {
  var list = Array.isArray(rawList) ? rawList : [];
  var listings = [];
  var warnings = [];
  var skippedReasons = Object.create(null);
  var unitSuspectCount = 0;
  var optionalMissing = { spc2: 0, rletTpNm: 0, atclCfmYmd: 0, flrInfo: 0, cortarNo: 0 };

  list.forEach(function (raw) {
    var res = normalizeOne(raw, ctx);
    if (!res.ok) {
      skippedReasons[res.reason] = (skippedReasons[res.reason] || 0) + 1;
      return;
    }
    if (res.warnings.length) warnings = warnings.concat(res.warnings);
    if (res.listing.unitSuspect) unitSuspectCount += 1;
    if (res.listing.areaExclusiveM2 === null) optionalMissing.spc2 += 1;
    if (res.listing.typeName === null) optionalMissing.rletTpNm += 1;
    if (res.listing.confirmedDate === null) optionalMissing.atclCfmYmd += 1;
    if (res.listing.floor === null) optionalMissing.flrInfo += 1;
    if (res.listing.regionCode === null) optionalMissing.cortarNo += 1;
    listings.push(res.listing);
  });

  var skipped = list.length - listings.length;
  return {
    listings: listings,
    warnings: warnings,
    skippedReasons: skippedReasons,
    total: list.length,
    skipped: skipped,
    skipRate: list.length ? skipped / list.length : 0,
    unitSuspectCount: unitSuspectCount,
    unitSuspectRate: listings.length ? unitSuspectCount / listings.length : 0,
    optionalMissing: optionalMissing
  };
}

// ------------------------------------------------------------------
// 2차 자체 필터
// ------------------------------------------------------------------

/**
 * 응답 cortarNo가 대상 지역인지 확인한다.
 * bbox가 넉넉해서 인접 동 매물이 섞여 들어와도 결과가 오염되지 않게 하는 안전장치다.
 * regionCode가 아예 없는 건은 판단 불가이므로 버리지 않고 남기되 카운트한다.
 */
function filterByRegion(listings, allowedCortarNos) {
  var allowed = Object.create(null);
  (allowedCortarNos || []).forEach(function (c) {
    allowed[String(c)] = true;
  });
  var kept = [];
  var droppedOtherRegion = 0;
  var unknownRegion = 0;
  listings.forEach(function (l) {
    if (l.regionCode === null) {
      unknownRegion += 1;
      kept.push(l);
      return;
    }
    if (allowed[l.regionCode]) {
      kept.push(l);
      return;
    }
    droppedOtherRegion += 1;
  });
  return { kept: kept, droppedOtherRegion: droppedOtherRegion, unknownRegion: unknownRegion };
}

/**
 * 검색 조건 자체 필터.
 * - selfFilterDeposit: 서버 wprc 필터를 신뢰하지 않고 prc로 한 번 더 걸러낸다.
 *   여기서 많이 걸러지면 "서버 필터가 동작하지 않는다"는 신호이므로 경고를 만든다.
 * - 주거용 오피스텔 판별: 전용면적 하한(기본 30㎡). 면적이 없으면 버리지 않고 남기며 카운트한다.
 */
function filterByCriteria(listings, criteria) {
  var c = criteria || {};
  var kept = [];
  var dropped = { deposit: 0, officetelTooSmall: 0, area: 0 };
  var officetelUnknownArea = 0;

  listings.forEach(function (l) {
    if (c.selfFilterDeposit !== false) {
      if (typeof c.depositMin === 'number' && l.deposit < c.depositMin) {
        dropped.deposit += 1;
        return;
      }
      if (typeof c.depositMax === 'number' && l.deposit > c.depositMax) {
        dropped.deposit += 1;
        return;
      }
    }
    if (typeof c.areaMinM2 === 'number' && l.areaExclusiveM2 !== null && l.areaExclusiveM2 < c.areaMinM2) {
      dropped.area += 1;
      return;
    }
    if (typeof c.areaMaxM2 === 'number' && l.areaExclusiveM2 !== null && l.areaExclusiveM2 > c.areaMaxM2) {
      dropped.area += 1;
      return;
    }
    if (c.excludeNonResidentialOfficetel && l.typeName === '오피스텔') {
      var min = typeof c.officetelMinExclusiveM2 === 'number' ? c.officetelMinExclusiveM2 : 30;
      if (l.areaExclusiveM2 === null) {
        officetelUnknownArea += 1; // 면적 불명 → 버리지 않고 남긴다(판단 불가를 삭제로 위장하지 않기)
      } else if (l.areaExclusiveM2 < min) {
        dropped.officetelTooSmall += 1;
        return;
      }
    }
    kept.push(l);
  });

  return { kept: kept, dropped: dropped, officetelUnknownArea: officetelUnknownArea };
}

module.exports = {
  PYEONG_PER_M2: PYEONG_PER_M2,
  RESPONSE_TYPE_CODE_NAMES: RESPONSE_TYPE_CODE_NAMES,
  REQUEST_TYPE_CODE_NAMES: REQUEST_TYPE_CODE_NAMES,
  TRADE_CODE_NAMES: TRADE_CODE_NAMES,
  parseHanPrc: parseHanPrc,
  parseFloorNum: parseFloorNum,
  parseConfirmDate: parseConfirmDate,
  m2ToPyeong: m2ToPyeong,
  normalizeOne: normalizeOne,
  normalizeMany: normalizeMany,
  filterByRegion: filterByRegion,
  filterByCriteria: filterByCriteria
};
