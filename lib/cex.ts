import * as fs from "fs"
import * as path from "path"
import {
  type BloomFilter,
  bloomCheck,
  deserializeBloom,
  type SerializedBloomFilter,
} from "./bloom"

const POSSIBLE_CEX_THRESHOLD = 500

interface CexBloomData {
  version: number
  totalAddresses: number
  exchanges: Record<string, { count: number; filter: SerializedBloomFilter }>
}

export interface CexDatabase {
  exchanges: Map<string, BloomFilter>
  totalAddresses: number
}

let cexDb: CexDatabase | null = null
let loading: Promise<CexDatabase> | null = null

export async function loadCexDatabase(): Promise<CexDatabase> {
  if (cexDb) return cexDb
  if (loading) return loading

  loading = (async () => {
    const bloomPath = path.join(process.cwd(), "data", "cex-bloom.json")

    if (!fs.existsSync(bloomPath)) {
      console.warn("[cex] bloom filter not found:", bloomPath)
      console.warn("[cex] run `pnpm build:cex` to generate from CSV files")
      cexDb = { exchanges: new Map(), totalAddresses: 0 }
      return cexDb
    }

    const raw = JSON.parse(
      fs.readFileSync(bloomPath, "utf8"),
    ) as CexBloomData
    const exchanges = new Map<string, BloomFilter>()

    for (const [name, data] of Object.entries(raw.exchanges)) {
      exchanges.set(name, deserializeBloom(data.filter))
      console.log(
        `[cex] loaded ${name} (${data.count.toLocaleString()} addresses)`,
      )
    }

    console.log(
      `[cex] total: ${raw.totalAddresses.toLocaleString()} addresses across ${exchanges.size} exchanges`,
    )

    cexDb = { exchanges, totalAddresses: raw.totalAddresses }
    return cexDb
  })()

  return loading
}

export function checkCex(addr: string, db: CexDatabase): string | null {
  for (const [exchange, filter] of db.exchanges) {
    if (bloomCheck(filter, addr)) return exchange
  }
  return null
}

export function isPossibleCex(historyLength: number): boolean {
  return historyLength >= POSSIBLE_CEX_THRESHOLD
}
