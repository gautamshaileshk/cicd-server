import React, { useState, useEffect, useCallback } from "react";
import { LuFileText, LuCheck, LuRefreshCw, LuExternalLink } from "react-icons/lu";
import { html, api } from "../lib.js";
import { useApp } from "../context.js";

export function DocsPage() {
  const { toast, refresh } = useApp();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const load = useCallback(async () => {
    // Docs setup/regenerate writes src/docs.js → nodemon restart. Retry across the
    // restart window so the re-fetch doesn't surface as a "NetworkError".
    let lastErr;
    for (let i = 0; i < 8; i++) {
      try { setInfo(await api("/docs")); return; }
      catch (err) { lastErr = err; await new Promise((r) => setTimeout(r, 500)); }
    }
    if (lastErr) toast(lastErr.message, "error");
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const docsUrl = (() => {
    const port = window.location.port || "3000";
    return window.location.protocol + "//" + window.location.hostname + ":" + port + "/docs";
  })();

  async function setup() {
    if (pw && pw.length < 6) {
      toast("Password must be at least 6 characters (or leave blank for public docs)", "error");
      return;
    }
    setBusy(true);
    try {
      // Set the password first (writes docs-auth.json), then create the docs route —
      // so /docs is protected from the moment it goes live.
      if (pw) await api("/docs/password", { method: "POST", body: { password: pw } });
      await api("/docs/setup", { method: "POST" });
      toast(pw ? "API docs set up and password-protected." : "API docs set up at /docs.", "success");
      setPw("");
      await load();
      refresh().catch(() => {});
    } catch (err) { toast(err.message, "error"); }
    setBusy(false);
  }

  async function regenerate() {
    setBusy(true);
    try {
      const r = await api("/docs/regenerate", { method: "POST" });
      toast(r.message, "success");
      await load();
    } catch (err) { toast(err.message, "error"); }
    setBusy(false);
  }

  async function setPassword() {
    if (pw.length < 6) { toast("Password must be at least 6 characters", "error"); return; }
    setPwBusy(true);
    try {
      const r = await api("/docs/password", { method: "POST", body: { password: pw } });
      toast(r.message, "success");
      setPw("");
      await load();
    } catch (err) { toast(err.message, "error"); }
    setPwBusy(false);
  }

  if (!info) return html`<div className="text-muted" style=${{ padding: "16px" }}>Loading…</div>`;

  return html`<div>
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="card-title">API Documentation</div>
        <div className="card-subtitle">Interactive API docs generated from your routes and models</div>
      </div>
    </div>

    ${!info.configured
      ? html`<div className="card" style=${{ maxWidth: "560px" }}>
          <div className="flex items-center gap-3 mb-4">
            <${LuFileText} size=${20} color="var(--accent)" />
            <div>
              <div style=${{ fontWeight: 600 }}>Set up API docs</div>
              <div className="text-sm text-muted">Generates a spec from your ${info.endpointCount} endpoint${info.endpointCount === 1 ? "" : "s"} and serves an interactive docs page at <span style=${{ fontFamily: "monospace" }}>/docs</span>.</div>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Docs password</label>
            <input className="form-input" type="password" value=${pw}
              placeholder="Protect /docs (min 6 chars) — leave blank for public docs"
              onInput=${(e) => setPw(e.target.value)}
              onKeyDown=${(e) => { if (e.key === "Enter") setup(); }} />
          </div>
          <button className="btn btn-primary" onClick=${setup} disabled=${busy}>
            ${busy ? html`<span className="spinner" />` : html`<${LuCheck} size=${16} />`}
            ${busy ? "Setting up..." : "Set up API docs"}
          </button>
        </div>`
      : html`<div>
          <div className="card mb-4">
            <div className="flex items-center gap-3" style=${{ flexWrap: "wrap" }}>
              <${LuFileText} size=${20} color="var(--success)" />
              <div style=${{ flex: 1, minWidth: "180px" }}>
                <div style=${{ fontWeight: 600 }}>Docs are live</div>
                <div className="text-sm text-muted">${info.endpointCount} endpoint${info.endpointCount === 1 ? "" : "s"} documented · spec at <span style=${{ fontFamily: "monospace" }}>src/openapi.json</span></div>
              </div>
              <a className="btn" href=${docsUrl} target="_blank" rel="noreferrer" style=${{ textDecoration: "none" }}>
                <${LuExternalLink} size=${14} /> Open /docs
              </a>
              <button className="btn btn-primary" onClick=${regenerate} disabled=${busy}>
                ${busy ? html`<span className="spinner" />` : html`<${LuRefreshCw} size=${14} />`}
                Regenerate
              </button>
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-title mb-1">Docs access</div>
            <div className="card-subtitle mb-4">
              By default <span style=${{ fontFamily: "monospace" }}>/docs</span> is public — anyone who can reach the app can read it.
              Set a password to require a login before the docs are shown.
            </div>
            ${info.passwordProtected
              ? html`<div className="flex items-center gap-3" style=${{ flexWrap: "wrap" }}>
                  <span className="badge badge-success">🔒 Password protected</span>
                  <div style=${{ display: "flex", gap: "8px", marginLeft: "auto", flexWrap: "wrap" }}>
                    <input className="form-input" type="password" placeholder="New password" value=${pw}
                      onInput=${(e) => setPw(e.target.value)} style=${{ width: "200px" }} />
                    <button className="btn btn-sm btn-primary" onClick=${setPassword} disabled=${pwBusy || pw.length < 6}>Change</button>
                  </div>
                </div>`
              : html`<div style=${{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <input className="form-input" type="password" placeholder="Password (min 6 chars)" value=${pw}
                    onInput=${(e) => setPw(e.target.value)}
                    onKeyDown=${(e) => { if (e.key === "Enter") setPassword(); }}
                    style=${{ flex: 1, minWidth: "220px" }} />
                  <button className="btn btn-primary" onClick=${setPassword} disabled=${pwBusy || pw.length < 6}>
                    ${pwBusy ? html`<span className="spinner" />` : null} Set password
                  </button>
                </div>`}
          </div>
          <div className="card text-sm text-muted">
            The spec stays in sync automatically — it regenerates whenever you add or change routes and models. Use Regenerate to force a refresh.
          </div>
        </div>`}
  </div>`;
}
