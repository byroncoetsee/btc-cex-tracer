"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Circle, Copy, Check } from "lucide-react"
import { riskLabel } from "@/lib/aggregates"
import { clusterColor } from "@/components/views/dashboard-view"
import { truncateAddr } from "@/lib/tracer"
import type { SourceAddress, TraceResult } from "@/lib/types"
import { LinkCard } from "@/components/link-card"

function toneText(tone: "danger" | "warn" | "ok" | "none") {
  if (tone === "danger") return "text-destructive"
  if (tone === "warn") return "text-accent"
  return "text-primary"
}

function SourceRow({ source, clusterIndex }: { source: SourceAddress; clusterIndex?: number }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const best = source.links.length ? source.links[0].score : null
  const risk = riskLabel(best)

  async function copy(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(source.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="rounded-sm border border-border bg-card/60">
      <button
        onClick={() => source.links.length && setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-3 text-left"
        aria-expanded={open}
      >
        {source.links.length ? (
          open ? (
            <ChevronDown className="size-4 shrink-0 text-primary" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <Circle className="size-3 shrink-0 text-muted-foreground/40" />
        )}

        <code className="flex items-center gap-1.5 text-sm text-foreground">
          {truncateAddr(source.address, 14, 10)}
          <span
            onClick={copy}
            className="cursor-pointer text-muted-foreground hover:text-primary"
            role="button"
            tabIndex={0}
            aria-label="copy address"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </span>
          {source.links.filter((l) => l.direction === "inflow").length > 0 && (
            <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-accent">
              {source.links.filter((l) => l.direction === "inflow").length} in
            </span>
          )}
          {source.links.filter((l) => l.direction === "outflow").length > 0 && (
            <span className="rounded-sm bg-destructive/15 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-destructive">
              {source.links.filter((l) => l.direction === "outflow").length} out
            </span>
          )}
          {source.links.length === 0 && (
            <span className="text-xs text-muted-foreground">0 CEX</span>
          )}
          {clusterIndex != null && (
            <span className={`rounded-sm ${clusterColor(clusterIndex).bg} px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${clusterColor(clusterIndex).text}`}>
              cluster {clusterIndex + 1}
            </span>
          )}
        </code>

        <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
          {source.derivationPath}
        </span>
        <span className="w-24 text-right text-xs text-foreground">
          {source.balanceBtc.toFixed(4)} BTC
        </span>
        <span className={`w-20 text-right text-xs font-bold ${toneText(risk.tone)}`}>
          {risk.label}
        </span>
      </button>

      {open && source.links.length > 0 && (
        <div className="space-y-3 border-t border-border p-3">
          {source.links.map((link) => (
            <LinkCard key={link.id} sourceAddress={source.address} link={link} />
          ))}
        </div>
      )}
    </div>
  )
}

export function SourcesView({ trace }: { trace: TraceResult }) {
  const [hideZero, setHideZero] = useState(false)
  const [linkedOnly, setLinkedOnly] = useState(false)
  const sources = trace.sources.filter((s) => {
    if (hideZero && s.balanceBtc <= 0) return false
    if (linkedOnly && s.links.length === 0) return false
    return true
  })

  // Build address → cluster index lookup
  const clusterLookup = new Map<string, number>()
  for (let i = 0; i < (trace.ownershipClusters?.length ?? 0); i++) {
    for (const addr of trace.ownershipClusters[i]) clusterLookup.set(addr, i)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">FILTER:</span>
        <button
          onClick={() => setHideZero((v) => !v)}
          className={`rounded-sm border px-2.5 py-1 uppercase tracking-widest ${
            hideZero
              ? "border-primary bg-primary/15 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          non-zero balance
        </button>
        <button
          onClick={() => setLinkedOnly((v) => !v)}
          className={`rounded-sm border px-2.5 py-1 uppercase tracking-widest ${
            linkedOnly
              ? "border-primary bg-primary/15 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          cex-linked only
        </button>
        <span className="ml-auto text-muted-foreground">
          {sources.length} shown · click a linked row to expand
        </span>
      </div>

      {sources.map((s) => (
        <SourceRow key={s.address} source={s} clusterIndex={clusterLookup.get(s.address)} />
      ))}
    </div>
  )
}
