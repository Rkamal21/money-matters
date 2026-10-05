/**
 * SHA-256 (FIPS 180-4) of a string's UTF-8 bytes, as lower-case hex.
 *
 * Synchronous and dependency-free on purpose. `crypto.subtle.digest` is
 * asynchronous and does not exist outside a secure context — and the app opened
 * on a phone over the local network is not one — while a duplicate key has to
 * be computable wherever the parser runs. DATABASE.md specifies `dedupe_hash` as
 * SHA-256, so this produces exactly the bytes that column will hold.
 *
 * Used for duplicate keys only. Nothing secret is hashed here.
 */

const ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

const INITIAL_HASH = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]

// Word arrays live in DataViews: reads return a plain number, so the loops need
// no `?? 0` fallbacks under `noUncheckedIndexedAccess`.
function wordsOf(values: readonly number[]): DataView {
  const view = new DataView(new ArrayBuffer(values.length * 4))
  values.forEach((value, index) => view.setUint32(index * 4, value))
  return view
}

const K = wordsOf(ROUND_CONSTANTS)

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

/**
 * UTF-8 by hand. `TextEncoder` is a Web API, and the parser also runs inside
 * Android's JavaScriptSandbox (platform/sms), which offers only ECMAScript. A
 * lone surrogate becomes U+FFFD, exactly as `TextEncoder` encodes it.
 */
function utf8(text: string): number[] {
  const bytes: number[] = []
  for (const char of text) {
    const point = char.codePointAt(0) as number
    const code = point >= 0xd800 && point <= 0xdfff ? 0xfffd : point
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return bytes
}

export function sha256Hex(text: string): string {
  const bytes = utf8(text)
  // Message, the 0x80 marker, zero padding, then the bit length in the last 8 bytes.
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const message = new Uint8Array(paddedLength)
  message.set(bytes)
  message.set([0x80], bytes.length)
  const data = new DataView(message.buffer)
  const bitLength = bytes.length * 8
  data.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000))
  data.setUint32(paddedLength - 4, bitLength >>> 0)

  const hash = wordsOf(INITIAL_HASH)
  const w = new DataView(new ArrayBuffer(64 * 4))

  for (let block = 0; block < paddedLength; block += 64) {
    for (let i = 0; i < 16; i++) w.setUint32(i * 4, data.getUint32(block + i * 4))
    for (let i = 16; i < 64; i++) {
      const w15 = w.getUint32((i - 15) * 4)
      const w2 = w.getUint32((i - 2) * 4)
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)
      w.setUint32(i * 4, (w.getUint32((i - 16) * 4) + s0 + w.getUint32((i - 7) * 4) + s1) >>> 0)
    }

    let a = hash.getUint32(0)
    let b = hash.getUint32(4)
    let c = hash.getUint32(8)
    let d = hash.getUint32(12)
    let e = hash.getUint32(16)
    let f = hash.getUint32(20)
    let g = hash.getUint32(24)
    let h = hash.getUint32(28)

    for (let i = 0; i < 64; i++) {
      const sum1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const choice = (e & f) ^ (~e & g)
      const t1 = (h + sum1 + choice + K.getUint32(i * 4) + w.getUint32(i * 4)) >>> 0
      const sum0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }

    ;[a, b, c, d, e, f, g, h].forEach((value, index) =>
      hash.setUint32(index * 4, (hash.getUint32(index * 4) + value) >>> 0),
    )
  }

  let hex = ''
  for (let offset = 0; offset < 32; offset += 4) {
    hex += hash.getUint32(offset).toString(16).padStart(8, '0')
  }
  return hex
}
