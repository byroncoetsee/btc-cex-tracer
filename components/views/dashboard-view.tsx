"use client"

import { Coins, Fingerprint, Link2, Radar, ShieldAlert, Wallet } from "lucide-react"
import { computeStats, riskLabel } from "@/lib/aggregates"
import type { TraceResult } from "@/lib/types"
import { AddressChip } from "@/components/address-chip"

const CLUSTER_COLORS = [
  { bg: "bg-rose-500/15", text: "text-rose-400", border: "border-rose-500/40" },
  { bg: "bg-sky-500/15", text: "text-sky-400", border: "border-sky-500/40" },
  { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/40" },
  { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/40" },
  { bg: "bg-violet-500/15", text: "text-violet-400", border: "border-violet-500/40" },
  { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/40" },
  { bg: "bg-cyan-500/15", text: "text-cyan-400", border: "border-cyan-500/40" },
  { bg: "bg-pink-500/15", text: "text-pink-400", border: "border-pink-500/40" },
]

export function clusterColor(index: number) {
  return CLUSTER_COLORS[index % CLUSTER_COLORS.length]
}

function toneClass(tone: "danger" | "warn" | "ok" | "none") {
  switch (tone) {
    case "danger":
      return "text-destructive border-destructive/50"
    case "warn":
      return "text-accent border-accent/50"
    default:
      return "text-primary border-primary/50"
  }
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Radar
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-sm border border-border bg-card/60 p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-primary text-glow">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export function DashboardView({ trace }: { trace: TraceResult }) {
  const stats = computeStats(trace)
  const risk = riskLabel(stats.strongestLink)

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Radar}
          label="addresses scanned"
          value={stats.addressesScanned.toLocaleString()}
          sub={`${stats.sourceCount} source addresses`}
        />
        <StatCard
          icon={Link2}
          label="cex-linked sources"
          value={String(stats.linkedSourceCount)}
          sub={`of ${stats.sourceCount} · ${stats.exchanges.length} exchanges`}
        />
        <StatCard
          icon={Wallet}
          label="balance exposed"
          value={`${stats.exposedBalance.toFixed(4)}`}
          sub={`BTC · ${stats.totalBalance.toFixed(4)} total`}
        />
        <div className={`rounded-sm border bg-card/60 p-4 ${toneClass(risk.tone)}`}>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            <ShieldAlert className="size-3.5" />
            exposure risk
          </div>
          <div className="mt-2 text-2xl font-bold text-glow">{risk.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {stats.strongestLink === null
              ? "no exchange links found"
              : `strongest link obscurity ${stats.strongestLink}`}
          </div>
        </div>
      </div>

      {trace.ownershipClusters?.length > 0 && (
        <div className="rounded-sm border border-accent/50 bg-accent/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-widest text-accent">
            <Fingerprint className="size-3.5" /> common-input-ownership detected
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            These source addresses co-spent in the same transaction, proving they are controlled by
            the same entity. An investigator can trivially link them.
          </p>
          <div className="space-y-2">
            {trace.ownershipClusters.map((cluster, i) => {
              const cc = clusterColor(i)
              const clusterSources = trace.sources.filter((s) => cluster.includes(s.address))
              const totalBtc = clusterSources.reduce((s, src) => s + src.balanceBtc, 0)
              const allLinks = clusterSources.flatMap((s) => s.links)
              const bestLink = allLinks.length > 0
                ? allLinks.reduce((best, l) => (l.score < best.score ? l : best))
                : null
              return (
              <div
                key={i}
                className={`rounded-sm border ${cc.border} bg-background/50 px-3 py-2`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`mr-1 text-[10px] uppercase tracking-widest ${cc.text}`}>
                    cluster {i + 1}
                  </span>
                  {cluster.map((addr) => (
                    <AddressChip key={addr} address={addr} head={10} tail={8} />
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-4 text-[11px] text-muted-foreground">
                  <span>{totalBtc.toFixed(4)} BTC</span>
                  <span>{clusterSources.length} address{clusterSources.length !== 1 ? "es" : ""}</span>
                  {bestLink ? (
                    <>
                      <span>
                        closest CEX: <span className="text-destructive">{bestLink.exchange}</span> · {bestLink.hops} hop{bestLink.hops !== 1 ? "s" : ""}
                        {bestLink.effectiveHops < bestLink.hops && (
                          <> ({bestLink.effectiveHops} eff)</>
                        )}
                      </span>
                      <span>
                        obscurity <span className="text-foreground">{bestLink.score}</span>
                      </span>
                    </>
                  ) : (
                    <span>no CEX links</span>
                  )}
                </div>
              </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-sm border border-border bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
          <Coins className="size-3.5" /> exchanges detected
        </div>
        {stats.exchanges.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {"// no centralized exchange links detected in this trace"}
          </p>
        ) : (
          <div className="space-y-2">
            {stats.exchanges.map((ex) => {
              const r = riskLabel(ex.strongest)
              return (
                <div
                  key={ex.name}
                  className="flex items-center gap-3 rounded-sm border border-border bg-background/50 px-3 py-2.5"
                >
                  <span className="w-28 shrink-0 text-sm font-bold uppercase tracking-widest text-destructive">
                    {ex.name}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background">
                    <div
                      className="h-full rounded-full bg-destructive/70"
                      style={{ width: `${Math.max(6, 100 - ex.strongest)}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-xs text-muted-foreground">
                    {ex.count} link{ex.count > 1 ? "s" : ""}
                  </span>
                  <span className="w-24 text-right text-xs text-muted-foreground">
                    ~{ex.avgHops} hops
                  </span>
                  <span className={`w-20 text-right text-xs font-bold ${toneClass(r.tone)}`}>
                    {r.label}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
