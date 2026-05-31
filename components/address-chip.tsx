"use client"

import { useState } from "react"
import { Copy, Check } from "lucide-react"
import { truncateAddr } from "@/lib/tracer"
import { getAddressIdentity } from "@/lib/address-identity"
import { useSettingsContext, useHoveredAddress } from "@/components/settings-provider"

interface AddressChipProps {
  address: string
  /** Truncation head/tail lengths (defaults to 8/6) */
  head?: number
  tail?: number
  /** Show copy button */
  copyable?: boolean
  /** Show the two-word nickname */
  showNickname?: boolean
  /** Render as inline-flex (default) or block */
  className?: string
  /** Stop click propagation (useful inside buttons) */
  stopPropagation?: boolean
}

function Identicon({ grid, color, size = 16 }: { grid: boolean[][]; color: string; size?: number }) {
  const cells = grid.length
  const cellSize = size / cells
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 rounded-[2px]">
      <rect width={size} height={size} fill="currentColor" className="text-background" rx={2} />
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

export function AddressChip({
  address,
  head = 8,
  tail = 6,
  copyable = false,
  showNickname = true,
  className = "",
  stopPropagation = false,
}: AddressChipProps) {
  const [copied, setCopied] = useState(false)
  const identity = getAddressIdentity(address)
  const { showIdenticons, showNicknames } = useSettingsContext()
  const [hoveredAddr, setHoveredAddr] = useHoveredAddress()
  const isHighlighted = hoveredAddr === address
  const isSomethingHovered = hoveredAddr !== null
  const isDimmed = isSomethingHovered && !isHighlighted

  async function copy(e: React.MouseEvent) {
    if (stopPropagation) e.stopPropagation()
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 transition-all duration-150 ${className} ${
        isHighlighted
          ? "rounded-sm ring-1 ring-current/40 bg-white/[0.06]"
          : isDimmed
            ? "opacity-40"
            : ""
      }`}
      title={address}
      style={isHighlighted ? { color: identity.color } : undefined}
      onMouseEnter={() => setHoveredAddr(address)}
      onMouseLeave={() => setHoveredAddr(null)}
    >
      {showIdenticons && <Identicon grid={identity.identicon} color={identity.color} size={16} />}
      {showNickname && showNicknames ? (
        <span
          className="text-[10px] font-medium uppercase tracking-wider"
          style={{ color: identity.color }}
        >
          {identity.nickname}
        </span>
      ) : (
        <code className="text-sm text-foreground">{truncateAddr(address, head, tail)}</code>
      )}
      {copyable && (
        <span
          onClick={copy}
          className="cursor-pointer text-muted-foreground hover:text-primary"
          role="button"
          tabIndex={0}
          aria-label="copy address"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </span>
      )}
    </span>
  )
}

/**
 * Lightweight SVG identicon for use inside SVG graphs (connections view).
 * Returns SVG group elements positioned at (x, y).
 */
export function SvgIdenticon({
  address,
  x,
  y,
  size = 12,
}: {
  address: string
  x: number
  y: number
  size?: number
}) {
  const { showIdenticons } = useSettingsContext()
  if (!showIdenticons) return null

  const identity = getAddressIdentity(address)
  const cells = identity.identicon.length
  const cellSize = size / cells

  return (
    <g>
      {identity.identicon.map((row, gy) =>
        row.map((filled, gx) =>
          filled ? (
            <rect
              key={`${gy}-${gx}`}
              x={x + gx * cellSize}
              y={y + gy * cellSize}
              width={cellSize}
              height={cellSize}
              fill={identity.colorHex}
              fillOpacity={0.9}
            />
          ) : null,
        ),
      )}
    </g>
  )
}
