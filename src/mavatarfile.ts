// A .mavatar read before mesh-avatar sees it (@livliv-dev/player/mavatar). A file from anyone (a friend's co-stream
// character, a shared project) must not make mesh-avatar build a mesh that freezes the page or runs it out of memory:
// mesh-avatar builds its meshes from the rig's numbers (rig.image over mesh.baseCell, a grid per layer, cloth columns and
// rows), not from the pictures. So the pictures are measured from their headers, the rig's cost counted from its JSON,
// both against MAVATAR_LIMITS, and only then is anything decoded.
//
// The package mesh-avatar plays from is one per distinct avatar (by its content): mesh-avatar keeps every picture and
// JSON file it has loaded, by URL, for the life of the page, so the same avatar loaded again gets the same URLs, not new
// ones that would each keep their pictures.
import type { AvatarManifest, AvatarPackage, Rig } from 'mesh-avatar'
import { BODY_LIMIT } from './body'
import { LivLivError } from './errors'

/** what a .mavatar may hold, checked before anything in it is decoded or built:
 *  - side, pixels: a picture's side, and the pictures' pixels in all;
 *  - json: each JSON file (avatar.json, rig.json, layers.json, sprites.json, overlays.json), in bytes;
 *  - cell: a mesh cell's side at least, in pixels (rig.mesh: baseCell, fine.cell and the others);
 *  - vertices: the meshes' vertices in all, counted from the rig and the layers' rectangles as mesh-avatar lays its
 *    grids (an avatar made in Mesh Avatar Studio has some 20 000);
 *  - points: the entries of any one list in the rig (an outline, a strand's nodes, a seam);
 *  - strands, accessories, garments: hair strands, swinging accessories, cloth layers;
 *  - garmentSide: a garment's columns, and its rows.
 *  The rig's picture size (rig.image) must also be the base picture's own. */
export const MAVATAR_LIMITS = {
  side: 8192, pixels: 64 * 2 ** 20, json: 2 ** 20, cell: 2, vertices: 262_144,
  points: 512, strands: 64, accessories: 32, garments: 16, garmentSide: 64,
} as const

type Runtime = typeof import('mesh-avatar')
type Entries = Record<string, Uint8Array>

/** mesh-avatar, which the page installs */
export async function runtime(): Promise<Runtime> {
  return import('mesh-avatar').catch((e) => {
    throw new LivLivError('unreachable', `LivLiv: could not load mesh-avatar, which a .mavatar needs: is it installed, and can this page reach it? (${(e as Error).message})`)
  })
}

const tooLarge = (file: string, what: string) => new LivLivError('too-large', `LivLiv: ${file} is too large for this player: ${what}`)

/** the avatar's files by their path in a .mavatar (avatar.json, rig.json, built/...): from the .mavatar given, or its
 *  unpacked files put in their places (by name: rig.json, avatar.json, the built pictures, sprites.json and overlays.json
 *  with the files they list) */
export async function entriesOf(files: Map<string, Blob>, MA: Runtime): Promise<{ entries: Entries; file: string }> {
  let total = 0
  for (const b of files.values()) if ((total += b.size) > BODY_LIMIT) throw new LivLivError('too-large', `LivLiv: the files are larger than ${BODY_LIMIT} bytes`)
  const packed = [...files].find(([n]) => /\.mavatar$/i.test(n)) ?? [...files].find(([n]) => /\.zip$/i.test(n))
  if (packed) {
    const [file, blob] = packed
    let entries: Entries
    try { entries = MA.unpackAvatar(new Uint8Array(await blob.arrayBuffer())) } catch (e) { throw refused(file, e, 'not-a-model') }
    // as mesh-avatar's openAvatar: an archive has its manifest (unpacked files may leave it out)
    if (!entries['avatar.json']) throw new LivLivError('missing-file', `LivLiv: ${file} has no avatar.json, which a .mavatar has`)
    return { entries, file }
  }
  const file = 'rig.json', entries: Entries = {}
  if (!files.has('rig.json')) throw new LivLivError('missing-file', 'LivLiv: no .mavatar file among the files, and no rig.json of an unpacked one')
  const read = async (n: string) => new Uint8Array(await files.get(n)!.arrayBuffer())
  const json = async (n: string) => {
    const b = await read(n)
    if (b.byteLength > MAVATAR_LIMITS.json) throw tooLarge(n, `${b.byteLength} bytes of JSON, more than ${MAVATAR_LIMITS.json}`)
    try { return JSON.parse(new TextDecoder().decode(b)) } catch { throw new LivLivError('invalid', `LivLiv: ${n} is not JSON`) }
  }
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
  return { entries, file }
}

/** The avatar's manifest and rig, once its files pass mesh-avatar's own checks and this player's limits (see
 *  MAVATAR_LIMITS): nothing is decoded or built before */
export function inspect(entries: Entries, file: string, MA: Runtime): { manifest: AvatarManifest; rig: Rig } {
  // the JSON files' sizes, before any is parsed
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('.json') && data.byteLength > MAVATAR_LIMITS.json) throw tooLarge(file, `${path} has ${data.byteLength} bytes, more than ${MAVATAR_LIMITS.json}`)
  }
  // the pictures, from their headers
  const sizes = new Map<string, [number, number]>()
  let pixels = 0
  for (const [path, data] of Object.entries(entries)) {
    if (!/\.(png|jpe?g|webp)$/i.test(path)) continue
    const size = pictureSize(data)
    if (!size) throw new LivLivError('invalid', `LivLiv: ${path} in ${file} is not a picture this player can measure (PNG, JPEG or WebP)`)
    if (size[0] > MAVATAR_LIMITS.side || size[1] > MAVATAR_LIMITS.side || (pixels += size[0] * size[1]) > MAVATAR_LIMITS.pixels) {
      throw tooLarge(file, `${path} is ${size[0]} x ${size[1]} (${MAVATAR_LIMITS.side} px a side and ${MAVATAR_LIMITS.pixels} pixels in all at most)`)
    }
    sizes.set(path, size)
  }
  // mesh-avatar's own checks (its schema, the files it names), then its parsing
  const errors = MA.validateAvatarFiles(entries)
  if (errors.length) throw refused(file, new Error(errors.slice(0, 4).join('; ')))
  const parse = (path: string) => JSON.parse(new TextDecoder().decode(entries[path]))
  let manifest: AvatarManifest, rig: Rig
  try {
    // unpacked files without avatar.json: the manifest mesh-avatar's packAvatar gives them
    manifest = MA.parseManifest(entries['avatar.json'] ? parse('avatar.json') : { format: 'mesh-avatar', version: 1, name: 'Avatar' })
    rig = MA.parseRig(parse('rig.json'))
  } catch (e) { throw refused(file, e) }
  const layers = parse('built/layers.json') as { layers?: Record<string, number[]> }
  const sprites = entries['built/sprites/sprites.json'] ? parse('built/sprites/sprites.json') as { layers?: Record<string, number[]> } : null
  const overlays = [...sizes].filter(([p]) => p.startsWith('built/overlays/')).map(([, s]) => s)
  limits(rig, layers, sprites, overlays, sizes.get('built/base.png'), file)
  return { manifest, rig }
}

/** the rig's cost against MAVATAR_LIMITS: its picture size the base picture's, its lists, cells and meshes
 *  @internal (exported for its tests) */
export function limits(rig: Rig, layers: { layers?: Record<string, number[]> }, sprites: { layers?: Record<string, number[]> } | null,
  overlays: [number, number][], base: [number, number] | undefined, file: string) {
  const L = MAVATAR_LIMITS, R = rig as unknown as Record<string, unknown>
  if (!base || rig.image.width !== base[0] || rig.image.height !== base[1]) {
    throw new LivLivError('invalid', `LivLiv: ${file}'s rig is for a picture of ${rig.image.width} x ${rig.image.height}, and its base picture is ${base ? base.join(' x ') : 'missing'}`)
  }
  // every list in the rig, however deep: an outline, a strand's nodes, a seam
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      if (v.length > L.points) throw tooLarge(file, `${path} has ${v.length} entries (${L.points} at most)`)
      v.forEach((x) => walk(x, path))
    } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`)
  }
  walk(rig, 'rig')
  const count = (k: string) => (Array.isArray(R[k]) ? (R[k] as unknown[]).length : 0)
  if (count('strands') > L.strands) throw tooLarge(file, `${count('strands')} hair strands (${L.strands} at most)`)
  if (count('accessories') > L.accessories) throw tooLarge(file, `${count('accessories')} accessories (${L.accessories} at most)`)
  if (count('cloth') > L.garments) throw tooLarge(file, `${count('cloth')} garments (${L.garments} at most)`)
  for (const c of rig.cloth ?? []) {
    const cols = c.seams?.length || (c.columns ?? 8), rows = c.rows ?? 5, tiers = c.tiers?.length ?? 0
    if (cols > L.garmentSide || rows > L.garmentSide || tiers > L.garmentSide) throw tooLarge(file, `the garment ${String(c.name).slice(0, 40)} has ${cols} columns, ${rows} rows and ${tiers} tiers (${L.garmentSide} each at most)`)
  }
  // the cells, then the meshes' vertices as mesh-avatar lays its grids (renderer.js axis and buildGrid)
  const mesh = rig.mesh as Rig['mesh'] & { clothCell?: number }
  const cell = (name: string, v: unknown, fallback?: number) => {
    const c = v === undefined && fallback !== undefined ? fallback : v
    if (typeof c !== 'number' || !Number.isInteger(c) || c < L.cell) throw tooLarge(file, `rig.mesh.${name} is ${String(c)} px (${L.cell} at least)`)
    return c
  }
  const C = {
    base: cell('baseCell', mesh.baseCell), fine: cell('fine.cell', mesh.fine?.cell), hand: cell('handCell', mesh.handCell),
    tassel: cell('tasselCell', mesh.tasselCell), ball: cell('eyeBallCell', mesh.eyeBallCell), eye: cell('eyeCell', mesh.eyeCell),
    sprite: cell('spriteCell', mesh.spriteCell), cloth: cell('clothCell', mesh.clothCell, 8),
  }
  const fine = mesh.fine
  let vertices = 0
  const add = (rect: unknown, c: number, f?: { from: number; to: number }[]) => {
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every((n) => typeof n === 'number' && Number.isFinite(n))) return
    const [x, y, w, h] = rect as number[]
    vertices += steps(x, Math.min(w, L.side), c, f?.[0]) * steps(y, Math.min(h, L.side), c, f?.[1])
    if (vertices > L.vertices) throw tooLarge(file, `its meshes would have more than ${L.vertices} vertices (mesh cells too small for its pictures)`)
  }
  add([0, 0, rig.image.width, rig.image.height], C.base, [{ from: fine.x0, to: fine.x1 }, { from: fine.y0, to: fine.y1 }].map((r) => ({ ...r, cell: C.fine })))
  for (const [name, rect] of Object.entries(layers.layers ?? {})) {
    add(rect, /^eye\d+_ball$/.test(name) ? C.ball : /^eye\d+_/.test(name) ? C.eye : name === 'hand' ? C.hand : name.startsWith('cloth_') ? C.cloth : C.tassel)
  }
  for (const rect of Object.values(sprites?.layers ?? {})) add(rect, C.sprite)
  for (const [w, h] of overlays) add([0, 0, w, h], C.sprite)
}

/** points along one side of a grid, as mesh-avatar's axis() lays them: a cell apart, a finer one inside `fine` */
function steps(start: number, len: number, cell: number, fine?: { from: number; to: number; cell?: number }) {
  let n = 1
  for (let v = start; v < start + len - 0.5; n++) v = Math.min(start + len, v + (fine?.cell && v >= fine.from && v < fine.to ? fine.cell : cell))
  return n
}

/** one package per distinct avatar, kept while it plays and a few after: the same avatar loaded again (a stage that
 *  draws it once more, a video made of it) gets the same URLs, and mesh-avatar's caches do not grow */
const shared = new Map<string, { pkg: AvatarPackage; users: number; idle: number }>()
const KEEP_IDLE = 6
let clock = 0

/** the package mesh-avatar plays from, and the key to give it back by (null: not shared) */
export async function packageFor(entries: Entries, manifest: AvatarManifest, rig: Rig): Promise<{ pkg: AvatarPackage; key: string | null }> {
  const key = await digest(entries)
  const had = key ? shared.get(key) : undefined
  if (had) { had.users++; return { pkg: had.pkg, key } }
  const urls: string[] = [], assets: Record<string, string> = {}
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith('built/')) continue
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: path.endsWith('.json') ? 'application/json' : 'image/png' }))
    urls.push(url); assets[path.slice('built/'.length)] = url
  }
  const pkg: AvatarPackage = { manifest, rig, assets, release() { urls.splice(0).forEach((u) => URL.revokeObjectURL(u)) } }
  if (key) shared.set(key, { pkg, users: 1, idle: 0 })
  return { pkg, key }
}

/** a package no longer played by one of its users: kept a while for the next, released when too many wait */
export function giveBack(pkg: AvatarPackage, key: string | null) {
  const s = key ? shared.get(key) : undefined
  if (!s || s.pkg !== pkg) { pkg.release(); return }
  if (--s.users > 0) return
  s.idle = ++clock
  const idle = [...shared].filter(([, v]) => v.users <= 0).sort((a, b) => a[1].idle - b[1].idle)
  for (const [k, v] of idle.slice(0, Math.max(0, idle.length - KEEP_IDLE))) { v.pkg.release(); shared.delete(k) }
}

/** the avatar's content as a key (SHA-256 of its files by path), where the page has WebCrypto (not on plain-HTTP pages) */
async function digest(entries: Entries): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const enc = new TextEncoder(), parts: Uint8Array[] = []
  for (const path of Object.keys(entries).sort()) {
    const name = enc.encode(path), size = new Uint8Array(new Uint32Array([name.byteLength, entries[path].byteLength]).buffer)
    parts.push(size, name, entries[path])
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const p of parts) { all.set(p, at); at += p.byteLength }
  try { return [...new Uint8Array(await subtle.digest('SHA-256', all))].map((b) => b.toString(16).padStart(2, '0')).join('') } catch { return null }
}

/** what mesh-avatar said, as a LivLivError */
export function refused(file: string, e: unknown, code: 'invalid' | 'not-a-model' = 'invalid'): LivLivError {
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
