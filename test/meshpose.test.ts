// A Player pose in mesh-avatar's terms (src/meshpose.ts), without a GPU: what each param becomes, the expressions'
// weights, and the drawn expression picked. That mesh-avatar's own live expressions settle at these numbers, and how
// the poses look, is checked in the browser (test/mavatar.html).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DRAWN_FROM, MESH_EXPRESSIONS, meshParams } from '../src/meshpose'
import { defaultParams, type Params } from '../src/runtime/params'

const pose = (p: Partial<Params> = {}) => ({ ...defaultParams(), ...p })
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a}, not ${b}`)

describe('meshParams: the pose', () => {
  it('at rest: eyes open, mouth shut, nothing turned', () => {
    const { params: q, mood } = meshParams(pose(), {})
    assert.equal(mood, 'neutral')
    for (const k of ['angleX', 'angleY', 'angleZ', 'bodyAngleX', 'bodyAngleZ', 'gazeX', 'gazeY', 'browY', 'browAngle', 'mouthOpen', 'eyeSmile', 'eyeSmileL', 'blush']) near(q[k], 0, k)
    near(q.eyeLOpen, 1, 'eyeLOpen'); near(q.eyeROpen, 1, 'eyeROpen')
  })

  it('the head and body: yaw, pitch and lean as they are; the rolls the other way round', () => {
    const { params: q } = meshParams(pose({ angleX: 20, angleY: -12, angleZ: 15, bodyX: 6, bodyZ: -4, breath: 0.7 }), {})
    near(q.angleX, 20, 'yaw'); near(q.angleY, -12, 'pitch'); near(q.angleZ, -15, 'roll')
    near(q.bodyAngleX, 6, 'body turn'); near(q.bodyAngleZ, 4, 'body roll'); near(q.breath, 0.7, 'breath')
  })

  it("the eyes: the Player's left eye (the screen's left) is mesh-avatar's right", () => {
    const { params: q } = meshParams(pose({ eyeLOpen: 0.2, eyeROpen: 0.9, eyeBallX: 0.5, eyeBallY: -0.3 }), {})
    near(q.eyeROpen, 0.2, 'screen-left eye'); near(q.eyeLOpen, 0.9, 'screen-right eye')
    near(q.gazeX, 0.5, 'gaze x'); near(q.gazeY, -0.3, 'gaze y')
  })

  it('the brows: the two as one', () => {
    near(meshParams(pose({ browLY: 0.6, browRY: 0.2 }), {}).params.browY, 0.4, 'browY')
  })

  it("the mouth: open as the voice says, its shape the vowel's turned round (wide i is -1 there)", () => {
    const wide = meshParams(pose({ mouthOpen: 0.7, vowel: 1 }), {}).params, round = meshParams(pose({ mouthOpen: 0.5, vowel: -0.8 }), {}).params
    near(wide.mouthOpen, 0.7, 'open'); near(wide.mouthForm, -1, 'wide')
    near(round.mouthOpen, 0.5, 'open'); near(round.mouthForm, 0.8, 'round')
  })

  it('the smile param: mesh-avatar\'s happy talking face, by its weight', () => {
    const full = meshParams(pose({ smile: 1 }), {}).params, half = meshParams(pose({ smile: 0.5 }), {}).params
    near(full.eyeSmile, 0.45, 'eye smile'); near(full.blush, 0.35, 'blush'); near(full.browY, 0.25, 'brows'); near(full.eyeLOpen, 0.8, 'eyes')
    near(half.eyeSmile, 0.225, 'half eye smile'); near(half.eyeROpen, 0.9, 'half eyes')
  })

  it('nothing out of range, and no NaN, whatever the pose says', () => {
    const { params: q } = meshParams({ ...pose({ angleZ: NaN, eyeLOpen: 9, mouthOpen: -3, vowel: 7, browLY: 4, smile: Infinity }) }, { angry: NaN, laugh: 5, nope: 1 })
    for (const [k, v] of Object.entries(q)) assert.ok(Number.isFinite(v), `${k} is ${v}`)
    assert.ok(q.eyeROpen <= 1.25 && q.mouthOpen >= 0 && q.mouthForm >= -1 && q.mouthForm <= 1 && q.browY <= 1)
  })
})

describe('meshParams: the expressions', () => {
  it("mesh-avatar's live expressions, smile called laugh (smile is the Player's own)", () => {
    assert.deepEqual(MESH_EXPRESSIONS.map((e) => e.id), ['laugh', 'shy', 'surprise', 'halfLidded', 'angry', 'sad', 'wink'])
    assert.deepEqual(MESH_EXPRESSIONS.map((e) => e.mesh), ['smile', 'shy', 'surprise', 'halfLidded', 'angry', 'sad', 'wink'])
    for (const e of MESH_EXPRESSIONS) assert.ok(e.labels.en && e.labels.zh && e.labels['zh-Hant'] && e.labels.ja, `${e.id} has its names`)
  })

  it('at full weight, its face over the pose as its overlay puts it', () => {
    const angry = meshParams(pose({ eyeLOpen: 0.5 }), { angry: 1 })
    near(angry.params.eyeROpen, 0.5 * 0.72, 'eyes scaled'); near(angry.params.browAngle, 0.85, 'brows'); near(angry.params.browY, -0.55, 'brows down')
    assert.equal(angry.mood, 'angry')
    const sad = meshParams(pose({ angleY: 3 }), { sad: 1 }).params
    near(sad.angleY, -3, 'the head nods down'); near(sad.gazeY, -0.45, 'eyes down')
    const wink = meshParams(pose(), { wink: 1 }).params
    near(wink.eyeLOpen, 0, "the screen's right eye shut"); near(wink.eyeROpen, 1, 'the other open'); near(wink.eyeSmileL, 1, 'smiling')
  })

  it('by weight: half an expression is half its face', () => {
    near(meshParams(pose(), { halfLidded: 0.5 }).params.eyeLOpen, 0.75, 'half-lidded at half')
    near(meshParams(pose(), { shy: 0.5 }).params.blush, 0.5, 'shy at half')
  })

  it("surprise opens the mouth while the voice leaves it shut, in its own shape; the avatar's own opening wins", () => {
    const quiet = meshParams(pose(), { surprise: 1 }).params
    near(quiet.mouthOpen, 0.6, 'open'); near(quiet.mouthForm, 0.6, 'its o')
    const loud = meshParams(pose({ mouthOpen: 0.9, vowel: 1 }), { surprise: 1 }).params
    near(loud.mouthOpen, 0.9, 'the voice'); near(loud.mouthForm, -1, "the voice's vowel")
    near(meshParams(pose(), { surprise: 1 }, { surprise: { mouthOpen: 0.3 } }).params.mouthOpen, 0.3, "the file's own")
  })

  it('together more than 1: shared out', () => {
    const both = meshParams(pose(), { shy: 1, angry: 1 }).params
    near(both.blush, 0.5, 'half of shy'); near(both.browAngle, (-0.5 + 0.85) / 2, 'both brows')
  })

  it('the drawn expression: the strongest, from its threshold', () => {
    assert.equal(meshParams(pose(), { sad: DRAWN_FROM - 0.01 }).mood, 'neutral')
    assert.equal(meshParams(pose(), { sad: DRAWN_FROM }).mood, 'sad')
    assert.equal(meshParams(pose(), { sad: 0.5, surprise: 0.8 }).mood, 'surprise')
    assert.equal(meshParams(pose(), { laugh: 1 }).mood, 'smile')
    assert.equal(meshParams(pose({ smile: 1 }), {}).mood, 'neutral')
  })
})
