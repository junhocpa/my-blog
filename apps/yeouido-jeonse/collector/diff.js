/* diff.js — 이전 스냅샷과 비교해 신규/사라짐/가격변동을 판정한다 (spec 8.3)
   순수 함수만 둔다(파일 입출력 없음) → 손으로 만든 데이터로 단독 검증할 수 있다.

   핵심 방어 규칙
   1. 최초 실행에서는 전부 신규로 표시하지 않는다. 기준 스냅샷을 만들 뿐이고 stats.new = null이다.
   2. 수집이 실패한 지역의 매물은 "사라졌다"고 판정하지 않는다.
      차단·오류를 매물 소멸로 오독하는 것이 이 도구에서 가장 위험한 오류다.
   3. 사라진 매물은 즉시 지우지 않고 keepDisappearedDays 동안 표시한 뒤 제거한다. */
'use strict';

var DEFAULT_RECENT_CHANGE_DAYS = 7; // 가격변동 배지를 며칠간 유지할지
var MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(laterIso, earlierIso) {
  var a = new Date(laterIso).getTime();
  var b = new Date(earlierIso).getTime();
  if (!isFinite(a) || !isFinite(b)) return Infinity;
  return (a - b) / MS_PER_DAY;
}

function indexById(listings) {
  var map = Object.create(null);
  (listings || []).forEach(function (l) {
    if (l && l.id) map[String(l.id)] = l;
  });
  return map;
}

/**
 * @param {object} o
 *   prev                이전 listings.json 객체 (없으면 null → 최초 실행)
 *   currListings        이번 수집·정규화 결과 배열
 *   history             이전 history.json 객체 (없으면 null)
 *   now                 ISO 시각 문자열
 *   failedRegionCodes   이번 실행에서 수집이 실패한 cortarNo 배열
 *   skippedIds          정규화에 실패해 이번 스냅샷에서 빠진 매물번호 배열 (사라짐 판정 보류)
 *   keepDisappearedDays 사라진 매물 보관 일수 (기본 14)
 *   historyMaxSnapshots runs 배열 보관 개수 (기본 60)
 *   recentChangeDays    가격변동 배지 유지 일수 (기본 7)
 * @returns {{listings:Array, stats:object, history:object, notes:string[]}}
 */
function computeDiff(o) {
  var now = o.now;
  var keepDays = typeof o.keepDisappearedDays === 'number' ? o.keepDisappearedDays : 14;
  var maxRuns = typeof o.historyMaxSnapshots === 'number' ? o.historyMaxSnapshots : 60;
  var recentDays =
    typeof o.recentChangeDays === 'number' ? o.recentChangeDays : DEFAULT_RECENT_CHANGE_DAYS;

  var prevListings = o.prev && Array.isArray(o.prev.listings) ? o.prev.listings : null;
  var isFirstRun = prevListings === null;
  var prevById = indexById(prevListings);
  var currById = indexById(o.currListings);
  var notes = [];

  var failed = Object.create(null);
  (o.failedRegionCodes || []).forEach(function (c) {
    failed[String(c)] = true;
  });
  var anyRegionFailed = Object.keys(failed).length > 0;

  // 정규화에 실패해 이번 스냅샷에서 빠진 매물. 응답에는 있었으므로 "사라진" 것이 아니다.
  var skipped = Object.create(null);
  (o.skippedIds || []).forEach(function (id) {
    skipped[String(id)] = true;
  });

  var histIn = o.history && o.history.items ? o.history.items : {};
  var histOut = Object.create(null);

  var out = [];
  var newCount = 0;
  var priceChangedCount = 0;

  // ---------- 이번에 관측된 매물 ----------
  (o.currListings || []).forEach(function (curr) {
    var id = String(curr.id);
    var prevItem = prevById[id] || null;
    var hist = histIn[id] || null;

    var firstSeenAt =
      (hist && hist.firstSeenAt) || (prevItem && prevItem.firstSeenAt) || now;

    var isNew = !isFirstRun && !prevItem;
    if (isNew) newCount += 1;

    // 가격 변동: 직전 스냅샷의 보증금과 비교
    var priceChange = null;
    if (prevItem && typeof prevItem.deposit === 'number' && prevItem.deposit !== curr.deposit) {
      priceChange = {
        from: prevItem.deposit,
        to: curr.deposit,
        direction: curr.deposit < prevItem.deposit ? 'down' : 'up',
        changedAt: now
      };
      priceChangedCount += 1;
    } else if (
      prevItem &&
      prevItem.priceChange &&
      prevItem.priceChange.changedAt &&
      daysBetween(now, prevItem.priceChange.changedAt) <= recentDays
    ) {
      // 최근 변동은 배지를 며칠 유지한다 (이번 실행의 변동 건수에는 세지 않는다)
      priceChange = prevItem.priceChange;
    }

    var item = Object.assign({}, curr, {
      firstSeenAt: firstSeenAt,
      lastSeenAt: now,
      status: 'active',
      isNew: isNew,
      priceChange: priceChange
    });
    delete item.heldDueToFailure;
    delete item.disappearedAt;
    out.push(item);

    // 이력: 가격이 바뀔 때만 append
    var priceHistory = (hist && Array.isArray(hist.priceHistory) && hist.priceHistory.slice()) || [];
    var last = priceHistory.length ? priceHistory[priceHistory.length - 1] : null;
    if (!last || last.deposit !== curr.deposit) {
      priceHistory.push({ at: priceHistory.length ? now : firstSeenAt, deposit: curr.deposit });
    }
    histOut[id] = {
      firstSeenAt: firstSeenAt,
      lastSeenAt: now,
      priceHistory: priceHistory,
      status: 'active'
    };
  });

  // ---------- 이번에 관측되지 않은 이전 매물 ----------
  var newlyDisappeared = 0;
  var heldForFailure = 0;
  var heldForSkip = 0;   // 그중 정규화 실패로 보류된 건수
  var removedExpired = 0;

  Object.keys(prevById).forEach(function (id) {
    if (currById[id]) return;
    var prevItem = prevById[id];
    var hist = histIn[id] || null;

    // (2) 실패한 지역이면 삭제 판정을 보류한다.
    //     regionCode를 모르는 매물(응답에 cortarNo가 없던 건)은 어느 지역인지 확인할 수 없으므로,
    //     실패한 지역이 하나라도 있으면 역시 보류한다 — 판단 불가를 "사라짐"으로 위장하지 않는다.
    // (2-b) 응답에는 있었지만 정규화에 실패해 빠진 매물도 보류한다.
    //       파싱 실패를 "매물이 사라졌다"로 보고하면 사용자가 잘못된 결론을 내린다.
    if (
      failed[String(prevItem.regionCode)] ||
      (anyRegionFailed && !prevItem.regionCode) ||
      skipped[String(id)]
    ) {
      heldForFailure += 1;
      if (skipped[String(id)]) heldForSkip += 1;
      var held = Object.assign({}, prevItem, { heldDueToFailure: true });
      out.push(held);
      histOut[id] = {
        firstSeenAt: (hist && hist.firstSeenAt) || prevItem.firstSeenAt || null,
        lastSeenAt: (hist && hist.lastSeenAt) || prevItem.lastSeenAt || null,
        priceHistory: (hist && hist.priceHistory) || [],
        status: prevItem.status || 'active'
      };
      return;
    }

    var disappearedAt = prevItem.disappearedAt || now;
    if (daysBetween(now, disappearedAt) > keepDays) {
      removedExpired += 1; // 보관 기간 경과 → 목록과 이력에서 제거
      return;
    }

    if (prevItem.status !== 'disappeared') newlyDisappeared += 1;

    var gone = Object.assign({}, prevItem, {
      status: 'disappeared',
      isNew: false,
      disappearedAt: disappearedAt
    });
    delete gone.heldDueToFailure;
    out.push(gone);

    histOut[id] = {
      firstSeenAt: (hist && hist.firstSeenAt) || prevItem.firstSeenAt || null,
      lastSeenAt: (hist && hist.lastSeenAt) || prevItem.lastSeenAt || null,
      priceHistory: (hist && hist.priceHistory) || [],
      status: 'disappeared'
    };
  });

  if (isFirstRun) {
    notes.push('최초 실행 — 기준 스냅샷을 만들었다. 신규 판정은 다음 실행부터 의미가 있다.');
  }
  if (heldForFailure > 0) {
    notes.push(
      heldForFailure + '건은 삭제 판정을 보류했다 (사라짐으로 처리하지 않음)' +
        (heldForSkip > 0
          ? ' — 수집 실패 지역 ' + (heldForFailure - heldForSkip) + '건, 정규화 실패 ' + heldForSkip + '건.'
          : ' — 수집 실패 지역의 매물이다.')
    );
  }
  if (removedExpired > 0) {
    notes.push(removedExpired + '건은 사라진 뒤 ' + keepDays + '일이 지나 목록에서 제거했다.');
  }

  var activeCount = out.filter(function (l) {
    return l.status !== 'disappeared';
  }).length;
  var disappearedCount = out.length - activeCount;

  var stats = {
    total: activeCount,
    new: isFirstRun ? null : newCount,
    priceChanged: priceChangedCount,
    disappeared: disappearedCount,
    newlyDisappeared: newlyDisappeared,
    heldForFailure: heldForFailure,
    heldForSkip: heldForSkip,
    errors: (o.failedRegionCodes || []).length,
    baselineCreated: isFirstRun
  };

  // ---------- history.json ----------
  var runs = (o.history && Array.isArray(o.history.runs) && o.history.runs.slice()) || [];
  runs.push({ at: now, total: stats.total, new: stats.new, errors: stats.errors });
  if (runs.length > maxRuns) runs = runs.slice(runs.length - maxRuns);

  var history = {
    schemaVersion: 1,
    updatedAt: now,
    items: histOut,
    runs: runs
  };

  return { listings: out, stats: stats, history: history, notes: notes };
}

module.exports = {
  computeDiff: computeDiff,
  DEFAULT_RECENT_CHANGE_DAYS: DEFAULT_RECENT_CHANGE_DAYS
};
