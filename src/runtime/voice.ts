// Microphone -> mouth open (PNGTuber-style lip sync, all local).
//  - speech band only (band-pass around 200-2000 Hz): breaths, fan noise and hiss barely move the mouth
//  - automatic gain: the room's noise floor and the speaker's own loudness are tracked, so a quiet voice on a
//    laptop mic and a loud one on a headset both open the mouth the full range (`gain` still scales it)
//  - opens fast, closes a little slower; the renderer adds hysteresis between mouth frames
//  - the vowel (vowel.ts) from the unfiltered spectrum: o / u round, i / e wide
//
// The analysis (band-pass + RMS + spectrum) runs in an AudioWorklet on the audio render thread and the main thread
// reads one posted value per frame. Previously the level and vowel were read synchronously on the main thread with
// AnalyserNode.getFloatTimeDomainData / getFloatFrequencyData, which can deadlock against the audio thread after a few
// minutes of a live stream (the page freezes, audio keeps playing).
import { VowelCue } from './vowel'

/** an <audio> / <video> element routed through Web Audio plays only through that context from then on, and an element
 *  can be routed once: each keeps its context and source for good, and stop() only unplugs the meter from it */
const routed = new WeakMap<HTMLMediaElement, { ctx: AudioContext; src: MediaElementAudioSourceNode }>()

/** the AudioWorklet processor source: band-pass + RMS for the level, and a 1024-point FFT for the vowel band ratios.
 *  Runs on the audio render thread, so the main thread never blocks on a synchronous analyser read. */
const WORKLET = `
const FFT = 1024
class LivlivVoiceMeter extends AudioWorkletProcessor {
  constructor() {
    super()
    this.n = 0
    this.raw = new Float32Array(FFT)
    this.bp = new Float32Array(FFT)
    this.re = new Float32Array(FFT)
    this.im = new Float32Array(FFT)
    this.win = new Float32Array(FFT)
    for (let i = 0; i < FFT; i++) this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT - 1))
    // band-pass 650 Hz, Q 0.55 (RBJ cookbook), matching the previous BiquadFilterNode
    const w = 2 * Math.PI * 650 / sampleRate
    const alpha = Math.sin(w) / (2 * 0.55)
    const a0 = 1 + alpha
    this.b0 = alpha / a0; this.b1 = 0; this.b2 = -alpha / a0
    this.a1 = (-2 * Math.cos(w)) / a0; this.a2 = (1 - alpha) / a0
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const x = ch[i]
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
        this.x2 = this.x1; this.x1 = x
        this.y2 = this.y1; this.y1 = y
        if (this.n < FFT) { this.raw[this.n] = x; this.bp[this.n] = y; this.n++ }
      }
      if (this.n >= FFT) {
        let s = 0
        for (let i = 0; i < FFT; i++) s += this.bp[i] * this.bp[i]
        const rms = Math.sqrt(s / FFT)
        for (let i = 0; i < FFT; i++) { this.re[i] = this.raw[i] * this.win[i]; this.im[i] = 0 }
        fft(this.re, this.im)
        const hz = sampleRate / FFT
        const sum = (a, b) => {
          let t = 1e-12
          for (let k = Math.ceil(a / hz); k * hz < b && k < FFT / 2; k++) t += this.re[k] * this.re[k] + this.im[k] * this.im[k]
          return t
        }
        const back = 10 * Math.log10(sum(300, 900) / sum(1800, 3500))
        const close = 10 * Math.log10(sum(250, 650) / sum(650, 1300))
        this.port.postMessage({ rms: rms, back: back, close: close })
        this.n = 0
      }
    }
    return true
  }
}
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const tr = re[i], ti = im[i]; re[i] = re[j]; im[i] = im[j]; re[j] = tr; im[j] = ti }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2
        const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti
        const c2 = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = c2
      }
    }
  }
}
registerProcessor('livliv-voice-meter', LivlivVoiceMeter)
`

export class VoiceMeter {
  ctx?: AudioContext; stream?: MediaStream; level = 0; gain = 1
  /** -1 round (o, u) .. +1 wide (i, e), 0 neither; updated by read() */
  vowel = 0
  private cue = new VowelCue()
  private floor = 0.004 // noise floor (RMS), follows quiet moments quickly and rises slowly
  private peak = 0.05   // recent speaking loudness, decays over a few seconds
  private last = 0
  private rms = 0
  private back = NaN
  private close = NaN

  private el?: HTMLAudioElement
  /** the page's own element (start), and what the meter plugged into it */
  private tap?: { src: AudioNode; to: AudioNode[] }
  /** the voice as a stream, for recording it alongside */
  out?: MediaStream

  /** file: play this audio (looped, audible) instead of listening to the microphone: tests without anyone talking.
   *  The SDK also passes a stream (a call's remote voice: listened to, not played) or an <audio> / <video> element the
   *  page plays itself (its sound goes on through the speakers) */
  async start(file?: string | MediaStream | HTMLMediaElement) {
    if (!file) this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    const own = file instanceof HTMLMediaElement ? file : undefined
    let r = own && routed.get(own)
    if (own && !r) {
      const c = new AudioContext()
      r = { ctx: c, src: c.createMediaElementSource(own) }
      r.src.connect(c.destination)
      routed.set(own, r)
    }
    const ctx = this.ctx = r ? r.ctx : new AudioContext()
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    try { await ctx.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
    const node = new AudioWorkletNode(ctx, 'livliv-voice-meter')
    node.port.onmessage = (e: MessageEvent<{ rms: number; back: number; close: number }>) => {
      this.rms = e.data.rms; this.back = e.data.back; this.close = e.data.close
    }
    const dest = ctx.createMediaStreamDestination()
    this.out = dest.stream
    const stream = this.stream || (file instanceof MediaStream ? file : undefined)
    if (stream) { const src = ctx.createMediaStreamSource(stream); src.connect(node); src.connect(dest) }
    else if (r) {
      r.src.connect(node); r.src.connect(dest)
      this.tap = { src: r.src, to: [node, dest] }
      if (ctx.state !== 'running') addEventListener('pointerdown', () => ctx.resume(), { once: true })  // autoplay rules
    } else {
      const el = this.el = new Audio(file as string); el.loop = true
      const src = ctx.createMediaElementSource(el)
      src.connect(node); src.connect(ctx.destination); src.connect(dest)
      // autoplay needs a click first in most browsers
      el.play().catch(() => addEventListener('pointerdown', () => { ctx.resume(); el.play() }, { once: true }))
    }
  }

  /** (a stream the page passed in stays on: it is theirs) */
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop()); this.el?.pause()
    if (this.tap) { const { src, to } = this.tap; to.forEach((n) => src.disconnect(n)); this.tap = undefined }
    else this.ctx?.close()
  }

  /** 0..1 mouth openness, smoothed; call once per frame */
  read(): number {
    const now = performance.now(), dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 1 / 60)
    this.last = now
    const rms = this.rms
    this.floor = rms < this.floor ? this.floor + (rms - this.floor) * Math.min(1, dt * 4) : this.floor + (rms - this.floor) * dt * 0.05
    this.floor = Math.max(0.0005, this.floor)
    const gate = this.floor * 2.2
    this.peak = Math.max(rms, gate * 3, 0.012, this.peak * Math.exp(-dt / 3))
    const x = Math.min(1, Math.max(0, (rms - gate) / (this.peak - gate)))
    const target = Math.min(1, Math.pow(x, 0.8) * 1.1 * this.gain)
    this.level += (target - this.level) * Math.min(1, dt * (target > this.level ? 30 : 14))
    if (this.back === this.back) this.vowel = this.cue.pushBands(this.back, this.close, this.level, dt)
    return this.level
  }
}
