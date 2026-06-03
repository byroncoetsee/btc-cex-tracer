# DOXd

A Bitcoin chain-analysis tool that traces whether your addresses can be linked back to centralized exchanges (CEXs). It follows transaction flows on-chain, detects same-entity address clusters, and scores how exposed each address is — all through a retro terminal-style interface.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## What it does

DOXd connects to an Electrum-compatible node and walks the transaction graph outward from your addresses (or xpub-derived addresses), looking for known CEX deposit/withdrawal addresses. It then calculates an **obscurity score** based on hop distance, value continuity, fan-out complexity, and counterparty analysis.

**Key capabilities:**

- **Xpub address derivation** — BIP44, BIP49, BIP84, and BIP86 (legacy, wrapped SegWit, native SegWit, Taproot)
- **On-chain path tracing** — Follow transaction flows 2–6 hops deep with real-time streaming progress
- **Common-Input-Ownership Heuristic (CIOH)** — Detect address clusters controlled by the same entity
- **Risk scoring** — 8-level classification from CRITICAL to NEGLIGIBLE based on 6 weighted factors
- **CEX address database** — Pre-loaded databases for Binance, Kraken, Luno, Bitstamp, FTX, Celsius, Valr, and WalletExplorer aggregated data
- **Interactive graph visualization** — Force-directed graph showing address connections, clusters, and CEX nodes
- **Live network status** — Real-time block height, fee estimates, and mempool pressure
- **Local-only storage** — All data stays in your browser's localStorage. No server database, no accounts

## Screenshots

<!-- Add screenshots here -->

## Getting started

### Prerequisites

- **Node.js** 18+
- **An Electrum-compatible node** — either your own (e.g. [Fulcrum](https://github.com/cculianu/Fulcrum), [ElectrumX](https://github.com/spesmilo/electrumx)) or a public one
  - TCP (default port 50001) or TLS (default port 50002)

### Installation

```bash
git clone https://github.com/byroncoetsee/btc-cex-tracer.git
cd btc-cex-tracer
npm install
```

### CEX address databases

The tracer matches on-chain addresses against known exchange addresses. You supply these as CSV files in `data/cex_addresses/` (named `<exchange>_addresses.csv`), then build them into a compact **Bloom filter** that the app loads at runtime. The CSVs are **not included in the repo** — you bring your own.

Rather than loading millions of raw addresses into memory, the build step hashes each address into a per-exchange Bloom filter (1% false-positive rate) serialized to `data/cex-bloom.json`. This keeps lookups O(1) and memory usage flat regardless of how many addresses you load — at the cost of an occasional false positive, which downstream scoring treats as low-confidence.

To set up your databases:

1. Place CSV files in `data/cex_addresses/` with the naming pattern `<exchange>_addresses.csv`. The exchange name is derived from the filename — `coinbase_addresses.csv` becomes **Coinbase**, `kraken_addresses.csv` becomes **Kraken**, etc.
2. Build the Bloom filter:
   ```bash
   npm run build:cex
   ```
   This reads every `*_addresses.csv` (skipping `example_addresses.csv`) and writes `data/cex-bloom.json`.
3. Start (or restart) the app — it loads `data/cex-bloom.json` on the first trace. Re-run `build:cex` whenever you add or change CSVs.

**CSV format:** one address per line, or CSV with the address as the first column. Lines starting with `#` and common headers are skipped.

```csv
# coinbase_addresses.csv
1FzWLkAahHooV3kzTgyx6qsXoRDrBsrXU1
1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG
```

The tracer works without any CEX data — if `data/cex-bloom.json` is absent, traces still run and map transaction flows, they just won't identify exchange endpoints. The more comprehensive your address databases, the better the results.

### Running

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000). Enter your Electrum node address, paste an xpub or Bitcoin address, and start a trace.

### Running with Docker

DOXd ships a multi-stage [`Dockerfile`](Dockerfile) that builds a slim, self-contained image (Next.js standalone output, ~225 MB). The pre-built `data/cex-bloom.json` is baked into the image, so **build the Bloom filter first** (see above) if you want CEX matching — the raw CSVs are excluded from the image, only the filter is shipped.

```bash
# Build the CEX Bloom filter (optional, but recommended)
npm run build:cex

# Build the image
docker build -t doxd .

# Run it
docker run -d --name doxd -p 3000:3000 doxd
```

Open [http://localhost:3000](http://localhost:3000).

**Auto-connecting to a node.** By default the node address is entered in the UI. To pre-fill it (so the app connects out of the box), set these environment variables:

| Variable | Example | Description |
|---|---|---|
| `DEFAULT_NODE` | `10.21.0.5:50001` | `host:port` of an Electrum/Fulcrum node, pre-filled on first load |
| `DEFAULT_NODE_TLS` | `false` | Default state of the TLS toggle (`true`/`false`) |

```bash
docker run -d --name doxd -p 3000:3000 \
  -e DEFAULT_NODE="10.21.0.5:50001" \
  -e DEFAULT_NODE_TLS="false" \
  doxd
```

Remember the [connection constraint](#where-to-run-it-important): the *container* opens the socket to the node, so the container must be able to reach that `host:port` on its network.

### Running as an Umbrel app

DOXd connects directly to Umbrel's bundled Electrs node on the internal Docker network, which makes it a natural fit — no LAN/VPN gymnastics, and on-chain queries never leave the device. The [`umbrel/`](umbrel/) directory contains the app manifest ([`umbrel-app.yml`](umbrel/umbrel-app.yml)) and [`docker-compose.yml`](umbrel/docker-compose.yml). The compose file auto-wires `DEFAULT_NODE` to Electrs via Umbrel's injected `${APP_ELECTRS_NODE_IP}:${APP_ELECTRS_NODE_PORT}`, so it connects with zero configuration.

To install:

1. **Push a tagged image** to a registry and pin it in [`umbrel/docker-compose.yml`](umbrel/docker-compose.yml) (the Umbrel App Store installs from a published image, not from source — ideally pin a `@sha256:` digest).
2. **Self-host now** via a [community app store](https://github.com/getumbrel/umbrel-community-app-store): drop the two files under `<store>/doxd/` and add the store URL in your Umbrel's *App Store → Community App Stores*. No review needed.
3. **Official store** (optional): submit a PR to [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps) and fill in the `submission:` field in the manifest.

### Where to run it (important)

The Electrum connection is made **server-side**, not in your browser. Your browser sends the node address to a Next.js API route, and the *server process* opens the TCP/TLS socket to your node. This has a key consequence for how you deploy:

- **Local Electrum node** (e.g. an Umbrel/Start9 box, or anything on your LAN/VPN) → **run DOXd on a machine that can reach that node directly.** Run it on your own LAN, or on a device joined to the same VPN/tailnet as the node. A cloud-hosted instance (Vercel, etc.) **cannot** reach `*.local` mDNS names or private IPs like `192.168.x.x` / `100.x.x.x` — the connection just times out, because the *server* doing the connecting isn't on your network, even if your browser is.
- **Public Electrum server** → if you want to host DOXd in the cloud, point it at a publicly reachable Fulcrum/ElectrumX endpoint (a public server, or your own node exposed via Tor, a Tailscale Funnel, or a Cloudflare/SSH tunnel). ⚠️ Exposing your own Electrum port to the internet has privacy/security tradeoffs.

In short: the machine running DOXd's backend — not your browser — must be able to reach the node.

## How it works

1. **Address discovery** — If you provide an xpub, DOXd derives addresses across all derivation schemes (BIP44/49/84/86) and queries the node for funded ones.
2. **Transaction graph traversal** — For each funded address, it fetches transaction history and follows outputs forward (and inputs backward) through the configured hop depth.
3. **CIOH clustering** — Addresses that appear as co-inputs in the same transaction are grouped into ownership clusters. Hops within a cluster count as zero effective hops.
4. **CEX matching** — Each address encountered is checked against the loaded CEX databases.
5. **Scoring** — When a CEX link is found, an obscurity score (0–100) is calculated from:
   - Transaction obscurity (20%) — number of inputs/outputs in linking transactions
   - Counterparty analysis (25%) — diversity of addresses in the path
   - Hop distance (15%) — number of effective hops, compounded
   - Value continuity (20%) — how much BTC is preserved across hops
   - Fan-out complexity (15%) — branching factor through the path
   - CEX confidence (5%) — reliability of the CEX address identification

## Risk levels

| Level | Score range | Meaning |
|-------|-----------|---------|
| CRITICAL | < 10 | Definitive link to CEX |
| SEVERE | 10–19 | Very strong link |
| HIGH | 20–29 | Strong link |
| ELEVATED | 30–41 | Moderate link |
| MODERATE | 42–54 | Weak link |
| LOW | 55–69 | Very weak link |
| MINOR | 70–84 | Tenuous link |
| NEGLIGIBLE | 85+ | Minimal or no link |

## Views

- **Dashboard** — Aggregate stats, exposure summary, ownership clusters
- **Sources** — Per-address breakdown with individual CEX links and paths
- **Exchanges** — Analysis grouped by exchange
- **Connections** — Interactive force-directed graph of address relationships
- **History** — Past trace results with JSON export
- **Settings** — Node config, identicons, nicknames, trace depth

## Tech stack

- [Next.js](https://nextjs.org/) 16 with React 19
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) 4
- [shadcn/ui](https://ui.shadcn.com/) components
- [@scure/bip32](https://github.com/paulmillr/scure-bip32) for HD wallet derivation
- [@noble/hashes](https://github.com/paulmillr/noble-hashes) and [@noble/secp256k1](https://github.com/paulmillr/noble-secp256k1) for cryptography
- Custom Electrum protocol client with TCP/TLS support and connection pooling

## Privacy

DOXd is designed with privacy in mind:

- **No server-side storage** — trace results live only in your browser's localStorage
- **Direct node connection** — your queries go straight to the Electrum node you configure, not through any third-party API
- **No telemetry** — no data is sent anywhere except to your chosen node
- **Self-hostable** — run it entirely on your own infrastructure

## License

MIT
