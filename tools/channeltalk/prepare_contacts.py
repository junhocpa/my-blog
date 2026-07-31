#!/usr/bin/env python3
"""채널톡 연락처 xlsx("User data" 시트)를 파싱해 세그먼트 JSON을 생성한다.

사용법:
    python3 prepare_contacts.py <연락처.xlsx> <출력디렉터리>

출력 (모두 출력디렉터리 안, git에 커밋 금지 — 고객 PII 포함):
    contacts.json           전체 연락처 (정규화됨)
    seg_unnamed.json        이름 없음 + 연락처 정보 있음 (신원 추정 대상)
    seg_named_untagged.json 이름 있음 + 태그 없음 (서비스유형 분류 대상)
    seg_named_tagged.json   이름·태그 모두 있음 (경량 분류)
    seg_unidentifiable.json 이름·연락처 모두 없음 (추정 불가)
"""
import sys, json, re, collections, warnings

warnings.filterwarnings("ignore")


def norm_phone(p):
    if not p:
        return None
    d = re.sub(r"\D", "", str(p))
    if d.startswith("82"):
        d = "0" + d[2:]
    return d or None


def main(xlsx_path, out_dir):
    import os
    import openpyxl

    os.makedirs(out_dir, exist_ok=True)
    wb = openpyxl.load_workbook(xlsx_path, read_only=True)
    ws = wb["User data"]
    rows = list(ws.iter_rows(values_only=True))
    data = rows[1:]

    contacts = []
    for r in data:
        contacts.append({
            "id": r[0],
            "name": (str(r[1]).strip() if r[1] else None),
            "email": (str(r[2]).strip().lower() if r[2] else None),
            "mobile": norm_phone(r[3]),
            "landline": norm_phone(r[4]),
            "memberId": r[5],
            "tags": (str(r[6]).strip() if r[6] else None),
            "description": (str(r[7]).strip() if r[7] else None),
        })

    def has_contact(c):
        return c["email"] or c["mobile"] or c["landline"]

    unnamed = [c for c in contacts if not c["name"]]
    segs = {
        "contacts.json": contacts,
        "seg_unnamed.json": [c for c in unnamed if has_contact(c)],
        "seg_named_untagged.json": [c for c in contacts if c["name"] and not c["tags"]],
        "seg_named_tagged.json": [c for c in contacts if c["name"] and c["tags"]],
        "seg_unidentifiable.json": [c for c in unnamed if not has_contact(c)],
    }
    for fname, seg in segs.items():
        with open(f"{out_dir}/{fname}", "w") as f:
            json.dump(seg, f, ensure_ascii=False, indent=1)
        print(f"{fname}: {len(seg)}건")

    dup = collections.Counter()
    for c in contacts:
        for k in (c["mobile"], c["email"]):
            if k:
                dup[k] += 1
    dups = {k: v for k, v in dup.items() if v > 1}
    print(f"중복 연락처 키: {len(dups)}개")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
