export type LinkStrength = "DEFINITIVE" | "VERY STRONG" | "STRONG" | "MODERATE" | "WEAK" | "VERY WEAK" | "TENUOUS" | "NEGLIGIBLE";

export interface IntermediateWallet {
  address: string;
  txCount: number;
  uniqueCounterparties: number;
  directness: string;
  isPossibleCex: boolean;
  /** Ratio of value forwarded to next hop (0-1). Undefined when data unavailable. */
  valuePassthrough?: number;
  /** Number of outputs in the connecting transaction. */
  outputCount?: number;
}

export interface ObscurityBreakdown {
  transaction: number; // 0-100 (weighted 20%)
  counterparty: number; // 0-100 (weighted 25%)
  hop: number; // 0-100 (weighted 15%)
  valueContinuity: number; // 0-100 (weighted 20%) — value dilution across path
  fanOut: number; // 0-100 (weighted 15%) — output count per intermediate tx
  cexConfidence: number; // 0-100 (weighted 5%) — confirmed vs heuristic CEX
}

export type CexDirection = "outflow" | "inflow";

export interface CexLink {
  id: string;
  exchange: string;
  exchangeAddress: string;
  hops: number;
  /** Effective hops after common-input-ownership clustering (same-entity hops collapsed). */
  effectiveHops: number;
  /** outflow = funds sent toward the CEX; inflow = funds received from the CEX */
  direction: CexDirection;
  score: number; // 0-100, lower = stronger/more traceable
  strength: LinkStrength;
  breakdown: ObscurityBreakdown;
  path: IntermediateWallet[]; // includes source-adjacent intermediates and the CEX node
}

export interface SourceAddress {
  address: string;
  derivationPath: string;
  balanceBtc: number;
  txCount: number;
  links: CexLink[];
}

export interface InternalTransfer {
  /** Source address where the path originates */
  from: string;
  /** Source address where the path terminates */
  to: string;
  /** Number of hops (1 = direct transfer) */
  hops: number;
  /** BTC value received at the destination */
  valueBtc: number;
  /** Intermediate addresses between from and to (excludes endpoints) */
  intermediates: string[];
}

export interface TraceResult {
  id: string;
  /** the xpub / address label the user entered */
  label: string;
  nodeAddress: string;
  depth: number;
  scannedAt: number;
  durationMs: number;
  addressesScanned: number;
  sources: SourceAddress[];
  /** Groups of source addresses linked by common-input-ownership (co-spending). */
  ownershipClusters: string[][];
  /** Direct on-chain transfers between source addresses. */
  internalTransfers: InternalTransfer[];
}

export interface ScanInput {
  /** xpub or address label */
  label: string;
  nodeAddress: string;
  depth: number;
}

export interface AddressBalance {
  address: string;
  path?: string;
  change?: boolean;
  scheme?: string; // "BIP84", "BIP49", "BIP44"
  confirmed: number;
  unconfirmed: number;
  confirmedBtc: number;
  error?: string;
}

export interface LookupGroup {
  input: string;
  kind: "address" | "xpub";
  derivedCount?: number;
  results: AddressBalance[];
}

export type WatchKind = "xpub" | "address";

export interface WatchEntry {
  id: string;
  value: string;
  kind: WatchKind;
  addedAt: number;
}
