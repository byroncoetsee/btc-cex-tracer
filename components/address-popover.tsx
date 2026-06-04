"use client"

import { Copy, Check, ArrowDownLeft, ArrowUpRight, Link2, Fingerprint, ArrowRight, Wallet } from "lucide-react"
import { useState } from "react"
import { riskLabel } from "@/lib/aggregates"
import { strengthColor, truncateAddr } from "@/lib/tracer"
import { copyToClipboard } from "@/lib/clipboard"
import { getAddressIdentity } from "@/lib/address-identity"
import type { TraceResult, SourceAddress, CexLink, InternalTransfer } from "@/lib/types"

function Identicon({ grid, color, size = 32 }: { grid: boolean[][]; color: string; size?: number }) {
  const cells = grid.length
  const cellSize = size / cells
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 rounded-sm">
      <rect width={size} height={size} fill="currentColor" className="text-background" rx={3} />
      {grid.map((row, y) =>
        row.map((filled, x) =>
          filled ? (
            <rect
              key={`${y}-${x}`}
              x={x * cellSize}
              y={y * cellSize}
              width={cellSize}
              height={cellSize}
              fill={color}
            />
          ) : null,
        ),
      )}
    </svg>
  )
}

function toneText(tone: "danger" | "warn" | "ok" | "none") {
  if (tone === "danger") return "text-destructive"
  if (tone === "warn") return "text-accent"
  return "text-primary"
}

function Stat({ label, value, className = "" }: { label: string; value: string | number; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right font-medium ${className}`}>{value}</span>
    </div>
  )
}

function CexLinkRow({ link }: { link: CexLink }) {
  const risk = riskLabel(link.score)
  return (
    <div className="flex items-center gap-2 rounded-sm border border-border bg-background/50 px-2.5 py-1.5 text-[11px]">
      <span className={link.direction === "inflow" ? "text-accent" : "text-destructive"}>
        {link.direction === "inflow" ? <ArrowDownLeft className="size-3" /> : <ArrowUpRight className="size-3" />}
      </span>
      <span className="font-bold uppercase tracking-widest text-destructive">{link.exchange}</span>
      <span className="text-muted-foreground">{link.hops} hop{link.hops !== 1 ? "s" : ""}</span>
      <span className={`ml-auto font-bold ${strengthColor(link.strength)}`}>{link.strength}</span>
      <span className={`font-bold ${toneText(risk.tone)}`}>{risk.label}</span>
    </div>
  )
}

function TransferRow({ transfer, address }: { transfer: InternalTransfer; address: string }) {
  const isFrom = transfer.from === address
  const other = isFrom ? transfer.to : transfer.from
  const otherIdentity = getAddressIdentity(other)
  return (
    <div className="flex items-center gap-2 rounded-sm border border-border bg-background/50 px-2.5 py-1.5 text-[11px]">
      <span className={isFrom ? "text-destructive" : "text-accent"}>
        {isFrom ? <ArrowUpRight className="size-3" /> : <ArrowDownLeft className="size-3" />}
      </span>
      <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: otherIdentity.color }}>
        {otherIdentity.nickname}
      </span>
      <span className="text-muted-foreground">
        {transfer.hops} hop{transfer.hops !== 1 ? "s" : ""}
      </span>
      <span className="ml-auto text-foreground">{transfer.valueBtc.toFixed(6)} BTC</span>
    </div>
  )
}

interface AddressPopoverContentProps {
  address: string
  trace: TraceResult
}

export function AddressPopoverContent({ address, trace }: AddressPopoverContentProps) {
  const [copied, setCopied] = useState(false)
  const identity = getAddressIdentity(address)

  const source = trace.sources.find((s) => s.address === address) ?? null
  const best = source?.links.length ? source.links[0].score : null
  const risk = riskLabel(best)

  // Cluster membership
  const clusterIdx = (trace.ownershipClusters ?? []).findIndex((c) => c.includes(address))
  const cluster = clusterIdx >= 0 ? trace.ownershipClusters[clusterIdx] : null
  const clusterPeers = cluster ? cluster.filter((a) => a !== address) : []

  // Internal transfers involving this address
  const transfers = (trace.internalTransfers ?? []).filter(
    (t) => t.from === address || t.to === address,
  )

  // Inflow/outflow counts
  const inflows = source?.links.filter((l) => l.direction === "inflow") ?? []
  const outflows = source?.links.filter((l) => l.direction === "outflow") ?? []

  async function copyAddr() {
    if (await copyToClipboard(address)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
  }

  return (
    <div className="space-y-3">
      {/* Header: identicon + nickname + full address */}
      <div className="flex items-start gap-3">
        <Identicon grid={identity.identicon} color={identity.color} size={32} />
        <div className="min-w-0 flex-1">
          <div
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: identity.color }}
          >
            {identity.nickname}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <code className="break-all text-[11px] text-muted-foreground">{address}</code>
            <button
              onClick={copyAddr}
              className="shrink-0 text-muted-foreground hover:text-primary"
              aria-label="copy address"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </button>
          </div>
        </div>
      </div>

      {/* Core stats */}
      {source ? (
        <div className="space-y-1 rounded-sm border border-border bg-card/60 p-2.5">
          <Stat label="Balance" value={source.balanceBtc > 0 ? `${source.balanceBtc.toFixed(8)} BTC` : "empty"} className={source.balanceBtc > 0 ? "" : "text-muted-foreground"} />
          <Stat label="Transactions" value={source.txCount} />
          <Stat label="Derivation" value={source.derivationPath} />
          <Stat
            label="Risk"
            value={risk.label}
            className={toneText(risk.tone)}
          />
          {best !== null && <Stat label="Obscurity score" value={best} />}
        </div>
      ) : (
        <div className="rounded-sm border border-border bg-card/60 p-2.5 text-center text-[11px] text-muted-foreground">
          not a source address in this trace
        </div>
      )}

      {/* Cluster membership */}
      {cluster && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            <Fingerprint className="size-3" /> cluster {clusterIdx + 1} — {cluster.length} address{cluster.length !== 1 ? "es" : ""}
          </div>
          {clusterPeers.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {clusterPeers.map((peer) => {
                const pi = getAddressIdentity(peer)
                return (
                  <span
                    key={peer}
                    className="rounded-sm bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                    style={{ color: pi.color }}
                    title={peer}
                  >
                    {pi.nickname}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* CEX links */}
      {source && source.links.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            <Link2 className="size-3" />
            {source.links.length} exchange link{source.links.length !== 1 ? "s" : ""}
            {inflows.length > 0 && <span className="text-accent">{inflows.length} in</span>}
            {outflows.length > 0 && <span className="text-destructive">{outflows.length} out</span>}
          </div>
          <div className="space-y-1">
            {source.links.slice(0, 5).map((link) => (
              <CexLinkRow key={link.id} link={link} />
            ))}
            {source.links.length > 5 && (
              <div className="text-center text-[10px] text-muted-foreground">
                +{source.links.length - 5} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* Internal transfers */}
      {transfers.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            <Wallet className="size-3" />
            {transfers.length} internal transfer{transfers.length !== 1 ? "s" : ""}
          </div>
          <div className="space-y-1">
            {transfers.slice(0, 5).map((t, i) => (
              <TransferRow key={i} transfer={t} address={address} />
            ))}
            {transfers.length > 5 && (
              <div className="text-center text-[10px] text-muted-foreground">
                +{transfers.length - 5} more
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
