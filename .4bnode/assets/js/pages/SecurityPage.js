import React, { useState, useEffect } from "react";
import { LuCheck, LuGauge } from "react-icons/lu";
import { html, api } from "../lib.js";
import { useApp } from "../context.js";

export function SecurityPage() {
  const { toast } = useApp();

  const [rl, setRl] = useState(null);
  const [savingRl, setSavingRl] = useState(false);

  useEffect(() => {
    api("/security/rate-limit")
      .then((r) => setRl({ windowMinutes: r.windowMinutes, max: r.max }))
      .catch(() => setRl({ windowMinutes: 15, max: 500 }));
  }, []);

  async function saveRl() {
    setSavingRl(true);
    try {
      await api("/security/rate-limit", {
        method: "POST",
        body: { windowMinutes: Number(rl.windowMinutes), max: Number(rl.max) },
      });
      toast("Rate limit saved — restart the app to apply.", "success");
    } catch (err) {
      toast(err.message, "error");
    }
    setSavingRl(false);
  }

  return html`<div>
    <div className="mb-4">
      <div className="card-title">Security</div>
      <div className="card-subtitle">
        <b>Security is built in</b> — Helmet, rate limiting, CORS, error handling, RBAC, and Zod
        validation ship with every app. Validation is generated per route from each route's own
        fields when you create it. Adjust rate limiting below.
      </div>
    </div>

    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <${LuGauge} size=${16} />
        <div className="card-title" style=${{ margin: 0 }}>Rate limiting</div>
      </div>
      <div className="card-subtitle mb-4">
        Throttle requests per IP. Applies to your API routes (the <span style=${{ fontFamily: "monospace" }}>/_dev</span> dashboard is exempt).
      </div>
      ${rl === null
        ? html`<div className="text-muted text-sm">Loading…</div>`
        : html`<div style=${{ display: "flex", gap: "16px", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="form-group" style=${{ marginBottom: 0 }}>
              <label className="form-label">Window (minutes)</label>
              <input className="form-input" type="number" min="1" value=${rl.windowMinutes}
                onInput=${(e) => setRl((s) => ({ ...s, windowMinutes: e.target.value }))}
                style=${{ width: "140px" }} />
            </div>
            <div className="form-group" style=${{ marginBottom: 0 }}>
              <label className="form-label">Max requests / window</label>
              <input className="form-input" type="number" min="1" value=${rl.max}
                onInput=${(e) => setRl((s) => ({ ...s, max: e.target.value }))}
                style=${{ width: "180px" }} />
            </div>
            <button className="btn btn-primary" onClick=${saveRl} disabled=${savingRl}>
              ${savingRl ? html`<span className="spinner" />` : html`<${LuCheck} size=${15} />`} Save
            </button>
          </div>
          <div className="text-sm text-muted" style=${{ marginTop: "10px" }}>
            Restart the app for changes to take effect (values are read from <span style=${{ fontFamily: "monospace" }}>.env</span> at startup).
          </div>`}
    </div>
  </div>`;
}
