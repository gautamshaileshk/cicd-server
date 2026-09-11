import React, { useState, useEffect } from "react";
import { LuWifi, LuRefreshCw } from "react-icons/lu";
import { html, api, copyToClipboard } from "../lib.js";
import { useApp } from "../context.js";

const STATUS_BADGE = {
  advertising: { cls: "badge-success", label: "Advertising" },
  idle: { cls: "badge-muted", label: "Idle" },
  error: { cls: "badge-error", label: "Error" },
  unsupported: { cls: "badge-warning", label: "Not installed" },
};

export function DiscoveryPage() {
  const { toast } = useApp();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("http");
  const [enabled, setEnabled] = useState(true);

  const [browseType, setBrowseType] = useState("http");
  const [services, setServices] = useState(null);
  const [browsing, setBrowsing] = useState(false);

  async function loadInfo() {
    setLoading(true);
    try {
      const r = await api("/discovery");
      setInfo(r);
      setName((r.config && r.config.name) || "");
      setType((r.config && r.config.type) || "http");
      setEnabled(r.enabled !== false);
    } catch (err) {
      toast(err.message, "error");
    }
    setLoading(false);
  }

  useEffect(() => {
    loadInfo();
  }, []);

  // Flip Bonjour on/off immediately — no "Save" step. The dashboard runs in the
  // same process as the advertiser, so the server re-publishes / unpublishes live
  // and persists BONJOUR_ENABLED to .env in one call.
  async function handleToggle(e) {
    const next = e.target.checked;
    setEnabled(next); // optimistic
    setToggling(true);
    try {
      await api("/discovery/config", { method: "POST", body: { enabled: next } });
      toast(next ? "Bonjour enabled" : "Bonjour disabled", "success");
      loadInfo();
    } catch (err) {
      setEnabled(!next); // revert on failure
      toast(err.message, "error");
    }
    setToggling(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const r = await api("/discovery/config", {
        method: "POST",
        body: { enabled, name, type },
      });
      toast(r.message || "Saved", "success");
      loadInfo();
    } catch (err) {
      toast(err.message, "error");
    }
    setSaving(false);
  }

  async function handleBrowse() {
    setBrowsing(true);
    setServices(null);
    try {
      const r = await api("/discovery/browse?type=" + encodeURIComponent(browseType || "http"));
      if (!r.available) {
        toast("bonjour-service is not installed", "error");
        setServices([]);
      } else {
        setServices(r.services || []);
      }
    } catch (err) {
      toast(err.message, "error");
      setServices([]);
    }
    setBrowsing(false);
  }

  const self = info && info.self;
  const available = info && info.available;
  const status = self ? self.status : "idle";
  const badge = STATUS_BADGE[status] || STATUS_BADGE.idle;

  return html`<div>
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="card-title">Discovery</div>
        <div className="card-subtitle">
          Bonjour / mDNS — advertise this app and find others on your network
        </div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick=${loadInfo} disabled=${loading}>
        <span className="sidebar-icon"><${LuRefreshCw} size=${14} /></span> Refresh
      </button>
    </div>

    ${loading && !info
      ? html`<div className="card"><div className="empty-state" style=${{ padding: "40px" }}><p>Loading…</p></div></div>`
      : html`<div style=${{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "20px", alignItems: "start" }}>
          <!-- This app -->
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="card-title">This app</div>
              <span className=${`badge ${badge.cls}`}>${badge.label}</span>
            </div>

            ${!available
              ? html`<div>
                  <p className="text-sm text-muted mb-2">
                    Local network discovery needs the <code>bonjour-service</code> package.
                    Install it, then restart the app:
                  </p>
                  <div className="code-block" style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <code>npm install bonjour-service</code>
                    <button className="btn btn-ghost btn-sm" onClick=${() => { copyToClipboard("npm install bonjour-service"); toast("Copied", "success"); }}>Copy</button>
                  </div>
                </div>`
              : html`<div>
                  <!-- Enable / disable — applies instantly, no restart -->
                  <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "8px", marginBottom: "14px" }}>
                    <div>
                      <div style=${{ fontSize: "13px", fontWeight: 600 }}>Advertise on local network</div>
                      <div className="text-muted" style=${{ fontSize: "12px" }}>
                        ${enabled ? "On — this app is discoverable via Bonjour/mDNS" : "Off — not broadcasting on the network"}
                      </div>
                    </div>
                    <label className="form-toggle">
                      <input type="checkbox" checked=${enabled} disabled=${toggling} onChange=${handleToggle} />
                      <span className="slider"></span>
                    </label>
                  </div>

                  ${status === "advertising"
                    ? html`<div style=${{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "6px 12px", fontSize: "13px", marginBottom: "12px" }}>
                        <span className="text-muted">Name</span><span>${self.name}</span>
                        <span className="text-muted">Address</span>
                        <span style=${{ fontFamily: "monospace" }}>
                          <a href=${`http://${self.host}:${self.port}`} target="_blank" rel="noreferrer">${self.host}:${self.port}</a>
                        </span>
                        <span className="text-muted">Service</span><span style=${{ fontFamily: "monospace" }}>_${self.type}._tcp.local</span>
                        ${self.txt ? Object.entries(self.txt).map(([k, v]) => html`
                          <span key=${k} className="text-muted">txt · ${k}</span><span>${String(v)}</span>`) : null}
                      </div>`
                    : html`<p className="text-sm text-muted mb-2">
                        ${status === "error"
                          ? html`Advertising failed: <span style=${{ color: "var(--danger, #e5484d)" }}>${self.error}</span>`
                          : enabled
                            ? "Not advertising yet — restart the app to start."
                            : "Advertising is disabled (BONJOUR_ENABLED=off)."}
                      </p>`}

                  <div style=${{ borderTop: "1px solid var(--border)", margin: "4px 0 14px" }}></div>

                  <div className="form-group" style=${{ opacity: enabled ? 1 : 0.55 }}>
                    <label className="form-label">Service name</label>
                    <input className="form-input" value=${name} placeholder="My App (auto: app + hostname)" onInput=${(e) => setName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Service type</label>
                    <input className="form-input" value=${type} placeholder="http" onInput=${(e) => setType(e.target.value)} />
                  </div>
                  <button className="btn btn-primary" onClick=${handleSave} disabled=${saving}>
                    ${saving ? html`<span className="spinner" />` : null}
                    ${saving ? "Saving…" : "Save settings"}
                  </button>
                  <p className="text-sm text-muted" style=${{ marginTop: "8px" }}>
                    Changes apply immediately — no restart needed.
                  </p>
                </div>`}
          </div>

          <!-- Browse the network -->
          <div className="card">
            <div className="card-title mb-1">Network</div>
            <div className="card-subtitle mb-3">Discover other Bonjour services on this LAN</div>
            <div className="flex items-center gap-2 mb-3" style=${{ display: "flex", gap: "8px" }}>
              <input className="form-input" style=${{ maxWidth: "160px" }} value=${browseType}
                placeholder="http" onInput=${(e) => setBrowseType(e.target.value)}
                onKeyDown=${(e) => e.key === "Enter" && handleBrowse()} />
              <button className="btn btn-primary" onClick=${handleBrowse} disabled=${browsing}>
                ${browsing ? html`<span className="spinner" />` : html`<span className="sidebar-icon"><${LuWifi} size=${14} /></span>`}
                ${browsing ? "Scanning…" : "Browse"}
              </button>
            </div>

            ${services === null
              ? html`<div className="empty-state" style=${{ padding: "28px" }}>
                  <div className="empty-icon"><${LuWifi} size=${30} /></div>
                  <p>Browse for <code>_${browseType || "http"}._tcp</code> services on your network.</p>
                </div>`
              : services.length === 0
                ? html`<div className="empty-state" style=${{ padding: "28px" }}>
                    <p>No services found. Discovery only works on the same local network, and firewalls blocking UDP 5353 will silently hide services.</p>
                  </div>`
                : html`<div className="routes-list">
                    ${services.map((s) => html`<div key=${`${s.name}|${s.host}|${s.port}`} className="route-item">
                      <div style=${{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, minWidth: 0 }}>
                        <span className="ri-name">${s.name}</span>
                        <span className="ri-file" style=${{ fontFamily: "monospace" }}>${s.host}:${s.port}${s.addresses && s.addresses.length ? ` · ${s.addresses.join(", ")}` : ""}</span>
                        ${s.txt && Object.keys(s.txt).length
                          ? html`<span className="ri-file" style=${{ opacity: 0.7 }}>${Object.entries(s.txt).map(([k, v]) => `${k}=${v}`).join("  ")}</span>`
                          : null}
                      </div>
                      <a className="btn btn-ghost btn-sm" href=${`http://${s.host}:${s.port}`} target="_blank" rel="noreferrer">Open</a>
                    </div>`)}
                  </div>`}

            <p className="text-sm text-muted" style=${{ marginTop: "12px" }}>
              mDNS is local-network only — it can't bridge Wi-Fi and cellular, and guest networks with client isolation block it.
            </p>
          </div>
        </div>`}
  </div>`;
}
