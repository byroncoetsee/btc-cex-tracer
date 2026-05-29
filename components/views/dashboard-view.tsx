"use client"

import { Coins, Link2, Radar, ShieldAlert, Wallet } from "lucide-react"
import { computeStats, riskLabel } from "@/lib/aggregates"
import type { TraceResult } from "@/lib/types"

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
