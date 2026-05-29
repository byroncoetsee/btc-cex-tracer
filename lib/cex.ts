import * as fs from "fs"
import * as path from "path"
import * as readline from "readline"

/**
 * CEX address database — lazy-loaded singleton.
 * Reads all *_addresses.csv files from public/cex_addresses/ on first access.
 */

let cexMap: Map<string, string> | null = null
let loading: Promise<Map<string, string>> | null = null

const POSSIBLE_CEX_THRESHOLD = 500 // history entries

async function loadFile(
  filePath: string,
  exchange: string,
  map: Map<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let count = 0
    const stream = fs.createReadStream(filePath, { encoding: "utf8" })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

    rl.on("line", (line) => {
      // skip headers, comments, empty lines
      const trimmed = line.trim()
      if (
        !trimmed ||
        trimmed.startsWith("#") ||
        trimmed.startsWith('"#') ||
        trimmed === "address" ||
        trimmed.startsWith("address,")
      )
        return

      // address is always the first column
      const addr = trimmed.split(",")[0].replace(/"/g, "").trim()
      if (addr && addr.length >= 26) {
        map.set(addr, exchange)
        count++
      }
    })

    rl.on("close", () => resolve(count))
    rl.on("error", reject)
    stream.on("error", reject)
  })
}

export async function loadCexDatabase(): Promise<Map<string, string>> {
  if (cexMap) return cexMap
  if (loading) return loading

  loading = (async () => {
    const map = new Map<string, string>()
    const cexDir = path.join(process.cwd(), "public", "cex_addresses")

    if (!fs.existsSync(cexDir)) {
      console.warn("CEX address directory not found:", cexDir)
      cexMap = map
      return map
    }

    const files = fs
      .readdirSync(cexDir)
      .filter((f) => f.endsWith("_addresses.csv"))

    for (const file of files) {
      // extract exchange name: "binance_addresses.csv" → "Binance"
      // "walletexplorer-0000001bce8b8aa0-addresses.csv" → "Binance (WE)"
      let exchange: string
      if (file.startsWith("walletexplorer")) {
        exchange = "Binance (WE)"
      } else {
        exchange = file
          .replace("_addresses.csv", "")
          .replace(/(^|\s)\S/g, (m) => m.toUpperCase())
      }

      const count = await loadFile(path.join(cexDir, file), exchange, map)
      console.log(`[cex] loaded ${count.toLocaleString()} addresses from ${file} (${exchange})`)
    }

    console.log(`[cex] total: ${map.size.toLocaleString()} unique addresses`)
    cexMap = map
    return map
  })()

  return loading
}

/** Check if an address is a known CEX. Returns exchange name or null. */
export function checkCex(
  addr: string,
  db: Map<string, string>,
): string | null {
  return db.get(addr) ?? null
}

/** Heuristic: flag high-activity addresses as possible CEX. */
export function isPossibleCex(historyLength: number): boolean {
  return historyLength >= POSSIBLE_CEX_THRESHOLD
}
