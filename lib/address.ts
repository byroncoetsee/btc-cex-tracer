import * as crypto from "crypto"

/**
 * Convert any Bitcoin address to an Electrum-style scripthash.
 * Supports P2PKH (1…), P2SH (3…), P2WPKH/P2WSH (bc1q…), P2TR (bc1p…).
 */

// --- Base58 decode ---

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

function base58Decode(str: string): Buffer {
  const bytes: number[] = [0]
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char)
    if (idx < 0) throw new Error(`Invalid base58 character: ${char}`)
    let carry = idx
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  // leading zeros
  for (const char of str) {
    if (char !== "1") break
    bytes.push(0)
  }
  return Buffer.from(bytes.reverse())
}

function base58CheckDecode(str: string): { version: number; hash: Buffer } {
  const raw = base58Decode(str)
  if (raw.length < 5) throw new Error("Base58Check too short")
  const payload = raw.slice(0, -4)
  const checksum = raw.slice(-4)
  const hash = crypto.createHash("sha256").update(payload).digest()
  const hash2 = crypto.createHash("sha256").update(hash).digest()
  if (!hash2.subarray(0, 4).equals(checksum)) {
    throw new Error("Base58Check checksum mismatch")
  }
  return { version: payload[0], hash: payload.slice(1) }
}

// --- Bech32 decode ---

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const top = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GEN[i]
    }
  }
  return chk
}

function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = []
  for (const c of hrp) ret.push(c.charCodeAt(0) >> 5)
  ret.push(0)
  for (const c of hrp) ret.push(c.charCodeAt(0) & 31)
  return ret
}

function bech32Decode(str: string): {
  hrp: string
  version: number
  program: Buffer
} {
  const lower = str.toLowerCase()
  const pos = lower.lastIndexOf("1")
  if (pos < 1) throw new Error("Invalid bech32: no separator")
  const hrp = lower.slice(0, pos)
  const dataChars = lower.slice(pos + 1)

  const data: number[] = []
  for (const c of dataChars) {
    const idx = BECH32_CHARSET.indexOf(c)
    if (idx < 0) throw new Error(`Invalid bech32 character: ${c}`)
    data.push(idx)
  }

  const polymod = bech32Polymod([...bech32HrpExpand(hrp), ...data])
  // bech32 = 1, bech32m = 0x2bc830a3
  if (polymod !== 1 && polymod !== 0x2bc830a3) {
    throw new Error("Invalid bech32 checksum")
  }

  const version = data[0]
  const payload = data.slice(1, -6)

  // convert from 5-bit groups to 8-bit bytes
  let acc = 0
  let bits = 0
  const result: number[] = []
  for (const val of payload) {
    acc = (acc << 5) | val
    bits += 5
    if (bits >= 8) {
      bits -= 8
      result.push((acc >> bits) & 0xff)
    }
  }

  return { hrp, version, program: Buffer.from(result) }
}

// --- ScriptPubKey construction ---

function addressToScriptPubKey(address: string): Buffer {
  const trimmed = address.trim()

  // bech32 / bech32m (bc1q… or bc1p…)
  if (trimmed.toLowerCase().startsWith("bc1")) {
    const { version, program } = bech32Decode(trimmed)
    // OP_n (0 = 0x00, 1 = 0x51, …) + push length + program
    const opVersion = version === 0 ? 0x00 : 0x50 + version
    return Buffer.concat([
      Buffer.from([opVersion, program.length]),
      program,
    ])
  }

  // base58check (1… = P2PKH, 3… = P2SH)
  const { version, hash } = base58CheckDecode(trimmed)
  if (version === 0x00) {
    // P2PKH: OP_DUP OP_HASH160 <20> hash OP_EQUALVERIFY OP_CHECKSIG
    return Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      hash,
      Buffer.from([0x88, 0xac]),
    ])
  }
  if (version === 0x05) {
    // P2SH: OP_HASH160 <20> hash OP_EQUAL
    return Buffer.concat([
      Buffer.from([0xa9, 0x14]),
      hash,
      Buffer.from([0x87]),
    ])
  }

  throw new Error(`Unsupported address version: ${version}`)
}

// --- Public API ---

/** Convert a Bitcoin address to an Electrum-protocol scripthash (reversed SHA256 of scriptPubKey). */
export function addressToScripthash(address: string): string {
  const script = addressToScriptPubKey(address)
  const hash = crypto.createHash("sha256").update(script).digest()
  // reverse in place
  hash.reverse()
  return hash.toString("hex")
}
