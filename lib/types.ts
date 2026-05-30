export type LinkStrength = "VERY STRONG" | "STRONG" | "MODERATE" | "WEAK" | "VERY WEAK";

export interface IntermediateWallet {
  address: string;
  txCount: number;
  uniqueCounterparties: number;
  directness: string;
  isPossibleCex: boolean;
}

export interface ObscurityBreakdown {
  transaction: number; // 0-100 (weighted 40%)
  counterparty: number; // 0-100 (weighted 50%)
  hop: number; // 0-100 (weighted 10%)
}

export type CexDirection = "outflow" | "inflow";

export interface CexLink {
  id: string;
  exchange: string;
  exchangeAddress: string;
  hops: number;
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
