/**
 * Deterministic visual identity for Bitcoin addresses.
 *
 * Hashes an address string to produce a stable color, two-word nickname,
 * and a simple geometric identicon — so the same address always looks the
 * same across the entire UI.
 */

// --- seeded PRNG (mulberry32) ---
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- Nickname wordlists (128 each → 16 384 combos) ---

const ADJECTIVES = [
  "amber", "arctic", "ashen", "azure", "blaze", "bold", "brisk", "calm",
  "cedar", "chalk", "cliff", "cloud", "coal", "cold", "coral", "crisp",
  "dark", "dawn", "deep", "drift", "dusk", "dusty", "ember", "faded",
  "faint", "flint", "foggy", "forge", "frost", "ghost", "glass", "gleam",
  "gold", "grave", "gray", "green", "grim", "haze", "heavy", "hollow",
  "hushed", "iron", "ivory", "jade", "keen", "lake", "lean", "light",
  "lime", "lunar", "maple", "marsh", "mild", "mint", "misty", "moss",
  "muted", "night", "noble", "north", "oak", "opal", "pale", "pearl",
  "pine", "plain", "plum", "polar", "prime", "quiet", "rapid", "raw",
  "reed", "ridge", "rocky", "rose", "rough", "rust", "sage", "salt",
  "sand", "sharp", "shell", "silk", "slate", "slim", "smoke", "snow",
  "solar", "soot", "south", "spark", "steel", "still", "stone", "storm",
  "swift", "tan", "tarn", "tawny", "teal", "terra", "thick", "thorn",
  "tide", "torch", "trace", "twin", "vapor", "vast", "vivid", "warm",
  "wax", "west", "wheat", "wild", "wind", "wine", "wired", "worn",
  "young", "zinc", "agate", "birch", "brass", "burnt", "chrome", "clay",
]

const NOUNS = [
  "anvil", "arch", "badge", "basin", "bay", "beam", "bell", "blade",
  "bluff", "bolt", "bone", "booth", "bow", "brick", "bridge", "brook",
  "cairn", "cape", "cave", "chain", "cliff", "coast", "coin", "cone",
  "core", "cove", "crane", "crest", "cross", "crown", "curve", "dale",
  "delta", "dome", "drift", "drum", "dune", "eagle", "elm", "ember",
  "fang", "fern", "field", "fin", "flame", "flare", "flask", "flint",
  "forge", "fork", "fox", "frost", "gate", "gem", "glen", "grove",
  "guild", "gust", "haven", "hawk", "heath", "helm", "heron", "hive",
  "horn", "hull", "isle", "ivy", "jay", "keep", "knot", "lance",
  "lark", "leaf", "ledge", "lens", "loch", "lodge", "loft", "lynx",
  "marsh", "mast", "mesa", "mill", "mink", "moat", "mole", "moor",
  "nest", "node", "notch", "oak", "ore", "owl", "palm", "pass",
  "peak", "pier", "pike", "pine", "pond", "quay", "rail", "ram",
  "raven", "reef", "ridge", "ring", "rock", "rook", "sage", "seal",
  "shard", "shoal", "shore", "skull", "slab", "spark", "spire", "spur",
  "stake", "stag", "stone", "tower", "vale", "vault", "vine", "wolf",
]

// --- Color generation ---

/**
 * Generate an HSL color with good contrast on dark backgrounds.
 * Spreads hues across the full wheel, keeps saturation/lightness
 * in a range that's vibrant but not eye-searing.
 */
function generateColor(rng: () => number): { hsl: string; hex: string } {
  const hue = Math.floor(rng() * 360)
  const sat = 55 + Math.floor(rng() * 25) // 55-80%
  const lit = 55 + Math.floor(rng() * 15) // 55-70%
  const hsl = `hsl(${hue}, ${sat}%, ${lit}%)`

  // Convert to hex for SVG contexts
  const c = (n: number) => {
    const k = (n + hue / 30) % 12
    const color = lit / 100 - (sat / 100) * Math.min(lit / 100, 1 - lit / 100) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * color).toString(16).padStart(2, "0")
  }
  const hex = `#${c(0)}${c(8)}${c(4)}`

  return { hsl, hex }
}

// --- Identicon (4×4 mirrored grid → 8 visible columns) ---

function generateIdenticon(rng: () => number): boolean[][] {
  // 4x4 half → mirror to 4x8, but we'll use 4x4 mirrored = 4 rows × 4 cols, mirror horizontally
  const size = 4
  const half: boolean[][] = []
  for (let y = 0; y < size; y++) {
    const row: boolean[] = []
    for (let x = 0; x < Math.ceil(size / 2); x++) {
      row.push(rng() > 0.45) // slightly biased toward filled
    }
    // Mirror
    const full = [...row, ...row.slice().reverse()]
    half.push(full)
  }
  return half
}

// --- Public API ---

export interface AddressIdentity {
  /** Deterministic HSL color string */
  color: string
  /** Deterministic hex color string (for SVG) */
  colorHex: string
  /** Two-word human-readable nickname, e.g. "Coral Falcon" */
  nickname: string
  /** 4×4 boolean grid for identicon rendering */
  identicon: boolean[][]
}

const cache = new Map<string, AddressIdentity>()

export function getAddressIdentity(address: string): AddressIdentity {
  const cached = cache.get(address)
  if (cached) return cached

  const seed = hashSeed(address)
  const rng = mulberry32(seed)

  const adjIdx = Math.floor(rng() * ADJECTIVES.length)
  const nounIdx = Math.floor(rng() * NOUNS.length)
  const nickname = `${ADJECTIVES[adjIdx]} ${NOUNS[nounIdx]}`

  const { hsl, hex } = generateColor(rng)
  const identicon = generateIdenticon(rng)

  const identity: AddressIdentity = {
    color: hsl,
    colorHex: hex,
    nickname,
    identicon,
  }

  cache.set(address, identity)
  return identity
}
