"use client"

import Link from "next/link"
import {
  ArrowLeft,
  Database,
  Eye,
  Globe,
  HardDrive,
  Lock,
  Network,
  Search,
  Shield,
  Workflow,
} from "lucide-react"

const SECTIONS = [
  {
    title: "what is this?",
    icon: Eye,
    content: [
      "BTC Tracer is a chain-analysis terminal that checks whether your Bitcoin addresses can be linked back to centralized exchanges (CEXs).",
      "It connects directly to an Electrum-compatible node, walks the transaction graph outward from your addresses, and looks for known exchange deposit and withdrawal addresses. When it finds a link, it scores how strong the connection is.",
      "Think of it as a privacy check — are your coins traceable back to an exchange where you KYC'd?",
    ],
  },
  {
    title: "how to use it",
    icon: Workflow,
    steps: [
      {
        label: "Connect to a node",
        detail:
          "Enter the address of an Electrum or Fulcrum node (e.g. 127.0.0.1:50001). Toggle TLS if your node uses port 50002. Hit TEST to verify the connection.",
      },
      {
        label: "Add addresses to your watchlist",
        detail:
          "Paste a Bitcoin address or an extended public key (xpub/ypub/zpub). If you provide an xpub, the tracer will automatically derive addresses across all derivation paths (legacy, SegWit, Taproot) and find the funded ones.",
      },
      {
        label: "Run a trace",
        detail:
          "Hit RUN TRACE. The tracer will stream progress in real-time as it walks the transaction graph. Depending on depth and address count, this can take anywhere from a few seconds to a few minutes.",
      },
      {
        label: "Review your results",
        detail:
          "Explore the dashboard for a summary, the sources view for per-address breakdowns, the exchanges view grouped by CEX, or the connections graph for a visual map of how your addresses relate.",
      },
    ],
  },
  {
    title: "what you'll need",
    icon: Network,
    content: [
      "You need access to an Electrum protocol-compatible node. This can be:",
    ],
    list: [
      "Your own Fulcrum or ElectrumX instance (recommended for privacy)",
      "A public Electrum server (convenient but less private — the server can see your queries)",
      "A local Bitcoin Core node with an Electrum adapter",
    ],
    footer:
      "The tracer communicates with the node over TCP (default port 50001) or TLS (default port 50002). No other network connections are made.",
  },
  {
    title: "features",
    icon: Search,
    features: [
      {
        name: "Xpub derivation",
        detail: "Supports BIP44 (legacy), BIP49 (wrapped SegWit), BIP84 (native SegWit), and BIP86 (Taproot). Automatically discovers funded addresses across all paths.",
      },
      {
        name: "Transaction graph traversal",
        detail: "Follows transaction inputs and outputs 2–6 hops deep (configurable in settings), tracing the flow of funds in both directions.",
      },
      {
        name: "Common-Input-Ownership Heuristic (CIOH)",
        detail: "Detects when multiple addresses appear as inputs in the same transaction — a strong signal they're controlled by the same entity. These are grouped into ownership clusters.",
      },
      {
        name: "Risk scoring",
        detail: "Each CEX link gets an obscurity score (0–100) based on hop distance, transaction complexity, value continuity, counterparty diversity, and fan-out. Scores map to 8 risk levels from CRITICAL to NEGLIGIBLE.",
      },
      {
        name: "Interactive graph",
        detail: "The connections view renders a force-directed graph showing your addresses, intermediate hops, CEX nodes, and CIOH clusters — a visual map of your on-chain footprint.",
      },
      {
        name: "JSON export",
        detail: "Export individual traces or your full history as JSON for offline analysis or record-keeping.",
      },
    ],
  },
  {
    title: "CEX address database",
    icon: Database,
    content: [
      "The tracer checks addresses against pre-loaded CSV databases of known exchange addresses. These cover major exchanges including Binance, Kraken, Bitstamp, Luno, and others.",
      "The databases are loaded on-demand and cached in memory. They are not sent anywhere — matching happens entirely on the server side of your local instance.",
    ],
  },
  {
    title: "privacy & security",
    icon: Shield,
    points: [
      {
        icon: HardDrive,
        label: "Everything stays local",
        detail: "All trace results are stored in your browser's localStorage. There is no server database, no accounts, no cloud sync. Close the tab and your data stays on your machine.",
      },
      {
        icon: Network,
        label: "Direct node connection",
        detail: "Queries go straight from this app to the Electrum node you configure. No third-party APIs, no intermediaries, no analytics on your addresses.",
      },
      {
        icon: Lock,
        label: "No telemetry on your addresses",
        detail: "The app does not phone home with your addresses, trace results, or any other data. The only outbound connections are to your configured node.",
      },
      {
        icon: Globe,
        label: "Self-hostable",
        detail: "You can run this entirely on your own infrastructure. Clone the repo, point it at your own node, and you have a fully private chain-analysis setup.",
      },
    ],
  },
  {
    title: "important notes",
    icon: Shield,
    notes: [
      "This tool shows links between addresses and known CEX addresses — it does not prove ownership or identity. A link means funds flowed between the addresses, not necessarily that the same person controls them.",
      "Obscurity scores are heuristic-based estimates, not certainties. A low score means a strong statistical link, but real-world traceability depends on many factors this tool cannot measure.",
      "The quality of results depends heavily on the CEX address database. More comprehensive databases produce more complete traces.",
      "When using a public Electrum server, the server operator can see which addresses you're querying. For maximum privacy, run your own node.",
    ],
  },
]

export default function GuidePage() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <ArrowLeft className="size-3" />
            back
          </Link>
          <h1 className="text-sm uppercase tracking-widest text-primary text-glow">
            // guide
          </h1>
        </div>

        {SECTIONS.map((section) => {
          const Icon = section.icon
          return (
            <section
              key={section.title}
              className="space-y-3 rounded-sm border border-border bg-card/40 p-5"
            >
              <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
                <Icon className="size-4" />
                {section.title}
              </h2>

              {section.content?.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-foreground/80">
                  {p}
                </p>
              ))}

              {section.list && (
                <ul className="space-y-1 pl-4 text-sm text-foreground/80">
                  {section.list.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 block size-1 shrink-0 rounded-full bg-primary/60" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}

              {section.footer && (
                <p className="text-sm leading-relaxed text-foreground/80">
                  {section.footer}
                </p>
              )}

              {section.steps && (
                <ol className="space-y-4">
                  {section.steps.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-primary/40 text-xs text-primary">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {step.label}
                        </p>
                        <p className="mt-0.5 text-sm leading-relaxed text-foreground/60">
                          {step.detail}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {section.features && (
                <div className="space-y-3">
                  {section.features.map((f, i) => (
                    <div key={i}>
                      <p className="text-sm font-medium text-foreground">
                        {f.name}
                      </p>
                      <p className="mt-0.5 text-sm leading-relaxed text-foreground/60">
                        {f.detail}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {section.points && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {section.points.map((p, i) => {
                    const PIcon = p.icon
                    return (
                      <div
                        key={i}
                        className="rounded-sm border border-border bg-background/40 p-3"
                      >
                        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-foreground">
                          <PIcon className="size-3.5 text-primary" />
                          {p.label}
                        </p>
                        <p className="mt-1.5 text-xs leading-relaxed text-foreground/60">
                          {p.detail}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}

              {section.notes && (
                <div className="space-y-3">
                  {section.notes.map((note, i) => (
                    <div
                      key={i}
                      className="flex gap-2.5 rounded-sm border border-accent/20 bg-accent/5 px-3 py-2.5"
                    >
                      <span className="mt-0.5 text-xs text-accent">!</span>
                      <p className="text-sm leading-relaxed text-foreground/70">
                        {note}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}

        <footer className="border-t border-border pt-4 text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
          <Link href="/" className="hover:text-primary transition-colors">
            back to tracer
          </Link>
        </footer>
      </div>
    </div>
  )
}
