import { NextResponse } from "next/server"
import { ElectrumSession, parseNodeAddress } from "@/lib/electrum"
import { addressToScripthash } from "@/lib/address"
import { toHDKey, deriveAddressBatch, SCHEMES, type DerivedAddress } from "@/lib/xpub"

export interface AddressBalance {
  address: string
  path?: string
  change?: boolean
  scheme?: string
  confirmed: number
  unconfirmed: number
  confirmedBtc: number
  error?: string
}

export interface LookupGroup {
  input: string
  kind: "address" | "xpub"
  derivedCount?: number
  results: AddressBalance[]
}

const XPUB_PREFIXES = ["xpub", "ypub", "zpub", "tpub", "upub", "vpub"]
const GAP_LIMIT = 20

function isXpub(value: string): boolean {
  const lower = value.trim().toLowerCase()
  return XPUB_PREFIXES.some((p) => lower.startsWith(p))
}

/**
 * Discover used addresses from an xpub. Checks all 4 schemes' first batch
 * in one pipelined call, then only continues discovery for active schemes.
 * Each xpub gets its own session for parallel execution.
 */
async function lookupXpub(
  extKey: string,
  session: ElectrumSession,
): Promise<LookupGroup> {
  const group: LookupGroup = {
    input: extKey,
    kind: "xpub",
    derivedCount: 0,
    results: [],
  }

  try {
    const hdkey = toHDKey(extKey)

    // Phase 1: check first batch of ALL schemes in one pipelined call
    const firstBatches: { scheme: (typeof SCHEMES)[number]; addresses: DerivedAddress[] }[] = []
    const allFirstAddrs: DerivedAddress[] = []

    for (const scheme of SCHEMES) {
      const batch = deriveAddressBatch(hdkey, scheme.type, scheme.label, 0, GAP_LIMIT)
      const receive = batch.filter((a) => !a.change)
      firstBatches.push({ scheme, addresses: receive })
      allFirstAddrs.push(...receive)
    }

    group.derivedCount = allFirstAddrs.length

    // one big pipelined history check for all schemes at once
    const allHistoryResults = await session.batch(
      allFirstAddrs.map((a) => ({
        method: "blockchain.scripthash.get_history",
        params: [addressToScripthash(a.address)],
      })),
    )

    // split results back per scheme and find which schemes had activity
    type SchemeState = {
      scheme: (typeof SCHEMES)[number]
      used: DerivedAddress[]
      consecutiveEmpty: number
      needsMore: boolean
    }
    const schemeStates: SchemeState[] = []
    let resultIdx = 0

    for (const { scheme, addresses } of firstBatches) {
      const state: SchemeState = {
        scheme,
        used: [],
        consecutiveEmpty: 0,
        needsMore: false,
      }
      let hadActivity = false
      for (const addr of addresses) {
        const res = allHistoryResults[resultIdx++]
        const history = (res.result ?? []) as unknown[]
        if (history.length > 0) {
          state.used.push(addr)
          hadActivity = true
          state.consecutiveEmpty = 0
        } else {
          state.consecutiveEmpty++
        }
      }
      state.needsMore = hadActivity && state.consecutiveEmpty < GAP_LIMIT
      schemeStates.push(state)
    }

    // Phase 2: continue discovery only for schemes that had hits and haven't
    // reached gap limit yet
    for (const state of schemeStates) {
      if (!state.needsMore) continue

      let startIndex = GAP_LIMIT
      while (state.consecutiveEmpty < GAP_LIMIT) {
        const batch = deriveAddressBatch(
          hdkey,
          state.scheme.type,
          state.scheme.label,
          startIndex,
          GAP_LIMIT,
        )
        const receive = batch.filter((a) => !a.change)
        group.derivedCount! += receive.length

        const historyResults = await session.batch(
          receive.map((a) => ({
            method: "blockchain.scripthash.get_history",
            params: [addressToScripthash(a.address)],
          })),
        )

        let batchHadActivity = false
        for (let i = 0; i < receive.length; i++) {
          const res = historyResults[i]
          const history = (res.result ?? []) as unknown[]
          if (history.length > 0) {
            state.used.push(receive[i])
            batchHadActivity = true
            state.consecutiveEmpty = 0
          } else {
            state.consecutiveEmpty++
          }
        }
        if (!batchHadActivity) break
        startIndex += GAP_LIMIT
      }
    }

    // Phase 3: fetch balances for all used addresses across all schemes in one batch
    const allUsed = schemeStates.flatMap((s) => s.used)
    if (allUsed.length > 0) {
      const balanceResults = await session.batch(
        allUsed.map((a) => ({
          method: "blockchain.scripthash.get_balance",
          params: [addressToScripthash(a.address)],
        })),
      )

      for (let i = 0; i < allUsed.length; i++) {
        const addr = allUsed[i]
        const res = balanceResults[i]
        if (res.error) {
          group.results.push({
            address: addr.address,
            path: addr.path,
            change: addr.change,
            scheme: addr.scheme,
            confirmed: 0,
            unconfirmed: 0,
            confirmedBtc: 0,
            error: res.error.message,
          })
        } else {
          const { confirmed, unconfirmed } = res.result as {
            confirmed: number
            unconfirmed: number
          }
          group.results.push({
            address: addr.address,
            path: addr.path,
            change: addr.change,
            scheme: addr.scheme,
            confirmed,
            unconfirmed,
            confirmedBtc: confirmed / 1e8,
          })
        }
      }
    }
  } catch (err) {
    group.results.push({
      address: extKey,
      confirmed: 0,
      unconfirmed: 0,
      confirmedBtc: 0,
      error: err instanceof Error ? err.message : "Lookup failed",
    })
  }

  return group
}

export async function POST(req: Request) {
  try {
    const { nodeAddress, entries, tls: useTls } = (await req.json()) as {
      nodeAddress?: string
      entries?: { value: string; kind: string }[]
      tls?: boolean
    }

    if (!nodeAddress?.trim()) {
      return NextResponse.json(
        { ok: false, error: "No node address provided" },
        { status: 400 },
      )
    }
    if (!entries?.length) {
      return NextResponse.json(
        { ok: false, error: "No entries provided" },
        { status: 400 },
      )
    }

    const { host, port } = parseNodeAddress(nodeAddress)

    // single shared session for everything
    const session = new ElectrumSession(host, port, 30000, useTls ?? false)
    await session.connect()

    try {
      const groups: LookupGroup[] = []

      // xpubs — sequential on shared session
      for (const entry of entries.filter((e) => isXpub(e.value))) {
        groups.push(await lookupXpub(entry.value, session))
      }

      // plain addresses — one pipelined batch
      const addrs = entries.filter((e) => !isXpub(e.value)).map((e) => e.value)
      if (addrs.length) {
        const lookups = addrs.map((addr) => {
          try {
            return { address: addr, scripthash: addressToScripthash(addr) }
          } catch (err) {
            return {
              address: addr,
              scripthash: "",
              error: err instanceof Error ? err.message : "Invalid address",
            }
          }
        })

        const valid = lookups.filter((l) => !("error" in l))
        const responses = valid.length
          ? await session.batch(
              valid.map((l) => ({
                method: "blockchain.scripthash.get_balance",
                params: [l.scripthash],
              })),
            )
          : []

        let validIdx = 0
        for (const lookup of lookups) {
          const group: LookupGroup = {
            input: lookup.address,
            kind: "address",
            results: [],
          }
          if ("error" in lookup) {
            group.results.push({
              address: lookup.address,
              confirmed: 0,
              unconfirmed: 0,
              confirmedBtc: 0,
              error: lookup.error as string,
            })
          } else {
            const res = responses[validIdx++]
            if (res.error) {
              group.results.push({
                address: lookup.address,
                confirmed: 0,
                unconfirmed: 0,
                confirmedBtc: 0,
                error: res.error.message,
              })
            } else {
              const { confirmed, unconfirmed } = res.result as {
                confirmed: number
                unconfirmed: number
              }
              group.results.push({
                address: lookup.address,
                confirmed,
                unconfirmed,
                confirmedBtc: confirmed / 1e8,
              })
            }
          }
          groups.push(group)
        }
      }

      return NextResponse.json({ ok: true, groups })
    } finally {
      session.close()
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ ok: false, error: message })
  }
}
