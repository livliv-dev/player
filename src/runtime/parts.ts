// Soft parts (model.json `rig.parts`, format 4.3): regions of the picture that move on their own, added to a character
// after it is built and without changing any image. A part is a field of weights over the model's lattice, a way the
// weights move what lies in it, and the drivers that push it. Every layer's vertices inside the field move by the same
// rule, so whatever lies there (an ear, the copy of it painted into the hair behind, the hair at its base) moves as one
// picture and nothing under it is uncovered.
//
// The first kind is an upright animal ear: a band along its spine that turns about its root, a damped spring thrown by
// the head's motion, and now and then a twitch. Kinds this player does not know are skipped, and a part that is not
// valid is dropped: the model plays on without it, as a player from before 4.3 plays it.
import { LIMITS } from './format'

/** an upright animal ear as model.json gives it (FORMAT.md, Appendix E). Model px; a missing field takes EAR's default */
export interface EarDef {
  kind: 'ear'
  id: string
  /** root first (where the ear meets the head), then toward the tip: the field is 0 at the root and rises to 1 along it */
  spine: [number, number][]
  /** half the band's width across the spine, at the root and at the tip (linear between): all of the ear inside it */
  width: [number, number]
  /** the soft edge past the width, a share of width[0] */
  feather?: number
  /** the share of the spine over which the weight rises to 1: less turns the upper ear stiffly and bends only its base */
  bend?: number
  /** the spring: its frequency (Hz) and damping ratio */
  hz?: number; damp?: number
  /** how far the root's acceleration throws it (1: a free pendulum of the ear's length) */
  drive?: number
  /** the most it turns either way (degrees) */
  max_angle?: number
  /** 0..1: how much it keeps hanging as the head rolls */
  hang?: number
  /** a twitch's peak (degrees, outward); 0: it never twitches */
  twitch?: number
  /** seconds between twitches, drawn evenly from this range */
  twitch_every?: [number, number]
}
/** an entry of rig.parts as a writer gives it: a kind this player knows, or any other (skipped) */
export type PartDef = EarDef | { kind: string; id: string; [field: string]: unknown }
/** an ear as the player plays it: every field there and in range */
export type Ear = Required<EarDef>

/** each ear field's default and range (FORMAT.md Appendix E): the values the ears were tuned to */
export const EAR = {
  feather: [0.35, 0, 2], bend: [1, 0.05, 1], hz: [5, 0.5, 20], damp: [0.5, 0, 2], drive: [4, 0, 20], max_angle: [12, 0, 45],
  hang: [0, 0, 1], twitch: [7, 0, 30],
} as const satisfies Record<string, readonly [number, number, number]>
export const EAR_EVERY: readonly [number, number] = [5, 10]
/** twitch_every's range (s) */
export const EVERY_RANGE: readonly [number, number] = [1, 120]
/** the kinds this player plays */
export const PART_KINDS: readonly string[] = ['ear']
/** a part's id: as a layer's (the schema's id) */
const ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
/** tuning.parts above this counts as this: the parts' motion at twice its own is as far as a picture bends cleanly */
export const PARTS_GAIN_MAX = 2

/** A twitch is a short push on the spring (sin², TWITCH_PUSH s): it eases in over two or three frames at 60 fps instead
 *  of jumping, and the spring brings the ear back. A character's ears share one rhythm: each time one of them twitches,
 *  or both (TWITCH_BOTH of the time, the second 60-90 ms later), at its own strength times 0.8-1.2. The first comes
 *  2-6 s after the model loads
 *  @internal */
export const TWITCH_PUSH = 0.07, TWITCH_BOTH = 0.35
/** the second ear's lag: from TWITCH_LAG, up to TWITCH_LAG_SPREAD more (s)
 *  @internal */
export const TWITCH_LAG = 0.06, TWITCH_LAG_SPREAD = 0.03
/** the first twitch: TWITCH_FIRST after the load, up to TWITCH_FIRST_SPREAD more (s)
 *  @internal */
export const TWITCH_FIRST = 2, TWITCH_FIRST_SPREAD = 4
/** at most this many of a part's pushes at once (they last TWITCH_PUSH s, a second or more apart) */
const PULSES = 4
/** a spring this close to rest is at rest exactly: the frame draws as without it */
const REST_ANGLE = 1e-5, REST_SPEED = 1e-4

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const point = (q: unknown): q is [number, number] => Array.isArray(q) && q.length === 2 && finite(q[0]) && finite(q[1])

/** tuning.parts as the player reads it: 0 (off) to PARTS_GAIN_MAX, anything not a number from 0 up the default 1 */
export function partsGain(v: unknown): number {
  return finite(v) && v >= 0 ? Math.min(v, PARTS_GAIN_MAX) : 1
}

/** The soft parts of a model this player plays: its rig.parts read as untrusted input. Never throws: an entry of a kind
 *  this player does not know is skipped, one that is not valid (FORMAT.md Appendix E) is dropped and said so through
 *  `warn`, and a list that is no list, or longer than LIMITS.parts, is not read at all. A field missing or null takes its
 *  default (null: a build's None, as everywhere in the model); a number out of its range is brought into it, a width
 *  past the canvas's longer side to that side. At most LIMITS.ears ears */
export function readParts(model: { canvas: [number, number]; rig?: { parts?: unknown } }, warn: (why: string) => void = () => {}): Ear[] {
  const raw = model.rig?.parts
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > LIMITS.parts) { warn(`rig.parts is not a list of at most ${LIMITS.parts}: none of it is played`); return [] }
  const [W, H] = model.canvas, side = Math.max(W, H)
  const ears: Ear[] = [], ids = new Set<string>()
  for (const e of raw as unknown[]) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) { warn('a part is not an object'); continue }
    const d = e as Record<string, unknown>
    if (d.kind !== 'ear') continue  // a kind for a newer player (or none)
    const id = typeof d.id === 'string' && ID.test(d.id) && !ids.has(d.id) ? d.id : null
    const bad = (why: string) => warn(`part ${id ?? (typeof d.id === 'string' ? d.id.slice(0, 64) : `(${typeof d.id} id)`)} is not played: ${why}`)
    if (!id) { bad('its id is missing, not an id, or used twice'); continue }
    const s = d.spine
    if (!Array.isArray(s) || s.length < 2 || s.length > LIMITS.partPoints || !s.every(point)) { bad(`its spine is not 2 to ${LIMITS.partPoints} points`); continue }
    if (!s.every(([x, y]) => x >= -W && x <= 2 * W && y >= -H && y <= 2 * H)) { bad('its spine leaves the canvas'); continue }
    let len = 0
    for (let i = 1; i < s.length; i++) { const dx = s[i][0] - s[i - 1][0], dy = s[i][1] - s[i - 1][1]; len += Math.sqrt(dx * dx + dy * dy) }
    if (!(len >= 4)) { bad('its spine is shorter than 4 px'); continue }
    if (!point(d.width) || !(d.width[0] > 0 && d.width[1] > 0)) { bad('its width is not two numbers above 0'); continue }
    const ear = { kind: 'ear', id, spine: s.map(([x, y]) => [x, y]), width: [Math.min(d.width[0], side), Math.min(d.width[1], side)] } as Ear
    let ok = true
    for (const [k, [def, lo, hi]] of Object.entries(EAR) as [keyof typeof EAR, readonly [number, number, number]][]) {
      const v = d[k]
      if (v == null) ear[k] = def
      else if (finite(v)) ear[k] = clamp(v, lo, hi)
      else { bad(`its ${k} is not a number`); ok = false; break }
    }
    if (!ok) continue
    const ev = d.twitch_every
    if (ev == null) ear.twitch_every = [...EAR_EVERY]
    else if (point(ev)) {
      const a = clamp(ev[0], EVERY_RANGE[0], EVERY_RANGE[1])
      ear.twitch_every = [a, clamp(ev[1], a, EVERY_RANGE[1])]
    } else { bad('its twitch_every is not two numbers'); continue }
    if (ears.length >= LIMITS.ears) { bad(`a model has at most ${LIMITS.ears} ears`); continue }
    ids.add(id)
    ears.push(ear)
  }
  return ears
}

// ------------------------------------------------------------------------------------------------ the field

/** where a part acts: its weight (0..1) at a place at rest, model px, and a box outside which it is 0
 *  @internal */
export interface SoftField {
  at(x: number, y: number): number
  /** [x0, y0, x1, y1] */
  box: [number, number, number, number]
  /** the work of one at(), in the units the load's budget counts (segments of the spine) */
  cost: number
}

const smooth = (e0: number, e1: number, x: number) => {
  if (!(e1 > e0)) return x < e0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** An ear's field: the distance along the spine to the point of it nearest (x, y), as a share of its length, rising
 *  smoothly to 1 at `bend`; times 1 within the width there, easing to 0 across the feather
 *  @internal */
export function spineField(e: Ear): SoftField {
  const s = e.spine, n = s.length - 1
  const ax = new Float64Array(n), ay = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n), L2 = new Float64Array(n), L = new Float64Array(n)
  let len = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < n; i++) {
    ax[i] = s[i][0]; ay[i] = s[i][1]; vx[i] = s[i + 1][0] - ax[i]; vy[i] = s[i + 1][1] - ay[i]
    L2[i] = vx[i] * vx[i] + vy[i] * vy[i]; L[i] = Math.sqrt(L2[i]); len += L[i]
  }
  for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  const fe = e.feather * e.width[0], pad = Math.max(e.width[0], e.width[1]) + fe + 1
  return {
    box: [x0 - pad, y0 - pad, x1 + pad, y1 + pad],
    cost: n,
    at(x, y) {
      let bd = Infinity, bs = 0, acc = 0
      for (let i = 0; i < n; i++) {
        if (L2[i] > 0) {
          const t = Math.min(1, Math.max(0, ((x - ax[i]) * vx[i] + (y - ay[i]) * vy[i]) / L2[i]))
          const dx = x - ax[i] - t * vx[i], dy = y - ay[i] - t * vy[i], d = Math.sqrt(dx * dx + dy * dy)
          if (d < bd) { bd = d; bs = acc + t * L[i] }
        }
        acc += L[i]
      }
      const u = bs / len
      const hw = e.width[0] + (e.width[1] - e.width[0]) * u
      return smooth(0, e.bend, u) * (1 - smooth(hw, hw + fe, bd))
    },
  }
}

/** where a layer's mesh can have vertices: its box out to the lattice points round it, [x0, y0, x1, y1] (model px)
 *  @internal */
export function latticeBox(b: { x: number; y: number; w: number; h: number }, cell: number): [number, number, number, number] {
  return [Math.floor(b.x / cell) * cell, Math.floor(b.y / cell) * cell, Math.ceil((b.x + b.w) / cell) * cell, Math.ceil((b.y + b.h) / cell) * cell]
}

/** The parts, in order, whose fields a load can weigh within LIMITS: for each, the vertices its box could hold (every
 *  lattice point inside it of each layer's latticeBox, which no mesh exceeds) times the work of one weight. The parts
 *  past the budget are dropped, said so through `warn`
 *  @internal */
export function withinBudget<P extends { field: SoftField; id: string }>(parts: P[], boxes: { x: number; y: number; w: number; h: number }[], cell: number,
  warn: (why: string) => void = () => {}): P[] {
  let vertices = 0, work = 0
  const kept: P[] = []
  for (const p of parts) {
    const [bx0, by0, bx1, by1] = p.field.box
    let v = 0
    for (const b of boxes) {
      const [lx0, ly0, lx1, ly1] = latticeBox(b, cell)
      const x0 = Math.max(bx0, lx0), y0 = Math.max(by0, ly0), x1 = Math.min(bx1, lx1), y1 = Math.min(by1, ly1)
      if (x1 < x0 || y1 < y0) continue
      v += (Math.floor(x1 / cell) - Math.ceil(x0 / cell) + 1) * (Math.floor(y1 / cell) - Math.ceil(y0 / cell) + 1)
    }
    if (vertices + v > LIMITS.partVertices || work + v * p.field.cost > LIMITS.partWork) { warn(`part ${p.id} is not played: its field would cover more than this player weighs`); continue }
    vertices += v; work += v * p.field.cost
    kept.push(p)
  }
  return kept
}

// ------------------------------------------------------------------------------------------------ motion and drivers

/** what a driver reads each physics sub-step
 *  @internal */
export interface SoftInput {
  dt: number
  /** the time at the sub-step's end (s) */
  time: number
  /** tuning.parts (partsGain): 0 is off */
  gain: number
  /** where the head has put the part's root this sub-step (model px) */
  root: [number, number]
  /** the head's roll (rad) */
  roll: number
}
/** One source of force on a part's spring. This version has the head's motion (headInertia) and twitches (Twitches);
 *  the body's acceleration, breathing and a pointer's poke or drag are drivers of the same shape, with what they read
 *  added to SoftInput. Internal: it may change as kinds are added (the format is the contract, not this)
 *  @internal */
export interface SoftDriver {
  /** once a frame, before its sub-steps (`time` at the frame's end): start what comes at a moment (a twitch) */
  frame?(rig: SoftRig, time: number, gain: number): void
  /** the angular acceleration it adds this sub-step (rad/s²) */
  force(run: SoftRun, k: SoftInput): number
}

/** a part as it plays
 *  @internal */
export interface SoftPart {
  kind: 'ear'
  id: string
  def: Ear
  field: SoftField
  /** how the weights move a vertex: about the root by the spring's angle times the weight */
  motion: 'turn'
  drivers: SoftDriver[]
}
/** a part's motion: its spring, and its root's place, speed and acceleration (smoothed) as the drivers read them
 *  @internal */
export interface SoftRun {
  part: SoftPart
  /** the root (model px at rest), the unit axis from it to the tip, the tip's distance, the twitch's outward sign */
  root: [number, number]; ax: [number, number]; reach: number; out: number
  /** the spring's angle (rad) and speed */
  theta: number; omega: number
  p: [number, number]; v: [number, number]; a: [number, number]; started: boolean
  /** pushes under way: their start (s) and strength at the top (rad/s²) */
  pulses: { t0: number; k: number }[]
  /** the push strength that peaks this spring at 1 rad */
  unit: number
}

/** the push strength that peaks a spring of `hz`, `damp` at 1 rad (a short simulation, once per part)
 *  @internal */
export function pulseUnit(hz: number, damp: number): number {
  const w = 2 * Math.PI * hz, z = damp, h = 1 / 960
  let th = 0, om = 0, peak = 0
  for (let t = 0; t < 0.6; t += h) {
    const f = t < TWITCH_PUSH ? Math.sin((Math.PI * t) / TWITCH_PUSH) ** 2 : 0
    om += (-w * w * th - 2 * z * w * om + f) * h; th += om * h
    peak = Math.max(peak, th)
  }
  return peak > 0 ? 1 / peak : 0
}

/** the head's motion: the tip lags the root, so the root's acceleration across the ear's axis (which turns with the
 *  head's roll) turns it, `drive` times as much as a free pendulum of its length
 *  @internal */
export const headInertia: SoftDriver = {
  force(R, k) {
    const c = Math.cos(k.roll), s = Math.sin(k.roll)
    const ex = R.ax[0] * c - R.ax[1] * s, ey = R.ax[0] * s + R.ax[1] * c
    const across = -(R.a[0] * -ey + R.a[1] * ex) / R.reach
    return R.part.def.drive * k.gain * across
  },
}

/** the twitches of one character's ears: one rhythm for all of them (see TWITCH_PUSH)
 *  @internal */
export class Twitches implements SoftDriver {
  /** when the next one starts */
  next: number
  /** twitches decided, waiting for their start: the time, the part, degrees */
  pending: { t: number; R: SoftRun; deg: number }[] = []
  private random: () => number
  constructor(random: () => number, now: number) {
    this.random = random
    this.next = now + TWITCH_FIRST + this.random() * TWITCH_FIRST_SPREAD
  }
  frame(rig: SoftRig, time: number, gain: number) {
    if (gain <= 0) this.pending = []
    if (time < this.next) return
    const tw = rig.runs.filter((R) => R.part.drivers.includes(this) && R.part.def.twitch > 0)
    if (gain > 0 && tw.length) {
      const both = this.random() < TWITCH_BOTH, first = Math.floor(this.random() * tw.length)
      tw.forEach((R, k) => {
        if (!both && k !== first) return
        const deg = R.part.def.twitch * (0.8 + 0.4 * this.random()) * gain
        const t = time + (both && k !== first ? TWITCH_LAG + TWITCH_LAG_SPREAD * this.random() : 0)
        this.pending.push({ t, R, deg })
      })
    }
    const ev = (tw[0] ?? rig.runs[0])?.part.def.twitch_every ?? EAR_EVERY
    this.next = time + ev[0] + this.random() * (ev[1] - ev[0])
  }
  force(R: SoftRun, k: SoftInput) {
    if (this.pending.length) {
      for (const q of this.pending) if (q.R === R && q.t <= k.time) { R.pulses.push({ t0: q.t, k: R.out * R.unit * (q.deg * Math.PI) / 180 }); q.t = Infinity }
      if (R.pulses.length > PULSES) R.pulses.splice(0, R.pulses.length - PULSES)
    }
    let push = 0
    for (const q of R.pulses) { const u = k.time - q.t0; if (u > 0 && u < TWITCH_PUSH) push += q.k * Math.sin((Math.PI * u) / TWITCH_PUSH) ** 2 }
    if (R.pulses.length && k.time - R.pulses[0].t0 > TWITCH_PUSH) R.pulses = R.pulses.filter((q) => k.time - q.t0 <= TWITCH_PUSH)
    return push
  }
  /** after every part's sub-step: what has started is no longer waiting */
  settle() { if (this.pending.length) this.pending = this.pending.filter((q) => q.t !== Infinity) }
}

/** the twitches' own numbers when no seed is given: from the platform's random bytes, never from Math.random, which the
 *  idle motion draws its blinks and glances from (a model with soft parts, on or off, leaves that stream as it was)
 *  @internal */
export function softRandom(): () => number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto
  const seed = c?.getRandomValues ? c.getRandomValues(new Uint32Array(1))[0] : (Date.now() ^ (performance.now() * 1e3)) >>> 0
  return seeded(seed)
}

/** a generator of numbers in [0, 1) from a seed (mulberry32): the same twitches on every run, for tests and recordings
 *  @internal */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A model's soft parts in motion: each part's spring, stepped with the physics, and the drivers they share
 *  @internal */
export class SoftRig {
  readonly runs: SoftRun[]
  readonly twitches: Twitches
  /** each driver's force this sub-step (a part has a few) */
  private forces = new Float64Array(8)
  constructor(ears: Ear[], headCx: number, now: number, random: () => number = softRandom()) {
    this.twitches = new Twitches(random, now)
    this.runs = ears.map((def) => {
      const part: SoftPart = { kind: 'ear', id: def.id, def, field: spineField(def), motion: 'turn', drivers: [headInertia, this.twitches] }
      const s = def.spine, r = s[0], t = s[s.length - 1]
      const reach = Math.hypot(t[0] - r[0], t[1] - r[1]) || 1
      const ax: [number, number] = [(t[0] - r[0]) / reach, (t[1] - r[1]) / reach]
      // a +theta turn moves the tip along (-ax.y, ax.x); outward is away from the head's centre line
      const out = Math.sign(-ax[1] * (t[0] - headCx)) || 1
      return { part, root: [r[0], r[1]], ax, reach, out, theta: 0, omega: 0, p: [0, 0], v: [0, 0], a: [0, 0], started: false, pulses: [],
        unit: pulseUnit(def.hz, def.damp) } as SoftRun
    })
  }

  /** once a frame, before its sub-steps */
  frame(time: number, gain: number) {
    const seen = new Set<SoftDriver>()
    for (const R of this.runs) for (const d of R.part.drivers) if (d.frame && !seen.has(d)) { seen.add(d); d.frame(this, time, gain) }
  }

  /** one physics sub-step of one part: its root's place this sub-step, the head's roll, the time at the sub-step's end.
   *  At gain 0 the part is at rest, at once */
  step(R: SoftRun, k: SoftInput) {
    if (!(k.gain > 0)) { this.rest(R); return }
    const D = R.part.def, dt = k.dt, inv = 1 / Math.max(dt, 1e-4), [wx, wy] = k.root
    if (!R.started) { R.p = [wx, wy]; R.v = [0, 0]; R.a = [0, 0]; R.started = true }
    // the root's velocity and acceleration, low-passed (~40 ms) as the hair's drive is
    const ks = Math.min(1, dt * 25)
    const vx = R.v[0] + ((wx - R.p[0]) * inv - R.v[0]) * ks, vy = R.v[1] + ((wy - R.p[1]) * inv - R.v[1]) * ks
    R.a[0] += ((vx - R.v[0]) * inv - R.a[0]) * ks; R.a[1] += ((vy - R.v[1]) * inv - R.a[1]) * ks
    R.p = [wx, wy]; R.v = [vx, vy]
    const w = 2 * Math.PI * D.hz, z = D.damp
    const rest = -Math.min(1, D.hang * k.gain) * k.roll
    const D2 = R.part.drivers, f = this.forces
    for (let i = 0; i < D2.length; i++) f[i] = D2[i].force(R, k)
    // the spring, semi-implicit: stable while (w h)² + 4 z w h stays below 4; a stiff, heavily damped one (20 Hz, damping
    // 2 at 120 Hz) is stepped n times within the sub-step, its pushes held
    const a = w * w * dt * dt, b = 2 * z * w * dt
    let n = 1
    while (a / (n * n) + (2 * b) / n > 1 && n < 32) n++
    const h = dt / n
    for (let j = 0; j < n; j++) {
      let alpha = -w * w * (R.theta - rest) - 2 * z * w * R.omega
      for (let i = 0; i < D2.length; i++) alpha += f[i]
      R.omega += alpha * h; R.theta += R.omega * h
    }
    const m = (D.max_angle * Math.PI) / 180
    if (R.theta > m + rest) { R.theta = m + rest; R.omega = Math.min(0, R.omega) }
    if (R.theta < -m + rest) { R.theta = -m + rest; R.omega = Math.max(0, R.omega) }
    if (!Number.isFinite(R.theta) || !Number.isFinite(R.omega) || !Number.isFinite(R.a[0] + R.a[1] + R.v[0] + R.v[1])) this.rest(R)
    else if (Math.abs(R.theta) < REST_ANGLE && Math.abs(R.omega) < REST_SPEED && !R.pulses.length) { R.theta = 0; R.omega = 0 }
  }

  /** after every part has taken a sub-step */
  settle() { this.twitches.settle() }

  /** every part at rest exactly: a frame draws as without them */
  get still(): boolean { return this.runs.every((R) => R.theta === 0) }

  private rest(R: SoftRun) { R.theta = 0; R.omega = 0; R.started = false; R.pulses = [] }
  /** all at rest, nothing waiting (the twitches keep their rhythm) */
  reset() { for (const R of this.runs) this.rest(R); this.twitches.pending = [] }

  /** the motion of the parts with the same id and kind in `b` (the same character loaded again) goes on here */
  carry(b: SoftRig) {
    const old = new Map(b.runs.map((R) => [R.part.id, R]))
    for (const R of this.runs) {
      const o = old.get(R.part.id)
      if (!o || o.part.kind !== R.part.kind) continue
      Object.assign(R, { theta: o.theta, omega: o.omega, pulses: o.pulses.map((q) => ({ ...q })) })
      // the root's place, speed and acceleration only where the root is where it was: an edit that moved it would take
      // the jump for a speed and throw the ear to its limit
      if (o.root[0] === R.root[0] && o.root[1] === R.root[1]) Object.assign(R, { p: [...o.p], v: [...o.v], a: [...o.a], started: o.started })
    }
    this.twitches.next = b.twitches.next
    const runs = new Map(this.runs.map((R) => [R.part.id, R]))
    this.twitches.pending = b.twitches.pending.flatMap((q) => { const R = runs.get(q.R.part.id); return R && q.t !== Infinity ? [{ ...q, R }] : [] })
  }
}
