#!/usr/bin/env node
import { createReadStream, readdirSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { createInterface } from "readline"
import { createHash } from "crypto"

// Bloom filter helpers (standalone copies — no TS imports in .mjs)

function createBloomFilter(expectedItems, fpRate = 0.01) {
  const numBits = Math.ceil(
    (-expectedItems * Math.log(fpRate)) / (Math.LN2 * Math.LN2),
  )
  const numHashes = Math.max(
    1,
    Math.round((numBits / expectedItems) * Math.LN2),
  )
  return { bits: new Uint8Array(Math.ceil(numBits / 8)), numBits, numHashes }
}

function hashPair(item) {
  const hash = createHash("sha256").update(item).digest()
  return [hash.readUInt32LE(0), hash.readUInt32LE(4)]
}

function bloomInsert(filter, item) {
  const [h1, h2] = hashPair(item)
  for (let i = 0; i < filter.numHashes; i++) {
    const pos = ((h1 + i * h2) >>> 0) % filter.numBits
    filter.bits[pos >> 3] |= 1 << (pos & 7)
  }
}

function serializeBloom(filter) {
  return {
    numBits: filter.numBits,
    numHashes: filter.numHashes,
    bits: Buffer.from(filter.bits).toString("base64"),
  }
}

function isSkipLine(trimmed) {
  return (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith('"#') ||
    trimmed === "address" ||
    trimmed.startsWith("address,")
  )
}

function parseAddress(line) {
  const trimmed = line.trim()
  if (isSkipLine(trimmed)) return null
  const addr = trimmed.split(",")[0].replace(/"/g, "").trim()
  return addr && addr.length >= 26 ? addr : null
}

function exchangeName(file) {
  if (file.startsWith("walletexplorer")) return "Binance (WE)"
  return file
    .replace(/[-_]addresses\.csv$/, "")
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase())
}

// ---

const CEX_DIR = join(process.cwd(), "data", "cex_addresses")
const OUTPUT = join(process.cwd(), "data", "cex-bloom.json")

if (!existsSync(CEX_DIR)) {
  console.error(`CEX directory not found: ${CEX_DIR}`)
  process.exit(1)
}

const files = readdirSync(CEX_DIR).filter(
  (f) =>
    f.endsWith(".csv") &&
    f !== "example_addresses.csv" &&
    (f.includes("addresses") || f.includes("address")),
)

if (!files.length) {
  console.error("No *_addresses.csv files found in", CEX_DIR)
  process.exit(1)
}

async function countFile(filePath) {
  let count = 0
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    if (parseAddress(line)) count++
  }
  return count
}

async function buildFilter(filePath, expectedCount) {
  const filter = createBloomFilter(expectedCount, 0.01)
  let inserted = 0
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    const addr = parseAddress(line)
    if (addr) {
      bloomInsert(filter, addr)
      inserted++
    }
  }
  return { filter, inserted }
}

console.log("Pass 1: counting addresses…")
const counts = new Map()
for (const file of files) {
  const count = await countFile(join(CEX_DIR, file))
  counts.set(file, count)
  console.log(`  ${file}: ${count.toLocaleString()}`)
}

console.log("\nPass 2: building bloom filters…")
const exchanges = {}
let totalAddresses = 0

for (const file of files) {
  const count = counts.get(file)
  if (count === 0) {
    console.log(`  Skipping ${file} (0 addresses)`)
    continue
  }

  const exchange = exchangeName(file)
  const { filter, inserted } = await buildFilter(join(CEX_DIR, file), count)

  exchanges[exchange] = { count: inserted, filter: serializeBloom(filter) }
  totalAddresses += inserted

  const sizeKb = Math.ceil(filter.bits.length / 1024)
  console.log(
    `  ${exchange}: ${inserted.toLocaleString()} → ${sizeKb.toLocaleString()} KB (k=${filter.numHashes})`,
  )
}

const output = { version: 1, totalAddresses, exchanges }
const json = JSON.stringify(output)
writeFileSync(OUTPUT, json)

const sizeMb = (Buffer.byteLength(json) / (1024 * 1024)).toFixed(1)
console.log(
  `\nDone → ${OUTPUT}\n${totalAddresses.toLocaleString()} addresses across ${Object.keys(exchanges).length} exchanges (${sizeMb} MB)`,
)
