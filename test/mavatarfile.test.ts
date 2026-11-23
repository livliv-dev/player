// A .mavatar from anyone, before mesh-avatar sees it (src/mavatarfile.ts): what makes mesh-avatar build a mesh that would
// freeze the page or run it out of memory is refused with too-large, from the rig's JSON and the pictures' headers, with
// nothing decoded or built. Each case is the featured fixture (test/fixtures/nana.mavatar) changed in one place.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { packAvatar, parseRig, unpackAvatar } from 'mesh-avatar'
import { checkMavatar } from '../src/mavatar'
import { limits, MAVATAR_LIMITS, meshVertices } from '../src/mavatarfile'

const fixture = new Uint8Array(readFileSync(new URL('./fixtures/nana.mavatar', import.meta.url)))
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))
const dec = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b))
/** the fixture with its files changed: a function of its rig, layers.json and the files */
function changed(f: (rig: any, layers: any, files: Record<string, Uint8Array>) => void): Blob {
  const files = unpackAvatar(fixture), rig = dec(files['rig.json']), layers = dec(files['built/layers.json'])
  f(rig, layers, files)
  files['rig.json'] = enc(rig); files['built/layers.json'] = enc(layers)
  return new Blob([packAvatar(files) as BlobPart])
}
const code = async (p: Promise<unknown>) => p.then(() => 'loaded', (e) => e.code ?? String(e))
const rigOf = () => parseRig(dec(unpackAvatar(fixture)['rig.json']))
const layersOf = () => dec(unpackAvatar(fixture)['built/layers.json'])

describe('checkMavatar: what passes', () => {
  it('the fixture, named as its avatar.json says, its meshes well within the limit', async () => {
    assert.deepEqual(await checkMavatar(new Blob([fixture])), { name: 'Nana' })
    assert.equal(await code(checkMavatar(new File([fixture], 'nana.zip'))), 'loaded')
  })
  it('its unpacked files, by name, the same', async () => {
    const files = new Map(Object.entries(unpackAvatar(fixture)).map(([p, b]) => [p.split('/').pop()!, new Blob([b as BlobPart])]))
    assert.deepEqual(await checkMavatar(files), { name: 'Nana' })
  })
  it('unpacked files may leave avatar.json out (mesh-avatar names them Avatar); an archive may not', async () => {
    const files = new Map(Object.entries(unpackAvatar(fixture)).filter(([p]) => p !== 'avatar.json').map(([p, b]) => [p.split('/').pop()!, new Blob([b as BlobPart])]))
    assert.deepEqual(await checkMavatar(files), { name: 'Avatar' })
    const { zipSync } = await import('fflate'), all = unpackAvatar(fixture)
    delete all['avatar.json']
    assert.equal(await code(checkMavatar(new Blob([zipSync(all, { level: 0 }) as BlobPart]))), 'missing-file')
  })
})

describe('checkMavatar: a rig that would build too much', () => {
  it('a rig for a larger picture than its base picture (mesh-avatar meshes rig.image, not the picture)', async () => {
    const big = changed((rig, layers) => { rig.image = { width: 3072, height: 3072 }; layers.size = [3072, 3072] })
    assert.equal(await code(checkMavatar(big)), 'invalid')
  })
  it('cells under the limit: the base, its fine area', async () => {
    assert.equal(await code(checkMavatar(changed((rig) => { rig.mesh.baseCell = 1 }))), 'too-large')
    assert.equal(await code(checkMavatar(changed((rig) => { rig.mesh.fine.cell = 1 }))), 'too-large')
    assert.equal(await code(checkMavatar(changed((rig) => { rig.mesh.spriteCell = 1 }))), 'too-large')
  })
  it('cells allowed one by one but too many vertices together', async () => {
    assert.equal(await code(checkMavatar(changed((rig) => { rig.mesh.baseCell = 2; rig.mesh.fine.cell = 2 }))), 'too-large')
  })
  it('JSON over its size, before it is parsed', async () => {
    const huge = changed((_rig, _layers, files) => { const a = dec(files['avatar.json']); a.license = 'x'.repeat(MAVATAR_LIMITS.json); files['avatar.json'] = enc(a) })
    assert.equal(await code(checkMavatar(huge)), 'too-large')
  })
  it('a picture whose header says it is larger than the limit', async () => {
    const bomb = changed((_rig, _layers, files) => { const b = files['built/base.png'].slice(); new DataView(b.buffer).setUint32(16, 9000); files['built/base.png'] = b })
    assert.equal(await code(checkMavatar(bomb)), 'too-large')
  })
  it('entries that are not stored as they are (mesh-avatar refuses them too)', async () => {
    const { zipSync } = await import('fflate')
    const files = unpackAvatar(fixture), deflated = zipSync(Object.fromEntries(Object.entries(files).map(([p, b]) => [p, [b, { level: p === 'avatar.json' ? 6 : 0 }]])) as never)
    assert.equal(await code(checkMavatar(new Blob([deflated as BlobPart]))), 'not-a-model')
  })
})

describe('checkMavatar: one mesh per entry, as mesh-avatar builds them', () => {
  const overlay = (n: number) => changed((_rig, _layers, files) => {
    files['built/overlays/big.png'] = files['built/base.png']
    files['built/overlays/overlays.json'] = enc({ version: 1, overlays: Array.from({ length: n }, (_, i) => ({ name: `o${i}`, file: 'big.png' })) })
  })
  it('the fixture: about 38 000 vertices, inside the limit (about three times the largest real avatar)', () => {
    const files = unpackAvatar(fixture), v = meshVertices(rigOf(), layersOf(), dec(files['built/sprites/sprites.json']), [])
    assert.ok(v > 30_000 && v < 45_000 && v < MAVATAR_LIMITS.vertices, `${v}`)
  })
  it('overlays.json entries that all name one large picture: a mesh each', async () => {
    assert.equal(await code(checkMavatar(overlay(40))), 'too-large')
  })
  it("an overlay's file: a plain name of the archive, nothing else (no folders, ., .., /, \\, ? or a missing file)", async () => {
    const { zipSync } = await import('fflate')
    for (const name of ['../base.png', './glasses.png', 'glasses.png?', '/glasses.png', 'a\\glasses.png', 'gone.png']) {
      const all = unpackAvatar(fixture)
      all['built/overlays/glasses.png'] = all['built/eye0_crease.png']
      all['built/overlays/overlays.json'] = enc({ version: 1, overlays: [{ name: 'g', file: name }] })
      // packed as is: packAvatar would refuse these itself
      assert.equal(await code(checkMavatar(new Blob([zipSync(all, { level: 0 }) as BlobPart]))), name === 'gone.png' ? 'missing-file' : 'invalid', name)
    }
  })
  it('more sprites.json entries than the limit: a mesh, and a draw, each', async () => {
    const many = changed((_rig, _layers, files) => {
      const sheet = dec(files['built/sprites/sprites.json']), one = Object.keys(sheet.layers)[0]
      for (let i = 0; i < MAVATAR_LIMITS.sprites; i++) { sheet.layers[`x${i}`] = sheet.layers[one]; files[`built/sprites/x${i}.png`] = files[`built/sprites/${one}.png`] }
      files['built/sprites/sprites.json'] = enc(sheet)
    })
    assert.equal(await code(checkMavatar(many)), 'too-large')
  })
  it('more overlays.json entries than the limit', async () => {
    const many = changed((_rig, _layers, files) => {
      files['built/overlays/dot.png'] = files['built/eye0_crease.png']
      files['built/overlays/overlays.json'] = enc({ version: 1, overlays: Array.from({ length: MAVATAR_LIMITS.overlays + 1 }, (_, i) => ({ name: `o${i}`, file: 'dot.png' })) })
    })
    assert.equal(await code(checkMavatar(many)), 'too-large')
  })
})

describe('the rig limits, one by one', () => {
  const run = (f: (rig: any, layers: any) => void) => {
    const rig = rigOf() as any, layers = layersOf()
    f(rig, layers)
    try { limits(rig, layers, null, [], [rig.image.width, rig.image.height], 'x.mavatar'); return 'ok' } catch (e) { return (e as { code?: string }).code }
  }
  it('the fixture as it is', () => assert.equal(run(() => {}), 'ok'))
  it('eyes: a mesh for each of their four parts', () => {
    assert.equal(run((rig) => { rig.eyes = Array.from({ length: MAVATAR_LIMITS.eyes + 1 }, () => rig.eyes[0]) }), 'too-large')
    assert.equal(run((rig) => { rig.eyes = Array.from({ length: MAVATAR_LIMITS.eyes }, () => rig.eyes[0]) }), 'ok')
  })
  it('hair strands, accessories, garments', () => {
    assert.equal(run((rig) => { rig.strands = Array.from({ length: MAVATAR_LIMITS.strands + 1 }, () => rig.strands[0]) }), 'too-large')
    assert.equal(run((rig) => { rig.accessories = Array.from({ length: MAVATAR_LIMITS.accessories + 1 }, () => ({})) }), 'too-large')
    assert.equal(run((rig) => { rig.cloth = Array.from({ length: MAVATAR_LIMITS.garments + 1 }, (_, i) => ({ name: `c${i}` })) }), 'too-large')
  })
  it("a garment's columns and rows", () => {
    assert.equal(run((rig) => { rig.cloth = [{ name: 'skirt', columns: 1000, rows: 5 }] }), 'too-large')
    assert.equal(run((rig) => { rig.cloth = [{ name: 'skirt', columns: 8, rows: 1000 }] }), 'too-large')
    assert.equal(run((rig) => { rig.cloth = [{ name: 'skirt', seams: Array.from({ length: 200 }, () => [[0, 0], [1, 1]]) }] }), 'too-large')
    assert.equal(run((rig) => { rig.cloth = [{ name: 'skirt', columns: 8, rows: 5 }] }), 'ok')
  })
  it('any list in the rig: an outline, a strand of many nodes', () => {
    assert.equal(run((rig) => { rig.strands[0].nodes = Array.from({ length: MAVATAR_LIMITS.points + 1 }, (_, i) => [i, i]) }), 'too-large')
    assert.equal(run((rig) => { rig.head.weightOutline = Array.from({ length: 5000 }, (_, i) => [i % 100, i % 50]) }), 'too-large')
  })
  it('accessories: each its own name, each a mesh of its rectangle', () => {
    assert.equal(run((rig, layers) => { rig.accessories = [{ name: 'a' }, { name: 'a' }]; layers.layers.a = [0, 0, 10, 10] }), 'invalid')
    assert.equal(run((rig, layers) => { rig.accessories = Array.from({ length: 30 }, (_, i) => ({ name: `a${i}` })); for (let i = 0; i < 30; i++) layers.layers[`a${i}`] = [0, 0, 1024, 1536] }), 'too-large')
    assert.equal(run((rig, layers) => { rig.accessories = [{ name: 'a' }]; layers.layers.a = [0, 0, 60, 120] }), 'ok')
  })
  it('layers drawn on cells too small for their size', () => {
    assert.equal(run((rig, layers) => { rig.mesh.eyeCell = 2; layers.layers.eye0_lash = [0, 0, 1024, 1536] }), 'too-large')
  })
})
