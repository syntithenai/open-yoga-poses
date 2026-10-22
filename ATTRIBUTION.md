# Attribution

## Pose data, catalog, moves and routines

© Steve Ryan and Open Yoga Poses contributors, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (see `LICENSE-DATA`). Contributors are credited by the name they choose when suggesting a pose (shown on each pose's **Credits** panel and on the GitHub issue), in pull-request co-author lines, and in the git history of each file.

Suggested credit: "Pose data from Open Yoga Poses (https://github.com/syntithenai/open-yoga-poses), CC BY-SA 4.0".

Poses were fitted from photographs and then refined by hand. Only the measured joint rotations are published; no photographs or text from other sources are included.

## Bodies (`characters/`)

- [Anny body model](https://github.com/naver/anny): CC0 mesh (code Apache-2.0). Light bodies used by default in the viewer.
- [MakeHuman system assets](https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip): CC0, through MPFB2. The skeleton is the MakeHuman "default" rig.
- High-detail faces (`characters/hd/*.glb`): MPFB2 builds with skin, hair, brows and eyes, also CC0 MakeHuman-derived assets. Optional in the viewer's Settings → Body detail → High.

## Costumes (`styles/`)

Costume colour and pattern definitions in `styles/index.json` are part of the viewer (MIT). They tint the published bodies; wardrobe-cut accessory meshes from the SynthYoga app are not included.

## Viewer

- [three.js](https://threejs.org/) r186 in `vendor/three/`: MIT, see `vendor/three/LICENSE`.
