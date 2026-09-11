import React, { useState, useEffect, useRef, useCallback } from "react";
import { html, api, API, getStoredPasskey } from "../lib.js";
import { useApp } from "../context.js";

const TYPE_COLORS = {
  log: "var(--text)",
  info: "var(--info)",
  warn: "var(--warning)",
  error: "var(--error)",
};

const TYPE_BADGES = {
  log: "LOG",
  info: "INFO",
  warn: "WARN",
  error: "ERR",
};

export function LogsPage() {
  const { toast } = useApp();
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef(null);
  const containerRef = useRef(null);

  // Load existing logs
  useEffect(() => {
    api("/logs").then(setLogs).catch(() => {});
  }, []);

  // SSE stream for real-time logs.
  // Uses fetch() so the passkey travels in the x-passkey header instead of the
  // query string (EventSource can't set headers, which leaked it into logs).
  useEffect(() => {
    const controller = new AbortController();
    let aborted = false;
    let retryTimer = null;

    async function stream() {
      const passkey = getStoredPasskey();
      try {
        const res = await fetch(API + "/logs/stream", {
          headers: passkey ? { "x-passkey": passkey } : {},
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error("stream failed");
        setConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith("data: ")) continue;
            try {
              const entry = JSON.parse(line.slice(6));
              setLogs((prev) => {
                const next = [...prev, entry];
                return next.length > 500 ? next.slice(-500) : next;
              });
            } catch {}
          }
        }
      } catch {
        // network/parse error — fall through to reconnect below
      }
      if (!aborted) {
        setConnected(false);
        retryTimer = setTimeout(stream, 2000);
      }
    }

    stream();

    return () => {
      aborted = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  // Detect manual scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 60);
  }, []);

  const handleClear = async () => {
    try {
      await api("/logs", { method: "DELETE" });
      setLogs([]);
      toast("Logs cleared", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const filtered = logs.filter((l) => {
    if (filter !== "all" && l.type !== filter) return false;
    if (search && !l.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {
    all: logs.length,
    log: logs.filter((l) => l.type === "log").length,
    error: logs.filter((l) => l.type === "error").length,
    warn: logs.filter((l) => l.type === "warn").length,
    info: logs.filter((l) => l.type === "info").length,
  };

  const formatTime = (ts) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
        + "." + String(d.getMilliseconds()).padStart(3, "0");
    } catch { return ""; }
  };

  return html`<div style=${{ display: "flex", flexDirection: "column", height: "100%", gap: "12px" }}>

    <!-- Toolbar -->
    <div style=${{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
      <div style=${{ display: "flex", gap: "4px", background: "var(--bg-surface)", borderRadius: "8px", padding: "3px" }}>
        ${["all", "log", "error", "warn", "info"].map(
          (f) => html`<button key=${f} onClick=${() => setFilter(f)}
            style=${{
              padding: "4px 10px", fontSize: "11px", borderRadius: "6px", border: "none", cursor: "pointer",
              background: filter === f ? "var(--accent)" : "transparent",
              color: filter === f ? "#fff" : "var(--text-muted)",
              fontWeight: filter === f ? 600 : 400,
            }}>
            ${f.toUpperCase()}${counts[f] > 0 ? ` (${counts[f]})` : ""}
          </button>`
        )}
      </div>

      <input
        type="text"
        placeholder="Search logs..."
        value=${search}
        onInput=${(e) => setSearch(e.target.value)}
        style=${{
          flex: 1, minWidth: "160px", padding: "6px 10px", fontSize: "12px",
          background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px",
          color: "var(--text)", outline: "none",
        }}
      />

      <div style=${{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style=${{
          width: "8px", height: "8px", borderRadius: "50%",
          background: connected ? "var(--success)" : "var(--error)",
          display: "inline-block",
        }} />
        <span style=${{ fontSize: "11px", color: "var(--text-muted)" }}>
          ${connected ? "Live" : "Disconnected"}
        </span>
      </div>

      <button onClick=${() => setAutoScroll(!autoScroll)}
        style=${{
          padding: "4px 10px", fontSize: "11px", borderRadius: "6px", border: "1px solid var(--border)",
          cursor: "pointer",
          background: autoScroll ? "var(--accent)" : "var(--bg-surface)",
          color: autoScroll ? "#fff" : "var(--text-muted)",
        }}>
        Auto-scroll ${autoScroll ? "ON" : "OFF"}
      </button>

      <button onClick=${handleClear}
        style=${{
          padding: "4px 10px", fontSize: "11px", borderRadius: "6px",
          border: "1px solid var(--border)", cursor: "pointer",
          background: "var(--bg-surface)", color: "var(--error)",
        }}>
        Clear
      </button>
    </div>

    <!-- Log Output -->
    <div ref=${containerRef} onScroll=${handleScroll}
      style=${{
        flex: 1, overflow: "auto", background: "#0a0a0f", borderRadius: "8px",
        border: "1px solid var(--border)", fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: "12px", lineHeight: "1.7", padding: "12px 0",
      }}>
      ${filtered.length === 0 && html`
        <div style=${{ padding: "40px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
          ${logs.length === 0 ? "No logs yet. Console output from your app will appear here." : "No logs match the current filter."}
        </div>
      `}
      ${filtered.map(
        (entry) => html`<div key=${entry.id}
          style=${{
            padding: "1px 14px", display: "flex", gap: "10px", alignItems: "flex-start",
            borderLeft: entry.type === "error" ? "2px solid var(--error)" : entry.type === "warn" ? "2px solid var(--warning)" : "2px solid transparent",
            background: entry.type === "error" ? "rgba(239,68,68,0.04)" : entry.type === "warn" ? "rgba(245,158,11,0.04)" : "transparent",
          }}>
          <span style=${{ color: "var(--text-muted)", fontSize: "10px", minWidth: "80px", paddingTop: "2px", userSelect: "none" }}>
            ${formatTime(entry.timestamp)}
          </span>
          <span style=${{
            fontSize: "9px", fontWeight: 700, minWidth: "32px", textAlign: "center",
            padding: "1px 4px", borderRadius: "3px", letterSpacing: "0.5px", paddingTop: "3px",
            background: entry.type === "error" ? "rgba(239,68,68,0.15)" : entry.type === "warn" ? "rgba(245,158,11,0.15)" : entry.type === "info" ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.06)",
            color: TYPE_COLORS[entry.type] || "var(--text)",
          }}>
            ${TYPE_BADGES[entry.type] || "LOG"}
          </span>
          <span style=${{
            color: TYPE_COLORS[entry.type] || "var(--text)",
            whiteSpace: "pre-wrap", wordBreak: "break-all", flex: 1,
          }}>
            ${entry.message}
          </span>
        </div>`
      )}
      <div ref=${bottomRef} />
    </div>
  </div>`;
}
