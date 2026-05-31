"use client"

import { useCallback, useEffect, useState } from "react"

const SETTINGS_KEY = "tc_tracer_settings_v1"

export interface Settings {
  /** Show the 4x4 identicon next to addresses */
  showIdenticons: boolean
  /** Show the deterministic two-word nickname */
  showNicknames: boolean
}

const DEFAULTS: Settings = {
  showIdenticons: true,
  showNicknames: true,
}

function read(): Settings {
  if (typeof window === "undefined") return DEFAULTS
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(DEFAULTS)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setSettingsState(read())
    setHydrated(true)
  }, [])

  // cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_KEY) setSettingsState(read())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...read(), ...patch }
    setSettingsState(next)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    } catch {
      /* quota / private mode */
    }
  }, [])

  return { settings, update, hydrated }
}
