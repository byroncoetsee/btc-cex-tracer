"use client"

import { createContext, useContext } from "react"
import type { Settings } from "@/hooks/use-settings"

const defaults: Settings = { showIdenticons: true, showNicknames: true }

export const SettingsContext = createContext<Settings>(defaults)

export function useSettingsContext() {
  return useContext(SettingsContext)
}
