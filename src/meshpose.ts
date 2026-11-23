// A Player pose in mesh-avatar's terms (@livliv-dev/player/mavatar): its parameters, and the live expression whose drawn
// eyes and mouths it shows. Pure numbers, no runtime: the pose alone decides the picture, so a pose replayed (renderPose,
// a recording, a friend's copy of the character) draws as it did live.
//
// Expressions are weighted here, as the Player's are: mesh-avatar's own live expressions switch one at a time and ease
// on its clock. Their numbers are mesh-avatar 0.9.0's (MIT, engine/motion.js and engine/expression-overlay.js), applied
// as its overlay applies them, each by its weight.
import type { Labels } from './runtime/format'
import type { Params } from './runtime/params'

/** what an expression does to the face (mesh-avatar's overlay terms): eyes open by (each eye), eyes smiling, blush,
 *  brows, the mouth's opening and shape while the voice leaves it closer, a glance, the head's nod */
interface Face { eyeOpen: number; eyeOpenL: number; eyeSmile: number; eyeSmileL: number; blush: number; browY: number; browAngle: number
  mouthOpen: number; mouthForm: number; gx: number; gy: number; pitch: number }

const NEUTRAL: Face = { eyeOpen: 1, eyeOpenL: 1, eyeSmile: 0, eyeSmileL: 0, blush: 0, browY: 0, browAngle: 0, mouthOpen: 0, mouthForm: 0, gx: 0, gy: 0, pitch: 0 }
const face = (f: Partial<Face>): Face => ({ ...NEUTRAL, eyeOpenL: f.eyeOpen ?? 1, eyeSmileL: f.eyeSmile ?? 0, ...f })

/** mesh-avatar's live expressions as a BodyPlayer offers them: its own names, but `laugh` for its `smile` (the eyes shut
 *  in a ^^ smile), since `smile` is the Player's own (the smile param, a happy face here) */
export const MESH_EXPRESSIONS: { id: string; mesh: string; labels: Labels; face: Face }[] = [
  { id: 'laugh', mesh: 'smile', labels: { en: 'Laugh', zh: '大笑', 'zh-Hant': '大笑', ja: '笑い' }, face: face({ eyeOpen: 0, eyeSmile: 1, blush: 0.35, browY: 0.2 }) },
  { id: 'shy', mesh: 'shy', labels: { en: 'Shy', zh: '害羞', 'zh-Hant': '害羞', ja: '照れ' },
    face: face({ eyeOpen: 0.78, eyeSmile: 0.5, blush: 1, browAngle: -0.5, browY: -0.1, gx: 0.7, gy: 0.35 }) },
  { id: 'surprise', mesh: 'surprise', labels: { en: 'Surprised', zh: '惊讶', 'zh-Hant': '驚訝', ja: '驚き' },
    face: face({ eyeOpen: 1.22, browY: 1, mouthOpen: 0.6, mouthForm: 0.6 }) },
  { id: 'halfLidded', mesh: 'halfLidded', labels: { en: 'Half-lidded', zh: '半眯眼', 'zh-Hant': '半瞇眼', ja: 'ジト目' },
    face: face({ eyeOpen: 0.5, browY: -0.5, browAngle: 0.6 }) },
  { id: 'angry', mesh: 'angry', labels: { en: 'Angry', zh: '生气', 'zh-Hant': '生氣', ja: '怒り' }, face: face({ eyeOpen: 0.72, browAngle: 0.85, browY: -0.55, mouthForm: 0.2 }) },
  { id: 'sad', mesh: 'sad', labels: { en: 'Sad', zh: '难过', 'zh-Hant': '難過', ja: '悲しい' },
    face: face({ eyeOpen: 0.78, browAngle: -0.8, browY: -0.2, mouthForm: 0.3, gy: -0.45, pitch: -6 }) },
  { id: 'wink', mesh: 'wink', labels: { en: 'Wink', zh: '眨眼', 'zh-Hant': '眨眼', ja: 'ウインク' }, face: { ...NEUTRAL, eyeOpenL: 0, eyeSmileL: 1, blush: 0.3 } },
]

/** the Player's smile param at 1: mesh-avatar's happy talking face (open eyes; its mouth shape is the voice's) */
const SMILE = face({ eyeOpen: 0.8, eyeSmile: 0.45, blush: 0.35, browY: 0.25 })

/** a drawn expression (eyes, a closed mouth) is shown while its weight is at least this, the strongest one */
export const DRAWN_FROM = 0.35

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** per expression, the mouth opening the avatar's own file sets (avatar.json `expressions`, mesh-avatar's ids) */
export type MouthSettings = Record<string, { mouthOpen?: number } | undefined>

/** The pose's params and expression weights as mesh-avatar parameters, and the live expression to draw (`neutral` for
 *  none). Its arms, hands and legs are left to it. */
export function meshParams(P: Params, expr: Record<string, number>, settings: MouthSettings = {}): { params: Record<string, number>; mood: string } {
  // the expressions' weights, shared out when together they come to more than 1
  const weights = MESH_EXPRESSIONS.map((e) => clamp(num(expr[e.id]), 0, 1))
  const total = weights.reduce((a, b) => a + b, 0) + clamp(num(P.smile), 0, 1)
  const k = total > 1 ? 1 / total : 1
  const m = { ...NEUTRAL }
  const add = (f: Face, w: number) => { for (const key of Object.keys(m) as (keyof Face)[]) m[key] += (f[key] - NEUTRAL[key]) * w * k }
  add(SMILE, clamp(num(P.smile), 0, 1))
  MESH_EXPRESSIONS.forEach((e, i) => {
    const own = settings[e.mesh]?.mouthOpen
    add(typeof own === 'number' && Number.isFinite(own) ? { ...e.face, mouthOpen: clamp(own, 0, 1) } : e.face, weights[i])
  })
  // the pose itself, then the expressions over it as mesh-avatar's overlay puts them
  // the two runtimes count some things the other way round: mesh-avatar's head and body roll their tops to the
  // screen's left (the Player's to its right), and its eyeR is the eye on the screen's left (the Player's eyeL, as
  // in a LivLiv model's eye_L)
  const open = clamp(num(P.mouthOpen), 0, 1)
  const out: Record<string, number> = {
    angleX: num(P.angleX), angleY: clamp(num(P.angleY) + m.pitch, -30, 30), angleZ: -num(P.angleZ),
    bodyAngleX: num(P.bodyX), bodyAngleZ: -num(P.bodyZ), breath: num(P.breath),
    eyeROpen: clamp(num(P.eyeLOpen, 1) * m.eyeOpen, 0, 1.25), eyeLOpen: clamp(num(P.eyeROpen, 1) * m.eyeOpenL, 0, 1.25),
    eyeSmile: clamp(m.eyeSmile, 0, 1), eyeSmileL: clamp(m.eyeSmileL, 0, 1), blush: clamp(m.blush, 0, 1),
    gazeX: clamp(num(P.eyeBallX) + m.gx, -1, 1), gazeY: clamp(num(P.eyeBallY) + m.gy, -1, 1),
    browY: clamp((num(P.browLY) + num(P.browRY)) / 2 + m.browY, -1, 1), browAngle: clamp(m.browAngle, -1, 1),
    // the Player's vowel runs from round (-1) to wide (+1), mesh-avatar's mouth form from wide (i, -1) to round (u, +1)
    mouthOpen: Math.max(open, m.mouthOpen), mouthForm: m.mouthOpen > open ? clamp(m.mouthForm, -1, 1) : clamp(-num(P.vowel), -1, 1),
  }
  let mood = 'neutral', best = DRAWN_FROM
  MESH_EXPRESSIONS.forEach((e, i) => { if (weights[i] >= best) { best = weights[i]; mood = e.mesh } })
  return { params: out, mood }
}
