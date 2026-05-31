"use client"

import { Settings as SettingsIcon } from "lucide-react"
import type { Settings } from "@/hooks/use-settings"

interface SettingsViewProps {
  settings: Settings
  onUpdate: (patch: Partial<Settings>) => void
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-4 rounded-sm border border-border bg-card/60 px-4 py-3 text-left transition-colors hover:bg-card/80"
    >
      <div className="flex-1">
        <div className="text-sm text-foreground">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </div>
      <div
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-muted-foreground/30"
        }`}
      >
        <div
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </div>
    </button>
  )
}

export function SettingsView({ settings, onUpdate }: SettingsViewProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
          <SettingsIcon className="size-3.5" /> address display
        </div>

        <Toggle
          label="Identicons"
          description="Show a unique deterministic pixel pattern next to each address for quick visual identification"
          checked={settings.showIdenticons}
          onChange={(v) => onUpdate({ showIdenticons: v })}
        />

        <Toggle
          label="Colour nicknames"
          description="Show a deterministic two-word name (e.g. &quot;Coral Falcon&quot;) in a unique colour next to each address"
          checked={settings.showNicknames}
          onChange={(v) => onUpdate({ showNicknames: v })}
        />
      </div>
    </div>
  )
}
