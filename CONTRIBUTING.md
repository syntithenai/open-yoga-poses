# Contributing

Thank you for helping. Teachers and practitioners know these shapes far better than any fitting software, and every correction makes the library better for everyone who learns from it.

## Ways to help

| You want to | Do this |
|---|---|
| Fix a pose that looks wrong | Sign in with Google, turn on **Edit the 3D body**, drag the joints, fill **Edit details** (name, description, and the rest), then **Suggest this edit**. Or [open a pose correction](https://github.com/syntithenai/open-yoga-poses/issues/new?template=pose-correction.yml) in words: "the back heel should be down", "the hips should face the long edge of the mat". |
| Shape the move between two poses | In the viewer, add a move under **Moves**, add keyframes on the timeline, then choose **Suggest this move**. |
| Suggest a pose we don't have | Sign in, choose **New pose**, edit the 3D body and details, then suggest. Or [describe it in words](https://github.com/syntithenai/open-yoga-poses/issues/new?template=new-pose.yml). |
| Share a routine | Add a file in `routines/` (below), or [describe it in an issue](https://github.com/syntithenai/open-yoga-poses/issues/new?template=new-routine.yml). |
| Fix names or Sanskrit | Edit `catalog.json` and open a pull request, or send them with a signed-in pose suggestion. |
| Fix the 3D pose yourself | Edit `poses/<id>.json` (below) and open a pull request. |

Pose suggestions need a 3D shape and a credit name (CC BY-SA 4.0). Signed-in suggests open a GitHub issue that credits you on the pose's **Credits** panel.

Please don't attach photos or text you don't own. Describe the correction in your own words, or link to a source rather than copying it.

## Editing a pose

Each pose file stores, for every bone of the MakeHuman "default" rig, its rotation away from the rest pose as an armature-space quaternion `[w, x, y, z]`. Coordinates are metres, Z up, the body faces -Y, and the floor is z = 0. The full format is in [docs/FORMAT.md](docs/FORMAT.md).

Ways to edit:

- **In the viewer.** Sign in with Google, turn on **Edit the 3D body**, click a joint and turn it with the rings. Edits are saved in your browser (only on that device) and marked with ● in the list. **Edit details** covers teaching fields; **Suggest this edit** opens a GitHub issue with the 3D shape, fields and your credit name; **Download edited pose** gives you the whole file for a pull request.
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

A maintainer checks each change against the pose's usual form. For issues made with the viewer, adding the `apply-edit` label applies the 3D data and opens a pull request that credits you as co-author; the change still needs a review before it's merged. The viewer shows where each suggestion is: pending review, pending with a pull request open, integrated, or closed. Where traditions differ (for example Iyengar and Ashtanga versions of the same pose), we keep the most common form and welcome the others as named variations with their own id.

Merged changes flow back into the SynthYoga app.
