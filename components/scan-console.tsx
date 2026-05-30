"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cpu,
  Play,
  Server,
  Loader2,
  Plus,
  X,
  KeyRound,
  Wallet,
  Trash2,
  Zap,
  Search,
  ChevronRight,
  Square,
  Lock,
  Unlock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LookupGroup, TraceResult, WatchEntry } from "@/lib/types";

interface NodeTestResult {
  ok: boolean;
  server?: string;
  protocol?: string;
  satoshiBalance?: { confirmed: number; unconfirmed: number; confirmedBtc: number };
  error?: string;
}

interface ScanConsoleProps {
  nodeAddress: string;
  onNodeAddressChange: (addr: string) => void;
  onNodeStatus: (online: boolean) => void;
  watchlist: WatchEntry[];
  onAddWatch: (values: string[]) => number;
  onRemoveWatch: (id: string) => void;
  onClearWatch: () => void;
  onComplete: (results: TraceResult[]) => void;
}

const DEPTHS = [2, 3, 4, 5, 6];

export function ScanConsole({
  nodeAddress,
  onNodeAddressChange,
  onNodeStatus,
  watchlist,
  onAddWatch,
  onRemoveWatch,
  onClearWatch,
  onComplete,
}: ScanConsoleProps) {
  const [entryInput, setEntryInput] = useState("");
  const [useTls, setUseTls] = useState(false);
  const [depth, setDepth] = useState(4);
  const [running, setRunning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<NodeTestResult | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupGroups, setLookupGroups] = useState<LookupGroup[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // only auto-scroll if user is already near the bottom
  useEffect(() => {
    const container = logEndRef.current?.parentElement;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
    if (atBottom) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // prune selection when entries are removed
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(watchlist.map((w) => w.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [watchlist]);

  // entries to trace = selected, or all if nothing selected
  const targets = useMemo(() => (selected.size ? watchlist.filter((w) => selected.has(w.id)) : watchlist), [watchlist, selected]);

  const canRun = nodeAddress.trim().length > 0 && targets.length > 0 && !running;
  const canTest = nodeAddress.trim().length > 0 && !testing;

  async function handleTest() {
    if (!canTest) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/node/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeAddress: nodeAddress.trim(), tls: useTls }),
      });
      const data: NodeTestResult = await res.json();
      setTestResult(data);
      onNodeStatus(data.ok);
    } catch {
      setTestResult({ ok: false, error: "Network request failed" });
      onNodeStatus(false);
    } finally {
      setTesting(false);
    }
  }

  const canLookup = nodeAddress.trim().length > 0 && targets.length > 0 && !looking && !running;

  async function handleLookup() {
    if (!canLookup) return;
    setLooking(true);
    setLookupGroups(null);
    setLookupError(null);
    try {
      const res = await fetch("/api/address/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeAddress: nodeAddress.trim(),
          entries: targets.map((t) => ({ value: t.value, kind: t.kind })),
          tls: useTls,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setLookupGroups(data.groups as LookupGroup[]);
      } else {
        setLookupError(data.error ?? "Lookup failed");
      }
    } catch {
      setLookupError("Network request failed");
    } finally {
      setLooking(false);
    }
  }

  function handleAdd() {
    // support comma / whitespace / newline separated batch input
    const values = entryInput.split(/[\s,]+/).filter(Boolean);
    if (!values.length) return;
    onAddWatch(values);
    setEntryInput("");
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  // extract all used addresses from lookup results for tracing
  // includes zero-balance addresses — they may have sent funds (outflows)
  const traceSources = useMemo(() => {
    if (!lookupGroups) return [];
    return lookupGroups.flatMap((g) =>
      g.results
        .filter((r) => !r.error)
        .map((r) => ({
          address: r.address,
          derivationPath: r.path ?? "direct",
          balanceBtc: r.confirmedBtc,
          txCount: 0,
        })),
    );
  }, [lookupGroups]);

  const canTrace = nodeAddress.trim().length > 0 && traceSources.length > 0 && !running && !looking;

  async function handleRun() {
    if (!canTrace) return;
    setRunning(true);
    setLog([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeAddress: nodeAddress.trim(),
          sources: traceSources,
          depth,
          tls: useTls,
        }),
        signal: controller.signal,
      });

      if (!res.body) {
        setLog((prev) => [...prev, "> error: no response stream"]);
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";

        for (const part of parts) {
          const eventMatch = part.match(/^event:\s*(.+)$/m);
          const dataMatch = part.match(/^data:\s*(.+)$/m);
          if (!eventMatch || !dataMatch) continue;

          const event = eventMatch[1];
          const data = JSON.parse(dataMatch[1]);

          if (event === "log") {
            setLog((prev) => [...prev, data.message]);
          } else if (event === "done" && data.result) {
            onComplete([data.result as TraceResult]);
          } else if (event === "error") {
            setLog((prev) => [...prev, `> ERROR: ${data.message}`]);
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setLog((prev) => [...prev, "> trace aborted"]);
      } else {
        setLog((prev) => [...prev, `> ERROR: ${err instanceof Error ? err.message : "trace failed"}`]);
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }

  return (
    <section className="box-glow rounded-sm border border-border bg-card/70 p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <Cpu className="size-4 text-primary" />
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-primary">scan console</h2>
        <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground">no data leaves this terminal</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        {/* node address */}
        <div className="space-y-1.5">
          <Label htmlFor="node" className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
            <Server className="size-3" /> bitcoin node (fulcrum / electrumx)
          </Label>
          <div className="flex gap-2 items-center">
            <Input
              id="node"
              value={nodeAddress}
              onChange={(e) => {
                onNodeAddressChange(e.target.value);
                setTestResult(null);
                onNodeStatus(false);
              }}
              placeholder="umbrel.local:50002  /  192.168.1.42:50002"
              className="border-input bg-background font-mono text-sm text-primary placeholder:text-muted-foreground/60 focus-visible:ring-primary"
              spellCheck={false}
              autoComplete="off"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setUseTls((prev) => !prev);
                setTestResult(null);
                onNodeStatus(false);
              }}
              className={`shrink-0 gap-1.5 font-bold uppercase tracking-widest ${
                useTls
                  ? "border-primary/60 bg-primary/15 text-primary hover:bg-primary/20"
                  : "border-border bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              }`}
              aria-pressed={useTls}
            >
              {useTls ? <Lock className="size-4" /> : <Unlock className="size-4" />}
              tls
            </Button>
            <Button
              onClick={handleTest}
              disabled={!canTest}
              variant="outline"
              className="shrink-0 gap-1.5 border-primary/50 bg-transparent font-bold uppercase tracking-widest text-primary hover:bg-primary/10"
            >
              {testing ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
              test
            </Button>
          </div>
          {testResult && (
            <div
              className={`rounded-sm border px-3 py-2 text-xs font-mono ${
                testResult.ok
                  ? "border-green-500/40 bg-green-500/5 text-green-400"
                  : "border-destructive/40 bg-destructive/5 text-destructive"
              }`}
            >
              {testResult.ok ? (
                <>
                  <span className="font-bold">CONNECTED</span>
                  {" — "}
                  {testResult.server} (protocol {testResult.protocol})
                  {testResult.satoshiBalance && (
                    <span className="block mt-1 text-muted-foreground">
                      liveness: satoshi&apos;s wallet (1A1zP1…DivfNa) = {testResult.satoshiBalance.confirmedBtc.toFixed(8)} BTC
                      {testResult.satoshiBalance.unconfirmed > 0 && (
                        <> + {(testResult.satoshiBalance.unconfirmed / 1e8).toFixed(8)} unconfirmed</>
                      )}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="font-bold">FAILED</span>
                  {" — "}
                  {testResult.error}
                </>
              )}
            </div>
          )}
        </div>

        {/* add address / xpub */}
        <div className="space-y-1.5">
          <Label htmlFor="entry" className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
            <KeyRound className="size-3" /> add xpub / address
            <span className="text-muted-foreground/50">(paste multiple, comma or space separated)</span>
          </Label>
          <div className="flex gap-2">
            <Input
              id="entry"
              value={entryInput}
              onChange={(e) => setEntryInput(e.target.value)}
              placeholder="xpub6CUGRUo…  bc1q…  3FZbgi…"
              className="border-input bg-background font-mono text-sm text-primary placeholder:text-muted-foreground/60 focus-visible:ring-primary"
              spellCheck={false}
              autoComplete="off"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button
              onClick={handleAdd}
              variant="outline"
              className="shrink-0 gap-1.5 border-primary/50 bg-transparent font-bold uppercase tracking-widest text-primary hover:bg-primary/10"
            >
              <Plus className="size-4" /> add
            </Button>
          </div>
        </div>
      </div>

      {/* watchlist */}
      <div className="mt-4 rounded-sm border border-border bg-background/60 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
          <span>watchlist</span>
          <span className="rounded-sm bg-secondary px-1.5 text-[10px] text-secondary-foreground">{watchlist.length}</span>
          {watchlist.length > 0 && (
            <>
              <button
                onClick={() => setSelected((prev) => (prev.size === watchlist.length ? new Set() : new Set(watchlist.map((w) => w.id))))}
                className="ml-2 text-primary hover:text-glow"
              >
                {selected.size === watchlist.length ? "deselect all" : "select all"}
              </button>
              <button
                onClick={() => {
                  onClearWatch();
                  setSelected(new Set());
                }}
                className="ml-auto flex items-center gap-1 text-destructive hover:underline"
              >
                <Trash2 className="size-3" /> clear
              </button>
            </>
          )}
        </div>

        {watchlist.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground/70">
            {"// no keys saved — add an xpub or address above to build your watchlist"}
          </p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {watchlist.map((w) => {
              const active = selected.size === 0 || selected.has(w.id);
              const Icon = w.kind === "xpub" ? KeyRound : Wallet;
              return (
                <li
                  key={w.id}
                  className={`group flex items-center gap-2 rounded-sm border px-2 py-1.5 transition-colors ${
                    active ? "border-primary/60 bg-primary/5" : "border-border bg-card/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(w.id)}
                    onChange={() => toggle(w.id)}
                    className="size-3.5 shrink-0 accent-primary"
                    aria-label={`select ${w.value}`}
                  />
                  <Icon className="size-3.5 shrink-0 text-accent" />
                  <span
                    className={`rounded-sm px-1 text-[9px] uppercase tracking-widest ${
                      w.kind === "xpub" ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary"
                    }`}
                  >
                    {w.kind}
                  </span>
                  <code className="flex-1 truncate font-mono text-xs text-foreground">{w.value}</code>
                  <button
                    onClick={() => onRemoveWatch(w.id)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`remove ${w.value}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* run row */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="depth" className="text-[11px] uppercase tracking-widest text-muted-foreground">
            depth
          </Label>
          <select
            id="depth"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="h-9 rounded-sm border border-input bg-background px-2 font-mono text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {d} hops
              </option>
            ))}
          </select>
        </div>

        <Button
          onClick={handleLookup}
          disabled={!canLookup}
          className="h-9 gap-1.5 bg-primary font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
        >
          {looking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          {looking ? "looking up" : `lookup${targets.length > 1 ? ` · ${targets.length}` : ""}`}
        </Button>

        {running ? (
          <Button
            onClick={handleStop}
            variant="outline"
            className="h-9 gap-1.5 border-destructive/50 bg-transparent font-bold uppercase tracking-widest text-destructive hover:bg-destructive/10"
          >
            <Square className="size-4" />
            stop
          </Button>
        ) : (
          <Button
            onClick={handleRun}
            disabled={!canTrace}
            variant="outline"
            title={!traceSources.length ? "run a lookup first to discover funded addresses" : undefined}
            className="h-9 gap-1.5 border-primary/50 bg-transparent font-bold uppercase tracking-widest text-primary hover:bg-primary/10"
          >
            <Play className="size-4" />
            {traceSources.length ? `trace${traceSources.length > 1 ? ` · ${traceSources.length} addr` : ""}` : "trace"}
          </Button>
        )}

        <span className="text-[11px] text-muted-foreground">
          {watchlist.length === 0 ? "add addresses to get started" : selected.size ? `${selected.size} selected` : "all entries targeted"}
        </span>
      </div>

      {/* lookup results */}
      {lookupError && (
        <div className="mt-4 rounded-sm border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs font-mono text-destructive">
          <span className="font-bold">LOOKUP FAILED</span> — {lookupError}
        </div>
      )}
      {lookupGroups && lookupGroups.length > 0 && (
        <div className="mt-4 space-y-3">
          {lookupGroups.map((group) => {
            const funded = group.results.filter((r) => !r.error && r.confirmed > 0);
            const totalBtc = group.results.reduce((sum, r) => sum + r.confirmedBtc, 0);
            const totalUnconf = group.results.reduce((sum, r) => sum + r.unconfirmed, 0);
            const isXpub = group.kind === "xpub";
            const isOpen = !isXpub || expanded.has(group.input);

            return (
              <div key={group.input} className="rounded-sm border border-border bg-background/60 overflow-hidden">
                {/* group header */}
                <button
                  type="button"
                  onClick={() => {
                    if (!isXpub) return;
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.input)) next.delete(group.input);
                      else next.add(group.input);
                      return next;
                    });
                  }}
                  className={`flex w-full flex-wrap items-center gap-2 px-3 py-2 text-[11px] text-left ${
                    isOpen && group.results.length > 0 ? "border-b border-border" : ""
                  } ${isXpub ? "bg-card/60 hover:bg-card/80 cursor-pointer" : "bg-card/60 cursor-default"}`}
                >
                  {isXpub && (
                    <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  )}
                  <span
                    className={`rounded-sm px-1.5 py-0.5 uppercase tracking-widest ${
                      isXpub ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary"
                    }`}
                  >
                    {group.kind}
                  </span>
                  <code className="truncate font-mono text-foreground">
                    {group.input.slice(0, 24)}…{group.input.slice(-8)}
                  </code>
                  {isXpub && (
                    <span className="hidden sm:inline text-muted-foreground">
                      {group.results.length} used · {funded.length} funded
                    </span>
                  )}
                  <div className="ml-auto shrink-0 text-right font-mono">
                    <span className="text-primary text-glow font-bold">{totalBtc.toFixed(8)}</span>
                    <span className="text-muted-foreground"> BTC</span>
                    {totalUnconf !== 0 && (
                      <span className="ml-2 text-amber-400">
                        {totalUnconf > 0 ? "+" : ""}
                        {(totalUnconf / 1e8).toFixed(8)} unconf
                      </span>
                    )}
                  </div>
                </button>
                {/* address rows — collapsible for xpubs */}
                {isOpen && group.results.length > 0 && (
                  <div className="divide-y divide-border">
                    {group.results.map((r) => (
                      <div
                        key={r.address}
                        className={`flex items-center gap-3 px-3 py-2 text-xs font-mono ${
                          r.confirmedBtc === 0 && !r.error ? "text-muted-foreground/50" : ""
                        }`}
                      >
                        {r.scheme && <span className="shrink-0 w-10 text-[10px] text-accent/70">{r.scheme.replace("BIP", "")}</span>}
                        {r.path && (
                          <span className="shrink-0 w-14 text-muted-foreground">
                            {r.path}
                            {r.change ? " Δ" : ""}
                          </span>
                        )}
                        <code className="flex-1 truncate text-foreground">{r.address}</code>
                        {r.error ? (
                          <span className="text-destructive">{r.error}</span>
                        ) : (
                          <div className="shrink-0 text-right">
                            <span className={r.confirmedBtc > 0 ? "text-primary text-glow" : "text-muted-foreground/50"}>
                              {r.confirmedBtc.toFixed(8)}
                            </span>
                            <span className="text-muted-foreground"> BTC</span>
                            {r.unconfirmed !== 0 && (
                              <span className="ml-2 text-amber-400">
                                {r.unconfirmed > 0 ? "+" : ""}
                                {(r.unconfirmed / 1e8).toFixed(8)} unconf
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {/* grand total across all groups */}
          {lookupGroups.length > 1 && (
            <div className="flex items-center gap-3 rounded-sm border border-primary/40 bg-primary/5 px-3 py-3 text-xs font-mono">
              <span className="flex-1 uppercase tracking-widest text-primary">grand total</span>
              <div className="shrink-0 text-right">
                <span className="text-primary text-glow font-bold text-sm">
                  {lookupGroups.reduce((sum, g) => sum + g.results.reduce((s, r) => s + r.confirmedBtc, 0), 0).toFixed(8)}
                </span>
                <span className="text-muted-foreground"> BTC</span>
              </div>
            </div>
          )}
        </div>
      )}

      {(running || log.length > 0) && (
        <div className="relative mt-4 max-h-80 overflow-y-auto rounded-sm border border-border bg-background/80 p-3 text-xs leading-relaxed">
          {running && (
            <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-primary/10 to-transparent scan-sweep" />
          )}
          {log.map((line, i) => (
            <LogLine key={i} line={line} />
          ))}
          {running && <span className="text-primary caret">█</span>}
          <div ref={logEndRef} />
        </div>
      )}
    </section>
  );
}

// Bitcoin address pattern: 1/3/bc1 followed by alphanum
const ADDR_RE = /\b((?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62})/g;

function LogLine({ line }: { line: string }) {
  const cls = line.includes("CEX FOUND")
    ? "text-destructive font-bold"
    : line.includes("possible CEX")
      ? "text-accent font-bold"
      : line.includes("ERROR")
        ? "text-destructive"
        : line.startsWith("$")
          ? "text-accent"
          : line.includes("COMPLETE")
            ? "text-primary text-glow"
            : line.startsWith("    ")
              ? "text-muted-foreground/70"
              : "text-muted-foreground";

  // split line into text and clickable address spans
  const parts: (string | { addr: string })[] = [];
  let lastIdx = 0;
  for (const m of line.matchAll(ADDR_RE)) {
    if (m.index! > lastIdx) parts.push(line.slice(lastIdx, m.index!));
    parts.push({ addr: m[1] });
    lastIdx = m.index! + m[0].length;
  }
  if (lastIdx < line.length) parts.push(line.slice(lastIdx));

  if (parts.length <= 1) {
    return <div className={cls}>{line}</div>;
  }

  return (
    <div className={cls}>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <span
            key={i}
            className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-primary"
            title="click to copy"
            onClick={() => navigator.clipboard.writeText(p.addr)}
          >
            {p.addr}
          </span>
        ),
      )}
    </div>
  );
}
