import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LuActivity, LuCheck, LuRadio, LuZap } from "react-icons/lu";
import { html, api } from "../lib.js";
import { useApp } from "../context.js";

export function RealtimePage() {
  const { toast, refresh, status, showConfirm } = useApp();
  const [selected, setSelected] = useState(status?.socketConfigured ? 'socketio' : status?.websocketConfigured ? 'websocket' : 'socketio');

  const items = [
    { id: 'socketio', label: 'Socket.IO', desc: 'Auto-reconnect, rooms, namespaces', configured: status?.socketConfigured },
    { id: 'websocket', label: 'WebSocket', desc: 'Native ws library, lightweight', configured: status?.websocketConfigured },
  ];

  return html`<div>
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="card-title">Real-time</div>
        <div className="card-subtitle">Configure real-time communication</div>
      </div>
    </div>

    <div className="routes-layout">
      <div className="card" style=${{ padding: 0, overflow: 'hidden' }}>
        <div style=${{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)' }}>
          <span style=${{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Protocols</span>
        </div>
        <div className="routes-list">
          ${items.map(item => html`<div key=${item.id}
            className=${`route-item ${selected === item.id ? 'active' : ''}`}
            onClick=${() => setSelected(item.id)}>
            <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 }}>
              <span className="ri-name">${item.label}</span>
              <span className="ri-file">${item.desc}</span>
            </div>
            ${item.configured && html`<span className="badge badge-success" style=${{ fontSize: '10px' }}>Active</span>`}
          </div>`)}
        </div>
      </div>

      <div className="routes-detail">
        <${AnimatePresence} mode="wait">
          <${motion.div} key=${selected}
            initial=${{ opacity: 0, y: 6 }} animate=${{ opacity: 1, y: 0 }} exit=${{ opacity: 0, y: -6 }}
            transition=${{ duration: 0.12 }}>
            ${selected === 'socketio' ? html`<${SocketIOSetup} />` : html`<${WebSocketSetup} />`}
          <//>
        <//>
      </div>
    </div>
  </div>`;
}

function SocketIOSetup() {
  const { toast, refresh, status, showConfirm } = useApp();
  const [cors, setCors] = useState("*");
  const [loading, setLoading] = useState(false);

  if (status?.socketConfigured) {
    return html`<div>
      <div className="card mb-4" style=${{ borderColor: 'rgba(34,197,94,0.3)' }}>
        <div className="flex items-center gap-3">
          <${LuActivity} size=${20} color="var(--success)" />
          <div style=${{ flex: 1 }}>
            <div style=${{ fontWeight: 600 }}>Socket.IO Active</div>
            <div className="text-sm text-muted">Real-time events are configured in index.js</div>
          </div>
          <span className="badge badge-success">Configured</span>
        </div>
      </div>
      <div className="card">
        <div style=${{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '8px' }}>Features</div>
        ${['Auto-reconnect on disconnect', 'Room & namespace support', 'Binary data streaming', 'Middleware pipeline'].map(f =>
          html`<div key=${f} style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <${LuCheck} size=${14} color="var(--success)" /> ${f}
          </div>`
        )}
      </div>
    </div>`;
  }

  async function handleSetup() {
    if (status?.websocketConfigured) {
      const ok = await showConfirm('WebSocket is currently configured. Enabling Socket.IO will replace your WebSocket setup. Do you want to continue?', { confirmLabel: 'Replace with Socket.IO' });
      if (!ok) return;
    }
    setLoading(true);
    try {
      const result = await api('/add-socket', { method: 'POST', body: { corsOrigins: cors } });
      toast(result.message, 'success');
      refresh().catch(() => {});
    } catch (err) { toast(err.message, 'error'); }
    setLoading(false);
  }

  return html`<div className="card">
    <div className="card-title mb-2">Socket.IO Setup</div>
    <div className="card-subtitle mb-4">Add real-time bidirectional communication with auto-reconnect, rooms, and namespaces</div>
    ${status?.websocketConfigured && html`<div style=${{ padding: '10px 14px', borderRadius: '8px', background: 'var(--warning-glow)', border: '1px solid rgba(245,158,11,0.2)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <${LuZap} size=${14} color="var(--warning)" />
      <span style=${{ fontSize: '12px', color: 'var(--warning)' }}>WebSocket is currently active. Setting up Socket.IO will replace it.</span>
    </div>`}
    <div className="form-group">
      <label className="form-label">CORS Origins</label>
      <input className="form-input" value=${cors} onInput=${e => setCors(e.target.value)} placeholder="* or comma-separated origins" />
    </div>
    <button className="btn btn-primary" onClick=${handleSetup} disabled=${loading}>
      ${loading ? html`<span className="spinner" />` : null}
      ${loading ? 'Setting up...' : 'Setup Socket.IO'}
    </button>
  </div>`;
}

function WebSocketSetup() {
  const { toast, refresh, status, showConfirm } = useApp();
  const [samePort, setSamePort] = useState(true);
  const [wsPort, setWsPort] = useState("8080");
  const [loading, setLoading] = useState(false);

  if (status?.websocketConfigured) {
    return html`<div>
      <div className="card mb-4" style=${{ borderColor: 'rgba(34,197,94,0.3)' }}>
        <div className="flex items-center gap-3">
          <${LuRadio} size=${20} color="var(--success)" />
          <div style=${{ flex: 1 }}>
            <div style=${{ fontWeight: 600 }}>WebSocket Active</div>
            <div className="text-sm text-muted">Native WebSocket is configured in index.js</div>
          </div>
          <span className="badge badge-success">Configured</span>
        </div>
      </div>
      <div className="card">
        <div style=${{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '8px' }}>Features</div>
        ${['Lightweight native protocol', 'Low latency messaging', 'Binary frame support', 'Custom message handling'].map(f =>
          html`<div key=${f} style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <${LuCheck} size=${14} color="var(--success)" /> ${f}
          </div>`
        )}
      </div>
    </div>`;
  }

  async function handleSetup() {
    if (status?.socketConfigured) {
      const ok = await showConfirm('Socket.IO is currently configured. Enabling WebSocket will replace your Socket.IO setup. Do you want to continue?', { confirmLabel: 'Replace with WebSocket' });
      if (!ok) return;
    }
    setLoading(true);
    try {
      const result = await api('/add-websocket', { method: 'POST', body: { samePort, wsPort: samePort ? null : parseInt(wsPort) } });
      toast(result.message, 'success');
      refresh().catch(() => {});
    } catch (err) { toast(err.message, 'error'); }
    setLoading(false);
  }

  return html`<div className="card">
    <div className="card-title mb-2">Native WebSocket Setup</div>
    <div className="card-subtitle mb-4">Add lightweight WebSocket support using the ws library for low-level control</div>
    ${status?.socketConfigured && html`<div style=${{ padding: '10px 14px', borderRadius: '8px', background: 'var(--warning-glow)', border: '1px solid rgba(245,158,11,0.2)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <${LuZap} size=${14} color="var(--warning)" />
      <span style=${{ fontSize: '12px', color: 'var(--warning)' }}>Socket.IO is currently active. Setting up WebSocket will replace it.</span>
    </div>`}
    <div className="form-group">
      <label className="form-label">Server Port</label>
      <div style=${{ display: 'flex', gap: '8px', marginTop: '4px' }}>
        <label style=${{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)' }}>
          <input type="radio" name="wsPort" checked=${samePort} onChange=${() => setSamePort(true)} /> Same as HTTP server
        </label>
        <label style=${{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)' }}>
          <input type="radio" name="wsPort" checked=${!samePort} onChange=${() => setSamePort(false)} /> Separate port
        </label>
      </div>
    </div>
    ${!samePort && html`<div className="form-group">
      <label className="form-label">WebSocket Port</label>
      <input className="form-input" type="number" value=${wsPort} onInput=${e => setWsPort(e.target.value)} placeholder="8080" style=${{ maxWidth: '160px' }} />
    </div>`}
    <button className="btn btn-primary" onClick=${handleSetup} disabled=${loading}>
      ${loading ? html`<span className="spinner" />` : null}
      ${loading ? 'Setting up...' : 'Setup WebSocket'}
    </button>
  </div>`;
}

