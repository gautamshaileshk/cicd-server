import React, { useState, useEffect, useCallback } from "react";
import { LuSparkles, LuCheck, LuChevronDown, LuChevronRight, LuKey } from "react-icons/lu";
import { html, api } from "../lib.js";
import { useApp } from "../context.js";

const EXAMPLES = [
  "A blog with posts (title, body, author) and full CRUD",
  "A todo app: users and tasks linked to a user, with create/read/update/delete",
  "An e-commerce backend: products, categories, and orders",
];

export function AiBuilderPage() {
  const { status, toast, refresh } = useApp();

  const [config, setConfig] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedTab, setSelectedTab] = useState(null); // provider id currently viewed
  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [plan, setPlan] = useState(null);
  const [applying, setApplying] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoadError(null);
    try {
      const c = await api("/ai/config");
      setConfig(c);
      setSelectedTab((cur) => cur || c.provider);
    } catch (err) {
      setLoadError(err.message);
      toast(err.message, "error");
    }
  }, [toast]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const activeProvider = config?.provider;
  const providerById = (id) => (config?.providers || []).find((p) => p.id === id);
  const activeConfigured = !!providerById(activeProvider)?.configured;
  const sel = providerById(selectedTab);
  const showKeyForm = sel && (!sel.configured || editingKey);

  function selectTab(id) {
    setSelectedTab(id);
    setEditingKey(false);
    setKeyInput("");
  }

  async function saveKey(providerId) {
    if (!keyInput.trim()) return;
    setSavingKey(true);
    try {
      const r = await api("/ai/key", { method: "POST", body: { provider: providerId, key: keyInput.trim() } });
      toast(r.message, "success");
      setKeyInput("");
      setEditingKey(false);
      await loadConfig();
      refresh().catch(() => {});
    } catch (err) {
      toast(err.message, "error");
    }
    setSavingKey(false);
  }

  async function switchTo(providerId) {
    try {
      const r = await api("/ai/provider", { method: "POST", body: { provider: providerId } });
      toast(r.message, "success");
      await loadConfig();
      refresh().catch(() => {});
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function generate() {
    if (!prompt.trim()) { toast("Describe what you want to build", "error"); return; }
    setLoading(true);
    setPreview(null);
    setPlan(null);
    try {
      const r = await api("/ai/plan", { method: "POST", body: { prompt: prompt.trim() } });
      setPreview(r.preview);
      setPlan(r.plan);
    } catch (err) {
      toast(err.message, "error");
    }
    setLoading(false);
  }

  async function apply() {
    if (!plan) return;
    setApplying(true);
    try {
      const r = await api("/ai/apply", { method: "POST", body: { plan } });
      toast(r.message, "success");
      if (r.skipped && r.skipped.length) toast(`Skipped existing: ${r.skipped.join(", ")}`, "info");
      setPreview(null);
      setPlan(null);
      setPrompt("");
      refresh().catch(() => {});
    } catch (err) {
      toast(err.message, "error");
    }
    setApplying(false);
  }

  if (!config) {
    if (loadError) {
      return html`<div>
        <div className="card-title mb-1">AI Builder</div>
        <div className="card" style=${{ maxWidth: "560px", borderColor: "rgba(239,68,68,0.35)" }}>
          <div style=${{ fontWeight: 600, marginBottom: "6px" }}>Couldn't load AI settings</div>
          <div className="text-sm text-muted mb-4">${loadError}</div>
          <div className="text-sm text-muted mb-4">
            If you just updated 4bnode, restart the dev server — <span style=${{ fontFamily: "monospace" }}>npm run dev</span>
            does not hot-reload the <span style=${{ fontFamily: "monospace" }}>.4bnode/</span> dashboard.
          </div>
          <button className="btn btn-primary" onClick=${loadConfig}>Retry</button>
        </div>
      </div>`;
    }
    return html`<div className="text-muted" style=${{ padding: "16px" }}>Loading…</div>`;
  }

  function statusChip(p) {
    if (p.configured && p.id === activeProvider)
      return html`<span className="badge badge-success" style=${{ fontSize: "9px", marginLeft: "6px" }}>Active</span>`;
    if (p.configured)
      return html`<span className="badge" style=${{ fontSize: "9px", marginLeft: "6px" }}>Connected</span>`;
    return html`<span className="badge" style=${{ fontSize: "9px", marginLeft: "6px", opacity: 0.6 }}>No key</span>`;
  }

  return html`<div>
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="card-title">AI Builder</div>
        <div className="card-subtitle">Describe your backend — review the plan — generate</div>
      </div>
    </div>

    <div className="card mb-4" style=${{ padding: 0, overflow: "hidden" }}>
      <div className="api-tester-tabs">
        ${config.providers.map((p) => html`<button key=${p.id}
          className=${`api-tester-tab${selectedTab === p.id ? " active" : ""}`}
          onClick=${() => selectTab(p.id)}>
          ${p.label}${statusChip(p)}
        </button>`)}
      </div>

      ${sel && html`<div style=${{ padding: "16px" }}>
        ${showKeyForm
          ? html`<div>
              <div className="flex items-center gap-3 mb-3">
                <${LuKey} size=${16} color="var(--accent)" />
                <div className="text-sm text-muted">
                  ${editingKey ? "Replace" : "Add"} the ${sel.label} API key — stored in your .env
                </div>
              </div>
              <div className="form-group">
                <input className="form-input" type="password" value=${keyInput}
                  onInput=${(e) => setKeyInput(e.target.value)} placeholder=${sel.keyPlaceholder}
                  style=${{ maxWidth: "420px" }} />
              </div>
              <div style=${{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button className="btn btn-primary" onClick=${() => saveKey(sel.id)} disabled=${savingKey || !keyInput.trim()}>
                  ${savingKey ? html`<span className="spinner" />` : html`<${LuCheck} size=${16} />`}
                  ${savingKey ? "Saving..." : "Save key & use"}
                </button>
                ${editingKey && html`<button className="btn" onClick=${() => { setEditingKey(false); setKeyInput(""); }}>Cancel</button>`}
              </div>
              <div className="text-sm text-muted mt-4">Get a key at <span style=${{ color: "var(--accent)" }}>${sel.keysUrl}</span>.</div>
            </div>`
          : html`<div className="flex items-center gap-3" style=${{ flexWrap: "wrap" }}>
              <${LuCheck} size=${18} color="var(--success)" />
              <div style=${{ flex: 1, minWidth: "180px" }}>
                <div style=${{ fontWeight: 600 }}>
                  ${sel.id === activeProvider ? "In use" : "Connected"}
                </div>
                <div className="text-sm text-muted">
                  ${sel.id === activeProvider
                    ? html`model <span style=${{ fontFamily: "monospace" }}>${config.model}</span>`
                    : "Not the active provider"}
                </div>
              </div>
              ${sel.id !== activeProvider &&
              html`<button className="btn btn-primary" onClick=${() => switchTo(sel.id)}>Use this provider</button>`}
              <button className="btn" onClick=${() => { setEditingKey(true); setKeyInput(""); }}>Replace key</button>
            </div>`}
      </div>`}
    </div>

    ${!activeConfigured
      ? html`<div className="card text-sm text-muted">Add an API key above to start generating.</div>`
      : html`<div>
        ${!status?.mongoConfigured &&
        html`<div className="card mb-4 text-sm" style=${{ borderColor: "rgba(245,158,11,0.3)" }}>
          Configure MongoDB first — models and routes need a database to run.
        </div>`}

        <div className="card mb-4">
          <textarea className="form-input" rows=${3} value=${prompt}
            onInput=${(e) => setPrompt(e.target.value)}
            placeholder="e.g. A blog with posts and comments, authored by users, with full CRUD"
            style=${{ resize: "vertical", fontFamily: "inherit" }} />
          <div style=${{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "10px 0" }}>
            ${EXAMPLES.map((ex) => html`<button key=${ex} className="badge"
              onClick=${() => setPrompt(ex)}
              style=${{ cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-secondary)", fontWeight: 400 }}>${ex}</button>`)}
          </div>
          <button className="btn btn-primary" onClick=${generate} disabled=${loading || !prompt.trim()}>
            ${loading ? html`<span className="spinner" />` : html`<${LuSparkles} size=${16} />`}
            ${loading ? "Designing..." : "Generate plan"}
          </button>
        </div>

        ${preview &&
        html`<div className="card">
          <div className="flex items-center justify-between mb-2">
            <div className="card-title">Plan</div>
            <button className="btn btn-primary" onClick=${apply} disabled=${applying}>
              ${applying ? html`<span className="spinner" />` : html`<${LuCheck} size=${16} />`}
              ${applying ? "Generating..." : "Generate files"}
            </button>
          </div>
          ${preview.summary && html`<div className="text-sm text-muted mb-4">${preview.summary}</div>`}

          ${preview.models.length > 0 &&
          html`<div className="mb-4">
            <div style=${{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: "8px" }}>
              Models (${preview.models.length})
            </div>
            ${preview.models.map((m) => html`<${CodeBlock} key=${m.name}
              title=${`src/models/${m.name}.js`} subtitle=${m.fields.map((f) => f.name).join(", ")} code=${m.code} />`)}
          </div>`}

          ${preview.routes.length > 0 &&
          html`<div>
            <div style=${{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: "8px" }}>
              Routes (${preview.routes.length})
            </div>
            ${preview.routes.map((r) => html`<${CodeBlock} key=${r.name}
              title=${`/api/${r.name}`} subtitle=${`${r.model} · ${r.operations.join(", ")}`} code=${r.code} />`)}
          </div>`}
        </div>`}
      </div>`}
  </div>`;
}

function CodeBlock({ title, subtitle, code }) {
  const [open, setOpen] = useState(false);
  return html`<div style=${{ border: "1px solid var(--border)", borderRadius: "8px", marginBottom: "8px", overflow: "hidden" }}>
    <div onClick=${() => setOpen((o) => !o)}
      style=${{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", cursor: "pointer" }}>
      ${open ? html`<${LuChevronDown} size=${14} />` : html`<${LuChevronRight} size=${14} />`}
      <div style=${{ flex: 1, minWidth: 0 }}>
        <div style=${{ fontWeight: 600, fontSize: "13px" }}>${title}</div>
        <div className="text-sm text-muted" style=${{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${subtitle}</div>
      </div>
    </div>
    ${open && html`<pre style=${{ margin: 0, padding: "12px", background: "var(--bg)", borderTop: "1px solid var(--border)", overflowX: "auto", fontSize: "12px", lineHeight: 1.5 }}>${code}</pre>`}
  </div>`;
}
