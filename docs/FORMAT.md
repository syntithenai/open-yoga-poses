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
  "muscles": ["core", "legs"],
  "drishti": "Over the front fingertips",
  "basePoseId": "warrior-ii"
}
```

- `category`: `standing`, `floor`, `arm-balance`, `inversion`, `chair`, `breath` or `transition`.
- `difficulty`: 1 (gentle) to 5 (advanced). Optional, and only set where a person has rated the pose; rating the rest is welcome.
- `basePoseId`: set on named variations, pointing at the pose they vary.

## Muscles: `muscles.json` (`yoga-muscles-pack/1`)

```json
{
  "format": "yoga-muscles-pack/1",
  "poses": {
    "warrior-ii": {
      "reviewed": true,
      "muscles": [{ "id": "gluteus_medius", "side": "L", "role": "stabilise", "level": 2 }]
    }
  }
}
```

- `role`: `stretch`, `contract` or `stabilise`.
- `side`: `L`, `R` or `both`.
- `level`: 1 (light) to 3 (strong).
- `reviewed`: `false` for entries drafted automatically and not yet checked by a person. Reviewing them is a great first contribution.

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
| `author` | Who to credit. `url` is optional. |
| `level` | 1 (gentle) to 5 (advanced). |
| `steps[].pose` | A pose id from `catalog.json`. |
| `steps[].holdSec` | How long to stay, 1 to 600 seconds. |
| `steps[].side` | `right` or `left` for one-sided poses. |
| `steps[].cue` | Optional words to say or show during the step. |
| `steps[].section` | Optional heading that starts a new section of the routine. |
