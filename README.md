# BTC Tracer

A Bitcoin chain-analysis tool that traces whether your addresses can be linked back to centralized exchanges (CEXs). It follows transaction flows on-chain, detects same-entity address clusters, and scores how exposed each address is — all through a retro terminal-style interface.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## What it does

BTC Tracer connects to an Electrum-compatible node and walks the transaction graph outward from your addresses (or xpub-derived addresses), looking for known CEX deposit/withdrawal addresses. It then calculates an **obscurity score** based on hop distance, value continuity, fan-out complexity, and counterparty analysis.

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
git clone https://github.com/your-username/btc-tracer.git
cd btc-tracer
npm install
```

### CEX address databases

The tracer matches on-chain addresses against known exchange addresses stored as CSV files in `data/cex_addresses/`. These are **not included in the repo** — you bring your own.

An example file (`example_addresses.csv`) is included to show the expected format. To add your own:

1. Place CSV files in `data/cex_addresses/` with the naming pattern `<exchange>_addresses.csv`
2. The exchange name is derived from the filename — `coinbase_addresses.csv` becomes **Coinbase**, `kraken_addresses.csv` becomes **Kraken**, etc.
3. Restart the app — files are detected and loaded automatically on the first trace

**Format:** one address per line, or CSV with the address as the first column. Lines starting with `#` and common headers are skipped.

```csv
# coinbase_addresses.csv
1FzWLkAahHooV3kzTgyx6qsXoRDrBsrXU1
1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG
```

The tracer works without any CEX data — traces will still run and map transaction flows, they just won't identify exchange endpoints. The more comprehensive your address databases, the better the results.

### Running

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000). Enter your Electrum node address, paste an xpub or Bitcoin address, and start a trace.

## How it works

1. **Address discovery** — If you provide an xpub, BTC Tracer derives addresses across all derivation schemes (BIP44/49/84/86) and queries the node for funded ones.
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

BTC Tracer is designed with privacy in mind:

- **No server-side storage** — trace results live only in your browser's localStorage
- **Direct node connection** — your queries go straight to the Electrum node you configure, not through any third-party API
- **No telemetry** — no data is sent anywhere except to your chosen node
- **Self-hostable** — run it entirely on your own infrastructure

## License

MIT
