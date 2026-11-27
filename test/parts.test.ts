// Soft parts (rig.parts, parts.ts): reading them as untrusted input, an ear's field, its spring and its twitches.
// No GPU: the parts the Puppet calls are plain functions and a class.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { LIMITS } from '../src/runtime/format'
import { ownTuning } from '../src/runtime/puppet'
import { EAR, EAR_EVERY, EVERY_RANGE, PARTS_GAIN_MAX, SoftRig, TWITCH_PUSH, partsGain, readParts, seeded, spineField, withinBudget, type Ear } from '../src/runtime/parts'

const CANVAS: [number, number] = [1024, 1024]
/** a left ear (tip up and to the image's left of a head centred at x 512), as a build writes it */
const ear = (o: Record<string, unknown> = {}) => ({ kind: 'ear', id: 'ear_L', spine: [[330, 300], [210, 40]], width: [120, 45], ...o })
const read = (parts: unknown, canvas = CANVAS) => {
  const why: string[] = []
  return { ears: readParts({ canvas, rig: { parts } }, (w) => why.push(w)), why }
}

describe('reading rig.parts', () => {
  it('an ear with only its required fields plays the tuned defaults', () => {
    const { ears, why } = read([ear()])
    assert.deepEqual(why, [])
    assert.equal(ears.length, 1)
    const e = ears[0]
    for (const [k, [def]] of Object.entries(EAR)) assert.equal(e[k as keyof typeof EAR], def, k)
    assert.deepEqual(e.twitch_every, [5, 10])
    assert.deepEqual(e.spine, [[330, 300], [210, 40]])
    assert.deepEqual(EAR.hz[0], 5); assert.deepEqual(EAR.damp[0], 0.5); assert.deepEqual(EAR.drive[0], 4); assert.deepEqual(EAR.twitch[0], 7)
  })

  it('reads nothing where there is nothing, and skips kinds it does not know without a word', () => {
    assert.deepEqual(readParts({ canvas: CANVAS }), [])
    assert.deepEqual(readParts({ canvas: CANVAS, rig: {} }), [])
    const { ears, why } = read([{ kind: 'bust', id: 'b', center: [1, 2] }, { kind: 'cheek' }, ear()])
    assert.equal(ears.length, 1); assert.deepEqual(why, [])
  })

  it('ignores fields it does not know: a writer\'s own marks and x- data', () => {
    const { ears, why } = read([ear({ fx: 'ears', 'x-fx': 'ears', 'x-layers': ['front_hair'], layers: ['front_hair'], whatever: { a: 1 } })])
    assert.equal(ears.length, 1); assert.deepEqual(why, [])
    assert.equal('fx' in ears[0] || 'x-fx' in ears[0], false)
  })

  it('a list that is no list, or longer than the limit, is not read at all', () => {
    for (const parts of [{ 0: ear() }, 'ear', 7, Array.from({ length: LIMITS.parts + 1 }, (_, i) => ear({ id: `e${i}` }))]) {
      const { ears, why } = read(parts)
      assert.deepEqual(ears, []); assert.equal(why.length, 1)
    }
    assert.equal(read(Array.from({ length: LIMITS.parts }, (_, i) => ({ kind: 'x', id: `e${i}` }))).why.length, 0)
  })

  it('drops an entry that is not valid, keeps the others and says why', () => {
    const bad: unknown[] = [
      null, [ear()], 'ear',
      ear({ id: undefined }), ear({ id: '1ear' }), ear({ id: 'ear-L' }), ear({ id: 'x'.repeat(65) }),
      ear({ spine: [[330, 300]] }), ear({ spine: Array.from({ length: LIMITS.partPoints + 1 }, (_, i) => [300, 300 - 10 * i]) }),
      ear({ spine: [[330, 300], [210, NaN]] }), ear({ spine: [[330, 300], [210, Infinity]] }), ear({ spine: [[330, 300], ['210', 40]] }),
      ear({ spine: [[330, 300], [210, 40, 5]] }), ear({ spine: [[330, 300], [210, -1100]] }), ear({ spine: [[330, 300], [332, 301]] }),
      ear({ spine: 'up' }), ear({ width: [0, 45] }), ear({ width: [120] }), ear({ width: [120, -1] }), ear({ width: [120, NaN] }),
      ear({ hz: '5' }), ear({ damp: NaN }), ear({ drive: Infinity }), ear({ twitch: [7] }), ear({ twitch_every: [5] }), ear({ twitch_every: [5, '10'] }),
    ]
    const { ears, why } = read([...bad, ear({ id: 'ok' })])
    assert.deepEqual(ears.map((e) => e.id), ['ok'])
    assert.equal(why.length, bad.length)
  })

  it('an id used twice: the first is played', () => {
    const { ears, why } = read([ear({ twitch: 3 }), ear({ twitch: 9 })])
    assert.deepEqual(ears.map((e) => e.twitch), [3]); assert.equal(why.length, 1)
  })

  it('brings numbers out of range into it; null is the default', () => {
    const [e] = read([ear({ hz: 100, damp: -1, drive: 1e9, max_angle: 90, hang: 2, twitch: -3, feather: 5, bend: 0, twitch_every: [0, 500], width: [5000, 1e9] })]).ears
    assert.deepEqual([e.hz, e.damp, e.drive, e.max_angle, e.hang, e.twitch, e.feather, e.bend], [20, 0, 20, 45, 1, 0, 2, 0.05])
    assert.deepEqual(e.twitch_every, [1, 120])
    assert.deepEqual(e.width, [1024, 1024])
    assert.deepEqual(read([ear({ twitch_every: [10, 5] })]).ears[0].twitch_every, [10, 10])
    assert.equal(read([ear({ hz: null })]).ears[0].hz, EAR.hz[0])
  })

  it('plays at most LIMITS.ears ears', () => {
    const { ears, why } = read(Array.from({ length: LIMITS.ears + 3 }, (_, i) => ear({ id: `e${i}` })))
    assert.equal(ears.length, LIMITS.ears); assert.equal(why.length, 3)
  })

  it('never throws, whatever the list holds (random trees)', () => {
    const rnd = seeded(7)
    const value = (d: number): unknown => {
      const r = rnd()
      if (d > 3 || r < 0.25) return [0, -1, 1e308, -1e308, NaN, Infinity, 3.5, 'ear', '', null, true, undefined][Math.floor(rnd() * 12)]
      if (r < 0.55) return Array.from({ length: Math.floor(rnd() * 6) }, () => value(d + 1))
      const o: Record<string, unknown> = {}
      for (const k of ['kind', 'id', 'spine', 'width', 'hz', 'damp', 'drive', 'max_angle', 'hang', 'twitch', 'twitch_every', 'feather', 'bend', '__proto__']) if (rnd() < 0.5) o[k] = k === 'kind' && rnd() < 0.7 ? 'ear' : value(d + 1)
      return o
    }
    for (let n = 0; n < 3000; n++) {
      const ears = readParts({ canvas: CANVAS, rig: { parts: value(0) } })
      for (const e of ears) {
        for (const k of Object.keys(EAR)) assert.ok(Number.isFinite(e[k as keyof typeof EAR]))
        assert.ok(e.spine.length >= 2 && e.spine.length <= LIMITS.partPoints)
      }
    }
  })
})

describe('an ear\'s field', () => {
  const [e] = read([ear()]).ears
  const f = spineField(e)

  it('is 0 at the root, 1 along the tip, 0 past the width and its feather', () => {
    assert.equal(f.at(330, 300), 0)
    assert.equal(f.at(210, 40), 1)
    const mid = f.at(270, 170)
    assert.ok(Math.abs(mid - 0.5) < 1e-9, `${mid}`)  // halfway along: smoothstep(0.5)
    // across the spine at the tip: inside the width, inside the feather, past it
    const nx = 260 / Math.hypot(120, 260), ny = -120 / Math.hypot(120, 260)  // a unit normal to the spine
    assert.ok(f.at(210 + 40 * nx, 40 + 40 * ny) > 0.999)
    assert.ok(f.at(210 + 60 * nx, 40 + 60 * ny) > 0 && f.at(210 + 60 * nx, 40 + 60 * ny) < 1)
    assert.equal(f.at(210 + 95 * nx, 40 + 95 * ny), 0)
  })

  it('is 0 everywhere outside its box', () => {
    const [x0, y0, x1, y1] = f.box
    for (let y = -200; y < 700; y += 7) for (let x = -200; x < 900; x += 7) if (f.at(x, y) > 0) assert.ok(x >= x0 && x <= x1 && y >= y0 && y <= y1, `${x} ${y}`)
  })

  it('bend: the upper part at full weight, only the base bending', () => {
    const [b] = read([ear({ bend: 0.5 })]).ears
    assert.equal(spineField(b).at(240, 105), 1)  // three quarters along
    assert.ok(spineField(b).at(300, 235) < 1)    // a quarter along
  })

  it('no feather is a hard edge; a spine with a point twice is no trouble', () => {
    const [h] = read([ear({ feather: 0, spine: [[330, 300], [330, 300], [210, 40], [210, 40]] })]).ears
    const g = spineField(h)
    for (let y = 0; y < 400; y += 3) for (let x = 100; x < 500; x += 3) { const w = g.at(x, y); assert.ok(w >= 0 && w <= 1, `${x} ${y} ${w}`) }
  })
})

describe('the load\'s budget', () => {
  const one = (o: Record<string, unknown> = {}) => { const [e] = read([ear(o)]).ears; return { id: e.id, field: spineField(e) } }
  it('keeps real ears, counting the lattice points their boxes hold', () => {
    const p = one()
    const kept = withinBudget([p], [{ x: 0, y: 0, w: 1024, h: 1024 }], 8)
    assert.equal(kept.length, 1)
  })
  it('drops what would weigh more than LIMITS allow', () => {
    const big = one({ width: [1024, 1024], spine: Array.from({ length: 16 }, (_, i) => [512, 1000 - 60 * i]) })
    const layers = Array.from({ length: 40 }, () => ({ x: 0, y: 0, w: 1024, h: 1024 }))
    const why: string[] = []
    assert.equal(withinBudget([big, { ...big, id: 'b' }], layers, 6, (w) => why.push(w)).length, 0)
    assert.equal(why.length, 2)
  })
})

/** a run of `seconds` at `fps`, sub-stepped at 120 Hz as the Puppet does: the left ear's angle each frame */
function play(e: Ear[], root: (t: number) => [number, number], seconds: number, { fps = 60, gain = (_t: number) => 1, seed = 1, roll = 0 } = {}) {
  const rig = new SoftRig(e, 512, 0, seeded(seed)), th: number[][] = e.map(() => [])
  let time = 0
  const dt = 1 / fps, steps = Math.max(1, Math.ceil(dt / (1 / 120)))
  for (let f = 0; f < seconds * fps; f++) {
    time += dt
    const g = gain(time)
    rig.frame(time, g)
    for (let i = 0; i < steps; i++) {
      const t = time - dt + (i + 1) * (dt / steps)
      for (const R of rig.runs) rig.step(R, { dt: dt / steps, time: t, gain: g, root: root(t), roll })
      rig.settle()
    }
    rig.runs.forEach((R, k) => th[k].push(R.theta))
  }
  return { rig, th }
}
const still = (): [number, number] => [330, 300]
/** the head shifted 40 px sideways over 0.25 s at 1 s, eased */
const jerk = (t: number): [number, number] => [330 + (t < 1 ? 0 : t < 1.25 ? 40 * (0.5 - 0.5 * Math.cos((Math.PI * (t - 1)) / 0.25)) : 40), 300]

describe('an ear\'s spring and twitches', () => {
  const quiet = read([ear({ twitch: 0 })]).ears
  const twitchy = read([ear()]).ears

  it('stays at exactly 0 while nothing moves it', () => {
    const { th, rig } = play(quiet, still, 4)
    assert.ok(th[0].every((a) => a === 0)); assert.ok(rig.still)
  })

  it('is thrown by the head, stays within its limit and comes back to exactly 0', () => {
    const { th } = play(quiet, jerk, 5)
    const peak = Math.max(...th[0].map(Math.abs))
    assert.ok(peak > 0.005, `${peak}`)
    assert.ok(peak <= (12 * Math.PI) / 180 + 1e-12)
    assert.equal(th[0][th[0].length - 1], 0)
  })

  it('does nothing at tuning.parts 0, and is at rest at once when it goes to 0 mid-swing', () => {
    assert.ok(play(twitchy, jerk, 8, { gain: () => 0 }).th[0].every((a) => a === 0))
    const { th } = play(quiet, jerk, 6, { gain: (t) => (t < 1.3 ? 1 : 0) })
    const f = Math.round(1.3 * 60)
    assert.notEqual(th[0][f - 2], 0)
    assert.ok(th[0].slice(f).every((a) => a === 0))
  })

  it('a hanging ear hangs as far as tuning.parts says: not at all at 0', () => {
    const lop = read([ear({ hang: 1, twitch: 0 })]).ears
    assert.ok(play(lop, still, 2, { gain: () => 0, roll: 0.2 }).th[0].every((a) => a === 0))
    const hung = play(lop, still, 2, { roll: 0.2 }).th[0]
    assert.ok(Math.abs(hung[hung.length - 1] + 0.2) < 1e-3, `${hung[hung.length - 1]}`)  // keeps hanging: turned back by the roll
  })

  it('a stiff, heavily damped spring settles too (20 Hz, damping 2, at 120 Hz sub-steps)', () => {
    const stiff = read([ear({ hz: 20, damp: 2, twitch: 0 })]).ears
    const nudge = (t: number): [number, number] => (t < 0.5 ? [330, 300] : [331, 300])
    const { th } = play(stiff, nudge, 4)
    assert.ok(th[0].every(Number.isFinite))
    assert.ok(Math.max(...th[0].map(Math.abs)) < (12 * Math.PI) / 180, 'never pinned at its limit')
    assert.equal(th[0][th[0].length - 1], 0)
    const loose = read([ear({ hz: 0.5, damp: 0, twitch: 0, drive: 20 })]).ears
    assert.ok(play(loose, jerk, 6).th[0].every(Number.isFinite))
  })

  it('never draws on Math.random, which the idle motion\'s blinks and glances come from', () => {
    const real = Math.random
    Math.random = () => { throw new Error('Math.random') }
    try {
      const rig = new SoftRig(twitchy, 512, 0)
      for (let t = 0; t < 30; t += 1 / 60) { rig.frame(t, 1); for (const R of rig.runs) rig.step(R, { dt: 1 / 60, time: t, gain: 1, root: still(), roll: 0 }); rig.settle() }
    } finally { Math.random = real }
  })

  it('throws about as far at 30 and 60 frames a second', () => {
    const a = Math.max(...play(quiet, jerk, 3).th[0].map(Math.abs)), b = Math.max(...play(quiet, jerk, 3, { fps: 30 }).th[0].map(Math.abs))
    assert.ok(Math.abs(a - b) < 0.15 * a, `${a} ${b}`)
  })

  it('twitches outward every 5-10 s, the first 2-6 s in, easing in and back', () => {
    const { rig, th } = play(twitchy, still, 40)
    const a = th[0], starts: number[] = []
    for (let f = 1; f < a.length; f++) if (a[f] !== 0 && a[f - 1] === 0) starts.push((f + 1) / 60)
    assert.ok(starts.length >= 3, `${starts}`)
    assert.ok(starts[0] >= 2 && starts[0] <= 6 + 1 / 60, `${starts[0]}`)
    for (let k = 1; k < starts.length; k++) { const d = starts[k] - starts[k - 1]; assert.ok(d >= 5 - 0.02 && d <= 10 + 0.1, `${d}`) }
    // the left ear's tip is left of the head's centre: outward turns it toward -x, a negative angle for this spine
    const f0 = Math.round(starts[0] * 60) - 1, peak = Math.min(...a.slice(f0, f0 + 20))
    assert.ok(peak < 0)
    const deg = (-peak * 180) / Math.PI
    assert.ok(deg > 7 * 0.8 * 0.9 && deg < 7 * 1.2 * 1.05, `${deg}`)
    // eases in: a small first frame, the top two or three frames later; back within 1 px of the tip by 0.35 s
    assert.ok(Math.abs(a[f0]) < 0.2 * -peak, `${a[f0]} ${peak}`)
    const top = a.slice(f0, f0 + 20).indexOf(peak)
    assert.ok(top >= 2 && top <= 6, `${top}`)
    const reach = rig.runs[0].reach
    assert.ok(Math.abs(a[f0 + Math.round(0.35 * 60)]) * reach < 1, `${a[f0 + 21] * reach}`)
    assert.ok(TWITCH_PUSH > 0)
  })

  it('the same seed twitches the same way; another does not', () => {
    const a = play(twitchy, still, 20, { seed: 3 }).th[0], b = play(twitchy, still, 20, { seed: 3 }).th[0], c = play(twitchy, still, 20, { seed: 4 }).th[0]
    assert.deepEqual(a, b); assert.notDeepEqual(a, c)
  })

  it('two ears: sometimes both, the second a little later', () => {
    const two = read([ear(), ear({ id: 'ear_R', spine: [[694, 300], [814, 40]] })]).ears
    const { th } = play(two, still, 400, { seed: 5 })
    let both = 0, one = 0
    for (let f = 1; f < th[0].length; f++) {
      const s0 = th[0][f] !== 0 && th[0][f - 1] === 0, s1 = th[1][f] !== 0 && th[1][f - 1] === 0
      if (!s0 && !s1) continue
      const near = (k: number) => th[k].slice(Math.max(0, f - 8), f + 8).some((v, i, arr) => i > 0 && v !== 0 && arr[i - 1] === 0)
      if (near(0) && near(1)) both++; else one++
    }
    assert.ok(both > 0 && one > 0, `${both} ${one}`)
  })

  it('a root that is no number puts the ear at rest, not NaN', () => {
    const { th } = play(quiet, (t) => (t > 1 && t < 1.1 ? [NaN, 300] : jerk(t)), 3)
    assert.ok(th[0].every(Number.isFinite))
  })

  it('carries its motion over to the same character loaded again, a twitch on its way too', () => {
    const { rig } = play(quiet, jerk, 1.3)
    const again = new SoftRig(quiet, 512, 1.3, seeded(1))
    again.carry(rig)
    assert.equal(again.runs[0].theta, rig.runs[0].theta); assert.notEqual(again.runs[0].theta, 0)
    // an edit that moved the root: the angle goes on, the root's motion starts again there (not taken for a fling)
    const moved = read([ear({ twitch: 0, spine: [[360, 320], [240, 60]] })]).ears
    const c = new SoftRig(moved, 512, 1.3, seeded(1))
    c.carry(rig)
    assert.equal(c.runs[0].theta, rig.runs[0].theta); assert.equal(c.runs[0].started, false)
    for (let i = 0; i < 4; i++) c.step(c.runs[0], { dt: 1 / 120, time: 1.3 + i / 120, gain: 1, root: [400, 330], roll: 0 })
    assert.ok(Math.abs(c.runs[0].theta) < Math.abs(rig.runs[0].theta) + 0.01, `${c.runs[0].theta} ${rig.runs[0].theta}`)
    const two = read([ear(), ear({ id: 'ear_R', spine: [[694, 300], [814, 40]] })]).ears
    const a = new SoftRig(two, 512, 0, seeded(5))
    a.twitches.pending.push({ t: 9, R: a.runs[1], deg: 7 })
    const b = new SoftRig(two, 512, 0, seeded(5))
    b.carry(a)
    assert.equal(b.twitches.pending.length, 1)
    assert.equal(b.twitches.pending[0].R, b.runs[1])
  })
})

describe('tuning.parts', () => {
  it('a model\'s own: a parts that is no number from 0 up is left out (the default), the rest as the file has it', () => {
    assert.equal('parts' in ownTuning({ tuning: { parts: 'abc' as unknown as number, turn: 2 } }), false)
    assert.equal(ownTuning({ tuning: { parts: 'abc' as unknown as number, turn: 2 } }).turn, 2)
    assert.equal('parts' in ownTuning({ tuning: { parts: -1 } }), false)
    assert.equal(ownTuning({ tuning: { parts: 0 } }).parts, 0)
    assert.equal(ownTuning({ tuning: { parts: 1.5 } }).parts, 1.5)
    assert.deepEqual(ownTuning(null), ownTuning({}))
  })

  it('is a factor from 0 to PARTS_GAIN_MAX, anything else 1', () => {
    assert.deepEqual([0, 0.5, 1, 2, 7].map(partsGain), [0, 0.5, 1, 2, PARTS_GAIN_MAX])
    assert.deepEqual([undefined, null, -1, NaN, Infinity, '0'].map(partsGain), [1, 1, 1, 1, 1, 1])
  })
})

describe('the schema', () => {
  const schema = JSON.parse(readFileSync(new URL('../schema/livliv-model-v4.json', import.meta.url), 'utf8'))
  it('gives an ear\'s fields the defaults and ranges the player reads them with', () => {
    const part = schema.$defs.ear, P = part.properties
    assert.deepEqual(part.required, ['kind', 'id', 'spine', 'width'])
    assert.deepEqual(P.kind, { const: 'ear' })
    // any entry: kind ear (held to the ear's fields) or a writer's own x_ kind, which readers skip as they skip any other
    const any = schema.$defs.part
    assert.deepEqual(any.required, ['kind', 'id'])
    assert.deepEqual(any.then, { $ref: '#/$defs/ear' })
    assert.ok(new RegExp(any.properties.kind.anyOf[1].pattern).test('x_tail'))
    assert.deepEqual(read([{ kind: 'x_tail', id: 'tail', anything: 1 }]).ears, [])
    for (const [k, [def, lo, hi]] of Object.entries(EAR)) assert.deepEqual([P[k].default, P[k].minimum, P[k].maximum], [def, lo, hi], k)
    assert.deepEqual(P.twitch_every.default, EAR_EVERY)
    for (const q of P.twitch_every.prefixItems) assert.deepEqual([q.minimum, q.maximum], EVERY_RANGE)
    assert.deepEqual([P.spine.minItems, P.spine.maxItems], [2, LIMITS.partPoints])
    assert.equal(schema.$defs.rig.properties.parts.maxItems, LIMITS.parts)
    // every field the player reads is in the schema, and nothing else is
    assert.deepEqual(Object.keys(P).sort(), ['kind', 'id', 'spine', 'width', 'twitch_every', ...Object.keys(EAR)].sort())
  })
})
