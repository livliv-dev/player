// @livliv-dev/player/mavatar: a Mesh Avatar Studio avatar (.mavatar) on a BodyPlayer (@livliv-dev/player/body), drawn by
// mesh-avatar, the format's own runtime (MIT), which the page installs (an optional peer dependency) and which loads only
// here. The Player's pose drives it (meshpose.ts): the head and body turn and tilt, the eyes blink and look, the brows,
// the mouth with the voice's vowel, the smile and the expressions; mesh-avatar swings its hair and moves its arms and
// legs by itself. Its own idle and motions stay off: the Player's idle, drivers and face tracking move it.
//
// mesh-avatar sizes its canvas from the canvas's CSS size and fits the picture into it by itself. So it draws on a canvas
// of the body's own, told the exact pixel size the player draws at (a detached canvas too: renderPose with a size), and
// that picture is copied into the player's canvas with the Player's move (a hop, the talking bob, the view): the player's
// canvas draws in 2D, as a PNGTuber's does, and the WebGL context is the body's own canvas's.
import { projectedAnchor, type AnchorName, type AttachmentAnchor } from './anchors'
import type { AvatarManifest, AvatarPackage, MeshAvatar } from 'mesh-avatar'
import type { Body, BodyExpression, BodyMeta, Pose } from './body'
import { LivLivError } from './errors'
import { MESH_EXPRESSIONS, meshParams, type MouthSettings } from './meshpose'

/** what a .mavatar may hold before its pictures are decoded: a picture's side and the pictures' pixels in all */
export const MAVATAR_LIMITS = { side: 8192, pixels: 64 * 2 ** 20 }

/** the WebGL attributes mesh-avatar asks for: asking first with the same ones gives it this context */
const GL: WebGLContextAttributes = { premultipliedAlpha: true, antialias: true, alpha: true, preserveDrawingBuffer: true }

/** who made the avatar and its terms, as its avatar.json says them. `text` is its licence as written (a free text in
 *  this format): `license.id` and `license.url` are what can be read from it */
export interface MavatarTerms extends BodyMeta {
  text: string | null
  raw: AvatarManifest
}

export interface MavatarBodyOptions {
  /** hair and tassel sway, 1 as the avatar was made (see `sway`) */
  sway?: number
}

/** one loaded avatar and the canvas it draws on */
interface Shown {
  avatar: MeshAvatar
  pkg: AvatarPackage
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext
  /** the pixel size mesh-avatar is told the canvas has */
  size: { w: number; h: number }
  image: { w: number; h: number }
  pad: { top: number; side: number }
  head: { cx: number; cy: number; rx: number; ry: number; pivotX: number; pivotY: number; maxRoll: number }
  chest: { cx: number; cy: number; rx: number } | null
  mouths: MouthSettings
  mood: string
  sway: number
}

export class MavatarBody implements Body {
  readonly format = 'mavatar'
  /** hair and tassel sway (mesh-avatar's setSwayGain): 0 still, 1 as the avatar was made, more to swing further */
  sway: number
  private g: CanvasRenderingContext2D | null = null
  private host: HTMLCanvasElement | null = null
  private shown: Shown | null = null
  /** the last frame's size and move, for head() and the anchors */
  private last = { w: 0, h: 0, move: { x: 0, y: 0, s: 1 }, roll: 0 }
  private anchors: Partial<Record<AnchorName, AttachmentAnchor>> = {}

  constructor(options: MavatarBodyOptions = {}) { this.sway = options.sway ?? 1 }

  attach(canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')
    this.host = canvas
    if (!this.g) throw new LivLivError('canvas-in-use', 'LivLiv: this canvas already draws with WebGL (a Player or a VRM): a .mavatar needs a canvas of its own')
  }

  /** the context of the canvas mesh-avatar draws on (the player's own canvas draws in 2D) */
  context() { return this.shown?.gl ?? null }

  async load(files: Map<string, Blob>) {
    const MA = await import('mesh-avatar').catch((e) => {
      throw new LivLivError('unreachable', `LivLiv: could not load mesh-avatar, which a .mavatar needs: is it installed, and can this page reach it? (${(e as Error).message})`)
    })
    const { bytes, file } = await archiveOf(files, MA)
    let pkg: AvatarPackage
    try { pkg = await MA.openAvatar(bytes) } catch (e) { throw refused(file, e) }
    // the new avatar on a canvas of its own, apart from the one shown (a failed load leaves that on the canvas): it takes
    // over at the end
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', GL)
    if (!gl) { pkg.release(); throw new LivLivError('no-webgl', 'LivLiv: a .mavatar needs WebGL2, and this browser gives none') }
    const size = { w: 2, h: 2 }
    let avatar: MeshAvatar
    try {
      avatar = await MA.loadMeshAvatar(sized(canvas, size), pkg, { manual: true })
    } catch (e) {
      pkg.release()
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      if (gl.isContextLost()) throw new LivLivError('context-lost', 'LivLiv: the WebGL context was lost while the avatar loaded', { cause: e })
      throw refused(file, e)
    }
    avatar.setAutoIdle(false)
    avatar.setAutoMotion(false)
    avatar.setSwayGain(this.sway)
    const rig = pkg.rig, m = pkg.manifest
    const shown: Shown = {
      avatar, pkg, canvas, gl, size, image: { w: rig.image.width, h: rig.image.height },
      pad: { top: num(rig.view.padTop), side: num(rig.view.padSide) },
      head: { cx: rig.head.cx, cy: rig.head.cy, rx: rig.head.rx, ry: rig.head.ry, pivotX: rig.head.pivotX, pivotY: rig.head.pivotY, maxRoll: num(rig.head.maxRoll, 0.15) },
      chest: rig.body.chest ? { cx: rig.body.chest.cx, cy: rig.body.chest.cy, rx: rig.body.chest.rx } : null,
      mouths: (m.expressions ?? {}) as MouthSettings, mood: 'neutral', sway: this.sway,
    }
    canvas.addEventListener('webglcontextlost', () => {
      // told to the player as its own canvas's loss: the character is gone and does not come back by itself
      if (this.shown === shown) this.host?.dispatchEvent(new Event('webglcontextlost'))
    })
    this.drop()
    this.shown = shown
    this.anchors = {}
    const name = (m.name || '').trim() || file.replace(/\.(mavatar|zip)$/i, '') || 'Mesh avatar'
    const expressions: BodyExpression[] = MESH_EXPRESSIONS.map((e) => ({ id: e.id, label: e.labels.en, labels: e.labels }))
    return { name: name.slice(0, 200), expressions, meta: terms(m) }
  }

  render(canvas: HTMLCanvasElement, { params: P, move, expr }: Pose, w: number, h: number, dt: number) {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    const g = (this.g ??= canvas.getContext('2d'))
    const s = this.shown
    if (!g || !s || s.gl.isContextLost()) return
    const { params, mood } = meshParams(P, expr, s.mouths)
    s.avatar.setParameters(params, 1)
    if (mood !== s.mood) { s.avatar.setExpression(mood as Parameters<MeshAvatar['setExpression']>[0], { parameters: false }); s.mood = mood }
    if (this.sway !== s.sway && Number.isFinite(this.sway)) { s.avatar.setSwayGain(Math.max(0, this.sway)); s.sway = this.sway }
    s.size.w = w; s.size.h = h
    // one step at most a 60th of a second (its springs and hair), the steps adding up to dt; 0 draws without time
    const t = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 1) : 0, steps = Math.max(1, Math.ceil(t * 60 - 1e-6))
    s.avatar.advance(t, t ? steps / t : 60)
    // its picture, scaled about the middle of the bottom edge and moved as the player's move says (y up)
    const k = move.s, x = (w - w * k) / 2 + move.x * w * 0.5, y = h - h * k - move.y * h * 0.5
    g.clearRect(0, 0, w, h)
    g.drawImage(s.canvas, 0, 0, w, h, x, y, w * k, h * k)
    this.last = { w, h, move: { ...move }, roll: num(P.angleZ) }
    this.place()
  }

  /** where the head is, from the rig: its middle and size at rest, through the fit and the move */
  head() {
    const s = this.shown, { w, h } = this.size()
    if (!s) return { x: 0.5, y: 0.3, rx: 0.15, ry: 0.12 }
    const [x, y] = this.at(s.head.cx, s.head.cy), k = this.fit(s, w, h).s * this.last.move.s
    return { x, y, rx: Math.min(0.5, (s.head.rx * k * 0.5) / w), ry: Math.min(0.5, (s.head.ry * k * 0.5) / h) }
  }

  anchor(name: AnchorName) { return this.anchors[name] ? { ...this.anchors[name] } : null }

  dispose() {
    this.drop()
    this.anchors = {}
  }

  /** the shown avatar gone, its canvas's context given up (the canvas is the body's own) */
  private drop() {
    const s = this.shown
    this.shown = null
    if (!s) return
    s.avatar.destroy()
    s.pkg.release()
    s.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  private size() {
    if (this.last.w && this.last.h) return this.last
    const c = this.host
    return { w: Math.max(1, c?.clientWidth || c?.width || 1), h: Math.max(1, c?.clientHeight || c?.height || 1) }
  }

  /** mesh-avatar's fit: contained, standing on the bottom, with the rig's margins (renderer.js resize) */
  private fit(s: Shown, w: number, h: number) {
    const k = Math.min(w / (s.image.w * (1 + 2 * s.pad.side)), h / (s.image.h * (1 + s.pad.top)))
    return { s: k, x: (w - s.image.w * k) / 2, y: h - s.image.h * k }
  }

  /** an avatar picture's pixel as shares of the player's canvas */
  private at(px: number, py: number): [number, number] {
    const s = this.shown!, { w, h } = this.size(), f = this.fit(s, w, h), mv = this.last.move
    const cx = f.x + px * f.s, cy = f.y + py * f.s
    return [((w - w * mv.s) / 2 + mv.x * w * 0.5 + cx * mv.s) / w, (h - h * mv.s - mv.y * h * 0.5 + cy * mv.s) / h]
  }

  /** the attachment points: the head's middle turned with its roll, the chest */
  private place() {
    const s = this.shown
    if (!s) return
    const { w, h } = this.last, hd = s.head
    // the head turns about its pivot by up to maxRoll radians at a roll of 30 (rig.js applyHead), its top to the screen's
    // right for a positive angleZ
    const a = (Math.max(-30, Math.min(30, this.last.roll)) / 30) * hd.maxRoll
    const turn = (x: number, y: number): [number, number] => {
      const dx = x - hd.pivotX, dy = y - hd.pivotY
      return [hd.pivotX + dx * Math.cos(a) - dy * Math.sin(a), hd.pivotY + dx * Math.sin(a) + dy * Math.cos(a)]
    }
    this.anchors.head = projectedAnchor(this.at(...turn(hd.cx, hd.cy)), this.at(...turn(hd.cx + hd.rx * 0.5, hd.cy)), h / w)
    const c = s.chest ?? { cx: hd.cx, cy: hd.cy + hd.ry * 1.6, rx: hd.rx * 0.7 }
    this.anchors.body = projectedAnchor(this.at(c.cx, c.cy), this.at(c.cx + c.rx, c.cy), h / w)
  }
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** the canvas as mesh-avatar sees it: its CSS size is what makes `size` pixels at this page's pixel ratio (renderer.js
 *  resize: CSS size × devicePixelRatio, at most 2), so it draws at exactly the player's size, on a canvas in no page */
function sized(canvas: HTMLCanvasElement, size: { w: number; h: number }): HTMLCanvasElement {
  const ratio = () => Math.min(window.devicePixelRatio || 1, 2)
  return new Proxy(canvas, {
    get(target, key) {
      if (key === 'clientWidth') return size.w / ratio()
      if (key === 'clientHeight') return size.h / ratio()
      const v = Reflect.get(target, key, target)
      return typeof v === 'function' ? v.bind(target) : v
    },
    set(target, key, v) { return Reflect.set(target, key, v, target) },
  })
}

type Runtime = typeof import('mesh-avatar')

/** the avatar as one .mavatar archive: the file given, or its unpacked files put together again (by name: rig.json,
 *  avatar.json, the built pictures, sprites.json and overlays.json with the files they list). Its pictures are measured
 *  from their headers before anything decodes them */
async function archiveOf(files: Map<string, Blob>, MA: Runtime): Promise<{ bytes: Uint8Array; file: string }> {
  const packed = [...files].find(([n]) => /\.mavatar$/i.test(n)) ?? [...files].find(([n]) => /\.zip$/i.test(n))
  let entries: Record<string, Uint8Array>, file: string, bytes: Uint8Array | null = null
  if (packed) {
    file = packed[0]
    bytes = new Uint8Array(await packed[1].arrayBuffer())
    try { entries = MA.unpackAvatar(bytes) } catch (e) { throw refused(file, e, 'not-a-model') }
  } else {
    file = 'rig.json'
    if (!files.has('rig.json')) throw new LivLivError('missing-file', 'LivLiv: no .mavatar file among the files, and no rig.json of an unpacked one')
    const read = async (n: string) => new Uint8Array(await files.get(n)!.arrayBuffer())
    const json = async (n: string) => { try { return JSON.parse(new TextDecoder().decode(await read(n))) } catch { throw new LivLivError('invalid', `LivLiv: ${n} is not JSON`) } }
    entries = {}
    const put = async (path: string, n = path.split('/').pop()!, need = true) => {
      if (files.has(n)) entries[path] = await read(n)
      else if (need) throw new LivLivError('missing-file', `LivLiv: ${n} is missing (the avatar names it)`)
    }
    await put('rig.json'); await put('avatar.json', 'avatar.json', false)
    if (!files.has('layers.json')) throw new LivLivError('missing-file', 'LivLiv: layers.json is missing (an unpacked avatar has it in built/)')
    const layers = await json('layers.json'), rig = await json('rig.json')
    await put('built/layers.json')
    for (const n of ['base', 'hairmask', ...(rig?.cloth?.length ? ['base_cloth'] : []), ...Object.keys(layers?.layers ?? {})]) await put(`built/${n}.png`)
    if (files.has('sprites.json')) {
      await put('built/sprites/sprites.json')
      for (const n of Object.keys((await json('sprites.json'))?.layers ?? {})) await put(`built/sprites/${n}.png`)
    }
    if (files.has('overlays.json')) {
      await put('built/overlays/overlays.json')
      const list = (await json('overlays.json'))?.overlays
      for (const o of Array.isArray(list) ? list : []) if (typeof o?.file === 'string') await put(`built/overlays/${o.file}`, o.file.split('/').pop())
    }
  }
  let pixels = 0
  for (const [path, data] of Object.entries(entries)) {
    if (!/\.(png|jpe?g|webp)$/i.test(path)) continue
    const size = pictureSize(data)
    if (!size) throw new LivLivError('invalid', `LivLiv: ${path} in ${file} is not a picture this player can measure (PNG, JPEG or WebP)`)
    if (size[0] > MAVATAR_LIMITS.side || size[1] > MAVATAR_LIMITS.side || (pixels += size[0] * size[1]) > MAVATAR_LIMITS.pixels) {
      throw new LivLivError('too-large', `LivLiv: ${file} has pictures too large for this player (${path}: ${size[0]} x ${size[1]}; ${MAVATAR_LIMITS.side} px a side and ${MAVATAR_LIMITS.pixels} pixels in all at most)`)
    }
  }
  if (!bytes) {
    try { bytes = MA.packAvatar(entries) } catch (e) { throw refused(file, e) }
  }
  return { bytes, file }
}

/** what mesh-avatar said, as a LivLivError */
function refused(file: string, e: unknown, code: 'invalid' | 'not-a-model' = 'invalid'): LivLivError {
  if (e instanceof LivLivError) return e
  const msg = String((e as Error)?.message ?? e).slice(0, 400)
  if (/WebGL2 is not available/.test(msg)) return new LivLivError('no-webgl', 'LivLiv: a .mavatar needs WebGL2, and this browser gives none', { cause: e })
  if (/exceeds 64 MB|more than \d+ entries/.test(msg)) return new LivLivError('too-large', `LivLiv: ${file} is too large for mesh-avatar (${msg})`, { cause: e })
  if (/missing file/.test(msg)) return new LivLivError('missing-file', `LivLiv: ${file} lacks a file the avatar needs (${msg})`, { cause: e })
  if (/invalid or truncated ZIP|expected stored compression|encrypted/.test(msg) || code === 'not-a-model') {
    return new LivLivError('not-a-model', `LivLiv: ${file} is not a .mavatar this player can read (${msg})`, { cause: e })
  }
  return new LivLivError('invalid', `LivLiv: ${file} is a .mavatar with a problem (${msg})`, { cause: e })
}

/** the manifest's author and licence: the licence is free text, its id read when it starts with one (an SPDX id or a
 *  LicenseRef-), its URL the first one in it */
function terms(m: AvatarManifest): MavatarTerms {
  const text = typeof m.license === 'string' && m.license.trim() ? m.license.trim().slice(0, 2000) : null
  const id = text?.match(/^(LicenseRef-[\w.-]+|[A-Za-z][\w.+-]*-\d[\w.+-]*|MIT|CC0-1\.0|Unlicense)(?=$|[\s(:;,])/)?.[1]
  const url = text?.match(/https?:\/\/[^\s)"']+/)?.[0]
  const author = typeof m.author === 'string' && m.author.trim() ? { name: m.author.trim().slice(0, 200) } : null
  return { author, license: id || url ? { ...(id ? { id } : {}), ...(url ? { url } : {}) } : null, text, raw: m }
}

/** width and height from the start of a PNG, a JPEG or a WebP (anything else: null) */
function pictureSize(d: Uint8Array): [number, number] | null {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength), n = d.byteLength
  if (n >= 24 && v.getUint32(0) === 0x89504e47 && v.getUint32(12) === 0x49484452) return [v.getUint32(16), v.getUint32(20)]
  if (n >= 30 && v.getUint32(0) === 0x52494646 && v.getUint32(8) === 0x57454250) {
    const kind = v.getUint32(12)
    if (kind === 0x56503858) return [1 + (v.getUint32(24, true) & 0xffffff), 1 + (v.getUint32(27, true) & 0xffffff)]  // VP8X
    if (kind === 0x5650384c) { const b = v.getUint32(21, true); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)] }  // VP8L
    if (kind === 0x56503820) return [v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff]  // VP8
    return null
  }
  if (n < 4 || v.getUint16(0) !== 0xffd8) return null
  for (let i = 2; i + 9 < n;) {
    if (v.getUint8(i) !== 0xff) { i++; continue }
    const mk = v.getUint8(i + 1)
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return [v.getUint16(i + 7), v.getUint16(i + 5)]
    i += 2 + v.getUint16(i + 2)
  }
  return null
}
