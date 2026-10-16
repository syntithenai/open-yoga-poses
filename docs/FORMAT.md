# File formats

## Pose: `poses/<id>.json` (`yoga-pose/1`)

```json
{
  "format": "yoga-pose/1",
  "pose": "warrior-ii",
  "rig": "makehuman-default",
  "frame": "metres, Z up, character faces -Y, floor at z = 0",
  "bones": { "root": [0.935, -0.309, -0.085, -0.151], "upperleg01.L": [0.818, -0.025, -0.394, -0.418] },
  "restAxes": { "root": [0, 1, 0], "upperleg01.L": [-0.032, -0.264, -0.964] },
  "root": { "head": [0.094, 0.224, 0.644] },
  "floor": { "lowest": 0, "contacts": ["foot.L", "foot.R"] }
}
```

| Field | Meaning |
|---|---|
| `pose` | The pose id. Must match the file name and an entry in `catalog.json`. |
| `rig` | Always `makehuman-default`. Bone names are listed in `tools/rig-bones.json`. |
| `bones` | For each bone, its rotation away from the rest pose, in armature space, as a unit quaternion `[w, x, y, z]`. A bone that isn't listed keeps its parent's rotation. |
| `restAxes` | Optional. The direction each bone pointed at rest on the body the pose was made on. Players use it to correct small differences between bodies. |
| `root.head` | Position of the root bone's head, in metres. |
| `floor.contacts` | Bones that touch the floor. Players snap the lowest point of the body to z = 0. |

To apply a pose to a body: walk the skeleton from the root. For each bone, take its rest rotation in the pose frame, multiply by the pose's rotation (the parent's, if the bone isn't listed), then convert to a rotation relative to its parent. `viewer/pose.js` does exactly this in about 60 lines.

## Catalog: `catalog.json`

An array, one entry per pose:

```json
{
  "id": "warrior-ii",
  "name": "Warrior II Pose",
  "sanskrit": "Virabhadrasana B",
  "altNames": ["Warrior 2"],
  "category": "standing",
  "difficulty": 3,
  "drishti": "Over the front fingertips",
  "basePoseId": "warrior-ii"
}
```

- `category`: `standing`, `floor`, `arm-balance`, `inversion`, `chair`, `breath` or `transition`.
- `difficulty`: 1 (gentle) to 5 (advanced). Optional, and only set where a person has rated the pose; rating the rest is welcome.
- `basePoseId`: set on named variations, pointing at the pose they vary.

## Moves: `transitions.json` (`yoga-transitions/1`)

How the body travels from one pose to another, keyed `"<from>><to>"`. Without an entry, players blend straight from one pose to the next.

```json
{
  "format": "yoga-transitions/1",
  "transitions": {
    "cat>cow": {
      "durationSec": 3,
      "breath": "inhale",
      "keys": [
        { "t": 0.5, "pose": { "bones": { "root": [0.98, 0.2, 0, 0], "spine03": [0.99, 0.1, 0, 0] }, "root": { "head": [0, 0.1, 0.5] } }, "ease": "out" }
      ],
      "endEase": "inOut"
    }
  }
}
```

| Field | Meaning |
|---|---|
| `durationSec` | How long the move takes, 0.2 to 30 seconds. |
| `breath` | Optional: `inhale` or `exhale` when the move follows one breath. |
| `keys` | Up to 8 in-between shapes. `t` runs from 0 (the first pose) to 1 (the second), strictly increasing. A key's `bones` use the same rotations as a pose file and must include `root`; a bone that isn't listed keeps its parent's rotation. |
| `keys[].ease` | How the body arrives at this key from the one before: `inOut` (smooth, the default), `linear` (even), `in` (speeding up) or `out` (slowing down). |
| `endEase` | How the body arrives at the second pose from the last key. |

A key has no `restAxes` of its own: players blend the two poses' `restAxes` at `t`. `viewer/transition.js` plays a move.

## Suggested edits (`open-yoga-edit/1`)

The viewer's **Suggest this edit** and **Suggest this move** buttons put the edited 3D data into the issue, so a maintainer can apply it by adding the `apply-edit` label (or locally with `python3 tools/apply_edit.py issue.md`).

```json
{ "format": "open-yoga-edit/1", "kind": "pose", "pose": "warrior-ii", "bones": { "upperarm01.L": [0.7, 0.1, -0.7, 0.1] }, "root": { "head": [0.09, 0.22, 0.64] } }
{ "format": "open-yoga-edit/1", "kind": "move", "from": "cat", "to": "cow", "transition": { "durationSec": 3, "keys": [] } }
{ "format": "open-yoga-edit/1", "kind": "app-pose", "pose": "warrior-ii", "bones": { "root": [1, 0, 0, 0] }, "fields": { "name": "Warrior II", "sanskrit": "Virabhadrasana B", "description": "…" }, "animations": [] }
{ "format": "open-yoga-edit/1", "kind": "routine", "routine": { "format": "open-yoga-routine/1", "id": "gentle-morning", "title": "Gentle morning", "steps": [] } }
```

A pose edit lists only the bones that changed; they replace those bones in `poses/<id>.json`. A move edit replaces the whole move. A routine edit writes `routines/<id>.json`.

An **app-pose** edit comes from the SynthYoga pose editor or a signed-in suggest on this viewer. It must include bones. It may also carry `creditName`, catalog fields (`name`, `sanskrit`, `altNames`, `category`, `intensity` → `difficulty`, `tags`, `drishti`, `basePoseId`), other teaching fields (written to `incoming/` as a patch for the app's `apply_pose_edits.ts`), and keyframed `animations` (written as moves when both pose ids are in the catalog). An empty `sourcePoseId` means a new pose: `apply_edit.py` creates `poses/<id>.json` and a catalog entry.

When the JSON is long, the viewer sends it as one line, `OYE1.` followed by the JSON compressed with raw deflate and encoded as base64url (no padding). In Python: `json.loads(zlib.decompress(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)), -15))`.

## Routine: `routines/<id>.json` (`open-yoga-routine/1`)

```json
{
  "format": "open-yoga-routine/1",
  "id": "gentle-morning",
  "title": "Gentle morning",
  "description": "Ten easy minutes to wake up the spine and legs.",
  "author": { "name": "Your name", "url": "https://example.com" },
  "level": 1,
  "language": "en",
  "tags": ["morning", "gentle"],
  "steps": [
    { "section": "Warm up", "pose": "easy", "holdSec": 60, "cue": "Sit tall and let the breath settle." },
    { "pose": "low-lunge", "holdSec": 30, "side": "right" },
    { "pose": "low-lunge", "holdSec": 30, "side": "left" }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | Lowercase letters, numbers and hyphens. Must match the file name. |
| `author` | Who to credit. `url` is optional. `email` (optional) lets the author claim the routine in SynthYoga when signed in with the same address. |
| `level` | 1 (gentle) to 5 (advanced). |
| `steps[].pose` | A pose id from `catalog.json`. |
| `steps[].holdSec` | How long to stay, 1 to 600 seconds. |
| `steps[].side` | `right` or `left` for one-sided poses. |
| `steps[].cue` | Optional words to say or show during the step. |
| `steps[].section` | Optional heading that starts a new section of the routine. |
