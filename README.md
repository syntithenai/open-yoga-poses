# Open Yoga Poses

An open library of 3D yoga poses, made for love and curiosity. Every pose is a small JSON file of joint rotations that works on any body built on the MakeHuman default rig, and this repo includes CC0 bodies to put them on.

**[Browse the poses in 3D](https://syntithenai.github.io/open-yoga-poses/)**: search by English or Sanskrit name, muscle or category, turn the body to any angle, and download what you need.

## Why it's open

Yoga has always been passed on by teachers and shared between practitioners. These poses were fitted from photos and refined by hand, and they still have mistakes: a hand a little off the floor, a hip that isn't quite square. Teachers and practitioners know these shapes better than any software does. Keeping the library open means everyone can help correct it, and every correction stays open for the next person.

The data is licensed CC BY-SA 4.0, so anything built from it, including your improvements, stays open and credited.

## What's here

| Path | What it is | Licence |
|---|---|---|
| `poses/<id>.json` | One pose per file (`yoga-pose/1`): joint rotations, rest axes, root position and floor contacts | CC BY-SA 4.0 |
| `catalog.json` | Names, Sanskrit, alternate names, category, difficulty and muscle tags for every pose | CC BY-SA 4.0 |
| `muscles.json` | Which muscles each pose stretches, strengthens or stabilises, and how strongly | CC BY-SA 4.0 |
| `routines/<id>.json` | Shared sequences (`open-yoga-routine/1`) | CC BY-SA 4.0 |
| `characters/*.glb` | Rigged bodies to show the poses on | CC0 |
| `index.html`, `viewer/`, `tools/` | The viewer and the validation script | MIT |

The file formats are described in [docs/FORMAT.md](docs/FORMAT.md).

## Help refine the poses

- **Spotted something wrong?** Open the pose in the viewer and choose **Suggest a fix**, or [open a pose correction](https://github.com/syntithenai/open-yoga-poses/issues/new?template=pose-correction.yml). Describe what's off in words; you don't need any 3D skills.
- **Share a routine.** Write it as a small JSON file (see [docs/FORMAT.md](docs/FORMAT.md)) or [describe it in an issue](https://github.com/syntithenai/open-yoga-poses/issues/new?template=new-routine.yml) and we'll turn it into one.
- **Fix a pose yourself.** Edit the pose file in Blender or any tool that reads the MakeHuman rig, then open a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Use the poses

Use them in your classes, your own apps, your research or your art, as long as you credit "Open Yoga Poses contributors" with a link to this repo and share changes to the data under the same licence.

To run the viewer locally:

```bash
python3 -m http.server 8797
# then open http://localhost:8797/
```

Check your changes before you open a pull request:

```bash
python3 tools/validate.py
```

## Where it comes from

The library comes from [SynthYoga](https://yoga.synthfit.online/), a free yoga app with spoken cues and a 3D guide. The app also has free tools for teachers and studios: a teacher directory, a knowledge base, home practice and a booking system. Read more at [yoga.synthfit.online/for-teachers](https://yoga.synthfit.online/for-teachers). The app isn't open source; this library is.

Fixes made here flow back into the app, and the app's improvements are published here.
