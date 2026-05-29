import * as crypto from "crypto"
import { HDKey } from "@scure/bip32"
import { base58check, bech32, bech32m } from "@scure/base"
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { secp256k1 } = require("@noble/curves/secp256k1.js") as {
  secp256k1: {
    Point: {
      fromHex(hex: Uint8Array | string): PointInstance
      BASE: PointInstance
    }
  }
}
interface PointInstance {
  add(other: PointInstance): PointInstance
  multiply(scalar: bigint): PointInstance
  hasEvenY(): boolean
  negate(): PointInstance
  toHex(compressed?: boolean): string
  x: bigint
}

/**
 * Derive Bitcoin addresses from extended public keys.
 *
 * Like the Python tracer, we try ALL derivation schemes for every key —
 * the prefix (xpub/ypub/zpub) does NOT reliably indicate the script type.
 *
 * For each key we derive:
 *   - BIP86  P2TR          (bc1p…)  taproot
 *   - BIP84  P2WPKH        (bc1q…)  native segwit
 *   - BIP49  P2SH-P2WPKH   (3…)    wrapped segwit
 *   - BIP44  P2PKH         (1…)    legacy
 */

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(crypto.createHash("sha256").update(data).digest())
}

const VERSION_XPUB = 0x0488b21e

/** Normalize any extended key (xpub/ypub/zpub) to xpub version bytes so HDKey can parse it. */
function toHDKey(extKey: string): HDKey {
  const decoded = base58check(sha256).decode(extKey)
  decoded[0] = (VERSION_XPUB >>> 24) & 0xff
  decoded[1] = (VERSION_XPUB >>> 16) & 0xff
  decoded[2] = (VERSION_XPUB >>> 8) & 0xff
  decoded[3] = VERSION_XPUB & 0xff
  const xpubStr = base58check(sha256).encode(decoded)
  return HDKey.fromExtendedKey(xpubStr)
}

// --- Address encoding ---

type AddressType = "p2pkh" | "p2sh-p2wpkh" | "p2wpkh" | "p2tr"

function hash160(data: Uint8Array): Uint8Array {
  const s = crypto.createHash("sha256").update(data).digest()
  return new Uint8Array(crypto.createHash("ripemd160").update(s).digest())
}

/**
 * BIP340 tagged hash: SHA256(SHA256(tag) || SHA256(tag) || msg)
 */
function taggedHash(tag: string, msg: Uint8Array): Uint8Array {
  const tagHash = sha256(new TextEncoder().encode(tag))
  const buf = new Uint8Array(tagHash.length * 2 + msg.length)
  buf.set(tagHash, 0)
  buf.set(tagHash, tagHash.length)
  buf.set(msg, tagHash.length * 2)
  return sha256(buf)
}

/**
 * BIP86 taproot key-path output: tweak the internal pubkey, produce x-only output key.
 * internalPubkey is a 33-byte compressed public key.
 */
function pubkeyToP2TR(compressedPubkey: Uint8Array): string {
  // x-only internal key (drop the 02/03 prefix byte)
  const xOnly = compressedPubkey.slice(1)

  // tweak = tagged_hash("TapTweak", x_only_internal_key)
  // For BIP86 key-path-only, there is no script tree, so the tweak is just the internal key.
  const tweak = taggedHash("TapTweak", xOnly)

  // Q = P + tweak*G
  let P = secp256k1.Point.fromHex(Buffer.from(compressedPubkey).toString("hex"))
  // BIP340: if P has odd Y, negate it first
  if (!P.hasEvenY()) P = P.negate()

  const tweakScalar = BigInt("0x" + Buffer.from(tweak).toString("hex"))
  const tweakPoint = secp256k1.Point.BASE.multiply(tweakScalar)
  let Q = P.add(tweakPoint)

  // If Q has odd Y, we'd negate (but for address encoding we just take the x-coordinate)
  if (!Q.hasEvenY()) Q = Q.negate()

  // x-only output key (32 bytes)
  const outputKey = hexToBytes(Q.x.toString(16).padStart(64, "0"))

  // bech32m encode: witness version 1 + 32-byte program
  const words = [1, ...bech32m.toWords(outputKey)]
  return bech32m.encode("bc", words)
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function pubkeyToP2PKH(pubkey: Uint8Array): string {
  const h = hash160(pubkey)
  const payload = new Uint8Array(21)
  payload[0] = 0x00
  payload.set(h, 1)
  return base58check(sha256).encode(payload)
}

function pubkeyToP2SH_P2WPKH(pubkey: Uint8Array): string {
  const keyhash = hash160(pubkey)
  const witnessScript = new Uint8Array(22)
  witnessScript[0] = 0x00
  witnessScript[1] = 0x14
  witnessScript.set(keyhash, 2)
  const scriptHash = hash160(witnessScript)
  const payload = new Uint8Array(21)
  payload[0] = 0x05
  payload.set(scriptHash, 1)
  return base58check(sha256).encode(payload)
}

function pubkeyToP2WPKH(pubkey: Uint8Array): string {
  const keyhash = hash160(pubkey)
  const words = [0, ...bech32.toWords(keyhash)]
  return bech32.encode("bc", words)
}

function pubkeyToAddress(pubkey: Uint8Array, type: AddressType): string {
  switch (type) {
    case "p2tr":
      return pubkeyToP2TR(pubkey)
    case "p2pkh":
      return pubkeyToP2PKH(pubkey)
    case "p2sh-p2wpkh":
      return pubkeyToP2SH_P2WPKH(pubkey)
    case "p2wpkh":
      return pubkeyToP2WPKH(pubkey)
  }
}

// --- Public types & functions ---

export interface DerivedAddress {
  address: string
  path: string
  change: boolean
  scheme: string // "BIP86", "BIP84", "BIP49", "BIP44"
}

const SCHEMES: { type: AddressType; label: string }[] = [
  { type: "p2tr", label: "BIP86" },
  { type: "p2wpkh", label: "BIP84" },
  { type: "p2sh-p2wpkh", label: "BIP49" },
  { type: "p2pkh", label: "BIP44" },
]

/**
 * Derive a batch of addresses from an extended public key for a single scheme.
 * Returns both receiving (m/0/i) and change (m/1/i) addresses.
 */
export function deriveAddressBatch(
  hdkey: HDKey,
  type: AddressType,
  schemeLabel: string,
  startIndex: number,
  count: number,
): DerivedAddress[] {
  const results: DerivedAddress[] = []
  for (const chain of [0, 1]) {
    for (let i = startIndex; i < startIndex + count; i++) {
      const child = hdkey.deriveChild(chain).deriveChild(i)
      if (!child.publicKey)
        throw new Error(`Failed to derive key at ${chain}/${i}`)
      results.push({
        address: pubkeyToAddress(child.publicKey, type),
        path: `m/${chain}/${i}`,
        change: chain === 1,
        scheme: schemeLabel,
      })
    }
  }
  return results
}

/** Parse any xpub/ypub/zpub into an HDKey. */
export { toHDKey }

/** The derivation schemes to try for every key (matches Python tracer behaviour). */
export { SCHEMES }
