import { createHash } from "crypto"

export interface BloomFilter {
  bits: Uint8Array
  numBits: number
  numHashes: number
}

export interface SerializedBloomFilter {
  numBits: number
  numHashes: number
  bits: string
}

function hashPair(item: string): [number, number] {
  const hash = createHash("sha256").update(item).digest()
  return [hash.readUInt32LE(0), hash.readUInt32LE(4)]
}

export function createBloomFilter(
  expectedItems: number,
  fpRate = 0.01,
): BloomFilter {
  const numBits = Math.ceil(
    (-expectedItems * Math.log(fpRate)) / (Math.LN2 * Math.LN2),
  )
  const numHashes = Math.max(1, Math.round((numBits / expectedItems) * Math.LN2))
  return { bits: new Uint8Array(Math.ceil(numBits / 8)), numBits, numHashes }
}

export function bloomInsert(filter: BloomFilter, item: string): void {
  const [h1, h2] = hashPair(item)
  for (let i = 0; i < filter.numHashes; i++) {
    const pos = ((h1 + i * h2) >>> 0) % filter.numBits
    filter.bits[pos >> 3] |= 1 << (pos & 7)
  }
}

export function bloomCheck(filter: BloomFilter, item: string): boolean {
  const [h1, h2] = hashPair(item)
  for (let i = 0; i < filter.numHashes; i++) {
    const pos = ((h1 + i * h2) >>> 0) % filter.numBits
    if (!(filter.bits[pos >> 3] & (1 << (pos & 7)))) return false
  }
  return true
}

export function serializeBloom(filter: BloomFilter): SerializedBloomFilter {
  return {
    numBits: filter.numBits,
    numHashes: filter.numHashes,
    bits: Buffer.from(filter.bits).toString("base64"),
  }
}

export function deserializeBloom(data: SerializedBloomFilter): BloomFilter {
  return {
    numBits: data.numBits,
    numHashes: data.numHashes,
    bits: new Uint8Array(Buffer.from(data.bits, "base64")),
  }
}
