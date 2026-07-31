#!/usr/bin/env python3
"""채널톡 Open API에서 통화로그(Meet)·상담내역(UserChat)을 조회 전용으로 수집한다.

인증 (환경변수, 절대 코드/저장소에 넣지 않는다):
    CHANNEL_ACCESS_KEY, CHANNEL_ACCESS_SECRET

사용법:
    # 1) 연결 확인
    python3 collect_channeltalk.py check

    # 2) 통화로그 전체 수집 → <출력디렉터리>/call_log.json
    python3 collect_channeltalk.py call-log <출력디렉터리>

    # 3) 유저별 상담내역 수집 (prepare_contacts.py 산출물 사용)
    #    → <출력디렉터리>/userchats/<userId>.json
    python3 collect_channeltalk.py user-chats <contacts.json> <출력디렉터리> [--max-messages 30]

API 규약 (Channel Talk API Reference, ko-2026-06-01 기준):
  - Base URL   : https://api.channel.io
  - 헤더       : x-access-key / x-access-secret / Channel-Version: 2026-06-01
  - Rate limit : Leaky Bucket, 일반 엔드포인트 초당 10건 → 초당 8건으로 스로틀
                 429 응답 시 Retry-After(초)만큼 대기 후 재시도
  - 페이지네이션: cursor 기반 (next / nextCursor) — 응답에 따라 자동 처리
수집 결과에는 고객 PII가 포함되므로 출력디렉터리를 git에 커밋하지 않는다.
"""
import sys, os, json, time
import urllib.request, urllib.parse, urllib.error

BASE = "https://api.channel.io"
VERSION = "2026-06-01"
MIN_INTERVAL = 0.125  # 초당 8건
_last_req = [0.0]


def _headers():
    key = os.environ.get("CHANNEL_ACCESS_KEY")
    secret = os.environ.get("CHANNEL_ACCESS_SECRET")
    if not key or not secret:
        sys.exit("CHANNEL_ACCESS_KEY / CHANNEL_ACCESS_SECRET 환경변수를 설정하세요.")
    return {
        "accept": "application/json",
        "x-access-key": key,
        "x-access-secret": secret,
        "Channel-Version": VERSION,
    }


def api_get(path, params=None, retries=5):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    for attempt in range(retries):
        wait = _last_req[0] + MIN_INTERVAL - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_req[0] = time.time()
        req = urllib.request.Request(url, headers=_headers())
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = int(e.headers.get("Retry-After", "3"))
                time.sleep(retry_after + 0.5)
                continue
            if e.code >= 500:
                time.sleep(2 ** attempt)
                continue
            # 404 등은 호출자에서 구분
            return {"_error": e.code, "_detail": e.read().decode(errors="replace")[:500]}
        except Exception as e:  # 네트워크 오류
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    return {"_error": "retries_exhausted"}


def paginate(path, params=None, item_keys=("callLogs", "userChats", "messages", "users")):
    """cursor 기반 페이지네이션을 따라가며 아이템을 모두 수집한다."""
    params = dict(params or {})
    items, pages = [], 0
    while True:
        data = api_get(path, params)
        if "_error" in data:
            return items, data
        found = False
        for k in item_keys:
            if isinstance(data.get(k), list):
                items.extend(data[k])
                found = True
                break
        if not found:
            # 알 수 없는 응답 형태 — 원본 저장을 위해 그대로 반환
            return items, data
        pages += 1
        cursor = data.get("next") or data.get("nextCursor")
        if not cursor or pages > 500:
            return items, None
        params["since"] = cursor


def cmd_check():
    data = api_get("/open/channel")
    if "_error" in data:
        print("연결됨(HTTP 도달), 응답 오류:", data)
    else:
        ch = data.get("channel", data)
        print("연결 성공:", ch.get("name", "?"), "| id:", ch.get("id", "?"))


def cmd_call_log(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    items, err = paginate("/open/meet/call/log", {"limit": 100})
    out = {"callLogs": items, "error": err}
    with open(f"{out_dir}/call_log.json", "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"통화로그 {len(items)}건 저장", "| 오류:" if err else "", err or "")


def cmd_user_chats(contacts_path, out_dir, max_messages=30):
    os.makedirs(f"{out_dir}/userchats", exist_ok=True)
    contacts = json.load(open(contacts_path))
    done = err_cnt = 0
    for i, c in enumerate(contacts):
        uid = c["id"]
        out_path = f"{out_dir}/userchats/{uid}.json"
        if os.path.exists(out_path):
            continue
        chats, err = paginate(f"/open/users/{uid}/user-chats", {"limit": 25})
        record = {"userId": uid, "chats": [], "error": err}
        for chat in chats:
            chat_id = chat.get("id")
            msgs, merr = ([], None)
            if chat_id:
                msgs, merr = paginate(f"/open/user-chats/{chat_id}/messages", {"limit": max_messages})
            record["chats"].append({
                "chat": chat,
                "messages": msgs[:max_messages],
                "messagesError": merr,
            })
        with open(out_path, "w") as f:
            json.dump(record, f, ensure_ascii=False, indent=1)
        done += 1
        if err:
            err_cnt += 1
        if (i + 1) % 50 == 0:
            print(f"진행 {i+1}/{len(contacts)} (저장 {done}, 오류 {err_cnt})")
    print(f"완료: {done}건 저장, 오류 {err_cnt}건")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    cmd = args[0]
    if cmd == "check":
        cmd_check()
    elif cmd == "call-log":
        cmd_call_log(args[1])
    elif cmd == "user-chats":
        max_m = 30
        if "--max-messages" in args:
            idx = args.index("--max-messages")
            max_m = int(args[idx + 1])
            args = args[:idx] + args[idx + 2:]
        cmd_user_chats(args[1], args[2], max_m)
    else:
        sys.exit(__doc__)
