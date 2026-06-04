/**
 * Copy text to the clipboard, working in non-secure contexts too.
 *
 * `navigator.clipboard` is only available in a secure context (HTTPS or
 * localhost). Umbrel serves apps over plain HTTP on a LAN host, so the modern
 * API is undefined there — we fall back to the legacy execCommand path, which
 * still works without a secure context.
 *
 * Returns true if the copy succeeded.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* fall through to the legacy path */
    }
  }

  try {
    const ta = document.createElement("textarea")
    ta.value = text
    // keep it out of view and from scrolling the page
    ta.style.position = "fixed"
    ta.style.top = "0"
    ta.style.left = "0"
    ta.style.opacity = "0"
    ta.setAttribute("readonly", "")
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
