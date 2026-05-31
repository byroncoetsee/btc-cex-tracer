import type { CexLink, InternalTransfer, IntermediateWallet, LinkStrength, ScanInput, SourceAddress, TraceResult } from "./types";

/**
 * Deterministic mock chain-analysis engine.
 *
 * NOTE: This simulates a breadth-first crawl over a Bitcoin node's transaction
 * graph. It produces stable, repeatable output seeded from the xpub label +
 * node address so the same input always yields the same trace. Wire a real
 * Bitcoin Core / Electrum RPC client into `runTrace` to replace the simulation.
 */

const EXCHANGES = ["BINANCE", "LUNO", "VALR", "KRAKEN", "COINBASE", "BITSTAMP", "OKX", "BYBIT"];

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

// --- seeded PRNG (mulberry32) ---
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeAddress(rng: () => number): string {
  // ~70% bech32 (bc1q...), 30% legacy
  if (rng() < 0.7) {
    let s = "bc1q";
    const len = 38;
    for (let i = 0; i < len; i++) s += BECH32[Math.floor(rng() * BECH32.length)];
    return s;
  }
  const prefix = rng() < 0.5 ? "1" : "3";
  let s = prefix;
  const len = 33;
  for (let i = 0; i < len; i++) s += BASE58[Math.floor(rng() * BASE58.length)];
  return s;
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function strengthFromScore(score: number): LinkStrength {
  if (score < 10) return "DEFINITIVE";
  if (score < 20) return "VERY STRONG";
  if (score < 30) return "STRONG";
  if (score < 42) return "MODERATE";
  if (score < 55) return "WEAK";
  if (score < 70) return "VERY WEAK";
  if (score < 85) return "TENUOUS";
  return "NEGLIGIBLE";
}

function directnessLabel(txCount: number, counterparties: number): string {
  const ratio = counterparties / Math.max(txCount, 1);
  if (txCount <= 3 && counterparties <= 3) return "Very Direct — likely forwarding wallet";
  if (ratio < 0.25) return "Direct — low fan-out relay";
  if (ratio < 0.6) return "Mixed — moderate dilution";
  if (counterparties > 40) return "Highly Diluted — heavy mixing activity";
  return "Diluted — multiple counterparties";
}

const DERIVATION_PATHS = [
  "m/84'/0'/0'/0", // native segwit
  "m/49'/0'/0'/0", // nested segwit
  "m/44'/0'/0'/0", // legacy
];

function buildLink(rng: () => number, exchange: string): CexLink {
  const hops = 1 + Math.floor(rng() * 4); // 1..4
  const isConfirmedCex = rng() < 0.7;

  // obscurity components 0-100
  const transaction = Math.floor(rng() * 100);
  const counterparty = Math.floor(rng() * 100);
  const hop = Math.min(100, hops * 10 + Math.floor(rng() * 12));
  const valueContinuity = Math.floor(rng() * 100);
  const fanOut = Math.floor(rng() * 80);
  const cexConfidence = isConfirmedCex ? 0 : 70;

  const baseScore =
    transaction * 0.20 +
    counterparty * 0.25 +
    hop * 0.15 +
    valueContinuity * 0.20 +
    fanOut * 0.15 +
    cexConfidence * 0.05;
  const compoundFactor = 1 + 0.08 * Math.max(0, hops - 1);
  const score = Math.min(100, Math.round(baseScore * compoundFactor));

  const path: IntermediateWallet[] = [];
  for (let i = 0; i < hops - 1; i++) {
    const txCount = 1 + Math.floor(rng() * 60);
    const counterparties = 1 + Math.floor(rng() * Math.min(txCount, 80));
    const isPossibleCex = txCount >= 30 && rng() < 0.4;
    const valuePassthrough = 0.1 + rng() * 0.9;
    const outputCount = 2 + Math.floor(rng() * 8);
    path.push({
      address: makeAddress(rng),
      txCount,
      uniqueCounterparties: counterparties,
      directness: directnessLabel(txCount, counterparties),
      isPossibleCex,
      valuePassthrough,
      outputCount,
    });
  }
  // final node = the CEX
  const cexTx = 5000 + Math.floor(rng() * 900000);
  path.push({
    address: makeAddress(rng),
    txCount: cexTx,
    uniqueCounterparties: 2000 + Math.floor(rng() * 50000),
    directness: isConfirmedCex ? `${exchange} hot wallet — confirmed CEX` : `${exchange} — possible CEX`,
    isPossibleCex: true,
  });

  return {
    id: `${exchange}-${Math.floor(rng() * 1e9).toString(16)}`,
    exchange,
    exchangeAddress: path[path.length - 1].address,
    hops,
    effectiveHops: Math.max(1, hops - (rng() < 0.3 ? Math.floor(rng() * 2) + 1 : 0)),
    direction: rng() < 0.8 ? "outflow" : "inflow",
    score,
    strength: strengthFromScore(score),
    breakdown: { transaction, counterparty, hop, valueContinuity, fanOut, cexConfidence },
    path,
  };
}

export function runTrace(input: ScanInput): TraceResult {
  const seed = hashSeed(`${input.label}::${input.nodeAddress}::${input.depth}`);
  const rng = mulberry32(seed);

  const sourceCount = 4 + Math.floor(rng() * 9); // 4..12 used addresses
  const sources: SourceAddress[] = [];
  let addressesScanned = 0;

  for (let i = 0; i < sourceCount; i++) {
    const balanceBtc = rng() < 0.55 ? +(rng() * 2.4).toFixed(6) : 0;
    const txCount = 1 + Math.floor(rng() * 40);

    const links: CexLink[] = [];
    const linkCount = rng() < 0.6 ? 1 + Math.floor(rng() * 3) : 0;
    const usedExchanges = new Set<string>();
    for (let l = 0; l < linkCount; l++) {
      let ex = pick(rng, EXCHANGES);
      let guard = 0;
      while (usedExchanges.has(ex) && guard < 8) {
        ex = pick(rng, EXCHANGES);
        guard++;
      }
      usedExchanges.add(ex);
      const link = buildLink(rng, ex);
      links.push(link);
      addressesScanned += link.path.length;
    }
    links.sort((a, b) => a.score - b.score);

    sources.push({
      address: makeAddress(rng),
      derivationPath: `${pick(rng, DERIVATION_PATHS)}/${i}`,
      balanceBtc,
      txCount,
      links,
    });
    addressesScanned += 1;
  }

  // strongest (lowest score) links first by source
  sources.sort((a, b) => {
    const sa = a.links.length ? a.links[0].score : 999;
    const sb = b.links.length ? b.links[0].score : 999;
    return sa - sb;
  });

  // Mock CIOH clusters — randomly link some source addresses
  const ownershipClusters: string[][] = [];
  const unclustered = sources.filter((s) => s.txCount > 1).map((s) => s.address);
  while (unclustered.length >= 2 && rng() < 0.4) {
    const size = 2 + Math.floor(rng() * Math.min(3, unclustered.length - 1));
    const cluster: string[] = [];
    for (let i = 0; i < size && unclustered.length > 0; i++) {
      const idx = Math.floor(rng() * unclustered.length);
      cluster.push(unclustered.splice(idx, 1)[0]);
    }
    if (cluster.length >= 2) ownershipClusters.push(cluster);
  }

  // Mock internal transfers between source addresses (some multi-hop)
  const internalTransfers: InternalTransfer[] = [];
  const addrs = sources.map((s) => s.address);
  for (let i = 0; i < addrs.length - 1 && rng() < 0.5; i++) {
    const from = addrs[i];
    const toIdx = i + 1 + Math.floor(rng() * Math.min(2, addrs.length - i - 1));
    const to = addrs[toIdx];
    if (from === to) continue;
    const hopCount = 1 + Math.floor(rng() * 3);
    const intermediates: string[] = [];
    for (let h = 0; h < hopCount - 1; h++) intermediates.push(makeAddress(rng));
    internalTransfers.push({
      from,
      to,
      hops: hopCount,
      valueBtc: +(rng() * 1.5).toFixed(6),
      intermediates,
    });
  }

  return {
    id: `${seed.toString(16)}-${Date.now().toString(36)}`,
    label: input.label,
    nodeAddress: input.nodeAddress,
    depth: input.depth,
    scannedAt: Date.now(),
    durationMs: 800 + Math.floor(rng() * 3500),
    addressesScanned,
    sources,
    ownershipClusters,
    internalTransfers,
  };
}

export function strengthColor(strength: LinkStrength): string {
  switch (strength) {
    case "DEFINITIVE":
      return "text-destructive";
    case "VERY STRONG":
      return "text-destructive";
    case "STRONG":
      return "text-destructive";
    case "MODERATE":
      return "text-accent";
    case "WEAK":
      return "text-accent";
    case "VERY WEAK":
      return "text-primary";
    case "TENUOUS":
      return "text-muted-foreground";
    case "NEGLIGIBLE":
      return "text-muted-foreground";
  }
}

export function truncateAddr(addr: string, head = 8, tail = 6): string {
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
