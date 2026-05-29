"use client"

import { ArrowRight, Building2, Home, Wallet } from "lucide-react"
import { truncateAddr } from "@/lib/tracer"
import type { CexLink } from "@/lib/types"

interface PathGraphProps {
  sourceAddress: string
  link: CexLink
}

export function PathGraph({ sourceAddress, link }: PathGraphProps) {
  const nodes = [
    { addr: sourceAddress, kind: "source" as const, label: "YOUR ADDRESS" },
    ...link.path.map((p, i) => ({
      addr: p.address,
      kind: (i === link.path.length - 1 ? "cex" : "hop") as "cex" | "hop",
      label: i === link.path.length - 1 ? link.exchange : `HOP ${i + 1}`,
      wallet: p,
    })),
  ]

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-stretch gap-2 py-2">
        {nodes.map((n, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className={`flex w-40 flex-col gap-1 rounded-sm border p-2.5 ${
                n.kind === "source"
                  ? "border-primary/60 bg-primary/10"
                  : n.kind === "cex"
                    ? "border-destructive/60 bg-destructive/10"
                    : "border-border bg-background"
              }`}
            >
              <div className="flex items-center gap-1.5">
                {n.kind === "source" ? (
                  <Home className="size-3.5 text-primary" />
                ) : n.kind === "cex" ? (
                  <Building2 className="size-3.5 text-destructive" />
                ) : (
                  <Wallet className="size-3.5 text-muted-foreground" />
                )}
                <span
                  className={`text-[10px] font-bold uppercase tracking-widest ${
                    n.kind === "source"
                      ? "text-primary"
                      : n.kind === "cex"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  {n.label}
                </span>
              </div>
              <code className="break-all text-[11px] text-foreground">
                {truncateAddr(n.addr, 10, 8)}
              </code>
              {"wallet" in n && n.wallet && (
                <span className="text-[10px] text-muted-foreground">
                  {n.wallet.txCount.toLocaleString()} tx ·{" "}
                  {n.wallet.uniqueCounterparties.toLocaleString()} cp
                </span>
              )}
            </div>
            {i < nodes.length - 1 && (
              <ArrowRight className="size-4 shrink-0 text-primary/60" aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
