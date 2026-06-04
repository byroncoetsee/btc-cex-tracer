"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Building2,
  Download,
  GitFork,
  HelpCircle,
  LayoutDashboard,
  ListTree,
  History,
  Settings,
  Trash2,
  X,
} from "lucide-react"
import Link from "next/link"
import { useTracerStore } from "@/hooks/use-tracer-store"
import { useNetworkLive } from "@/hooks/use-network-live"
import { useSettings } from "@/hooks/use-settings"
import type { TraceResult } from "@/lib/types"
import { TerminalHeader } from "@/components/terminal-header"
import { ScanConsole } from "@/components/scan-console"
import { DashboardView } from "@/components/views/dashboard-view"
import { SourcesView } from "@/components/views/sources-view"
import { ExchangesView } from "@/components/views/exchanges-view"
import { ConnectionsView } from "@/components/views/connections-view"
import { SettingsView } from "@/components/views/settings-view"
import { SettingsContext, HoverContext, TraceContext, createHoverStore } from "@/components/settings-provider"

type View = "dashboard" | "sources" | "exchanges" | "connections" | "history" | "settings"

const TABS: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "dashboard", icon: LayoutDashboard },
  { id: "sources", label: "sources", icon: ListTree },
  { id: "exchanges", label: "exchanges", icon: Building2 },
  { id: "connections", label: "connections", icon: GitFork },
  { id: "history", label: "history", icon: History },
  { id: "settings", label: "settings", icon: Settings },
]

function formatTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function exportToJson(data: TraceResult | TraceResult[], filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function Page() {
  const {
    hydrated,
    traces,
    watchlist,
    nodeAddress,
    setNodeAddress,
    addTraces,
    removeTrace,
    clearTraces,
    addWatch,
    removeWatch,
    clearWatch,
  } = useTracerStore()

  const [view, setView] = useState<View>("dashboard")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [nodeOnline, setNodeOnline] = useState(false)
  const [useTls, setUseTls] = useState(false)

  const { settings, update: updateSettings } = useSettings()
  const [hoverStore] = useState(createHoverStore)

  const { status: networkStatus, connected: liveConnected, connecting: liveConnecting } = useNetworkLive(nodeAddress, nodeOnline, useTls)

  const isFirstVisit = hydrated && !nodeAddress && watchlist.length === 0 && traces.length === 0

  // keep selection valid; default to newest trace
  useEffect(() => {
    if (!hydrated) return
    if (traces.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !traces.some((t) => t.id === selectedId)) {
      setSelectedId(traces[0].id)
    }
  }, [hydrated, traces, selectedId])

  const active: TraceResult | null = useMemo(
    () => traces.find((t) => t.id === selectedId) ?? null,
    [traces, selectedId],
  )

  function handleComplete(results: TraceResult[]) {
    if (!results.length) return
    addTraces(results)
    setSelectedId(results[0].id)
    setView("dashboard")
  }

  return (
    <SettingsContext.Provider value={settings}>
    <HoverContext.Provider value={hoverStore}>
    <TraceContext.Provider value={active}>
    <div className="min-h-screen">
      <TerminalHeader
        nodeAddress={nodeAddress}
        online={nodeOnline}
        liveStatus={networkStatus}
        liveConnected={liveConnected}
        liveConnecting={liveConnecting}
      />

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-5">
        <ScanConsole
          nodeAddress={nodeAddress}
          onNodeAddressChange={(addr) => {
            setNodeAddress(addr)
            setNodeOnline(false)
          }}
          onNodeStatus={setNodeOnline}
          onTlsChange={setUseTls}
          watchlist={watchlist}
          onAddWatch={addWatch}
          onRemoveWatch={removeWatch}
          onClearWatch={clearWatch}
          onComplete={handleComplete}
        />

        {active && (
          <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-card/40 px-3 py-2 text-xs">
            <span className="text-muted-foreground">ACTIVE TRACE:</span>
            <span className="text-primary">{active.label.slice(0, 28)}</span>
            <span className="text-muted-foreground/60">via {active.nodeAddress}</span>
            <span className="ml-auto text-muted-foreground">
              depth {active.depth} · {formatTime(active.scannedAt)}
            </span>
            <button
              onClick={() => exportToJson(active, `trace-${active.label.slice(0, 20)}-${active.id}.json`)}
              className="ml-2 flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary"
              aria-label="export trace as JSON"
            >
              <Download className="size-3" /> export
            </button>
          </div>
        )}

        {/* tab bar */}
        <nav className="flex items-center gap-1 border-b border-border">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs uppercase tracking-widest transition-colors ${
                  view === t.id
                    ? "border-primary text-primary text-glow"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" />
                {t.label}
                {t.id === "history" && traces.length > 0 && (
                  <span className="rounded-sm bg-secondary px-1 text-[10px] text-secondary-foreground">
                    {traces.length}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {!hydrated ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            <span className="caret">█</span> loading local session…
          </p>
        ) : view === "settings" ? (
          <SettingsView settings={settings} onUpdate={updateSettings} />
        ) : view === "history" ? (
          <HistoryView
            traces={traces}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id)
              setView("dashboard")
            }}
            onRemove={removeTrace}
            onClear={clearTraces}
          />
        ) : !active ? (
          <EmptyState />
        ) : view === "dashboard" ? (
          <DashboardView trace={active} />
        ) : view === "sources" ? (
          <SourcesView trace={active} />
        ) : view === "exchanges" ? (
          <ExchangesView trace={active} />
        ) : (
          <ConnectionsView trace={active} />
        )}

        <footer className="flex items-center justify-center gap-3 border-t border-border pt-4 text-[10px] uppercase tracking-widest text-muted-foreground/60">
          <span>traces stored locally in your browser · no server · no database</span>
          <Link
            href="/guide"
            className={`flex items-center gap-1 rounded-sm border px-2 py-1 transition-colors hover:border-primary hover:text-primary ${
              isFirstVisit
                ? "animate-pulse border-primary text-primary"
                : "border-border"
            }`}
          >
            <HelpCircle className="size-3" />
            what must i do?
          </Link>
        </footer>
      </main>
    </div>
    </TraceContext.Provider>
    </HoverContext.Provider>
    </SettingsContext.Provider>
  )
}

function EmptyState() {
  return (
    <div className="rounded-sm border border-dashed border-border bg-card/30 py-16 text-center">
      <p className="text-sm text-primary text-glow">{"// awaiting trace"}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        enter a node address, add one or more xpubs / addresses to your watchlist, then hit{" "}
        <span className="text-primary">RUN TRACE</span> to begin chain analysis
      </p>
    </div>
  )
}

function HistoryView({
  traces,
  selectedId,
  onSelect,
  onRemove,
  onClear,
}: {
  traces: TraceResult[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onClear: () => void
}) {
  if (traces.length === 0) {
    return (
      <p className="rounded-sm border border-border bg-card/60 py-10 text-center text-sm text-muted-foreground">
        {"// no saved traces — run a trace to populate history"}
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {traces.length} saved trace{traces.length > 1 ? "s" : ""} (persisted locally)
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportToJson(traces, `traces-all-${Date.now()}.json`)}
            className="flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Download className="size-3.5" /> export all
          </button>
          <button
            onClick={onClear}
            className="flex items-center gap-1.5 rounded-sm border border-destructive/50 px-2 py-1 uppercase tracking-widest text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-3.5" /> clear all
          </button>
        </div>
      </div>
      {traces.map((t) => {
        const linked = t.sources.filter((s) => s.links.length > 0).length
        return (
          <div
            key={t.id}
            className={`flex flex-wrap items-center gap-3 rounded-sm border px-3 py-3 ${
              t.id === selectedId
                ? "border-primary bg-primary/10"
                : "border-border bg-card/60"
            }`}
          >
            <button
              onClick={() => onSelect(t.id)}
              className="flex flex-1 flex-wrap items-center gap-3 text-left"
            >
              <code className="text-sm text-primary">{t.label.slice(0, 26)}</code>
              <span className="text-xs text-muted-foreground/70">{t.nodeAddress}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {linked}/{t.sources.length} linked · depth {t.depth}
              </span>
              <span className="w-32 text-right text-xs text-muted-foreground">
                {formatTime(t.scannedAt)}
              </span>
            </button>
            <button
              onClick={() => exportToJson(t, `trace-${t.label.slice(0, 20)}-${t.id}.json`)}
              className="text-muted-foreground hover:text-primary"
              aria-label="export trace as JSON"
            >
              <Download className="size-3.5" />
            </button>
            <button
              onClick={() => onRemove(t.id)}
              className="text-muted-foreground hover:text-destructive"
              aria-label="delete trace"
            >
              <X className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
