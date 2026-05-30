import type { CexLink, TraceResult } from "./types"

export interface DashboardStats {
  addressesScanned: number
  sourceCount: number
  linkedSourceCount: number
  totalBalance: number
  exposedBalance: number
  exchanges: { name: string; count: number; avgHops: number; strongest: number }[]
  strongestLink: number | null
}

export function computeStats(trace: TraceResult | null): DashboardStats {
  if (!trace) {
    return {
      addressesScanned: 0,
      sourceCount: 0,
      linkedSourceCount: 0,
      totalBalance: 0,
      exposedBalance: 0,
      exchanges: [],
      strongestLink: null,
    }
  }

  let totalBalance = 0
  let exposedBalance = 0
  let linkedSourceCount = 0
  let strongestLink: number | null = null

  const exMap = new Map<string, { count: number; hops: number[]; scores: number[] }>()

  for (const source of trace.sources) {
    totalBalance += source.balanceBtc
    if (source.links.length > 0) {
      linkedSourceCount += 1
      exposedBalance += source.balanceBtc
      const best = source.links[0].score
      strongestLink = strongestLink === null ? best : Math.min(strongestLink, best)
    }
    for (const link of source.links) {
      const entry = exMap.get(link.exchange) || { count: 0, hops: [], scores: [] }
      entry.count += 1
      entry.hops.push(link.hops)
      entry.scores.push(link.score)
      exMap.set(link.exchange, entry)
    }
  }

  const exchanges = [...exMap.entries()]
    .map(([name, v]) => ({
      name,
      count: v.count,
      avgHops: +(v.hops.reduce((a, b) => a + b, 0) / v.hops.length).toFixed(1),
      strongest: Math.min(...v.scores),
    }))
    .sort((a, b) => a.strongest - b.strongest)

  return {
    addressesScanned: trace.addressesScanned,
    sourceCount: trace.sources.length,
    linkedSourceCount,
    totalBalance,
    exposedBalance,
    exchanges,
    strongestLink,
  }
}

export function riskLabel(score: number | null): {
  label: string
  tone: "danger" | "warn" | "ok" | "none"
} {
  if (score === null) return { label: "NO LINK", tone: "ok" }
  if (score < 20) return { label: "CRITICAL", tone: "danger" }
  if (score < 35) return { label: "HIGH", tone: "danger" }
  if (score < 55) return { label: "MEDIUM", tone: "warn" }
  if (score < 75) return { label: "LOW", tone: "ok" }
  return { label: "MINIMAL", tone: "ok" }
}

export function allLinks(trace: TraceResult): { source: string; link: CexLink }[] {
  const out: { source: string; link: CexLink }[] = []
  for (const s of trace.sources) {
    for (const l of s.links) out.push({ source: s.address, link: l })
  }
  return out
}
