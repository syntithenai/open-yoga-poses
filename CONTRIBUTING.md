# Contributing

Thank you for helping. Teachers and practitioners know these shapes far better than any fitting software, and every correction makes the library better for everyone who learns from it.

## Ways to help

| You want to | Do this |
|---|---|
| Point out a pose that looks wrong | [Open a pose correction](https://github.com/syntithenai/open-yoga-poses/issues/new?template=pose-correction.yml), or use **Suggest a fix** in the viewer. Words are enough: "the back heel should be down", "the hips should face the long edge of the mat". |
| Suggest a pose we don't have | [Suggest a new pose](https://github.com/syntithenai/open-yoga-poses/issues/new?template=new-pose.yml). |
| Share a routine | Add a file in `routines/` (below), or [describe it in an issue](https://github.com/syntithenai/open-yoga-poses/issues/new?template=new-routine.yml). |
| Fix names, Sanskrit or muscles | Edit `catalog.json` or `muscles.json` and open a pull request. |
| Fix the 3D pose yourself | Edit `poses/<id>.json` (below) and open a pull request. |

Please don't attach photos or text you don't own. Describe the correction in your own words, or link to a source rather than copying it.

## Editing a pose

Each pose file stores, for every bone of the MakeHuman "default" rig, its rotation away from the rest pose as an armature-space quaternion `[w, x, y, z]`. Coordinates are metres, Z up, the body faces -Y, and the floor is z = 0. The full format is in [docs/FORMAT.md](docs/FORMAT.md).

Ways to edit:

- **Blender with MPFB2.** Build a human with the default rig, set each pose bone's rotation from the file, adjust, and write the rotations back. Bones you don't list follow their parent.
- **Any tool that reads glTF.** Load `characters/joe_anny.glb`, pose it, and export the armature-space rotations relative to the rest pose.
- **By hand**, for small fixes: the viewer reloads the file each time you open the pose, so you can tweak a value and refresh.

Keep the body on the floor: set `floor.contacts` to the bones that touch it, and let the lowest point sit at z = 0.

## Adding a routine

Copy one of the files in `routines/`, give it a new id (lowercase letters, numbers and hyphens; the file name must match), and list its steps. Every `pose` must be an id in `catalog.json`. Put your name in `author` so you're credited.

## Before you open a pull request

```bash
python3 tools/validate.py
```

The same check runs on every pull request.

## Licence and sign-off

By contributing you agree that your contribution is licensed under the same terms as the file you changed: CC BY-SA 4.0 for data and routines, MIT for code. Sign off each commit to confirm you have the right to contribute it ([Developer Certificate of Origin](https://developercertificate.org/)):

```bash
git commit -s -m "Square the hips in warrior-i"
```

## Reviews

A maintainer checks each change against the pose's usual form. Where traditions differ (for example Iyengar and Ashtanga versions of the same pose), we keep the most common form and welcome the others as named variations with their own id.

Merged changes flow back into the SynthYoga app.
