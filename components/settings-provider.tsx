"use client"

import { createContext, useCallback, useContext, useSyncExternalStore } from "react"
import type { Settings } from "@/hooks/use-settings"
import type { TraceResult } from "@/lib/types"

// --- Settings context ---

const defaults: Settings = { showIdenticons: true, showNicknames: true }

export const SettingsContext = createContext<Settings>(defaults)

export function useSettingsContext() {
  return useContext(SettingsContext)
}

// --- Address hover context ---
// Uses a pub/sub store so only chips whose highlight state actually changes re-render.

type Listener = () => void

function createHoverStore() {
  let current: string | null = null
  const listeners = new Set<Listener>()

  return {
    get: () => current,
    set: (addr: string | null) => {
      if (current === addr) return
      current = addr
      listeners.forEach((l) => l())
    },
    subscribe: (l: Listener) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

type HoverStore = ReturnType<typeof createHoverStore>

const HoverContext = createContext<HoverStore | null>(null)

export { createHoverStore, HoverContext }
export type { HoverStore }

// --- Active trace context ---
// Provides the currently active trace to any component that needs it (e.g. AddressPopover).

export const TraceContext = createContext<TraceResult | null>(null)

export function useActiveTrace() {
  return useContext(TraceContext)
}

export function useHoveredAddress(): [string | null, (addr: string | null) => void] {
  const store = useContext(HoverContext)
  if (!store) return [null, () => {}]
  const addr = useSyncExternalStore(store.subscribe, store.get, () => null)
  const set = useCallback((a: string | null) => store.set(a), [store])
  return [addr, set]
}
