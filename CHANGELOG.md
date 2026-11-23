# Changelog

## 0.7.0 (not released yet)

Mesh Avatar Studio avatars play. A page written for 0.6 needs no change: `.livliv`, VRM and PNGTuber characters play
exactly as before.

### New

- **`@livliv-dev/player/mavatar`**: `MavatarBody` plays a `.mavatar` from
  [Mesh Avatar Studio](https://github.com/shinshin86/mesh-avatar-studio) on a `BodyPlayer`, drawn by the format's own
  runtime, [mesh-avatar](https://www.npmjs.com/package/mesh-avatar) 0.9.0 (MIT), which the page installs (an optional
  peer dependency, pinned to that version; only this entry imports it). The Player's pose drives it: the head, the body,
  the eyes and gaze, the brows, the mouth with the voice's vowel, the smile, the idle motion, lip sync and face tracking.
  Its expressions are mesh-avatar's live expressions (`laugh`, `shy`, `surprise`, `halfLidded`, `angry`, `sad`,
  `wink`), by weight, at mesh-avatar's own numbers; its hair swings by its own physics (`sway`). It loads from a URL, a
  `File` or its unpacked files, measures every picture before it is decoded (`MAVATAR_LIMITS`), gives the avatar's
  author and licence in `model.meta` (`MavatarTerms`), draws at the exact size asked for (`renderPose` with a size,
  a canvas in no page) and keeps the Player's move (actions, the view). The player's canvas draws in 2D, as a
  PNGTuber's does; the WebGL context is the avatar's own canvas's, so `onContextLost` and `dispose({ release })` work
  as for a VRM. See [API.md](API.md#characters-that-arent-livliv-models-livliv-devplayerbody).
- `example/mavatar.html`: open a `.mavatar`; without one, Nana as a `.mavatar` (made by LivLiv from the featured
  character for the tests, under the featured characters' licence).

## 0.6.0

Long hair that swings, feel settings an editor can change while the character plays, an advanced entry for code that
runs the renderer itself, and VRM files from Blender that play. A page written for 0.5 needs no change; the one thing it
will see is long hair swinging (below).

### New

- **Feel settings, live.** `player.tuning` is the character's feel settings as it plays (its model's `tuning`; a frozen
  copy), and `player.setTuning(changes)` changes some of them without loading the character again: `undefined` puts
  one back to the model's own, each load starts from the new character's own. On `Player` and `BodyPlayer`. Changing
  `turn`, `nod` or `fringe` on a model with keyforms measures its key poses again, so it draws exactly as it would
  loaded with those settings. See [API.md](API.md#feel-settings-tuning-and-settuning).
- **`blink`, `expr` and `mouth` from the model's `tuning` count**, as on livliv.ai: how often the idle motion blinks,
  how readily face tracking reads a smile, how far face tracking and live lip sync open the mouth (lip sync's own
  `gain` multiplies with it). A `Host` may carry `tuning` (optional): drivers read it there.
- **`load(source, { continueMotion: true })`**: the same character loaded again (an editor's change) goes on moving
  from its last frame (its springs, the body's lag, the long hair's swing, the expression showing) instead of starting
  again at rest.
- **`@livliv-dev/player/runtime`**, an advanced entry: the renderer (`Puppet`) and the motion modules, for code that
  runs its own frame loop, with `meshes()`, `rgbaAt()` and `layersAt()` to ask what is drawn where. Outside the
  compatibility promise of the other entries: pin the exact version. See [API.md](API.md#advanced-livliv-devplayerruntime).
- **`packageModelJson(paths)`**: which `model.json` among a package's files is its own, as `load()` picks it.
- **Format 4.2** ([FORMAT.md](FORMAT.md#5-profile-tuning-anchors)): `tuning.gaze`, `tuning.fringe` and
  `tuning.hair_sway` in the schema, all optional. The player read `gaze` and `fringe` before, but the schema refused a
  file that had them. The `Tuning` type is exported.

### Changed

- **Long hair swings below the shoulders** ([#15](https://github.com/livliv-dev/player/issues/15)). Below the jaw, long
  hair used to follow the torso, so its tips moved less than the hair at the shoulders. A gentle pendulum, thrown by the
  head's and the torso's moves and settling by itself, now swings it sideways, more toward the tips (twin tails and
  ponytails included); hair over the body swings less. **Characters you already have move this way too: at their
  default settings their hair tips sway when the head turns or the body leans.** A still frame is unchanged, and a
  character whose `tuning.hairBack` (format 4: `hair_back`) or new `hairSway` (`hair_sway`) is 0 draws every frame as
  in 0.5.
- **VRM files from Blender** ([#1](https://github.com/livliv-dev/player/issues/1)): a VRM 1.0 whose licence URL is not
  VRM's own (the author's terms page) plays, with that URL in its terms; node constraints that depend on each other in a
  circle are left out with a warning instead of refusing the file; a file that cannot play says why in the exporter's
  terms (bones the humanoid lacks, no meta, a VRM version this player does not read). A `.vrm` URL given to a `Player`
  says to use a `BodyPlayer`.
- **`modelFiles()` takes the names `load()` takes** (`#`, `?` and `:` included) and refuses, as opening a `.livliv`
  does, only a name that would leave the package. Its errors name the file.
- **A model's first frame draws everything once, out of sight** (Player only): every layer's pictures, the eyes'
  masks, the stencil. Some browsers put off a texture's upload until it is first drawn, so the first blink, glance or
  expression after a load could stall a frame. The renderer underneath has it as a switch (`Puppet.prewarm`), off.
- **The idle motion going on again doesn't jump.** After frames drawn with `idle` off, it used to go on from where it
  had stopped, in one frame; now it eases in from the pose those frames showed, over 0.4 s. A player whose idle motion
  is never turned off plays exactly as before.
- The model schema compiles without warnings in ajv's default settings (it logged two); it accepts and refuses the same
  files.
- The repository's featured characters are livliv.ai's current builds: 13 refreshed, Mochi and Kotaro gone (23).

## 0.5.1

Two optional settings for how strongly a character moves. A page that doesn't use them draws exactly as with 0.5.0.

### New

- `act(action, strength)`: a short move at a share of its full size, from 0 to 1 (default 1). It takes as long as
  before. See [API.md](API.md#motion-strength).
- `bodyMotion` (0 to 1, default 1): scales the live torso turn and lean, before `parameterProfile`. Recorded poses
  already include it, so replaying them doesn't scale them again.
- The repository's featured characters now include four full-body ones: Tsubaki, Neve, Juno and Viola.

### Changed

- The package builds itself when it is installed straight from GitHub (`prepare` instead of `prepack`), so
  `npm install github:livliv-dev/player#<commit>` gives a working copy.

## 0.5.0

Full-body characters, standing on the ground, with a choice of shot. Half-body characters draw exactly as in 0.4, and a
page written for 0.4 needs no change.

### New

- **Full-body characters**, livliv.ai's newer kind: drawn head to feet, the feet on the ground. The upper body moves as
  a half-body character's; the whole figure sways from the ankles, the hips shift their weight, a skirt's or coat's hem
  trails behind; leaning toward the camera or a hop crouches it, a hop lands, and lip sync dips the upper body. See
  [API.md](API.md#full-body-characters).
- **Choose the shot** with `view.fit`: `'frame'` (head and chest, the default), `'knee'` or `'whole'`.
- **For drivers and recordings:** `ModelInfo.fullBody`, `frame.talk` (the talking bob, apart from `frame.move`),
  `frame.grounded` and the `Fit` type. A full-body character's `PlaybackPose` keeps `crouch`, `dip` and `talk`, and
  `renderPose()` draws them again.
- **Format 4.1** ([FORMAT.md](FORMAT.md#full-body-characters-41)): `anchors.frame`, `anchors.body`,
  `anchors.hair_bottom_y`, `rig.lattice` and the feature `full_body`, in the schema too.
- A model's `tuning.fringe` (how far the bangs stand off the face) is read.

### Changed

- Lip sync puts its talking bob in `frame.talk` instead of adding it to `frame.move.y`; the picture moves as before.
- What drivers write to `frame.move` and `frame.talk` is kept to numbers: a NaN counts as no move.
- TypeScript code that builds a `Frame` or a `ModelInfo` of its own (a test's stand-in) adds the new fields.

## 0.4.0

Ways to record a character and show it in more than one place, and two changes to what a character does: the chest
spring is off, and full-body characters wait for a later version. A page written for 0.3 needs no change.

### New

- Recorded poses: `getPose()`, `onFrame` and `renderPose(pose, dt, size)` on `Player` and `BodyPlayer`, to keep each
  frame's pose and draw it again, in another window or at a video's exact size. See [API.md](API.md#recorded-poses).
- `renderWhenHidden`: keep drawing while the canvas is out of view, for a live output or a recording.
- Response profiles, which reshape params one by one (range, curve, smoothing): `parameterProfile` and
  `parameterSample` on both players, `profile` and `sample` on face tracking, and `TrackingFilter`,
  `readTrackingProfile()`, `parameterRule()` and `TRACKING_PARAMETERS` from `@livliv-dev/player/tracking`. See
  [API.md](API.md#response-profiles).
- `getAnchor('head' | 'body')`: where the head and the torso were drawn, to attach things that follow the character. A
  `Body` of your own can give its own with `anchor()`.
- Face tracking: `deviceId` picks the camera, and `tracking.video` is its preview.
- Speech: `say()` takes a fetch `Response`, played as it streams in, and hooks (`onStart`, then `onEnd` or `onFail`);
  `volume`, `level`, `vowel`, and `stream`, the voice as a `MediaStream` for a call or a recording.
- `modelFiles()`: a model's own files, to save or package a character with a project.
- `new PngBody({ pixelated: true })`, for pixel art.

### Changed

- **The chest spring is off**, as on livliv.ai: the player ignores a saved `rig.body.bust`, so packages exported before
  keep still there too, and the featured characters now say 0. Breathing stays. At rest a character draws as in 0.3, to
  the pixel; the difference shows only on characters that had it, around the chest, while they breathe and move.
- **Full-body characters**, livliv.ai's newer kind (`anchors.body` in `model.json`), are refused with
  `missing-feature`: this version would show the whole tall canvas with the feet sliding. A later version plays them,
  and a `PlaybackPose` already has room for their moves (`crouch`, `dip`, `talk`, unused here).

### Fixed

- The expressions' `label` and `labels` keep their types on both players (#8).
- A streamed WAV plays at its own sample rate (#6).
- Face tracking tilts the head the same way as the face (#5).

### Featured characters

They are not in the npm package.

- 17 of the 21 rebuilt, as livliv.ai now shows them, and their covers redrawn.
- `rig.body.bust` is 0 in all of them.

## 0.3.0

The first version on npm, with the interface settled first: these change what a page written for 0.2 does.

### What to change

| 0.2 | 0.3 |
|---|---|
| `import ... from '@livliv/player'` and its subpaths | `'@livliv-dev/player'`, the package's name on npm. |
| `player.act('away')` | `player.setAway(true)` and `setAway(false)`. `act('away')` now throws: it was a switch among one-off moves. |
| `player.puppet` | No longer in the types. `player.poke()` and `player.canvasToModel()` are what pages used it for. The field still exists and can change in any version. |
| `player.load(a); player.load(b)` played `a`, then `b` | The new load replaces the one running, which rejects with an `AbortError`. If you catch errors, let this one through: `if (e.name === 'AbortError') return`. |
| `dispose()` on a load running rejected with an `Error` | It rejects with an `AbortError`, as `load()` on a disposed player does. |
| Errors told apart by their message | `e.code`, on a `LivLivError`. The messages can change. |

### New

- `load(source, { signal, onProgress, poster })`: call a load off, follow how far it has come, show a picture until the first frame.
- `LivLivError`, with a `code` for each reason, from `@livliv-dev/player` and `@livliv-dev/player/body`.
- `player.contextLost` and `player.onContextLost`: the page hears when the WebGL context is gone. See [API.md](API.md#when-the-context-is-lost).
- `dispose({ release: true })`: gives the WebGL context up, for a canvas leaving the page.
- `player.setAway()`, `player.poke()`, `player.canvasToModel()`.
- `example/react.html`.

### Changed

- A model that breaks while it is built leaves the character before as it was, to the pixel. It used to leave an empty canvas.
- The pose stays in the ranges of `PARAM_RANGES` on `Player` too, as it did on `BodyPlayer`. A value that is not a number counts as the default.
- `maxPixelRatio` can be read and changed on a `Player`.
- `snapshot()` on a `Player` draws first, so it is the pose as it is now, on a paused player too.
- A `BodyPlayer`'s `Frame.time` counts the frames before this one, as a `Player`'s does. Its idle motion runs one frame later.
- The two classes now share their code. Nothing a `Player` draws changed: frame by frame, with the same random numbers, 1300 frames each of 4 characters came out identical.

See the [commits](https://github.com/livliv-dev/player/commits/main) for what came before 0.3.
