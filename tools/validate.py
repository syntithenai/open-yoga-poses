#!/usr/bin/env python3
"""Check the library's data files: poses, catalog, moves (transitions), routines and characters.

Run from the repo root: python3 tools/validate.py
Exits 1 and lists every problem when anything is wrong.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
CATEGORIES = {"standing", "floor", "arm-balance", "inversion", "chair", "breath", "transition"}
STEP_SIDES = {"right", "left"}
EASES = {"linear", "in", "out", "inOut"}
MAX_KEYS = 8

errors: list[str] = []


def err(where: str, msg: str) -> None:
    errors.append(f"{where}: {msg}")


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        err(str(path.relative_to(ROOT)), f"not valid JSON ({e})")
        return None


def is_vec(v, n: int) -> bool:
    return isinstance(v, list) and len(v) == n and all(isinstance(x, (int, float)) and math.isfinite(x) for x in v)


def check_bones(where: str, bones, bones_known: set[str]) -> None:
    if not isinstance(bones, dict) or "root" not in bones:
        err(where, '"bones" must be an object that includes "root"')
        return
    for name, q in bones.items():
        if name not in bones_known:
            err(where, f"unknown bone {name!r}")
        if not is_vec(q, 4):
            err(where, f"bone {name!r} must be a quaternion [w, x, y, z]")
        elif abs(math.sqrt(sum(x * x for x in q)) - 1) > 1e-3:
            err(where, f"bone {name!r} quaternion is not unit length")


def check_pose(path: Path, bones_known: set[str]) -> str | None:
    where = f"poses/{path.name}"
    doc = load(path)
    if not isinstance(doc, dict):
        return None
    pid = path.stem
    if doc.get("format") != "yoga-pose/1":
        err(where, 'format must be "yoga-pose/1"')
    if doc.get("pose") != pid:
        err(where, f'"pose" must match the file name ({pid})')
    if not ID_RE.match(pid):
        err(where, "file name must be lowercase letters, numbers and hyphens")
    if doc.get("rig") != "makehuman-default":
        err(where, 'rig must be "makehuman-default"')
    check_bones(where, doc.get("bones"), bones_known)
    for name, ax in (doc.get("restAxes") or {}).items():
        if name not in bones_known:
            err(where, f"restAxes: unknown bone {name!r}")
        if not is_vec(ax, 3):
            err(where, f"restAxes: {name!r} must be [x, y, z]")
    head = (doc.get("root") or {}).get("head")
    if head is not None and not is_vec(head, 3):
        err(where, "root.head must be [x, y, z]")
    floor = doc.get("floor") or {}
    for name in floor.get("contacts") or []:
        if name not in bones_known:
            err(where, f"floor.contacts: unknown bone {name!r}")
    return pid


def check_catalog(pose_ids: set[str]) -> set[str]:
    path = ROOT / "catalog.json"
    data = load(path)
    if not isinstance(data, list):
        err("catalog.json", "must be an array")
        return set()
    seen: set[str] = set()
    for i, p in enumerate(data):
        where = f"catalog.json[{i}]"
        pid = p.get("id") if isinstance(p, dict) else None
        if not isinstance(pid, str) or not ID_RE.match(pid):
            err(where, "needs an id of lowercase letters, numbers and hyphens")
            continue
        where = f"catalog.json {pid}"
        if pid in seen:
            err(where, "duplicate id")
        seen.add(pid)
        if not isinstance(p.get("name"), str) or not p["name"].strip():
            err(where, "needs a name")
        if p.get("category") not in CATEGORIES:
            err(where, f"category must be one of {sorted(CATEGORIES)}")
        d = p.get("difficulty")
        if d is not None and d not in (1, 2, 3, 4, 5):
            err(where, "difficulty must be 1 to 5")
        if pid not in pose_ids:
            err(where, f"no pose file poses/{pid}.json")
    for pid in sorted(pose_ids - seen):
        err(f"poses/{pid}.json", "has no catalog.json entry")
    for p in data:
        base = p.get("basePoseId") if isinstance(p, dict) else None
        if base and base not in seen:
            err(f"catalog.json {p.get('id')}", f"basePoseId {base!r} is not in the catalog")
    return seen


def check_transitions(catalog: set[str], bones_known: set[str]) -> int:
    path = ROOT / "transitions.json"
    if not path.is_file():
        return 0
    data = load(path)
    if not isinstance(data, dict):
        return 0
    if data.get("format") != "yoga-transitions/1":
        err("transitions.json", 'format must be "yoga-transitions/1"')
    moves = data.get("transitions") or {}
    for key, tr in moves.items():
        where = f"transitions.json {key}"
        a, sep, b = key.partition(">")
        if not sep or a == b:
            err(where, 'key must be "<from-id>><to-id>"')
        for pid in (a, b):
            if pid not in catalog:
                err(where, f"pose {pid!r} is not in catalog.json")
        if not isinstance(tr, dict):
            err(where, "must be an object")
            continue
        dur = tr.get("durationSec")
        if not isinstance(dur, (int, float)) or not 0.2 <= dur <= 30:
            err(where, "durationSec must be 0.2 to 30")
        if "endEase" in tr and tr["endEase"] not in EASES:
            err(where, f"endEase must be one of {sorted(EASES)}")
        keys = tr.get("keys")
        if not isinstance(keys, list) or len(keys) > MAX_KEYS:
            err(where, f"keys must be a list of at most {MAX_KEYS}")
            continue
        last = 0.0
        for i, k in enumerate(keys):
            kw = f"{where} key {i + 1}"
            t = k.get("t") if isinstance(k, dict) else None
            if not isinstance(t, (int, float)) or not last < t < 1:
                err(kw, "t must be between 0 and 1 and later than the key before")
            else:
                last = t
            if "ease" in k and k["ease"] not in EASES:
                err(kw, f"ease must be one of {sorted(EASES)}")
            pose = k.get("pose") if isinstance(k, dict) else None
            check_bones(kw, (pose or {}).get("bones"), bones_known)
            head = ((pose or {}).get("root") or {}).get("head")
            if head is not None and not is_vec(head, 3):
                err(kw, "root.head must be [x, y, z]")
    return len(moves)


def check_routine(path: Path, catalog: set[str]) -> None:
    where = f"routines/{path.name}"
    doc = load(path)
    if not isinstance(doc, dict):
        return
    if doc.get("format") != "open-yoga-routine/1":
        err(where, 'format must be "open-yoga-routine/1"')
    if doc.get("id") != path.stem or not ID_RE.match(path.stem):
        err(where, "id must match the file name (lowercase letters, numbers and hyphens)")
    if not isinstance(doc.get("title"), str) or not doc["title"].strip():
        err(where, "needs a title")
    if not isinstance((doc.get("author") or {}).get("name"), str):
        err(where, "needs author.name so the author is credited")
    if doc.get("level") not in (1, 2, 3, 4, 5):
        err(where, "level must be 1 to 5")
    steps = doc.get("steps")
    if not isinstance(steps, list) or not steps:
        err(where, "needs at least one step")
        return
    for i, s in enumerate(steps):
        sw = f"{where} step {i + 1}"
        if s.get("pose") not in catalog:
            err(sw, f"pose {s.get('pose')!r} is not in catalog.json")
        hold = s.get("holdSec")
        if not isinstance(hold, (int, float)) or not 1 <= hold <= 600:
            err(sw, "holdSec must be 1 to 600")
        if "side" in s and s["side"] not in STEP_SIDES:
            err(sw, "side must be right or left")


def check_characters() -> None:
    data = load(ROOT / "characters" / "index.json")
    if not isinstance(data, list) or not data:
        err("characters/index.json", "must list at least one character")
        return
    for c in data:
        f = ROOT / "characters" / str(c.get("file"))
        if not f.is_file():
            err("characters/index.json", f"{c.get('id')}: missing file {c.get('file')}")


def check_styles() -> None:
    path = ROOT / "styles" / "index.json"
    if not path.is_file():
        err("styles/index.json", "missing")
        return
    data = load(path)
    if not isinstance(data, list) or not data:
        err("styles/index.json", "must list at least one costume")
        return
    for s in data:
        if not s.get("id") or not s.get("label"):
            err("styles/index.json", f"entry needs id and label: {s!r}")
        if not isinstance(s.get("top"), list) or not isinstance(s.get("bottom"), list):
            err("styles/index.json", f"{s.get('id')}: top and bottom colours required")


def main() -> int:
    bones_known = set(load(ROOT / "tools" / "rig-bones.json") or [])
    if not bones_known:
        err("tools/rig-bones.json", "must list the rig's bone names")
    pose_ids = {pid for p in sorted((ROOT / "poses").glob("*.json")) if (pid := check_pose(p, bones_known))}
    catalog = check_catalog(pose_ids)
    moves = check_transitions(catalog, bones_known)
    for r in sorted((ROOT / "routines").glob("*.json")):
        if r.name == "index.json":
            continue
        check_routine(r, catalog)
    check_characters()
    check_styles()
    if errors:
        print(f"{len(errors)} problem(s):")
        for e in errors:
            print(f"  {e}")
        return 1
    routine_n = len([p for p in (ROOT / "routines").glob("*.json") if p.name != "index.json"])
    print(
        f"OK: {len(pose_ids)} poses, {moves} moves, "
        f"{routine_n} routines, "
        f"{len(load(ROOT / 'characters' / 'index.json') or [])} characters, "
        f"{len(load(ROOT / 'styles' / 'index.json') or [])} costumes"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
