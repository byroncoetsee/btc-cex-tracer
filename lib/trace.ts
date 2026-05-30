import { ElectrumPool } from "./electrum";
import { addressToScripthash } from "./address";
import { checkCex, isPossibleCex } from "./cex";
import type { CexDirection, CexLink, IntermediateWallet, LinkStrength, ObscurityBreakdown, SourceAddress, TraceResult } from "./types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_TX_DEPTH_0 = 20;
const MAX_TX_DEPTH_1 = 10;
const MAX_TX_DEPTH_2_PLUS = 5;
const FOLLOW_THRESHOLD = 100;
const MAX_CANDIDATES_PER_LEVEL = 20; // cap explosion
const SESSION_TIMEOUT = 15000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerboseTx {
  txid: string;
  vin: { txid: string; vout: number }[];
  vout: {
    n: number;
    value: number;
    scriptPubKey: { address?: string; type?: string };
  }[];
}

interface AddressInfo {
  historyLength: number;
  parentAddr: string | null;
}

export type ProgressFn = (msg: string) => void;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const TX_OBSC_W = 0.4;
const CP_OBSC_W = 0.5;
const HOP_OBSC_W = 0.1;

function calcTxObscurity(intermediates: AddressInfo[]): number {
  if (intermediates.length === 0) return 0;
  const minReq = intermediates.length * 2 + 2;
  let totalTx = 2;
  for (const a of intermediates) totalTx += Math.max(a.historyLength, 2);
  return Math.min(1, Math.max(0, 1 - minReq / totalTx));
}

function calcHopObscurity(hops: number): number {
  if (hops <= 1) return 0;
  if (hops >= 5) return 1;
  return (hops - 1) / 4;
}

function calcCpObscurity(intermediates: AddressInfo[]): number {
  if (intermediates.length === 0) return 0;
  const avg = intermediates.reduce((s, a) => s + a.historyLength, 0) / intermediates.length;
  if (avg <= 1) return 0;
  if (avg >= 10) return 1;
  return (avg - 1) / 9;
}

function strengthFromScore(score: number): LinkStrength {
  if (score < 15) return "VERY STRONG";
  if (score < 30) return "STRONG";
  if (score < 50) return "MODERATE";
  if (score < 70) return "WEAK";
  return "VERY WEAK";
}

function directnessLabel(histLen: number): string {
  if (histLen <= 2) return "Very Direct — likely forwarding wallet";
  if (histLen <= 5) return "Direct — minimal mixing";
  if (histLen <= 20) return "Moderate — some mixing activity";
  if (histLen <= 50) return "Diluted — significant mixing";
  return "Highly Diluted — heavy mixing/exchange activity";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cache scripthash conversions — avoids re-hashing the same address. */
const scripthashCache = new Map<string, string>();
function cachedScripthash(addr: string): string {
  let sh = scripthashCache.get(addr);
  if (!sh) {
    sh = addressToScripthash(addr);
    scripthashCache.set(addr, sh);
  }
  return sh;
}

function extractOutputAddresses(tx: VerboseTx): string[] {
  const addrs: string[] = [];
  for (const vout of tx.vout) {
    const a = vout.scriptPubKey?.address;
    if (a) addrs.push(a);
  }
  return addrs;
}

function reconstructPath(parentMap: Map<string, string | null>, source: string, target: string): string[] {
  const path: string[] = [];
  let current: string | null | undefined = target;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    path.push(current);
    if (current === source) break;
    current = parentMap.get(current);
  }
  path.reverse();
  return path;
}

function buildCexLink(
  pathAddrs: string[],
  addrInfo: Map<string, AddressInfo>,
  exchange: string,
  flag: "CEX" | "possible CEX",
  direction: CexDirection,
): CexLink {
  const hops = pathAddrs.length - 1;
  const intermediateInfos = pathAddrs.slice(1, -1).map((a) => addrInfo.get(a) ?? { historyLength: 0, parentAddr: null });

  const txObs = calcTxObscurity(intermediateInfos) * 100;
  const cpObs = calcCpObscurity(intermediateInfos) * 100;
  const hopObs = calcHopObscurity(hops) * 100;
  const score = Math.round(txObs * TX_OBSC_W + cpObs * CP_OBSC_W + hopObs * HOP_OBSC_W);

  const pathWallets: IntermediateWallet[] = pathAddrs.slice(1).map((addr) => {
    const histLen = addrInfo.get(addr)?.historyLength ?? 0;
    return {
      address: addr,
      txCount: histLen,
      uniqueCounterparties: histLen,
      directness: flag === "CEX" && addr === pathAddrs[pathAddrs.length - 1] ? `${exchange} — confirmed CEX` : directnessLabel(histLen),
      isPossibleCex: isPossibleCex(histLen),
    };
  });

  return {
    id: `${exchange.toLowerCase().replace(/\s/g, "-")}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    exchange,
    exchangeAddress: pathAddrs[pathAddrs.length - 1],
    hops,
    direction,
    score,
    strength: strengthFromScore(score),
    breakdown: {
      transaction: Math.round(txObs),
      counterparty: Math.round(cpObs),
      hop: Math.round(hopObs),
    },
    path: pathWallets,
  };
}

function recordCex(
  addr: string,
  parent: string,
  exchange: string,
  flag: "CEX" | "possible CEX",
  sourceAddr: string,
  parentMap: Map<string, string | null>,
  addrInfo: Map<string, AddressInfo>,
  links: CexLink[],
  visited: Set<string>,
  histLen = 0,
  direction: CexDirection = "outflow",
) {
  parentMap.set(addr, parent);
  addrInfo.set(addr, { historyLength: histLen, parentAddr: parent });
  visited.add(addr);
  const path = reconstructPath(parentMap, sourceAddr, addr);
  links.push(buildCexLink(path, addrInfo, exchange, flag, direction));
}

// ---------------------------------------------------------------------------
// Core BFS — processes each depth level as a batch
// ---------------------------------------------------------------------------

async function traceSource(
  sourceAddr: string,
  session: ElectrumPool,
  cexDb: Map<string, string>,
  maxDepth: number,
  onProgress: ProgressFn,
  sharedTxCache: Map<string, VerboseTx>,
): Promise<{ links: CexLink[]; scanned: number }> {
  const links: CexLink[] = [];
  const parentMap = new Map<string, string | null>();
  const addrInfo = new Map<string, AddressInfo>();
  const visited = new Set<string>();
  const txCache = sharedTxCache;

  visited.add(sourceAddr);
  parentMap.set(sourceAddr, null);

  // current level of BFS
  let currentLevel = [sourceAddr];

  for (let depth = 0; depth <= maxDepth && currentLevel.length > 0; depth++) {
    onProgress(`  depth ${depth}: processing ${currentLevel.length} address${currentLevel.length > 1 ? "es" : ""}`);

    // --- Step 1: batch get_history for entire level ---
    const histResults = await session.batch(
      currentLevel.map((a) => ({
        method: "blockchain.scripthash.get_history",
        params: [cachedScripthash(a)],
      })),
    );

    // filter: skip possible-CEX addresses (depth > 0), record them
    const toProcess: { addr: string; txHashes: string[] }[] = [];
    for (let i = 0; i < currentLevel.length; i++) {
      const addr = currentLevel[i];
      const res = histResults[i];

      // Fulcrum returns error when history exceeds max_history (125k)
      if (res.error) {
        const errMsg = res.error.message ?? "";
        if (depth > 0) {
          onProgress(`    possible CEX (history too large): ${addr.slice(0, 12)}…`);
          recordCex(
            addr,
            parentMap.get(addr)!,
            "Unknown (huge history)",
            "possible CEX",
            sourceAddr,
            parentMap,
            addrInfo,
            links,
            visited,
            999999,
          );
        } else {
          onProgress(`    warning: history error for ${addr.slice(0, 12)}…: ${errMsg.slice(0, 60)}`);
        }
        continue;
      }

      const history = (res.result ?? []) as { tx_hash: string }[];
      addrInfo.set(addr, { historyLength: history.length, parentAddr: parentMap.get(addr) ?? null });

      if (depth > 0 && isPossibleCex(history.length)) {
        onProgress(`    possible CEX (${history.length} txs): ${addr.slice(0, 12)}…`);
        recordCex(
          addr,
          parentMap.get(addr)!,
          "Unknown (high activity)",
          "possible CEX",
          sourceAddr,
          parentMap,
          addrInfo,
          links,
          visited,
          history.length,
        );
        continue;
      }

      const txCap = depth === 0 ? MAX_TX_DEPTH_0 : depth === 1 ? MAX_TX_DEPTH_1 : MAX_TX_DEPTH_2_PLUS;
      toProcess.push({ addr, txHashes: history.slice(-txCap).map((h) => h.tx_hash) });
    }

    if (toProcess.length === 0) break;

    // --- Step 2: batch fetch ALL verbose txs for the entire level ---
    const allTxHashes = new Set<string>();
    for (const { txHashes } of toProcess) {
      for (const h of txHashes) {
        if (!txCache.has(h)) allTxHashes.add(h);
      }
    }

    if (allTxHashes.size > 0) {
      const hashes = [...allTxHashes];
      onProgress(`  depth ${depth}: fetching ${hashes.length} transactions`);
      const txResults = await session.batch(
        hashes.map((txid) => ({
          method: "blockchain.transaction.get",
          params: [txid, true],
        })),
      );
      for (let i = 0; i < hashes.length; i++) {
        if (txResults[i].result) txCache.set(hashes[i], txResults[i].result as VerboseTx);
      }
    }

    // --- Step 3: extract output addresses, check CEX, collect candidates ---
    // Only follow outputs for txs where addr is a SENDER (not a recipient).
    // If addr appears in the tx outputs, it received funds — the other outputs
    // are co-recipients from the same sender, not addresses we sent to.
    const allCandidates = new Map<string, string>(); // candidate addr → parent addr

    for (const { addr, txHashes } of toProcess) {
      const txs = txHashes.map((h) => txCache.get(h)).filter(Boolean) as VerboseTx[];

      for (const tx of txs) {
        const outputAddrs = extractOutputAddresses(tx);
        const addrIsRecipient = outputAddrs.includes(addr);

        if (addrIsRecipient) {
          // addr received funds in this tx — other outputs are irrelevant
          // (they're co-outputs from the same sender, e.g. change addresses)
          continue;
        }

        // addr is a sender — follow outputs (forward trace)
        for (const outAddr of outputAddrs) {
          if (outAddr === addr || visited.has(outAddr)) continue;

          const exch = checkCex(outAddr, cexDb);
          if (exch) {
            recordCex(outAddr, addr, exch, "CEX", sourceAddr, parentMap, addrInfo, links, visited, 0, "outflow");
            onProgress(
              `    CEX FOUND (outflow): ${exch} — ${outAddr.slice(0, 12)}… (${reconstructPath(parentMap, sourceAddr, outAddr).length - 1} hops)`,
            );
          } else if (!allCandidates.has(outAddr)) {
            allCandidates.set(outAddr, addr); // track parent
          }
        }
      }
    }

    // --- Step 4: depth 0 only — resolve inputs of INBOUND txs for CEX detection ---
    // Only check inputs for txs where our address is a recipient (inflow detection).
    // "Who sent funds to me? Was it a CEX?"
    if (depth === 0) {
      const inboundTxs: { addr: string; tx: VerboseTx }[] = [];
      for (const { addr, txHashes } of toProcess) {
        const txs = txHashes.map((h) => txCache.get(h)).filter(Boolean) as VerboseTx[];
        for (const tx of txs) {
          if (extractOutputAddresses(tx).includes(addr)) {
            inboundTxs.push({ addr, tx });
          }
        }
      }

      // batch fetch prev txs needed to resolve input addresses
      const inputTxids = new Set<string>();
      for (const { tx } of inboundTxs) {
        for (const vin of tx.vin) {
          if (vin.txid && !txCache.has(vin.txid)) inputTxids.add(vin.txid);
        }
      }

      const inputFetch = [...inputTxids].slice(0, 100);
      if (inputFetch.length > 0) {
        onProgress(`  depth 0: resolving ${inputFetch.length} input txs for inflow detection`);
        const prevResults = await session.batch(
          inputFetch.map((txid) => ({
            method: "blockchain.transaction.get",
            params: [txid, true],
          })),
        );
        for (let i = 0; i < inputFetch.length; i++) {
          if (prevResults[i].result) txCache.set(inputFetch[i], prevResults[i].result as VerboseTx);
        }
      }

      for (const { addr, tx } of inboundTxs) {
        for (const vin of tx.vin) {
          if (!vin.txid) continue;
          const prevTx = txCache.get(vin.txid);
          const inAddr = prevTx?.vout[vin.vout]?.scriptPubKey?.address;
          if (!inAddr || inAddr === addr || visited.has(inAddr)) continue;
          const exch = checkCex(inAddr, cexDb);
          if (exch) {
            recordCex(inAddr, addr, exch, "CEX", sourceAddr, parentMap, addrInfo, links, visited, 0, "inflow");
            onProgress(`    CEX FOUND (inflow): ${exch} — ${inAddr.slice(0, 12)}… sent to you`);
          }
        }
      }
    }

    // --- Step 5: batch history check for candidates to decide follow ---
    const nextLevel: string[] = [];

    if (depth < maxDepth && allCandidates.size > 0) {
      const candidates = [...allCandidates.entries()]; // [addr, parent]
      const candHistResults = await session.batch(
        candidates.map(([a]) => ({
          method: "blockchain.scripthash.get_history",
          params: [cachedScripthash(a)],
        })),
      );

      for (let i = 0; i < candidates.length; i++) {
        const [cAddr, cParent] = candidates[i];
        const hLen = ((candHistResults[i].result ?? []) as unknown[]).length;

        addrInfo.set(cAddr, { historyLength: hLen, parentAddr: cParent });

        if (isPossibleCex(hLen)) {
          parentMap.set(cAddr, cParent);
          recordCex(cAddr, cParent, "Unknown (high activity)", "possible CEX", sourceAddr, parentMap, addrInfo, links, visited, hLen);
          onProgress(`    possible CEX (${hLen} txs): ${cAddr.slice(0, 12)}…`);
        } else if (hLen > 0 && hLen < FOLLOW_THRESHOLD && nextLevel.length < MAX_CANDIDATES_PER_LEVEL) {
          parentMap.set(cAddr, cParent);
          visited.add(cAddr);
          nextLevel.push(cAddr);
        }
      }

      const skipped = allCandidates.size - nextLevel.length;
      onProgress(
        `  depth ${depth}: ${allCandidates.size} candidates → ${nextLevel.length} queued${skipped > 0 ? ` (${skipped} skipped)` : ""} for depth ${depth + 1}`,
      );
    }

    currentLevel = nextLevel;
  }

  links.sort((a, b) => a.score - b.score);
  return { links, scanned: visited.size };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TraceSourceInput {
  address: string;
  derivationPath: string;
  balanceBtc: number;
  txCount: number;
}

export async function runRealTrace(
  sources: TraceSourceInput[],
  host: string,
  port: number,
  depth: number,
  cexDb: Map<string, string>,
  onProgress: ProgressFn,
  useTls = false,
): Promise<TraceResult> {
  const startTime = Date.now();
  let totalScanned = 0;

  onProgress(`$ trace ${sources.length} source${sources.length > 1 ? "s" : ""} · depth ${depth}`);

  // single session for all sources — avoids Fulcrum connection limits
  const session = new ElectrumPool(host, port, SESSION_TIMEOUT, useTls);
  await session.connect();

  // shared tx cache across all sources
  const sharedTxCache = new Map<string, VerboseTx>();

  const sourceResults: PromiseSettledResult<{ src: TraceSourceInput; links: CexLink[]; scanned: number }>[] = [];

  for (let idx = 0; idx < sources.length; idx++) {
    const src = sources[idx];
    try {
      onProgress(`> [${idx + 1}/${sources.length}] tracing ${src.address.slice(0, 16)}…`);
      const result = await traceSource(src.address, session, cexDb, depth, onProgress, sharedTxCache);
      sourceResults.push({ status: "fulfilled", value: { src, ...result } });
    } catch (reason) {
      sourceResults.push({ status: "rejected", reason });
    }
  }

  session.close();

  const resultSources: SourceAddress[] = [];
  for (let i = 0; i < sources.length; i++) {
    const res = sourceResults[i];
    const src = sources[i];
    if (res.status === "fulfilled") {
      totalScanned += res.value.scanned;
      resultSources.push({
        address: src.address,
        derivationPath: src.derivationPath,
        balanceBtc: src.balanceBtc,
        txCount: src.txCount,
        links: res.value.links,
      });
    } else {
      onProgress(`> error tracing ${src.address.slice(0, 16)}…: ${res.reason?.message ?? "unknown"}`);
      resultSources.push({
        address: src.address,
        derivationPath: src.derivationPath,
        balanceBtc: src.balanceBtc,
        txCount: src.txCount,
        links: [],
      });
    }
  }

  resultSources.sort((a, b) => {
    const sa = a.links.length ? a.links[0].score : 999;
    const sb = b.links.length ? b.links[0].score : 999;
    return sa - sb;
  });

  const totalLinks = resultSources.reduce((s, src) => s + src.links.length, 0);
  const durationMs = Date.now() - startTime;
  onProgress(
    `> TRACE COMPLETE · ${totalScanned} addresses scanned · ${totalLinks} CEX link${totalLinks !== 1 ? "s" : ""} · ${(durationMs / 1000).toFixed(1)}s`,
  );

  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label: sources.map((s) => s.address.slice(0, 12)).join(", "),
    nodeAddress: `${host}:${port}`,
    depth,
    scannedAt: Date.now(),
    durationMs,
    addressesScanned: totalScanned,
    sources: resultSources,
  };
}
