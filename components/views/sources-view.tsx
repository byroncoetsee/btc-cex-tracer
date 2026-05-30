"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Circle, Copy, Check } from "lucide-react"
import { riskLabel } from "@/lib/aggregates"
import { truncateAddr } from "@/lib/tracer"
import type { SourceAddress, TraceResult } from "@/lib/types"
import { LinkCard } from "@/components/link-card"

function toneText(tone: "danger" | "warn" | "ok" | "none") {
  if (tone === "danger") return "text-destructive"
  if (tone === "warn") return "text-accent"
  return "text-primary"
}

function SourceRow({ source }: { source: SourceAddress }) {
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
  const [filter, setFilter] = useState<"all" | "linked">("all")
  const sources =
    filter === "linked"
      ? trace.sources.filter((s) => s.links.length > 0)
      : trace.sources

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">FILTER:</span>
        {(["all", "linked"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-sm border px-2.5 py-1 uppercase tracking-widest ${
              filter === f
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "all" ? "all addresses" : "cex-linked only"}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground">
          {sources.length} shown · click a linked row to expand
        </span>
      </div>

      {sources.map((s) => (
        <SourceRow key={s.address} source={s} />
      ))}
    </div>
  )
}
