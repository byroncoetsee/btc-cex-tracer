"use client"

import { useCallback, useEffect, useState } from "react"
import type { TraceResult, WatchEntry, WatchKind } from "@/lib/types"

const TRACES_KEY = "tc_tracer_traces_v1"
const NODE_KEY = "tc_tracer_node_v1"
const WATCH_KEY = "tc_tracer_watchlist_v1"

interface StoreState {
  traces: TraceResult[]
  nodeAddress: string
  watchlist: WatchEntry[]
}

const XPUB_PREFIXES = ["xpub", "ypub", "zpub", "tpub", "upub", "vpub", "Ypub", "Zpub"]

export function detectKind(value: string): WatchKind {
  const v = value.trim()
  return XPUB_PREFIXES.some((p) => v.toLowerCase().startsWith(p.toLowerCase()))
    ? "xpub"
    : "address"
}

function read(): StoreState {
  if (typeof window === "undefined") return { traces: [], nodeAddress: "", watchlist: [] }
  try {
    const traces = JSON.parse(localStorage.getItem(TRACES_KEY) || "[]") as TraceResult[]
    const watchlist = JSON.parse(localStorage.getItem(WATCH_KEY) || "[]") as WatchEntry[]
    const nodeAddress = localStorage.getItem(NODE_KEY) || ""
    return {
      traces: Array.isArray(traces) ? traces : [],
      watchlist: Array.isArray(watchlist) ? watchlist : [],
      nodeAddress,
    }
  } catch {
    return { traces: [], nodeAddress: "", watchlist: [] }
  }
}

export function useTracerStore() {
  const [traces, setTraces] = useState<TraceResult[]>([])
  const [watchlist, setWatchlist] = useState<WatchEntry[]>([])
  const [nodeAddress, setNodeAddressState] = useState("")
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const s = read()
    setTraces(s.traces)
    setWatchlist(s.watchlist)
    setNodeAddressState(s.nodeAddress)
    setHydrated(true)
  }, [])

  // cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TRACES_KEY || e.key === NODE_KEY || e.key === WATCH_KEY) {
        const s = read()
        setTraces(s.traces)
        setWatchlist(s.watchlist)
        setNodeAddressState(s.nodeAddress)
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const persistTraces = useCallback((next: TraceResult[]) => {
    setTraces(next)
    try {
      localStorage.setItem(TRACES_KEY, JSON.stringify(next))
    } catch {
      /* quota / private mode */
    }
  }, [])

  const persistWatch = useCallback((next: WatchEntry[]) => {
    setWatchlist(next)
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }, [])

  const setNodeAddress = useCallback((addr: string) => {
    setNodeAddressState(addr)
    try {
      localStorage.setItem(NODE_KEY, addr)
    } catch {
      /* ignore */
    }
  }, [])

  const addTrace = useCallback(
    (trace: TraceResult) => {
      persistTraces([trace, ...read().traces])
    },
    [persistTraces],
  )

  const addTraces = useCallback(
    (newTraces: TraceResult[]) => {
      persistTraces([...newTraces, ...read().traces])
    },
    [persistTraces],
  )

  const removeTrace = useCallback(
    (id: string) => {
      persistTraces(read().traces.filter((t) => t.id !== id))
    },
    [persistTraces],
  )

  const clearTraces = useCallback(() => {
    persistTraces([])
  }, [persistTraces])

  /** add one or more watch entries (dedupes by value) */
  const addWatch = useCallback(
    (values: string[]) => {
      const existing = read().watchlist
      const seen = new Set(existing.map((e) => e.value.toLowerCase()))
      const additions: WatchEntry[] = []
      for (const raw of values) {
        const value = raw.trim()
        if (!value || seen.has(value.toLowerCase())) continue
        seen.add(value.toLowerCase())
        additions.push({
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          value,
          kind: detectKind(value),
          addedAt: Date.now(),
        })
      }
      if (additions.length) persistWatch([...additions, ...existing])
      return additions.length
    },
    [persistWatch],
  )

  const removeWatch = useCallback(
    (id: string) => {
      persistWatch(read().watchlist.filter((e) => e.id !== id))
    },
    [persistWatch],
  )

  const clearWatch = useCallback(() => {
    persistWatch([])
  }, [persistWatch])

  return {
    hydrated,
    traces,
    watchlist,
    nodeAddress,
    setNodeAddress,
    addTrace,
    addTraces,
    removeTrace,
    clearTraces,
    addWatch,
    removeWatch,
    clearWatch,
  }
}
