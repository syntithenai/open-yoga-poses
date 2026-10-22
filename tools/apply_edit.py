#!/usr/bin/env python3
"""Apply the 3D data from an issue (made with the viewer's Suggest buttons) to the library.

The issue body carries an `open-yoga-edit/1` envelope (docs/FORMAT.md), either as plain JSON or as one
`OYE1.<base64url>` line of deflate-compressed JSON:
  kind "pose": changed bones (and root position) of an existing pose, merged into poses/<id>.json
  kind "move": a keyframed move, written to transitions.json under "<from>><to>"
  kind "app-pose": SynthYoga app submission — bones, catalog fields, teaching-field patch, animations
  kind "routine": an open-yoga-routine/1 document written to routines/<id>.json

Usage, from the repo root:
  python3 tools/apply_edit.py issue.md
  gh issue view 12 --json body -q .body | python3 tools/apply_edit.py -

Prints one line describing the change. Exits 1 without writing anything when the data is missing or invalid.
The "Apply 3D edit" workflow runs this when a maintainer adds the `apply-edit` label, then opens a pull request.
"""

from __future__ import annotations

import base64
import json
import math
import re
import sys
import zlib
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORMAT = "open-yoga-edit/1"
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
TOKEN_RE = re.compile(r"OYE1\.([A-Za-z0-9_-]+)")
FENCE_RE = re.compile(r"```[a-z]*\n(.*?)```", re.S)
EASES = {"linear", "in", "out", "inOut"}
CATEGORIES = {"standing", "floor", "arm-balance", "inversion", "chair", "breath", "transition"}
CATALOG_FIELD_MAP = {
    "name": "name",
    "sanskrit": "sanskrit",
    "altNames": "altNames",
    "category": "category",
    "intensity": "difficulty",
    "tags": "tags",
    "drishti": "drishti",
    "basePoseId": "basePoseId",
    "discipline": "discipline",
    "description": "description",
    "goodFor": "goodFor",
    "muscles": "muscles",
    "breathCue": "breathCue",
    "transitionIn": "transitionIn",
    "breathPattern": "breathPattern",
    "props": "props",
    "modifications": "modifications",
    "deepen": "deepen",
    "avoidIf": "avoidIf",
    "commonMistakes": "commonMistakes",
    "alignmentCues": "alignmentCues",
    "defaultHoldSec": "defaultHoldSec",
    "minHoldSec": "minHoldSec",
}
MAX_KEYS = 8
MAX_DATA = 512 * 1024
INCOMING = ROOT / "incoming"


class EditError(Exception):
    pass


def extract(body: str) -> dict:
    """The edit envelope in an issue body."""
    m = TOKEN_RE.search(body)
    if m:
        raw = m.group(1)
        try:
            data = zlib.decompressobj(-15).decompress(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)), MAX_DATA)
            env = json.loads(data)
        except (ValueError, zlib.error) as e:
            raise EditError(f"the compressed 3D data couldn't be read ({e})") from e
        if isinstance(env, dict) and env.get("format") == FORMAT:
            return env
    for text in [*FENCE_RE.findall(body), body]:
        start = text.find("{")
        if start < 0:
            continue
        try:
            env = json.loads(text[start : text.rfind("}") + 1])
        except ValueError:
            continue
        if isinstance(env, dict) and env.get("format") == FORMAT:
            return env
    raise EditError("no 3D data found in the issue")


def unit_quat(v, where: str) -> list[float]:
    if not (isinstance(v, list) and len(v) == 4 and all(isinstance(x, (int, float)) and math.isfinite(x) for x in v)):
        raise EditError(f"{where} must be a quaternion [w, x, y, z]")
    n = math.sqrt(sum(x * x for x in v))
    if not 0.9 < n < 1.1:
        raise EditError(f"{where} is not a unit quaternion")
    return [round(x / n, 6) for x in v]


def head(v, where: str) -> list[float]:
    if not (isinstance(v, list) and len(v) == 3 and all(isinstance(x, (int, float)) and math.isfinite(x) and abs(x) < 5 for x in v)):
        raise EditError(f"{where} must be [x, y, z] in metres")
    return [round(x, 6) for x in v]


def clean_bones(bones, known: set[str], where: str) -> dict:
    if not isinstance(bones, dict):
        raise EditError(f"{where}: bones must be an object")
    out = {}
    for name, q in bones.items():
        if name not in known:
            raise EditError(f"{where}: unknown bone {name!r}")
        out[name] = unit_quat(q, f"{where} bone {name!r}")
    return out


def dump(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def apply_pose(env: dict, known: set[str]) -> str:
    pid = env.get("pose")
    path = ROOT / "poses" / f"{pid}.json"
    if not isinstance(pid, str) or not ID_RE.match(pid) or not path.is_file():
        raise EditError(f"pose {pid!r} isn't in the library")
    bones = clean_bones(env.get("bones") or {}, known, pid)
    doc = json.loads(path.read_text(encoding="utf-8"))
    changes = []
    if bones:
        doc["bones"].update(bones)
        changes.append(f"{len(bones)} bone(s)")
    if (env.get("root") or {}).get("head") is not None:
        doc.setdefault("root", {})["head"] = head(env["root"]["head"], f"{pid} root.head")
        changes.append("root position")
    if "props" in env:
        props = env.get("props")
        if props is None:
            raise EditError(f"{pid}: props must be a list")
        if not isinstance(props, list):
            raise EditError(f"{pid}: props must be a list")
        if props:
            doc["props"] = props
        else:
            doc.pop("props", None)
        changes.append("props")
    if not changes:
        raise EditError("the edit doesn't change anything")
    dump(path, doc)
    return f"Updated pose {pid}: {', '.join(changes)}."


def _parse_transition(tr: dict, known: set[str], where: str) -> dict:
    if not isinstance(tr, dict):
        raise EditError(f"{where}: the move has no transition")
    dur = tr.get("durationSec")
    if not isinstance(dur, (int, float)) or not 0.2 <= dur <= 30:
        raise EditError(f"{where}: durationSec must be 0.2 to 30")
    keys_in = tr.get("keys") or []
    if not isinstance(keys_in, list) or len(keys_in) > MAX_KEYS:
        raise EditError(f"{where}: a move can have at most {MAX_KEYS} keys")
    keys = []
    for i, k in enumerate(sorted(keys_in, key=lambda k: k.get("t", 0) if isinstance(k, dict) else 0)):
        kw = f"{where} key {i + 1}"
        t = k.get("t") if isinstance(k, dict) else None
        if not isinstance(t, (int, float)) or not 0 < t < 1 or (keys and t <= keys[-1]["t"]):
            raise EditError(f"{kw}: t must be between 0 and 1, later than the key before")
        pose = k.get("pose") or {}
        out = {"t": round(t, 4), "pose": {"bones": clean_bones(pose.get("bones") or {}, known, kw)}}
        if "root" not in out["pose"]["bones"]:
            raise EditError(f"{kw}: bones must include root")
        if (pose.get("root") or {}).get("head") is not None:
            out["pose"]["root"] = {"head": head(pose["root"]["head"], f"{kw} root.head")}
        if k.get("ease") is not None:
            if k["ease"] not in EASES:
                raise EditError(f"{kw}: ease must be one of {sorted(EASES)}")
            out["ease"] = k["ease"]
        keys.append(out)
    move: dict = {"durationSec": round(float(dur), 2), "keys": keys}
    if isinstance(tr.get("breath"), str) and len(tr["breath"]) <= 40:
        move["breath"] = tr["breath"]
    if tr.get("endEase") is not None:
        if tr["endEase"] not in EASES:
            raise EditError(f"{where}: endEase must be one of {sorted(EASES)}")
        move["endEase"] = tr["endEase"]
    return move


def _write_move(a: str, b: str, move: dict) -> str:
    path = ROOT / "transitions.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {"format": "yoga-transitions/1", "transitions": {}}
    moves = data.setdefault("transitions", {})
    key = f"{a}>{b}"
    verb = "Updated" if key in moves else "Added"
    moves[key] = move
    data["transitions"] = dict(sorted(moves.items()))
    dump(path, data)
    return f"{verb} move {a} to {b}: {len(move['keys'])} key(s), {move['durationSec']} s."


def apply_move(env: dict, known: set[str]) -> str:
    catalog = {p["id"] for p in json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))}
    a, b = env.get("from"), env.get("to")
    if a not in catalog or b not in catalog or a == b:
        raise EditError(f"a move needs two different poses from the catalog (got {a!r} and {b!r})")
    move = _parse_transition(env.get("transition") or {}, known, "move")
    return _write_move(a, b, move)


def _update_catalog(pose_id: str, fields: dict) -> str | None:
    path = ROOT / "catalog.json"
    catalog = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else []
    if not isinstance(catalog, list):
        raise EditError("catalog.json must be an array")
    entry = next((p for p in catalog if isinstance(p, dict) and p.get("id") == pose_id), None)
    created = entry is None
    if created:
        name = str(fields.get("name") or pose_id).strip()
        if not name:
            raise EditError("new poses need a name")
        entry = {"id": pose_id, "name": name, "category": "standing"}
        catalog.append(entry)
    changed = []
    for src, dest in CATALOG_FIELD_MAP.items():
        if src not in fields:
            continue
        val = fields[src]
        if dest == "difficulty":
            d = int(val) if isinstance(val, (int, float)) else None
            if d not in (1, 2, 3, 4, 5):
                continue
            if entry.get("difficulty") != d:
                entry["difficulty"] = d
                changed.append("difficulty")
            continue
        if dest == "category":
            if val not in CATEGORIES:
                continue
            if entry.get("category") != val:
                entry["category"] = val
                changed.append("category")
            continue
        if dest in (
            "altNames",
            "tags",
            "muscles",
            "props",
            "modifications",
            "deepen",
            "avoidIf",
            "commonMistakes",
            "alignmentCues",
        ):
            if not isinstance(val, list):
                continue
            names = [str(x).strip() for x in val if str(x).strip()]
            if entry.get(dest) != names:
                entry[dest] = names
                changed.append(dest)
            continue
        if dest in ("defaultHoldSec", "minHoldSec"):
            n = int(val) if isinstance(val, (int, float)) else None
            if n is None or n < 1 or n > 600:
                continue
            if entry.get(dest) != n:
                entry[dest] = n
                changed.append(dest)
            continue
        if dest == "basePoseId":
            bid = str(val or "").strip()
            if bid and not ID_RE.match(bid):
                continue
            if bid:
                if entry.get("basePoseId") != bid:
                    entry["basePoseId"] = bid
                    changed.append("basePoseId")
            elif "basePoseId" in entry:
                del entry["basePoseId"]
                changed.append("basePoseId")
            continue
        if isinstance(val, str) and val.strip() and entry.get(dest) != val.strip():
            entry[dest] = val.strip()
            changed.append(dest)
    catalog.sort(key=lambda p: p.get("id") or "")
    dump(path, catalog)
    if created:
        return f"added catalog entry {pose_id}"
    if changed:
        return f"catalog {', '.join(changed)}"
    return None


def _write_teaching_patch(pose_id: str, fields: dict, credit: str, copy_id: str) -> str | None:
    """Teaching fields beyond the public catalog → incoming patch for apply_pose_edits.ts."""
    skip = set(CATALOG_FIELD_MAP) | {"name"}
    teaching = {k: v for k, v in fields.items() if k not in skip and v not in (None, "", [])}
    if not teaching:
        return None
    INCOMING.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = INCOMING / f"app-pose-{pose_id}-{stamp}.json"
    patch = {
        "version": 1,
        "exportedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "edits": [
            {
                "sourcePoseId": pose_id,
                "copyId": copy_id or "",
                "authorEmail": "",
                "authorName": credit,
                "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "fields": teaching,
            }
        ],
    }
    dump(path, patch)
    return f"teaching patch {path.name}"


def _apply_animations(from_id: str, animations: list, known: set[str], catalog: set[str]) -> list[str]:
    notes = []
    if not isinstance(animations, list):
        return notes
    for i, anim in enumerate(animations):
        if not isinstance(anim, dict):
            continue
        to = anim.get("to")
        if not isinstance(to, str) or to not in catalog or to == from_id:
            # Skip moves to poses not yet in the catalog; bones still apply.
            continue
        tr = {
            "durationSec": anim.get("durationSec"),
            "keys": anim.get("keys") or [],
            "endEase": anim.get("endEase"),
        }
        try:
            move = _parse_transition(tr, known, f"animation {i + 1}")
        except EditError:
            continue
        notes.append(_write_move(from_id, to, move))
    return notes


def apply_app_pose(env: dict, known: set[str]) -> str:
    pid = env.get("pose")
    if not isinstance(pid, str) or not ID_RE.match(pid):
        raise EditError(f"pose {pid!r} is not a valid id")
    bones = clean_bones(env.get("bones") or {}, known, pid)
    if not bones:
        raise EditError("app-pose submissions need bones")
    path = ROOT / "poses" / f"{pid}.json"
    geom_props = env.get("props") if isinstance(env.get("props"), list) else None
    if path.is_file():
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["bones"].update(bones)
        if (env.get("root") or {}).get("head") is not None:
            doc.setdefault("root", {})["head"] = head(env["root"]["head"], f"{pid} root.head")
        if geom_props is not None:
            if geom_props:
                doc["props"] = geom_props
            else:
                doc.pop("props", None)
        dump(path, doc)
        bone_note = f"Updated pose {pid}: {len(bones)} bone(s)"
        if geom_props is not None:
            bone_note += " + props"
    else:
        if "root" not in bones:
            raise EditError("new poses need a root bone")
        doc = {
            "format": "yoga-pose/1",
            "pose": pid,
            "rig": "makehuman-default",
            "frame": "metres, Z up, character faces -Y, floor at z = 0",
            "bones": bones,
        }
        if (env.get("root") or {}).get("head") is not None:
            doc["root"] = {"head": head(env["root"]["head"], f"{pid} root.head")}
        if geom_props:
            doc["props"] = geom_props
        dump(path, doc)
        bone_note = f"Added pose {pid}: {len(bones)} bone(s)"
        if geom_props:
            bone_note += " + props"

    fields = env.get("fields") if isinstance(env.get("fields"), dict) else {}
    parts = [bone_note]
    catalog_note = _update_catalog(pid, fields)
    if catalog_note:
        parts.append(catalog_note)
    patch_note = _write_teaching_patch(
        pid, fields, str(env.get("creditName") or ""), str(env.get("copyId") or "")
    )
    if patch_note:
        parts.append(patch_note)

    catalog = {p["id"] for p in json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))}
    parts.extend(_apply_animations(pid, env.get("animations") or [], known, catalog))
    return ". ".join(parts) + "."


def apply_routine(env: dict) -> str:
    doc = env.get("routine")
    if not isinstance(doc, dict):
        raise EditError("routine edit needs a routine object")
    if doc.get("format") != "open-yoga-routine/1":
        raise EditError('routine.format must be "open-yoga-routine/1"')
    rid = doc.get("id")
    if not isinstance(rid, str) or not ID_RE.match(rid):
        raise EditError("routine id must be lowercase letters, numbers and hyphens")
    if not isinstance(doc.get("title"), str) or not doc["title"].strip():
        raise EditError("routine needs a title")
    steps = doc.get("steps")
    if not isinstance(steps, list) or not steps:
        raise EditError("routine needs at least one step")
    catalog = {p["id"] for p in json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))}
    clean_steps = []
    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            raise EditError(f"step {i} is not an object")
        hold = step.get("holdSec")
        if not isinstance(hold, (int, float)) or not 1 <= hold <= 600:
            raise EditError(f"step {i}: holdSec must be 1–600")
        pose = step.get("pose")
        if pose is not None:
            if not isinstance(pose, str) or pose not in catalog:
                raise EditError(f"step {i}: unknown pose {pose!r}")
        row = {"holdSec": int(hold)}
        if pose:
            row["pose"] = pose
        if isinstance(step.get("section"), str) and step["section"].strip():
            row["section"] = step["section"].strip()
        if step.get("side") in ("right", "left"):
            row["side"] = step["side"]
        if isinstance(step.get("cue"), str) and step["cue"].strip():
            row["cue"] = step["cue"].strip()
        if not pose and not row.get("cue"):
            raise EditError(f"step {i}: need a pose or a cue")
        clean_steps.append(row)
    author = doc.get("author") if isinstance(doc.get("author"), dict) else {}
    out = {
        "format": "open-yoga-routine/1",
        "id": rid,
        "title": doc["title"].strip(),
        "steps": clean_steps,
    }
    if isinstance(doc.get("description"), str) and doc["description"].strip():
        out["description"] = doc["description"].strip()
    if author:
        a = {}
        if isinstance(author.get("name"), str) and author["name"].strip():
            a["name"] = author["name"].strip()
        if isinstance(author.get("url"), str) and author["url"].strip():
            a["url"] = author["url"].strip()
        if isinstance(author.get("email"), str) and "@" in author["email"]:
            a["email"] = author["email"].strip().lower()
        if a:
            out["author"] = a
    if isinstance(doc.get("level"), (int, float)) and 1 <= int(doc["level"]) <= 5:
        out["level"] = int(doc["level"])
    if isinstance(doc.get("language"), str) and doc["language"].strip():
        out["language"] = doc["language"].strip()
    if isinstance(doc.get("tags"), list):
        tags = [t.strip() for t in doc["tags"] if isinstance(t, str) and t.strip()]
        if tags:
            out["tags"] = tags
    path = ROOT / "routines" / f"{rid}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return f"wrote routines/{rid}.json ({len(clean_steps)} steps)"


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    body = sys.stdin.read() if sys.argv[1] == "-" else Path(sys.argv[1]).read_text(encoding="utf-8")
    known = set(json.loads((ROOT / "tools" / "rig-bones.json").read_text()))
    try:
        env = extract(body)
        kind = env.get("kind")
        if kind == "pose":
            print(apply_pose(env, known))
        elif kind == "move":
            print(apply_move(env, known))
        elif kind == "app-pose":
            print(apply_app_pose(env, known))
        elif kind == "routine":
            print(apply_routine(env))
        else:
            raise EditError(f"unknown kind of edit {kind!r}")
    except EditError as e:
        print(f"Couldn't apply this edit: {e}.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
