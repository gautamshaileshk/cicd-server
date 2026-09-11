import React, { useState, useEffect } from "react";
import { LuCable } from "react-icons/lu";
import { html, api, Icons } from "../lib.js";
import { useApp } from "../context.js";

export function SerialPortPage() {
  const { toast, refresh, status, showConfirm } = useApp();
  const [ports, setPorts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [portName, setPortName] = useState("serialPort");
  const [portPath, setPortPath] = useState("/dev/ttyUSB0");
  const [baudRate, setBaudRate] = useState("9600");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api("/serialports").then(setPorts).catch(() => {});
  }, [status]);

  async function handleAdd() {
    setLoading(true);
    try {
      const result = await api("/add-serialport", {
        method: "POST",
        body: { name: portName, portPath, baudRate: parseInt(baudRate) },
      });
      toast(result.message, "success");
      setShowAdd(false);
      setPortName("serialPort" + ((ports?.length || 0) + 1));
      setPortPath("/dev/ttyUSB0");
      setBaudRate("9600");
      refresh();
      api("/serialports").then(setPorts).catch(() => {});
    } catch (err) { toast(err.message, "error"); }
    setLoading(false);
  }

  async function handleDelete(name) {
    const ok = await showConfirm('Remove serial port "' + name + '"? This will remove its code from index.js.', { danger: true, confirmLabel: 'Remove' });
    if (!ok) return;
    try {
      await api("/serialports/" + name, { method: "DELETE" });
      toast('Serial port "' + name + '" removed', "success");
      setSelected(null);
      refresh();
      api("/serialports").then(setPorts).catch(() => {});
    } catch (err) { toast(err.message, "error"); }
  }

  const selPort = ports.find(p => p.name === selected);
  const hasNoPorts = !ports || ports.length === 0;

  if (hasNoPorts && !showAdd) {
    return html`<div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="card-title">SerialPort</div>
          <div className="card-subtitle">0 connections</div>
        </div>
        <button className="btn btn-primary" onClick=${() => setShowAdd(true)}>
          <span className="sidebar-icon">${Icons.plus}</span> Add Port
        </button>
      </div>
      <div className="empty-state">
        <div className="empty-icon"><${LuCable} size=${36} /></div>
        <h3>No serial ports</h3>
        <p>Add a serial port connection to communicate with hardware devices</p>
        <button className="btn btn-primary" onClick=${() => setShowAdd(true)}>Add Port</button>
      </div>
    </div>`;
  }

  return html`<div>
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="card-title">SerialPort</div>
        <div className="card-subtitle">${ports.length} connection${ports.length !== 1 ? 's' : ''}</div>
      </div>
      <button className=${`btn ${showAdd ? 'btn-ghost' : 'btn-primary'}`}
        onClick=${() => {
          if (showAdd) { setShowAdd(false); if (ports.length) setSelected(ports[0].name); }
          else { setShowAdd(true); setSelected(null); setPortName("serialPort" + (ports.length + 1)); }
        }}>
        ${showAdd ? 'Cancel' : html`<span className="sidebar-icon">${Icons.plus}</span> Add Port`}
      </button>
    </div>

    <div className="routes-layout">
      <div className="card" style=${{ padding: 0, overflow: 'hidden' }}>
        <div style=${{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)' }}>
          <span style=${{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Connections</span>
        </div>
        <div className="routes-list">
          ${ports.map(p => html`<div key=${p.name}
            className=${`route-item ${selected === p.name && !showAdd ? 'active' : ''}`}
            onClick=${() => { setSelected(p.name); setShowAdd(false); }}>
            <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 }}>
              <span className="ri-name">${p.name}</span>
              <span className="ri-file">${p.path} @ ${p.baudRate}</span>
            </div>
            <span className="badge badge-success" style=${{ fontSize: '10px' }}>Active</span>
          </div>`)}
          <div className=${`route-item ${showAdd ? 'active' : ''}`}
            onClick=${() => { setShowAdd(true); setSelected(null); setPortName("serialPort" + (ports.length + 1)); }}
            style=${{ borderTop: ports.length ? '1px solid var(--border)' : 'none' }}>
            <span className="sidebar-icon" style=${{ color: 'var(--accent-light)' }}>${Icons.plus}</span>
            <span className="ri-name" style=${{ color: 'var(--accent-light)' }}>Add Port</span>
          </div>
        </div>
      </div>

      <div className="routes-detail">
        ${showAdd && html`<div className="card">
          <div className="card-title mb-2">Add Serial Port</div>
          <div className="card-subtitle mb-4">Configure a new serial port connection</div>
          <div className="form-group">
            <label className="form-label">Variable Name</label>
            <input className="form-input" value=${portName} onInput=${e => setPortName(e.target.value)} placeholder="serialPort1" />
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Port Path</label>
              <input className="form-input" value=${portPath} onInput=${e => setPortPath(e.target.value)} placeholder="/dev/ttyUSB0" />
            </div>
            <div className="form-group">
              <label className="form-label">Baud Rate</label>
              <select className="form-select" value=${baudRate} onChange=${e => setBaudRate(e.target.value)}>
                ${['9600', '14400', '19200', '38400', '57600', '115200'].map(r =>
                  html`<option key=${r} value=${r}>${r}</option>`
                )}
              </select>
            </div>
          </div>
          <button className="btn btn-primary" onClick=${handleAdd} disabled=${loading}>
            ${loading ? html`<span className="spinner" />` : null}
            ${loading ? 'Adding...' : 'Add Port'}
          </button>
        </div>`}

        ${!showAdd && selPort && html`<div>
          <div className="card mb-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div style=${{ fontWeight: 600, fontSize: '16px', marginBottom: '2px' }}>${selPort.name}</div>
                <div className="text-sm text-muted" style=${{ fontFamily: "'SF Mono', monospace" }}>${selPort.path} @ ${selPort.baudRate} baud</div>
              </div>
              <button className="btn btn-danger btn-sm btn-icon" onClick=${() => handleDelete(selPort.name)}>
                <span className="sidebar-icon">${Icons.trash}</span>
              </button>
            </div>
            <div style=${{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '8px' }}>Configuration</div>
            <div style=${{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '6px 12px', fontSize: '13px' }}>
              <span className="text-muted">Variable</span><span>${selPort.name}</span>
              <span className="text-muted">Path</span><span style=${{ fontFamily: 'monospace' }}>${selPort.path}</span>
              <span className="text-muted">Baud Rate</span><span>${selPort.baudRate}</span>
              <span className="text-muted">Parser</span><span>ReadlineParser (\\r\\n)</span>
            </div>
          </div>
        </div>`}

        ${!showAdd && !selPort && html`<div className="card">
          <div className="empty-state" style=${{ padding: '40px' }}>
            <p>Select a port to view details</p>
          </div>
        </div>`}
      </div>
    </div>
  </div>`;
}

