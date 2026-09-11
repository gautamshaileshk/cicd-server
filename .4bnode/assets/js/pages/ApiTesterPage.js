import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { io as socketIoConnect } from "socket.io-client";
import { LuChevronLeft, LuCircleDot, LuCopy, LuImport, LuLoader, LuPencil, LuPlugZap, LuPlus, LuRadio, LuSave, LuSend, LuShare2, LuTrash2, LuWifi, LuWifiOff } from "react-icons/lu";
import { html, api, Icons, copyToClipboard } from "../lib.js";
import { useApp } from "../context.js";
import { Modal } from "../components/Modal.js";

function SocketIOTester({ selectedSaved, isSaved, loadedTest, onSaveTest, onSaveLog }) {
  const { toast } = useApp();
  const [sioUrl, setSioUrl] = useState('http://localhost:3000');
  const [sioConnected, setSioConnected] = useState(false);
  const [sioSocket, setSioSocket] = useState(null);
  const [sioEvent, setSioEvent] = useState('');
  const [sioData, setSioData] = useState('');
  const [sioListen, setSioListen] = useState('');
  const [sioListeners, setSioListeners] = useState([]);
  const [sioLog, setSioLog] = useState([]);
  const logRef = useRef(null);

  function addLog(dir, msg) {
    const ts = new Date().toLocaleTimeString();
    setSioLog(prev => [...prev, { dir, msg, ts, id: Date.now() + Math.random() }]);
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [sioLog]);

  useEffect(() => {
    return () => { if (sioSocket) sioSocket.disconnect(); };
  }, []);

  function connect() {
    if (sioSocket) { sioSocket.disconnect(); setSioSocket(null); }
    try {
      const socket = socketIoConnect(sioUrl, { transports: ['websocket', 'polling'] });
      socket.on('connect', () => {
        setSioConnected(true);
        addLog('system', 'Connected (id: ' + socket.id + ')');
      });
      socket.on('disconnect', (reason) => {
        setSioConnected(false);
        addLog('system', 'Disconnected: ' + reason);
      });
      socket.on('connect_error', (err) => {
        addLog('system', 'Connection error: ' + err.message);
      });
      setSioSocket(socket);
    } catch (err) {
      addLog('system', 'Error: ' + err.message);
    }
  }

  function disconnect() {
    if (sioSocket) {
      sioSocket.disconnect();
      setSioSocket(null);
      setSioConnected(false);
    }
  }

  function emitEvent() {
    if (!sioSocket || !sioEvent.trim()) return;
    let parsed = sioData.trim();
    try { parsed = JSON.parse(parsed); } catch {}
    sioSocket.emit(sioEvent, parsed);
    addLog('sent', sioEvent + ': ' + (typeof parsed === 'object' ? JSON.stringify(parsed) : parsed));
  }

  function addListener() {
    if (!sioSocket || !sioListen.trim() || sioListeners.includes(sioListen.trim())) return;
    const ev = sioListen.trim();
    sioSocket.on(ev, (data) => {
      const display = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
      addLog('received', ev + ': ' + display);
    });
    setSioListeners(prev => [...prev, ev]);
    addLog('system', 'Listening on "' + ev + '"');
    setSioListen('');
  }

  function removeListener(ev) {
    if (sioSocket) sioSocket.off(ev);
    setSioListeners(prev => prev.filter(e => e !== ev));
  }

  useEffect(() => {
    if (loadedTest && loadedTest.type === 'socketio') {
      setSioUrl(loadedTest.url || 'http://localhost:3000');
      if (loadedTest.event) setSioEvent(loadedTest.event);
      if (loadedTest.data) setSioData(loadedTest.data);
    }
  }, [loadedTest?.id]);

  function saveSession() {
    const name = prompt('Name this Socket.IO test:');
    if (!name?.trim()) return;
    onSaveTest({
      name: name.trim(),
      type: 'socketio',
      url: sioUrl,
      event: sioEvent,
      data: sioData,
      listeners: [...sioListeners],
    });
  }

  function saveLogEntry(entry) {
    if (!selectedSaved || !onSaveLog) return;
    onSaveLog({
      dir: entry.dir,
      label: (entry.dir === 'sent' ? '↑ EMIT ' : entry.dir === 'received' ? '↓ EVENT ' : '● SYS ') + entry.msg.substring(0, 80),
      body: entry.msg,
      time: 0,
    });
  }

  return html`<div>
    <!-- Connection bar -->
    <div className="api-tester-bar">
      <input className="api-tester-url" placeholder="http://localhost:3000" value=${sioUrl}
        onInput=${(e) => setSioUrl(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter') connect(); }} />
      ${!sioConnected
        ? html`<button className="api-tester-send" onClick=${connect}>
            <${LuPlugZap} size=${14} /> Connect
          </button>`
        : html`<button className="api-tester-send" onClick=${disconnect} style=${{ background: 'var(--danger)' }}>
            <${LuWifiOff} size=${14} /> Disconnect
          </button>`}
      ${!isSaved && onSaveTest && html`<button className="api-tester-send" onClick=${saveSession}
        style=${{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
        <${LuSave} size=${14} /> Save
      </button>`}
    </div>

    <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
      <!-- Emit -->
      <div className="card" style=${{ padding: 0, overflow: 'hidden' }}>
        <div style=${{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
          Emit Event
        </div>
        <div style=${{ padding: '12px' }}>
          <div className="flex gap-2 mb-3">
            <input className="form-input" style=${{ flex: 1, fontSize: '12px' }} placeholder="Event name"
              value=${sioEvent} onInput=${(e) => setSioEvent(e.target.value)}
              onKeyDown=${(e) => { if (e.key === 'Enter') emitEvent(); }} />
            <button className="btn btn-sm btn-primary" onClick=${emitEvent}
              disabled=${!sioConnected || !sioEvent.trim()}>
              <${LuSend} size=${12} /> Emit
            </button>
          </div>
          <textarea className="api-tester-body-editor" style=${{ minHeight: '80px', fontSize: '11px' }}
            placeholder='{"key": "value"} or plain text'
            value=${sioData} onInput=${(e) => setSioData(e.target.value)} spellcheck=${false} />
        </div>
      </div>

      <!-- Listeners -->
      <div className="card" style=${{ padding: 0, overflow: 'hidden' }}>
        <div style=${{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
          Event Listeners
        </div>
        <div style=${{ padding: '12px' }}>
          <div className="flex gap-2 mb-3">
            <input className="form-input" style=${{ flex: 1, fontSize: '12px' }} placeholder="Event name to listen"
              value=${sioListen} onInput=${(e) => setSioListen(e.target.value)}
              onKeyDown=${(e) => { if (e.key === 'Enter') addListener(); }} />
            <button className="btn btn-sm btn-ghost" onClick=${addListener}
              disabled=${!sioConnected || !sioListen.trim()}>
              <${LuPlus} size=${12} /> Listen
            </button>
          </div>
          ${sioListeners.length === 0 && html`<div style=${{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px 0' }}>No listeners yet</div>`}
          <div className="flex gap-1" style=${{ flexWrap: 'wrap' }}>
            ${sioListeners.map(ev => html`<span key=${ev} style=${{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '4px', background: 'rgba(52,211,153,0.1)', fontSize: '11px', color: 'var(--success)' }}>
              <${LuCircleDot} size=${10} /> ${ev}
              <button style=${{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 2px', fontSize: '12px' }}
                onClick=${() => removeListener(ev)}>×</button>
            </span>`)}
          </div>
        </div>
      </div>
    </div>

    <!-- Log -->
    <div className="card" style=${{ padding: 0, overflow: 'hidden' }}>
      <div style=${{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="flex items-center gap-3">
          <span style=${{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
            Event Log
          </span>
          <span className="ws-connected">
            <span className=${`dot ${sioConnected ? 'on' : 'off'}`} />
            ${sioConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick=${() => setSioLog([])} style=${{ fontSize: '11px' }}>Clear</button>
      </div>
      <div className="ws-log" ref=${logRef}>
        ${sioLog.length === 0 && html`<div style=${{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>Connect to start logging events</div>`}
        ${sioLog.map(e => html`<div key=${e.id} className="ws-log-entry">
          <span className=${`dir ${e.dir}`}>${e.dir === 'sent' ? '↑ EMIT' : e.dir === 'received' ? '↓ EVENT' : '● SYS'}</span>
          <span className="msg">${e.msg}</span>
          <span className="ts">${e.ts}</span>
          ${selectedSaved && onSaveLog && html`<button className="btn btn-ghost" style=${{ padding: '2px 4px', opacity: 0.4, marginLeft: '4px', flexShrink: 0 }}
            onClick=${() => saveLogEntry(e)} title="Save log entry">
            <${LuSave} size=${10} />
          </button>`}
        </div>`)}
      </div>
    </div>
  </div>`;
}

// ── WebSocket Tester Component ──
function WebSocketTester({ selectedSaved, isSaved, loadedTest, onSaveTest, onSaveLog }) {
  const { toast } = useApp();
  const [wsUrl, setWsUrl] = useState('ws://localhost:3000');
  const [wsConnected, setWsConnected] = useState(false);
  const [wsRef, setWsRef] = useState(null);
  const [wsMessage, setWsMessage] = useState('');
  const [wsLog, setWsLog] = useState([]);
  const logRef = useRef(null);

  function addLog(dir, msg) {
    const ts = new Date().toLocaleTimeString();
    setWsLog(prev => [...prev, { dir, msg, ts, id: Date.now() + Math.random() }]);
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [wsLog]);

  useEffect(() => {
    return () => { if (wsRef) wsRef.close(); };
  }, []);

  function connect() {
    if (wsRef) { wsRef.close(); setWsRef(null); }
    try {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        setWsConnected(true);
        addLog('system', 'Connected to ' + wsUrl);
      };
      ws.onclose = (e) => {
        setWsConnected(false);
        addLog('system', 'Disconnected (code: ' + e.code + ', reason: ' + (e.reason || 'none') + ')');
      };
      ws.onerror = () => {
        addLog('system', 'Connection error');
      };
      ws.onmessage = (e) => {
        let display = e.data;
        try {
          const parsed = JSON.parse(e.data);
          display = JSON.stringify(parsed, null, 2);
        } catch {}
        addLog('received', display);
      };
      setWsRef(ws);
    } catch (err) {
      addLog('system', 'Error: ' + err.message);
    }
  }

  function disconnect() {
    if (wsRef) {
      wsRef.close();
      setWsRef(null);
      setWsConnected(false);
    }
  }

  function sendMessage() {
    if (!wsRef || !wsMessage.trim()) return;
    wsRef.send(wsMessage);
    addLog('sent', wsMessage);
    setWsMessage('');
  }

  useEffect(() => {
    if (loadedTest && loadedTest.type === 'websocket') {
      setWsUrl(loadedTest.url || 'ws://localhost:3000');
      if (loadedTest.message) setWsMessage(loadedTest.message);
    }
  }, [loadedTest?.id]);

  function saveSession() {
    const name = prompt('Name this WebSocket test:');
    if (!name?.trim()) return;
    onSaveTest({
      name: name.trim(),
      type: 'websocket',
      url: wsUrl,
      message: wsMessage,
    });
  }

  function saveLogEntry(entry) {
    if (!selectedSaved || !onSaveLog) return;
    onSaveLog({
      dir: entry.dir,
      label: (entry.dir === 'sent' ? '↑ SENT ' : entry.dir === 'received' ? '↓ RECV ' : '● SYS ') + entry.msg.substring(0, 80),
      body: entry.msg,
      time: 0,
    });
  }

  return html`<div>
    <!-- Connection bar -->
    <div className="api-tester-bar">
      <input className="api-tester-url" placeholder="ws://localhost:3000" value=${wsUrl}
        onInput=${(e) => setWsUrl(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter') connect(); }} />
      ${!wsConnected
        ? html`<button className="api-tester-send" onClick=${connect}>
            <${LuPlugZap} size=${14} /> Connect
          </button>`
        : html`<button className="api-tester-send" onClick=${disconnect} style=${{ background: 'var(--danger)' }}>
            <${LuWifiOff} size=${14} /> Disconnect
          </button>`}
      ${!isSaved && onSaveTest && html`<button className="api-tester-send" onClick=${saveSession}
        style=${{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
        <${LuSave} size=${14} /> Save
      </button>`}
    </div>

    <!-- Send message -->
    <div className="card" style=${{ padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
      <div style=${{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
        Send Message
      </div>
      <div style=${{ padding: '12px', display: 'flex', gap: '8px' }}>
        <textarea className="api-tester-body-editor" style=${{ minHeight: '60px', fontSize: '12px', flex: 1 }}
          placeholder='{"type": "ping"} or plain text'
          value=${wsMessage} onInput=${(e) => setWsMessage(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          spellcheck=${false} />
      </div>
      <div style=${{ padding: '0 12px 12px', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-sm btn-primary" onClick=${sendMessage}
          disabled=${!wsConnected || !wsMessage.trim()}>
          <${LuSend} size=${12} /> Send
        </button>
      </div>
    </div>

    <!-- Log -->
    <div className="card" style=${{ padding: 0, overflow: 'hidden' }}>
      <div style=${{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="flex items-center gap-3">
          <span style=${{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
            Message Log
          </span>
          <span className="ws-connected">
            <span className=${`dot ${wsConnected ? 'on' : 'off'}`} />
            ${wsConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick=${() => setWsLog([])} style=${{ fontSize: '11px' }}>Clear</button>
      </div>
      <div className="ws-log" ref=${logRef}>
        ${wsLog.length === 0 && html`<div style=${{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>Connect to start logging messages</div>`}
        ${wsLog.map(e => html`<div key=${e.id} className="ws-log-entry">
          <span className=${`dir ${e.dir}`}>${e.dir === 'sent' ? '↑ SENT' : e.dir === 'received' ? '↓ RECV' : '● SYS'}</span>
          <span className="msg">${e.msg}</span>
          <span className="ts">${e.ts}</span>
          ${selectedSaved && onSaveLog && html`<button className="btn btn-ghost" style=${{ padding: '2px 4px', opacity: 0.4, marginLeft: '4px', flexShrink: 0 }}
            onClick=${() => saveLogEntry(e)} title="Save log entry">
            <${LuSave} size=${10} />
          </button>`}
        </div>`)}
      </div>
    </div>
  </div>`;
}

export function SavedResponseDetail({ resp, parentTest, onBack, onUpdate }) {
  const isSocketResp = resp.dir;
  const [editLabel, setEditLabel] = useState(resp.label);
  const [editReqBody, setEditReqBody] = useState(() => {
    if (!resp.requestBody?.trim()) return '';
    try { return JSON.stringify(JSON.parse(resp.requestBody), null, 2); } catch { return resp.requestBody; }
  });
  const [editRespBody, setEditRespBody] = useState(() => {
    if (!resp.body) return '';
    try { return JSON.stringify(JSON.parse(resp.body), null, 2); } catch { return resp.body; }
  });
  const [editing, setEditing] = useState(false);

  const rStatusClass = 's' + Math.floor((resp.status || 0) / 100) + 'xx';
  const hasChanges = editLabel !== resp.label ||
    editReqBody !== ((() => { try { return JSON.stringify(JSON.parse(resp.requestBody || ''), null, 2); } catch { return resp.requestBody || ''; } })()) ||
    editRespBody !== ((() => { try { return JSON.stringify(JSON.parse(resp.body || ''), null, 2); } catch { return resp.body || ''; } })());

  function save() {
    onUpdate({
      label: editLabel,
      requestBody: editReqBody,
      body: editRespBody,
    });
    setEditing(false);
  }

  return html`<div>
    <div className="flex items-center gap-2 mb-3">
      <button className="btn btn-ghost btn-sm" onClick=${onBack} style=${{ fontSize: '11px' }}>
        <${LuChevronLeft} size=${14} /> Back
      </button>
      ${!editing
        ? html`<span style=${{ fontSize: '13px', fontWeight: 600, flex: 1 }}>${resp.label}</span>`
        : html`<input className="form-input" value=${editLabel} onInput=${(e) => setEditLabel(e.target.value)}
            style=${{ fontSize: '13px', fontWeight: 600, flex: 1, padding: '4px 8px' }} />`}
      ${!editing && html`<button className="btn btn-ghost btn-sm" onClick=${() => setEditing(true)} style=${{ fontSize: '11px' }}>
        <${LuPencil} size=${12} /> Edit
      </button>`}
      ${editing && html`<div className="flex gap-2">
        <button className="btn btn-ghost btn-sm" onClick=${() => setEditing(false)} style=${{ fontSize: '11px' }}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick=${save} disabled=${!hasChanges} style=${{ fontSize: '11px' }}>
          <${LuSave} size=${12} /> Update
        </button>
      </div>`}
    </div>

    ${!isSocketResp && html`<div>
      <div className="card mb-4" style=${{ padding: 0, overflow: 'hidden' }}>
        <div style=${{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style=${{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Request</span>
          <span className=${`route-method ${(parentTest.method || 'GET').toLowerCase()}`} style=${{ fontSize: '10px', padding: '1px 6px' }}>${parentTest.method || 'GET'}</span>
          <span style=${{ fontFamily: "'SF Mono', monospace", fontSize: '12px', color: 'var(--text-primary)' }}>${parentTest.url}</span>
        </div>
        ${(editReqBody?.trim() || editing) && html`<div style=${{ padding: editing ? '0' : '10px 16px' }}>
          ${!editing && html`<div>
            <div style=${{ padding: '0 0 6px', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px', color: 'var(--text-muted)' }}>Body Sent</div>
            <pre style=${{ margin: 0, fontFamily: "'SF Mono', monospace", fontSize: '12px', lineHeight: '1.5', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>${editReqBody}</pre>
          </div>`}
          ${editing && html`<textarea className="api-tester-body-editor" value=${editReqBody}
            onInput=${(e) => setEditReqBody(e.target.value)} spellcheck=${false}
            style=${{ borderRadius: 0, border: 'none', borderTop: '1px solid var(--border)', minHeight: '100px' }} />`}
        </div>`}
      </div>
      <div className="card" style=${{ padding: 0, overflow: 'hidden' }}>
        <div style=${{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style=${{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Response</span>
          <span className=${`api-tester-status ${rStatusClass}`}>${resp.status} ${resp.statusText}</span>
          <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>${resp.time}ms</span>
        </div>
        ${!editing && html`<div className="api-tester-response-body">${editRespBody || 'No response body'}</div>`}
        ${editing && html`<textarea className="api-tester-body-editor" value=${editRespBody}
          onInput=${(e) => setEditRespBody(e.target.value)} spellcheck=${false}
          style=${{ borderRadius: 0, border: 'none', minHeight: '140px' }} />`}
      </div>
    </div>`}

    ${isSocketResp && html`<div className="card" style=${{ padding: 0, overflow: 'hidden' }}>
      <div style=${{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style=${{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
          ${parentTest.type === 'socketio' ? 'Socket.IO' : 'WebSocket'} Log Entry
        </span>
        <span style=${{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 700,
          background: resp.dir === 'received' ? 'rgba(52,211,153,0.15)' : resp.dir === 'sent' ? 'rgba(245,158,11,0.15)' : 'rgba(148,163,184,0.15)',
          color: resp.dir === 'received' ? '#34d399' : resp.dir === 'sent' ? '#f59e0b' : '#94a3b8' }}>
          ${resp.dir === 'received' ? '↓ Received' : resp.dir === 'sent' ? '↑ Sent' : '● System'}
        </span>
      </div>
      ${!editing && html`<div className="api-tester-response-body">${editRespBody}</div>`}
      ${editing && html`<textarea className="api-tester-body-editor" value=${editRespBody}
        onInput=${(e) => setEditRespBody(e.target.value)} spellcheck=${false}
        style=${{ borderRadius: 0, border: 'none', minHeight: '140px' }} />`}
    </div>`}
  </div>`;
}

export function ApiTesterPage() {
  const { data, toast, showConfirm } = useApp();
  const [testerMode, setTesterMode] = useState('rest');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState([
    { key: 'Content-Type', value: 'application/json', id: 1 },
  ]);
  const [body, setBody] = useState('');
  const bodyRef = useRef(null);
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('body');
  const [params, setParams] = useState([]);
  const [savedTests, setSavedTests] = useState([]);
  const [selectedSaved, setSelectedSaved] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [importRoutes, setImportRoutes] = useState([]);
  const [importLoading, setImportLoading] = useState(false);
  const [bodyError, setBodyError] = useState(null);
  const [bodyType, setBodyType] = useState('json');
  const [formFields, setFormFields] = useState([]);
  const [responseTab, setResponseTab] = useState('body');
  const [urlParams, setUrlParams] = useState([]);
  const [savedResponses, setSavedResponses] = useState({}); // { testId: [{status, label, body, requestBody}] }
  const [selectedResponse, setSelectedResponse] = useState(null); // { testId, respId }
  const [expandedTests, setExpandedTests] = useState({});
  const [routeEndpoints, setRouteEndpoints] = useState([]);
  const [lastSharedAt, setLastSharedAt] = useState(null);
  const [sharedSnapshot, setSharedSnapshot] = useState(null);

  // Auto-grow the request-body textarea to fit its content (capped, then scrolls).
  useEffect(() => {
    const ta = bodyRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 600) + 'px'; }
  }, [body, bodyType, activeTab]);

  // ── Environments / variables + auth (persisted per-browser in sessionStorage) ──
  // sessionStorage (not localStorage) because vars can hold captured tokens and
  // auth carries bearer tokens / basic-auth passwords / api-key values.
  const [variables, setVariables] = useState([]);
  const [showVars, setShowVars] = useState(false);
  const [autoToken, setAutoToken] = useState(true);
  const [auth, setAuth] = useState({ type: 'none', token: '', username: '', password: '', apiKeyKey: 'x-api-key', apiKeyValue: '' });

  useEffect(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem('_4bnode_vars') || '[]');
      if (Array.isArray(v)) setVariables(v);
      const a = JSON.parse(sessionStorage.getItem('_4bnode_auth') || 'null');
      if (a && typeof a === 'object') setAuth(prev => ({ ...prev, ...a }));
      const at = localStorage.getItem('_4bnode_autotoken');
      if (at !== null) setAutoToken(at === '1');
    } catch {}
  }, []);
  useEffect(() => { try { sessionStorage.setItem('_4bnode_vars', JSON.stringify(variables)); } catch {} }, [variables]);
  useEffect(() => { try { sessionStorage.setItem('_4bnode_auth', JSON.stringify(auth)); } catch {} }, [auth]);
  useEffect(() => { try { localStorage.setItem('_4bnode_autotoken', autoToken ? '1' : '0'); } catch {} }, [autoToken]);

  // Replace {{name}} tokens with variable values.
  function subst(str) {
    if (typeof str !== 'string' || str.indexOf('{{') === -1) return str;
    return str.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => {
      const v = variables.find(x => (x.key || '').trim() === k);
      return v ? v.value : m;
    });
  }
  function setVar(key, value) {
    setVariables(prev => {
      const i = prev.findIndex(x => (x.key || '').trim() === key);
      if (i === -1) return [...prev, { key, value, id: Date.now() }];
      const next = prev.slice(); next[i] = { ...next[i], value }; return next;
    });
  }

  // ── Request tabs (each tab holds a snapshot; live state = active tab's buffer) ──
  const [tabs, setTabs] = useState([{ id: 1, snap: null }]);
  const [activeTabId, setActiveTabId] = useState(1);

  function captureSnap() {
    return { method, url, headers, body, bodyType, params, urlParams, formFields, response, activeTab };
  }
  function loadSnap(s) {
    // Only protect a restored request that actually has data; blank tabs should
    // still auto-fill from a matching route when the user types a URL.
    suppressAutofillRef.current = !!(s && s.url);
    setMethod((s && s.method) || 'GET');
    setUrl((s && s.url) || '');
    setHeaders((s && s.headers) || [{ key: 'Content-Type', value: 'application/json', id: 1 }]);
    setBody((s && s.body) || '');
    setBodyType((s && s.bodyType) || 'json');
    setParams((s && s.params) || []);
    setUrlParams((s && s.urlParams) || []);
    setFormFields((s && s.formFields) || []);
    setResponse((s && s.response) || null);
    setActiveTab((s && s.activeTab) || 'body');
    setBodyError(null);
    setSelectedSaved(null);
    setSelectedResponse(null);
  }
  function switchTab(id) {
    if (id === activeTabId) return;
    const snap = captureSnap();
    const target = tabs.find(t => t.id === id);
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, snap } : t));
    loadSnap(target && target.snap);
    setActiveTabId(id);
  }
  function newTab() {
    const snap = captureSnap();
    const id = Math.max(0, ...tabs.map(t => t.id)) + 1;
    setTabs(prev => [...prev.map(t => t.id === activeTabId ? { ...t, snap } : t), { id, snap: null }]);
    loadSnap(null);
    setActiveTabId(id);
  }
  function closeTab(id) {
    const remaining = tabs.filter(t => t.id !== id);
    if (remaining.length === 0) {
      const nid = Math.max(0, ...tabs.map(t => t.id)) + 1;
      setTabs([{ id: nid, snap: null }]);
      loadSnap(null);
      setActiveTabId(nid);
      return;
    }
    setTabs(remaining);
    if (id === activeTabId) {
      const next = remaining[remaining.length - 1];
      loadSnap(next.snap);
      setActiveTabId(next.id);
    }
  }
  function tabLabel(t) {
    const s = t.id === activeTabId ? { method, url } : (t.snap || {});
    if (!s.url) return 'New Request';
    let path = s.url;
    try { path = new URL(s.url).pathname || '/'; } catch {}
    return (s.method || 'GET') + ' ' + path;
  }

  // ── Request history (persisted per-browser) ──
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    try { const h = JSON.parse(sessionStorage.getItem('_4bnode_history') || '[]'); if (Array.isArray(h)) setHistory(h); } catch {}
  }, []);
  function pushHistory(entry) {
    setHistory(prev => {
      const next = [entry, ...prev].slice(0, 50);
      try { sessionStorage.setItem('_4bnode_history', JSON.stringify(next)); } catch {}
      return next;
    });
  }
  function clearHistory() {
    setHistory([]);
    try { sessionStorage.removeItem('_4bnode_history'); } catch {}
  }
  function loadHistory(h) {
    setMethod(h.method);
    setUrl(h.url);
    setResponse(null);
    setSelectedSaved(null);
    setSelectedResponse(null);
    setShowHistory(false);
  }

  // Latest-committed mirrors of tests/responses. Persistence reads these so a PUT
  // always sends the LATEST tests AND responses — never a stale half from an older
  // closure (which previously could wipe saved API data when saving from sockets).
  const savedTestsRef = useRef(savedTests);
  const savedResponsesRef = useRef(savedResponses);
  useEffect(() => { savedTestsRef.current = savedTests; }, [savedTests]);
  useEffect(() => { savedResponsesRef.current = savedResponses; }, [savedResponses]);

  // Load saved tests and responses from server
  useEffect(() => {
    api('/api-tester/data').then(data => {
      if (data.tests) { setSavedTests(data.tests); savedTestsRef.current = data.tests; }
      if (data.responses) { setSavedResponses(data.responses); savedResponsesRef.current = data.responses; }
      if (data.lastSharedAt) { setLastSharedAt(data.lastSharedAt); setSharedSnapshot(data.sharedSnapshot || null); }
    }).catch(() => {});
  }, []);

  // Load all route endpoints on mount for auto-matching
  useEffect(() => {
    api('/api-tester/routes').then(routes => {
      const eps = [];
      (routes || []).forEach(r => {
        (r.endpoints || []).forEach(ep => {
          eps.push({ ...ep, routeName: r.name, hasAuth: r.hasAuth });
        });
      });
      setRouteEndpoints(eps);
    }).catch(() => {});
  }, []);

  // Find matching endpoint based on current URL and method
  function findMatchingEndpoint() {
    if (!url.trim() || routeEndpoints.length === 0) return null;
    try {
      const urlObj = new URL(url.trim());
      const pathname = urlObj.pathname;
      return routeEndpoints.find(ep => {
        // Match exact path or path with :id param
        const epPath = ep.fullPath;
        if (pathname === epPath) return ep.method === method;
        // Check :id style params - /api/users/:id matches /api/users/123
        const epParts = epPath.split('/');
        const urlParts = pathname.split('/');
        if (epParts.length !== urlParts.length) return false;
        const matches = epParts.every((p, i) => p.startsWith(':') || p === urlParts[i]);
        return matches && ep.method === method;
      });
    } catch { return null; }
  }

  const matchedEndpoint = findMatchingEndpoint();

  // Load fields from server when route matches
  const lastMatchRef = useRef(null);
  const fieldsLoadedRef = useRef(false);
  const suppressAutofillRef = useRef(false);
  useEffect(() => {
    if (!matchedEndpoint) { lastMatchRef.current = null; return; }
    const matchKey = matchedEndpoint.fullPath + ':' + matchedEndpoint.method;
    // When a tab/history/saved request is restored, don't let route auto-fill clobber it.
    if (suppressAutofillRef.current) { suppressAutofillRef.current = false; lastMatchRef.current = matchKey; return; }
    if (lastMatchRef.current === matchKey) return;
    lastMatchRef.current = matchKey;
    fieldsLoadedRef.current = false;

    // Set URL params
    if (matchedEndpoint.params?.length > 0) {
      setUrlParams(matchedEndpoint.params.map((p, i) => ({ key: p, value: '', id: Date.now() + 200 + i })));
    } else {
      setUrlParams([]);
    }

    // Set query params
    if (matchedEndpoint.queryFields?.length > 0) {
      setParams(matchedEndpoint.queryFields.map((f, i) => ({ key: f.name, value: '', id: Date.now() + i })));
    }

    // Build fields: start from route-detected, then merge any saved custom fields
    const routeKey = encodeURIComponent(matchKey);
    const hasFiles = matchedEndpoint.fileFields?.length > 0;
    const hasBodyFields = matchedEndpoint.bodyFields?.length > 0;

    // Build route-detected fields
    const routeFields = [
      ...(matchedEndpoint.bodyFields || []).map((f, i) => ({ key: f.name, value: '', type: 'text', id: Date.now() + i, fromRoute: true })),
      ...(matchedEndpoint.fileFields || []).map((f, i) => ({ key: f.name, value: '', type: 'file', id: Date.now() + 100 + i, fromRoute: true })),
    ];

    if (hasFiles) setBodyType('form-data');

    // Load saved custom fields from server and merge
    api('/api-tester/fields/' + routeKey).then(res => {
      if (fieldsLoadedRef.current) return;
      fieldsLoadedRef.current = true;

      if (res.fields && res.fields.length > 0) {
        // Get custom fields (not from route) that user added
        const routeFieldKeys = routeFields.map(f => f.key);
        const customFields = res.fields.filter(f => !routeFieldKeys.includes(f.key));
        const merged = [...routeFields, ...customFields];
        setFormFields(merged);
        if (merged.some(f => f.type === 'file')) setBodyType('form-data');
      } else if (hasFiles || hasBodyFields) {
        setFormFields(hasFiles ? routeFields : []);
        if (!hasFiles && hasBodyFields) {
          const obj = {};
          matchedEndpoint.bodyFields.forEach(f => {
            obj[f.name] = f.type === 'Number' ? 0 : f.type === 'Boolean' ? false : f.type === 'Date' ? '2024-01-01' : '';
          });
          setBody(JSON.stringify(obj, null, 2));
          setBodyError(null);
        }
      }
      if (matchedEndpoint.bodyFields?.length > 0 || matchedEndpoint.fileFields?.length > 0) setActiveTab('body');
    }).catch(() => {});
  }, [url, method]);

  // Check if collection changed since last share
  const shareNeeded = lastSharedAt && sharedSnapshot !== null && sharedSnapshot !== JSON.stringify({ t: savedTests.length, r: Object.keys(savedResponses).length, ids: savedTests.map(t => t.id).join(',') });

  function persistTests(tests) {
    savedTestsRef.current = tests;
    setSavedTests(tests);
    api('/api-tester/data', { method: 'PUT', body: { tests, responses: savedResponsesRef.current } }).catch(() => {});
  }

  function persistResponses(resp) {
    savedResponsesRef.current = resp;
    setSavedResponses(resp);
    api('/api-tester/data', { method: 'PUT', body: { tests: savedTestsRef.current, responses: resp } }).catch(() => {});
  }

  function saveResponse() {
    if (!response || !selectedSaved) {
      toast('Save the request first, then save responses', 'error');
      return;
    }
    const label = prompt('Label this response (e.g., "Success", "Missing email"):', response.status + ' ' + response.statusText);
    if (!label?.trim()) return;
    const entry = {
      id: Date.now(),
      label: label.trim(),
      status: response.status,
      statusText: response.statusText,
      body: response.body,
      requestBody: body || '',
      time: response.time,
    };
    const updated = { ...savedResponses };
    if (!updated[selectedSaved]) updated[selectedSaved] = [];
    updated[selectedSaved].push(entry);
    persistResponses(updated);
    setExpandedTests(prev => ({ ...prev, [selectedSaved]: true }));
    toast('Response saved', 'success');
  }

  function deleteResponse(testId, respId) {
    const updated = { ...savedResponses };
    updated[testId] = (updated[testId] || []).filter(r => r.id !== respId);
    if (updated[testId].length === 0) delete updated[testId];
    persistResponses(updated);
  }

  function updateResponse(testId, respId, changes) {
    const updated = { ...savedResponses };
    updated[testId] = (updated[testId] || []).map(r =>
      r.id === respId ? { ...r, ...changes } : r
    );
    persistResponses(updated);
    toast('Response updated', 'success');
  }

  // Deep-clone + strip secrets so nothing sensitive leaves the browser in a share.
  function redactForShare(tests, responses) {
    const REDACTED = '[redacted]';
    const SECRET_REQ_HEADERS = ['authorization', 'cookie', 'x-api-key', 'x-passkey', 'proxy-authorization'];
    const SECRET_RESP_HEADERS = ['set-cookie', 'authorization'];
    const redactHeaders = (hdrs, names) => {
      if (Array.isArray(hdrs)) {
        return hdrs.map(h => (h && typeof h === 'object')
          ? (names.includes(String(h.key || '').toLowerCase()) ? { ...h, value: REDACTED } : { ...h })
          : h);
      }
      if (hdrs && typeof hdrs === 'object') {
        const out = {};
        Object.keys(hdrs).forEach(k => { out[k] = names.includes(k.toLowerCase()) ? REDACTED : hdrs[k]; });
        return out;
      }
      return hdrs;
    };
    const safeTests = (tests || []).map(t => {
      const copy = { ...t };
      if (copy.headers) copy.headers = redactHeaders(copy.headers, SECRET_REQ_HEADERS);
      if (copy.auth && typeof copy.auth === 'object') {
        const a = { ...copy.auth };
        if ('token' in a) a.token = REDACTED;
        if ('password' in a) a.password = REDACTED;
        if ('apiKeyValue' in a) a.apiKeyValue = REDACTED;
        copy.auth = a;
      }
      return copy;
    });
    const safeResponses = {};
    Object.keys(responses || {}).forEach(id => {
      safeResponses[id] = (responses[id] || []).map(r => {
        const copy = { ...r };
        if (copy.headers) copy.headers = redactHeaders(copy.headers, SECRET_RESP_HEADERS);
        return copy;
      });
    });
    return { tests: safeTests, responses: safeResponses };
  }

  async function shareCollection() {
    if (savedTests.length === 0) { toast('No saved requests to share', 'error'); return; }
    try {
      const safe = redactForShare(savedTests, savedResponses);
      const result = await api('/api-tester/share-collection', {
        method: 'POST',
        body: { tests: safe.tests, responses: safe.responses },
      });
      const shareUrl = window.location.origin + '/_dev/shared/' + result.id;
      copyToClipboard(shareUrl);
      const now = Date.now();
      setLastSharedAt(now);
      const snap = JSON.stringify({ t: savedTests.length, r: Object.keys(savedResponses).length, ids: savedTests.map(t => t.id).join(',') });
      setSharedSnapshot(snap);
      api('/api-tester/data', { method: 'PUT', body: { tests: savedTests, responses: savedResponses, lastSharedAt: now, sharedSnapshot: snap } }).catch(() => {});
      toast('Share URL copied: ' + shareUrl, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function sendRequest() {
    if (!url.trim()) { toast('Enter a URL', 'error'); return; }

    // Validate file fields before sending
    if (['POST','PUT','PATCH'].includes(method) && (bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded')) {
      const missingFiles = formFields.filter(f => f.key?.trim() && f.type === 'file' && !f.fileData && !f.value);
      if (missingFiles.length > 0) {
        const names = missingFiles.map(f => f.key).join(', ');
        const ok = await showConfirm('File field' + (missingFiles.length > 1 ? 's' : '') + ' "' + names + '" ' + (missingFiles.length > 1 ? 'are' : 'is') + ' empty. Send without ' + (missingFiles.length > 1 ? 'them' : 'it') + '?', { confirmLabel: 'Send Anyway' });
        if (!ok) return;
      }
    }

    // Validate URL params
    const emptyParams = urlParams.filter(p => p.key && !p.value);
    if (emptyParams.length > 0) {
      const names = emptyParams.map(p => p.key).join(', ');
      toast('Missing value for path variable: ' + names, 'error');
      return;
    }

    setLoading(true);
    setResponse(null);
    setSelectedResponse(null);
    try {
      const hdrs = {};
      headers.forEach(h => { if (h.key?.trim() && h.value?.trim()) hdrs[h.key] = subst(h.value); });
      // Apply the Auth tab (variables supported via {{...}})
      if (auth.type === 'bearer' && auth.token.trim()) {
        hdrs['Authorization'] = 'Bearer ' + subst(auth.token).trim();
      } else if (auth.type === 'basic' && (auth.username || auth.password)) {
        try { hdrs['Authorization'] = 'Basic ' + btoa(subst(auth.username) + ':' + subst(auth.password)); } catch {}
      } else if (auth.type === 'apikey' && auth.apiKeyKey.trim()) {
        hdrs[auth.apiKeyKey.trim()] = subst(auth.apiKeyValue);
      }
      const finalUrl = subst(buildDisplayUrl());
      // For base64 send-as, convert form field value into body JSON
      let sendBody = undefined;
      let sendBodyType = bodyType;
      let sendFormFields = undefined;

      if (['POST','PUT','PATCH'].includes(method)) {
        if (bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded') {
          sendFormFields = formFields.filter(f => f.key?.trim()).map(f => {
            if (f.sendAs === 'base64') {
              return { key: f.key, value: f.value }; // base64 string as text value
            }
            if (f.sendAs === 'file' && f.fileData) {
              return { key: f.key, fileData: f.fileData, fileName: f.fileName, fileType: f.fileType };
            }
            if (f.type === 'file' && !f.fileData && !f.value) {
              return null; // Skip empty file fields
            }
            return { key: f.key, value: subst(f.value || '') };
          }).filter(Boolean);
        } else if (bodyType === 'binary') {
          sendBody = body; // base64 encoded
        } else {
          sendBody = subst(body);
        }
      }

      const result = await api('/api-tester/send', {
        method: 'POST',
        body: {
          method,
          url: finalUrl,
          headers: hdrs,
          body: sendBody,
          bodyType: sendBodyType,
          formFields: sendFormFields,
        },
      });
      let parsed = null;
      try { parsed = JSON.parse(result.body); } catch {}
      setResponse({
        status: result.status,
        statusText: result.statusText,
        headers: result.headers || {},
        body: parsed ? JSON.stringify(parsed, null, 2) : result.body,
        isJson: !!parsed,
        time: result.time,
        size: result.size,
      });
      // Auto-capture an auth token from the response into {{token}}
      if (autoToken && parsed && typeof parsed === 'object') {
        const tok = parsed.token || parsed.accessToken || parsed.access_token || (parsed.data && parsed.data.token);
        if (tok && typeof tok === 'string') { setVar('token', tok); toast('Captured token → {{token}}', 'success'); }
      }
      pushHistory({ id: Date.now(), method, url, status: result.status, time: result.time, ts: Date.now() });
    } catch (err) {
      setResponse({
        status: 0, statusText: 'Error',
        body: err.message, isJson: false,
        time: 0, size: 0, headers: {},
      });
      pushHistory({ id: Date.now(), method, url, status: 0, time: 0, ts: Date.now() });
    }
    setLoading(false);
  }

  function saveTest() {
    const name = prompt('Name this request:');
    if (!name?.trim()) return;
    const test = {
      id: Date.now(),
      name: name.trim(),
      type: 'rest',
      method, url,
      headers: headers.filter(h => h.key?.trim()),
      params: params.filter(p => p.key?.trim()),
      urlParams: urlParams.filter(p => p.key?.trim()),
      body, bodyType,
      formFields: formFields.filter(f => f.key?.trim()),
    };
    const updated = [...savedTests, test];
    persistTests(updated);
    setSelectedSaved(test.id);
    toast('Request saved', 'success');
  }

  function handleSaveSocketTest(config) {
    const test = { id: Date.now(), ...config };
    const updated = [...savedTests, test];
    persistTests(updated);
    setSelectedSaved(test.id);
    toast('Test saved', 'success');
  }

  function handleSaveLog(entry) {
    if (!selectedSaved) return;
    const respEntry = {
      id: Date.now(),
      label: entry.label,
      status: entry.dir === 'received' ? 200 : entry.dir === 'sent' ? 201 : 100,
      statusText: entry.dir === 'received' ? 'Received' : entry.dir === 'sent' ? 'Sent' : 'System',
      body: entry.body,
      requestBody: '',
      time: entry.time || 0,
      dir: entry.dir,
    };
    const updated = { ...savedResponses };
    if (!updated[selectedSaved]) updated[selectedSaved] = [];
    updated[selectedSaved].push(respEntry);
    persistResponses(updated);
    setExpandedTests(prev => ({ ...prev, [selectedSaved]: true }));
    toast('Log entry saved', 'success');
  }

  function loadTest(test) {
    if (test.type === 'socketio') {
      setTesterMode('socketio');
    } else if (test.type === 'websocket') {
      setTesterMode('websocket');
    } else {
      setTesterMode('rest');
      setMethod(test.method || 'GET');
      setUrl(test.url || '');
      setHeaders(test.headers?.length ? test.headers : [{ key: 'Content-Type', value: 'application/json', id: 1 }]);
      setParams(test.params?.length ? test.params : []);
      setUrlParams(test.urlParams?.length ? test.urlParams : []);
      setBody(test.body || '');
      setBodyType(test.bodyType || 'json');
      setFormFields(test.formFields?.length ? test.formFields : []);
      if (['POST','PUT','PATCH'].includes(test.method)) setActiveTab('body');
      else setActiveTab('params');
    }
    setSelectedSaved(test.id);
    setSelectedResponse(null);
    setResponse(null);
  }

  function toggleExpand(testId) {
    setExpandedTests(prev => ({ ...prev, [testId]: !prev[testId] }));
  }

  function viewSavedResponse(testId, respId) {
    setSelectedSaved(testId);
    setSelectedResponse({ testId, respId });
    setResponse(null);
    const test = savedTests.find(t => t.id === testId);
    if (test) {
      if (test.type === 'socketio') { setTesterMode('socketio'); }
      else if (test.type === 'websocket') { setTesterMode('websocket'); }
      else {
        setTesterMode('rest');
        setMethod(test.method || 'GET');
        setUrl(test.url || '');
        setHeaders(test.headers?.length ? test.headers : [{ key: 'Content-Type', value: 'application/json', id: 1 }]);
        setParams(test.params?.length ? test.params : []);
        // Load saved response's request body into body editor
        const r = (savedResponses[testId] || []).find(x => x.id === respId);
        if (r?.requestBody?.trim()) {
          try { setBody(JSON.stringify(JSON.parse(r.requestBody), null, 2)); } catch { setBody(r.requestBody); }
        } else {
          setBody(test.body || '');
        }
        if (['POST','PUT','PATCH'].includes(test.method)) setActiveTab('body');
      }
    }
  }

  async function deleteTest(id) {
    const test = savedTests.find(t => t.id === id);
    const ok = await showConfirm('Delete "' + (test?.name || 'this request') + '"? This will also remove all saved responses.', { danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    const updated = savedTests.filter(t => t.id !== id);
    persistTests(updated);
    if (savedResponses[id]) {
      const r = { ...savedResponses };
      delete r[id];
      persistResponses(r);
    }
    // Clear saved field config for this route
    if (test?.url && test?.method) {
      try {
        const ep = matchedEndpoint || routeEndpoints.find(e => test.url.includes(e.fullPath) && e.method === test.method);
        if (ep) {
          const mk = encodeURIComponent(ep.fullPath + ':' + ep.method);
          api('/api-tester/fields/' + mk, { method: 'PUT', body: { fields: [] } }).catch(() => {});
        }
      } catch {}
      // Reset lastMatchRef so next time route is entered, it re-detects fresh
      lastMatchRef.current = null;
      fieldsLoadedRef.current = false;
    }
    if (selectedSaved === id) setSelectedSaved(null);
  }

  async function loadImportRoutes() {
    setShowImport(true);
    setImportLoading(true);
    try {
      const routes = await api('/api-tester/routes');
      setImportRoutes(routes);
    } catch (err) { toast(err.message, 'error'); }
    setImportLoading(false);
  }

  function importEndpoint(route, ep) {
    const port = window.location.port || '3000';
    const origin = window.location.protocol + '//' + window.location.hostname + ':' + port;
    setMethod(ep.method);
    setUrl(origin + ep.fullPath);
    setResponse(null);
    setSelectedSaved(null);
    setSelectedResponse(null);

    // Set URL params (:id, etc.)
    if (ep.params?.length > 0) {
      setUrlParams(ep.params.map((p, i) => ({ key: p, value: '', id: Date.now() + 200 + i })));
    } else {
      setUrlParams([]);
    }

    // Populate keys for testing — both the JSON body and the form-data rows, so
    // fields are pre-filled regardless of which body mode is used.
    const formRows = [
      ...((ep.bodyFields || []).map((f, i) => ({ key: f.name, value: '', type: 'text', id: Date.now() + i, fromRoute: true }))),
      ...((ep.fileFields || []).map((f, i) => ({ key: f.name, value: '', type: 'file', id: Date.now() + 500 + i, fromRoute: true }))),
    ];
    setFormFields(formRows);

    const hasFiles = ep.fileFields?.length > 0;
    if (ep.bodyFields?.length > 0 && ['POST','PUT','PATCH'].includes(ep.method)) {
      const bodyObj = {};
      ep.bodyFields.forEach(f => {
        bodyObj[f.name] = f.type === 'Number' ? 0 : f.type === 'Boolean' ? false : f.type === 'Date' ? '2024-01-01' : '';
      });
      setBody(JSON.stringify(bodyObj, null, 2));
      setHeaders([{ key: 'Content-Type', value: 'application/json', id: 1 }]);
      setActiveTab('body');
    } else {
      setBody('');
    }
    if (hasFiles && ['POST','PUT','PATCH'].includes(ep.method)) {
      setBodyType('form-data');
      setActiveTab('body');
    }

    // Set query params for GET/DELETE
    if (ep.queryFields?.length > 0 && ['GET','DELETE'].includes(ep.method)) {
      setParams(ep.queryFields.map((f, i) => ({ key: f.name, value: '', id: Date.now() + i })));
      setActiveTab('params');
    } else if (['GET','DELETE'].includes(ep.method)) {
      setParams([]);
      setActiveTab('params');
    } else {
      setParams([]);
    }

    // Set auth header if route has auth
    if (route.hasAuth) {
      const hasAuthHeader = headers.some(h => h.key === 'Authorization');
      if (!hasAuthHeader) {
        setHeaders(prev => [...prev, { key: 'Authorization', value: 'Bearer ', id: Date.now() }]);
      }
    }

    setShowImport(false);
    toast(ep.method + ' ' + ep.fullPath + ' loaded', 'success');
  }


  function updateHeader(id, field, value) {
    setHeaders(prev => prev.map(h => h.id === id ? { ...h, [field]: value } : h));
  }

  function addHeader() {
    setHeaders(prev => [...prev, { key: '', value: '', id: Date.now() }]);
  }

  function removeHeader(id) {
    setHeaders(prev => prev.filter(h => h.id !== id));
  }

  function updateParam(id, field, value) {
    setParams(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }

  function addParam() {
    setParams(prev => [...prev, { key: '', value: '', id: Date.now() }]);
  }

  function removeParam(id) {
    setParams(prev => prev.filter(p => p.id !== id));
  }

  function addHeaderPreset(type) {
    const presets = {
      'bearer': { key: 'Authorization', value: 'Bearer ' },
      'json': { key: 'Content-Type', value: 'application/json' },
      'form': { key: 'Content-Type', value: 'multipart/form-data' },
      'urlencoded': { key: 'Content-Type', value: 'application/x-www-form-urlencoded' },
      'accept': { key: 'Accept', value: 'application/json' },
    };
    const p = presets[type];
    if (p) {
      const exists = headers.find(h => h.key === p.key);
      if (exists) {
        setHeaders(prev => prev.map(h => h.key === p.key ? { ...h, value: p.value } : h));
      } else {
        setHeaders(prev => [...prev, { ...p, id: Date.now() }]);
      }
    }
  }

  function saveFieldsToServer(fields) {
    if (!matchedEndpoint) return;
    const matchKey = matchedEndpoint.fullPath + ':' + matchedEndpoint.method;
    const routeKey = encodeURIComponent(matchKey);
    api('/api-tester/fields/' + routeKey, {
      method: 'PUT',
      body: { fields: fields.map(f => ({ key: f.key, value: f.value || '', type: f.type || 'text', id: f.id })) },
    }).catch(() => {});
  }

  function addFormField() {
    setFormFields(prev => {
      const updated = [...prev, { key: '', value: '', type: 'text', id: Date.now() }];
      saveFieldsToServer(updated);
      return updated;
    });
  }

  function updateFormField(id, field, value) {
    setFormFields(prev => {
      const updated = prev.map(f => f.id === id ? { ...f, [field]: value } : f);
      saveFieldsToServer(updated);
      return updated;
    });
  }

  function removeFormField(id) {
    setFormFields(prev => {
      const updated = prev.filter(f => f.id !== id);
      saveFieldsToServer(updated);
      return updated;
    });
  }

  function handleFileSelect(fieldId, file, sendAs) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      setFormFields(prev => prev.map(f => {
        if (f.id !== fieldId) return f;
        if (sendAs === 'base64') {
          return { ...f, value: base64, fileName: file.name, fileType: file.type, sendAs: 'base64', fileSize: file.size };
        }
        return { ...f, fileData: base64, fileName: file.name, fileType: file.type, sendAs: 'file', fileSize: file.size };
      }));
    };
    reader.readAsDataURL(file);
  }

  function validateBody(val) {
    setBody(val);
    if (!val.trim()) { setBodyError(null); return; }
    try { JSON.parse(val); setBodyError(null); }
    catch (e) { setBodyError(e.message); }
  }

  function formatBody() {
    try {
      const parsed = JSON.parse(body);
      setBody(JSON.stringify(parsed, null, 2));
      setBodyError(null);
    } catch {}
  }

  const statusClass = response ? 's' + Math.floor(response.status / 100) + 'xx' : '';
  const hasBody = ['POST','PUT','PATCH'].includes(method);

  // Build display URL with param values and query params filled in
  function buildDisplayUrl() {
    let u = url;
    urlParams.forEach(p => {
      if (p.key && p.value) u = u.replace(':' + p.key, p.value);
    });
    const qp = params.filter(p => p.key?.trim() && p.value?.trim());
    if (qp.length > 0) {
      const sep = u.includes('?') ? '&' : '?';
      u += sep + qp.map(p => encodeURIComponent(p.key) + '=' + encodeURIComponent(p.value)).join('&');
    }
    return u;
  }
  const displayUrl = buildDisplayUrl();

  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const methodColors = { GET: 'var(--success)', POST: '#f59e0b', PUT: '#3b82f6', PATCH: '#8b5cf6', DELETE: 'var(--danger)' };

  const modeTabs = [
    { id: 'rest', label: 'REST API', icon: LuSend },
    { id: 'socketio', label: 'Socket.IO', icon: LuRadio },
    { id: 'websocket', label: 'WebSocket', icon: LuWifi },
  ];

  const loadedSocketTest = savedTests.find(t => t.id === selectedSaved);
  const typeBadgeStyles = {
    socketio: { background: 'rgba(52,211,153,0.15)', color: '#34d399' },
    websocket: { background: 'rgba(96,165,250,0.15)', color: '#60a5fa' },
  };

  return html`<div>
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="card-title">API Tester</div>
        <div className="card-subtitle">Test REST APIs, Socket.IO, and WebSocket connections</div>
      </div>
      <div className="flex gap-2">
        ${testerMode === 'rest' && html`<button className="btn btn-ghost btn-sm" onClick=${loadImportRoutes}>
          <${LuImport} size=${14} /> Import Route
        </button>`}
        <button className=${`btn btn-sm ${shareNeeded ? 'btn-warning' : 'btn-primary'}`}
          onClick=${shareCollection} disabled=${savedTests.length === 0}
          title="Secrets (auth tokens, passwords, and auth/cookie/api-key headers) are stripped before sharing"
          style=${shareNeeded ? { animation: 'pulse 2s infinite', background: 'var(--warning)', color: '#000' } : {}}>
          <${LuShare2} size=${14} /> ${shareNeeded ? 'Update & Share' : lastSharedAt ? 'Re-share' : 'Share'}
        </button>
      </div>
    </div>

    <div className="routes-layout">
      <!-- Left: Saved collection tree (always visible) -->
      <div className="card" style=${{ padding: 0, overflow: 'hidden' }}>
        <div style=${{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <span style=${{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Collection</span>
        </div>
        <div style=${{ maxHeight: '600px', overflowY: 'auto' }}>
          ${savedTests.length === 0 && html`<div style=${{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
            No saved requests yet
          </div>`}
          ${savedTests.map(test => {
            const resps = savedResponses[test.id] || [];
            const isExpanded = expandedTests[test.id];
            const isParentActive = selectedSaved === test.id && !selectedResponse;
            const testType = test.type || 'rest';
            return html`<div key=${test.id}>
              <div style=${{ padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                background: isParentActive ? 'var(--accent-glow)' : 'transparent',
                borderLeft: isParentActive ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'background 0.1s' }}
                onClick=${() => { loadTest(test); setSelectedResponse(null); if (resps.length > 0) setExpandedTests(prev => ({ ...prev, [test.id]: true })); }}>
                <div className="flex items-center gap-2">
                  ${resps.length > 0 && html`<span style=${{ fontSize: '10px', color: 'var(--text-muted)', width: '14px', textAlign: 'center', flexShrink: 0 }}>
                    ${isExpanded ? '▼' : '▶'}
                  </span>`}
                  ${resps.length === 0 && html`<span style=${{ width: '14px', flexShrink: 0 }} />`}
                  ${testType === 'rest' && html`<span className=${`route-method ${(test.method || 'GET').toLowerCase()}`} style=${{ fontSize: '9px', padding: '1px 5px' }}>${test.method || 'GET'}</span>`}
                  ${testType === 'socketio' && html`<span style=${{ fontSize: '9px', padding: '1px 5px', borderRadius: '4px', fontWeight: 700, fontFamily: "'SF Mono', monospace", ...typeBadgeStyles.socketio }}>SIO</span>`}
                  ${testType === 'websocket' && html`<span style=${{ fontSize: '9px', padding: '1px 5px', borderRadius: '4px', fontWeight: 700, fontFamily: "'SF Mono', monospace", ...typeBadgeStyles.websocket }}>WS</span>`}
                  <span style=${{ fontSize: '12px', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${test.name}</span>
                  ${resps.length > 0 && html`<span style=${{ fontSize: '9px', padding: '1px 5px', borderRadius: '8px', background: 'var(--accent-glow)', color: 'var(--accent-light)', fontWeight: 600 }}>${resps.length}</span>`}
                  <button className="btn btn-ghost" style=${{ padding: '2px', opacity: 0.4 }}
                    onClick=${(e) => { e.stopPropagation(); deleteTest(test.id); }}>
                    <${LuTrash2} size=${11} />
                  </button>
                </div>
              </div>
              ${isExpanded && resps.map(r => {
                const isRespActive = selectedResponse?.testId === test.id && selectedResponse?.respId === r.id;
                const isSocketChild = r.dir;
                return html`<div key=${r.id}
                  style=${{ padding: '6px 10px 6px 40px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                    background: isRespActive ? 'var(--accent-glow)' : 'transparent',
                    borderLeft: isRespActive ? '2px solid var(--accent)' : '2px solid transparent',
                    transition: 'background 0.1s' }}
                  onClick=${() => viewSavedResponse(test.id, r.id)}>
                  <div className="flex items-center gap-2">
                    ${isSocketChild
                      ? html`<span style=${{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', fontWeight: 700, fontFamily: "'SF Mono', monospace",
                          background: r.dir === 'received' ? 'rgba(52,211,153,0.15)' : r.dir === 'sent' ? 'rgba(245,158,11,0.15)' : 'rgba(148,163,184,0.15)',
                          color: r.dir === 'received' ? '#34d399' : r.dir === 'sent' ? '#f59e0b' : '#94a3b8' }}>
                          ${r.dir === 'received' ? '↓' : r.dir === 'sent' ? '↑' : '●'}
                        </span>`
                      : html`<span className=${`api-tester-status s${Math.floor(r.status / 100)}xx`} style=${{ fontSize: '10px', padding: '1px 5px' }}>
                          ${r.status}
                        </span>`}
                    <span style=${{ fontSize: '11px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>${r.label}</span>
                    <button className="btn btn-ghost" style=${{ padding: '2px', opacity: 0.3 }}
                      onClick=${(e) => { e.stopPropagation(); deleteResponse(test.id, r.id); }}>
                      <${LuTrash2} size=${10} />
                    </button>
                  </div>
                </div>`;
              })}
            </div>`;
          })}
        </div>
      </div>

      <!-- Right: Mode tabs + tester content -->
      <div>
        <div className="api-tester-mode-tabs">
          ${modeTabs.map(t => html`<button key=${t.id}
            className=${`api-tester-mode-tab${testerMode === t.id ? ' active' : ''}`}
            onClick=${() => { setTesterMode(t.id); setSelectedResponse(null); }}>
            <${t.icon} size=${14} /> ${t.label}
          </button>`)}
        </div>

        ${testerMode === 'socketio' && html`<${SocketIOTester}
          selectedSaved=${selectedSaved}
          isSaved=${!!(selectedSaved && savedTests.find(t => t.id === selectedSaved)?.type === 'socketio')}
          loadedTest=${loadedSocketTest}
          onSaveTest=${handleSaveSocketTest}
          onSaveLog=${handleSaveLog} />`}

        ${testerMode === 'websocket' && html`<${WebSocketTester}
          selectedSaved=${selectedSaved}
          isSaved=${!!(selectedSaved && savedTests.find(t => t.id === selectedSaved)?.type === 'websocket')}
          loadedTest=${loadedSocketTest}
          onSaveTest=${handleSaveSocketTest}
          onSaveLog=${handleSaveLog} />`}

        ${testerMode === 'rest' && html`<div>
          <!-- Request tabs -->
          <div style=${{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '10px', flexWrap: 'wrap' }}>
            ${tabs.map(t => { const active = t.id === activeTabId; return html`<div key=${t.id}
              onClick=${() => switchTab(t.id)}
              style=${{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
                background: active ? 'var(--accent-glow)' : 'transparent',
                color: active ? 'var(--accent-light)' : 'var(--text-secondary)',
                borderRadius: '6px', padding: '5px 10px', maxWidth: '220px', fontSize: '12px' }}>
              <span style=${{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${tabLabel(t)}</span>
              ${tabs.length > 1 && html`<span onClick=${(e) => { e.stopPropagation(); closeTab(t.id); }}
                style=${{ cursor: 'pointer', fontSize: '15px', lineHeight: 1, opacity: 0.6 }}>×</span>`}
            </div>`; })}
            <button onClick=${newTab} title="New request tab"
              style=${{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '6px', padding: '4px 11px', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>+</button>
          </div>

          <!-- Request bar -->
          <div className="api-tester-bar">
            <select className="api-tester-method"
              value=${method}
              onChange=${(e) => setMethod(e.target.value)}
              style=${{ color: methodColors[method] || 'var(--text-primary)' }}>
              ${methods.map(m => html`<option key=${m} value=${m} style=${{ color: 'var(--text-primary)' }}>${m}</option>`)}
            </select>
            <input
              className="api-tester-url"
              type="text"
              placeholder="http://localhost:3000/api/users"
              value=${url}
              onInput=${(e) => setUrl(e.target.value)}
              onKeyDown=${(e) => { if (e.key === 'Enter') sendRequest(); }}
            />
            <button className="api-tester-send" onClick=${sendRequest} disabled=${loading || !url.trim()}>
              ${loading ? html`<${LuLoader} size=${14} className="spin" />` : html`<${LuSend} size=${14} />`}
              Send
            </button>
            <button className="api-tester-send" onClick=${() => { setShowVars(v => !v); setShowHistory(false); }}
              title="Environment variables"
              style=${{ background: showVars ? 'var(--accent-glow)' : 'transparent', border: '1px solid var(--border)', color: showVars ? 'var(--accent-light)' : 'var(--text-primary)' }}>
              Variables${variables.filter(v => v.key?.trim()).length ? ` (${variables.filter(v => v.key?.trim()).length})` : ''}
            </button>
            <button className="api-tester-send" onClick=${() => { setShowHistory(h => !h); setShowVars(false); }}
              title="Request history"
              style=${{ background: showHistory ? 'var(--accent-glow)' : 'transparent', border: '1px solid var(--border)', color: showHistory ? 'var(--accent-light)' : 'var(--text-primary)' }}>
              History
            </button>
            ${!savedTests.some(t => t.type !== 'socketio' && t.type !== 'websocket' && t.method === method && t.url === url) && html`<button className="api-tester-send" onClick=${saveTest} disabled=${!url.trim()}
              style=${{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              <${LuSave} size=${14} /> Save
            </button>`}
            ${selectedResponse && (() => {
              const sr = (savedResponses[selectedResponse.testId] || []).find(x => x.id === selectedResponse.respId);
              if (!sr) return null;
              return html`<button className="api-tester-send" onClick=${() => {
                updateResponse(selectedResponse.testId, selectedResponse.respId, { requestBody: body });
              }} style=${{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                <${LuSave} size=${14} /> Update
              </button>`;
            })()}
          </div>

          ${displayUrl !== url && html`<div style=${{
            padding: '6px 14px', fontSize: '11px', color: 'var(--text-muted)',
            fontFamily: "'SF Mono', monospace", background: 'rgba(124,58,237,0.04)',
            borderRadius: '6px', marginBottom: '8px', wordBreak: 'break-all',
          }}>${displayUrl}</div>`}

          ${showVars && html`<div className="card" style=${{ padding: '12px 14px', marginBottom: '12px' }}>
            <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style=${{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Environment Variables</span>
              <label style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked=${autoToken} onChange=${e => setAutoToken(e.target.checked)} /> Auto-capture token from response
              </label>
            </div>
            ${variables.map((v, i) => html`<div key=${v.id || i} className="api-tester-kv-row">
              <input placeholder="name" value=${v.key}
                onInput=${e => setVariables(prev => prev.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} />
              <input placeholder="value" value=${v.value}
                onInput=${e => setVariables(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
              <button className="btn btn-ghost" style=${{ padding: '4px', opacity: 0.5 }}
                onClick=${() => setVariables(prev => prev.filter((_, j) => j !== i))}><${LuTrash2} size=${12} /></button>
            </div>`)}
            <div style=${{ padding: '8px 0 0' }}>
              <button className="btn btn-ghost btn-sm" onClick=${() => setVariables(prev => [...prev, { key: '', value: '', id: Date.now() }])}>
                <${LuPlus} size=${12} /> Add variable
              </button>
            </div>
            <div className="text-sm text-muted" style=${{ marginTop: '6px' }}>
              Reference anywhere with <span style=${{ fontFamily: "'SF Mono', monospace", color: 'var(--accent-light)' }}>{{name}}</span> — URL, headers, body, or Auth.
            </div>
          </div>`}

          ${showHistory && html`<div className="card" style=${{ padding: 0, marginBottom: '12px', overflow: 'hidden' }}>
            <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <span style=${{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>History</span>
              ${history.length > 0 && html`<button className="btn btn-ghost btn-sm" onClick=${clearHistory} style=${{ fontSize: '11px' }}>Clear</button>`}
            </div>
            ${history.length === 0
              ? html`<div style=${{ padding: '16px', color: 'var(--text-muted)', fontSize: '12px' }}>No requests yet — sent requests show up here.</div>`
              : history.map(h => html`<div key=${h.id}
                  onClick=${() => loadHistory(h)}
                  style=${{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: '12px' }}>
                  <span style=${{ fontWeight: 600, color: methodColors[h.method] || 'var(--text-secondary)', minWidth: '46px' }}>${h.method}</span>
                  <span style=${{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'SF Mono', monospace" }}>${h.url}</span>
                  <span style=${{ fontWeight: 600, color: h.status >= 200 && h.status < 300 ? 'var(--success)' : h.status === 0 ? 'var(--text-muted)' : 'var(--warning)' }}>${h.status || '—'}</span>
                </div>`)}
          </div>`}

          <!-- URL Params (:id, etc.) -->
          ${urlParams.length > 0 && html`<div className="card" style=${{ padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
            <div style=${{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style=${{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Path Variables</span>
            </div>
            ${urlParams.map(p => html`<div key=${p.id} className="api-tester-kv-row">
              <input value=${p.key} disabled style=${{
                flex: '0 0 120px', opacity: 0.6, fontWeight: 600, fontFamily: "'SF Mono', monospace",
                color: 'var(--accent-light)', background: 'var(--bg-input)', fontSize: '12px',
              }} />
              <input placeholder=${'Enter ' + p.key + ' value'} value=${p.value}
                onInput=${(e) => setUrlParams(prev => prev.map(up => up.id === p.id ? { ...up, value: e.target.value } : up))}
                style=${{ fontFamily: "'SF Mono', monospace", fontSize: '12px' }} />
            </div>`)}
          </div>`}

          <!-- Tabs: Params / Headers / Body -->
          <div className="card" style=${{ padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
            <div className="api-tester-tabs">
              <button className=${`api-tester-tab${activeTab === 'params' ? ' active' : ''}`}
                onClick=${() => setActiveTab('params')}>
                Params <span style=${{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>(${params.filter(p => p.key?.trim()).length})</span>
              </button>
              <button className=${`api-tester-tab${activeTab === 'headers' ? ' active' : ''}`}
                onClick=${() => setActiveTab('headers')}>
                Headers <span style=${{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>(${headers.filter(h => h.key?.trim()).length})</span>
              </button>
              ${hasBody && html`<button className=${`api-tester-tab${activeTab === 'body' ? ' active' : ''}`}
                onClick=${() => setActiveTab('body')}>
                Body
              </button>`}
              <button className=${`api-tester-tab${activeTab === 'auth' ? ' active' : ''}`}
                onClick=${() => setActiveTab('auth')}>
                Auth${auth.type !== 'none' ? html` <span style=${{ color: 'var(--success)', marginLeft: '2px' }}>●</span>` : ''}
              </button>
            </div>

            ${activeTab === 'auth' && html`<div style=${{ padding: '12px 14px' }}>
              <div style=${{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
                ${[['none', 'No Auth'], ['bearer', 'Bearer Token'], ['basic', 'Basic'], ['apikey', 'API Key']].map(([t, label]) => html`<button key=${t}
                  onClick=${() => setAuth(a => ({ ...a, type: t }))}
                  className="badge"
                  style=${{ cursor: 'pointer', border: '1px solid var(--border)', background: auth.type === t ? 'var(--accent-glow)' : 'var(--bg-input)', color: auth.type === t ? 'var(--accent-light)' : 'var(--text-secondary)' }}>${label}</button>`)}
              </div>
              ${auth.type === 'bearer' && html`<input className="form-input" placeholder="Token (e.g. {{token}})"
                value=${auth.token} onInput=${e => setAuth(a => ({ ...a, token: e.target.value }))} />`}
              ${auth.type === 'basic' && html`<div style=${{ display: 'flex', gap: '8px' }}>
                <input className="form-input" placeholder="Username" value=${auth.username} onInput=${e => setAuth(a => ({ ...a, username: e.target.value }))} />
                <input className="form-input" placeholder="Password" value=${auth.password} onInput=${e => setAuth(a => ({ ...a, password: e.target.value }))} />
              </div>`}
              ${auth.type === 'apikey' && html`<div style=${{ display: 'flex', gap: '8px' }}>
                <input className="form-input" placeholder="Header name" value=${auth.apiKeyKey} onInput=${e => setAuth(a => ({ ...a, apiKeyKey: e.target.value }))} style=${{ flex: '0 0 170px' }} />
                <input className="form-input" placeholder="Value (e.g. {{apiKey}})" value=${auth.apiKeyValue} onInput=${e => setAuth(a => ({ ...a, apiKeyValue: e.target.value }))} />
              </div>`}
              ${auth.type === 'none' && html`<div className="text-sm text-muted">No authentication will be sent with this request.</div>`}
            </div>`}

            ${activeTab === 'params' && html`<div>
              ${params.map(p => html`<div key=${p.id} className="api-tester-kv-row">
                <input placeholder="Param name" value=${p.key}
                  onInput=${(e) => updateParam(p.id, 'key', e.target.value)} />
                <input placeholder="Value" value=${p.value}
                  onInput=${(e) => updateParam(p.id, 'value', e.target.value)} />
                <button className="btn btn-ghost" style=${{ padding: '4px', opacity: 0.5 }}
                  onClick=${() => removeParam(p.id)}>
                  <${LuTrash2} size=${12} />
                </button>
              </div>`)}
              <div style=${{ padding: '8px 14px' }}>
                <button className="btn btn-ghost btn-sm" onClick=${addParam}>
                  <${LuPlus} size=${12} /> Add Param
                </button>
              </div>
            </div>`}

            ${activeTab === 'headers' && html`<div>
              ${headers.map(h => html`<div key=${h.id} className="api-tester-kv-row">
                <input placeholder="Header name" value=${h.key}
                  onInput=${(e) => updateHeader(h.id, 'key', e.target.value)} />
                <input placeholder="Value" value=${h.value}
                  onInput=${(e) => updateHeader(h.id, 'value', e.target.value)} />
                <button className="btn btn-ghost" style=${{ padding: '4px', opacity: 0.5 }}
                  onClick=${() => removeHeader(h.id)}>
                  <${LuTrash2} size=${12} />
                </button>
              </div>`)}
              <div style=${{ padding: '8px 14px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn btn-ghost btn-sm" onClick=${addHeader}>
                  <${LuPlus} size=${12} /> Add Header
                </button>
                <span style=${{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 4px' }}>|</span>
                <button className="btn btn-ghost btn-sm" style=${{ fontSize: '10px' }} onClick=${() => addHeaderPreset('bearer')}>+ Auth Bearer</button>
                <button className="btn btn-ghost btn-sm" style=${{ fontSize: '10px' }} onClick=${() => addHeaderPreset('json')}>+ JSON</button>
                <button className="btn btn-ghost btn-sm" style=${{ fontSize: '10px' }} onClick=${() => addHeaderPreset('form')}>+ Form Data</button>
                <button className="btn btn-ghost btn-sm" style=${{ fontSize: '10px' }} onClick=${() => addHeaderPreset('urlencoded')}>+ URL Encoded</button>
                <button className="btn btn-ghost btn-sm" style=${{ fontSize: '10px' }} onClick=${() => addHeaderPreset('accept')}>+ Accept JSON</button>
              </div>
            </div>`}

            ${activeTab === 'body' && hasBody && html`<div>
              <div style=${{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)' }}>
                ${[
                  { id: 'json', label: 'JSON' },
                  { id: 'form-data', label: 'Form Data' },
                  { id: 'x-www-form-urlencoded', label: 'URL Encoded' },
                  { id: 'raw', label: 'Raw' },
                  { id: 'binary', label: 'Binary' },
                ].map(bt => html`<button key=${bt.id}
                  style=${{
                    padding: '6px 14px', fontSize: '11px', fontWeight: bodyType === bt.id ? 600 : 400,
                    color: bodyType === bt.id ? 'var(--accent-light)' : 'var(--text-muted)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    borderBottom: bodyType === bt.id ? '2px solid var(--accent)' : '2px solid transparent',
                    transition: 'all 0.15s',
                  }}
                  onClick=${() => setBodyType(bt.id)}
                >${bt.label}</button>`)}
              </div>

              ${(bodyType === 'json' || bodyType === 'raw') && html`<div>
                <textarea
                  ref=${bodyRef}
                  className="api-tester-body-editor"
                  placeholder=${bodyType === 'json' ? '{\n  "key": "value"\n}' : 'Enter raw body...'}
                  value=${body}
                  onInput=${(e) => bodyType === 'json' ? validateBody(e.target.value) : setBody(e.target.value)}
                  onBlur=${bodyType === 'json' ? formatBody : undefined}
                  spellcheck=${false}
                  style=${{ borderTop: bodyError && bodyType === 'json' ? '2px solid var(--danger)' : 'none' }}
                />
                ${bodyError && bodyType === 'json' && html`<div style=${{ padding: '6px 14px', fontSize: '11px', color: 'var(--danger)', background: 'rgba(248,113,113,0.06)' }}>
                  Invalid JSON: ${bodyError}
                </div>`}
              </div>`}

              ${(bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded') && html`<div>
                ${formFields.map(f => html`<div key=${f.id} style=${{
                  display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 14px',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <input placeholder="Key" value=${f.key} style=${{
                    flex: '0 0 140px', padding: '6px 10px', fontSize: '12px',
                    background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '6px',
                    color: 'var(--text-primary)', outline: 'none',
                  }} onInput=${(e) => updateFormField(f.id, 'key', e.target.value)} />

                  ${bodyType === 'form-data' && html`<select style=${{
                    padding: '6px 8px', fontSize: '11px', background: 'var(--bg-input)',
                    border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-secondary)',
                    cursor: 'pointer', minWidth: '70px',
                  }} value=${f.type || 'text'} onChange=${(e) => updateFormField(f.id, 'type', e.target.value)}>
                    <option value="text">Text</option>
                    <option value="file">File</option>
                  </select>`}

                  ${(f.type !== 'file' || bodyType === 'x-www-form-urlencoded') && html`<input
                    placeholder="Value" value=${f.value || ''} style=${{
                    flex: 1, padding: '6px 10px', fontSize: '12px',
                    background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '6px',
                    color: 'var(--text-primary)', outline: 'none',
                  }} onInput=${(e) => updateFormField(f.id, 'value', e.target.value)} />`}

                  ${f.type === 'file' && bodyType === 'form-data' && html`<div style=${{ flex: 1, display: 'flex', gap: '6px', alignItems: 'center' }}>
                    ${f.fileName ? html`<span style=${{
                      fontSize: '11px', color: 'var(--text-secondary)', padding: '4px 8px',
                      background: 'var(--bg-input)', borderRadius: '4px', border: '1px solid var(--border)',
                      maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>${f.fileName} <span style=${{ color: 'var(--text-muted)', fontSize: '10px' }}>(${f.fileSize > 1024 ? (f.fileSize / 1024).toFixed(1) + 'KB' : f.fileSize + 'B'})</span></span>` : null}
                    <label style=${{
                      padding: '5px 12px', fontSize: '11px', borderRadius: '6px', cursor: 'pointer',
                      background: 'var(--bg-input)', border: '1px solid var(--border)',
                      color: 'var(--accent-light)', fontWeight: 500,
                    }}>
                      ${f.fileName ? 'Change' : 'Choose File'}
                      <input type="file" style=${{ display: 'none' }} onChange=${(e) => {
                        const file = e.target.files[0];
                        if (file) {
                          const sendAs = f.sendAs || 'file';
                          handleFileSelect(f.id, file, sendAs);
                        }
                      }} />
                    </label>
                    ${f.fileName && html`<select style=${{
                      padding: '5px 8px', fontSize: '10px', background: 'var(--bg-input)',
                      border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }} value=${f.sendAs || 'file'} onChange=${(e) => {
                      const newSendAs = e.target.value;
                      setFormFields(prev => prev.map(ff => {
                        if (ff.id !== f.id) return ff;
                        var updated = { ...ff, sendAs: newSendAs };
                        if (ff.fileData && newSendAs === 'base64') updated.value = ff.fileData;
                        else if (ff.value && newSendAs === 'file') updated.fileData = ff.value;
                        return updated;
                      }));
                    }}>
                      <option value="file">Send as File</option>
                      <option value="base64">Send as Base64</option>
                    </select>`}
                  </div>`}

                  <button className="btn btn-ghost" style=${{ padding: '4px', opacity: 0.5 }}
                    onClick=${() => removeFormField(f.id)}>
                    <${LuTrash2} size=${12} />
                  </button>
                </div>`)}
                <div style=${{ padding: '8px 14px' }}>
                  <button className="btn btn-ghost btn-sm" onClick=${addFormField}>
                    <${LuPlus} size=${12} /> Add Field
                  </button>
                </div>
              </div>`}

              ${bodyType === 'binary' && html`<div style=${{ padding: '20px 14px', textAlign: 'center' }}>
                <label style=${{
                  padding: '12px 24px', fontSize: '13px', borderRadius: '8px', cursor: 'pointer',
                  background: 'var(--bg-input)', border: '1.5px dashed var(--border)',
                  color: 'var(--accent-light)', fontWeight: 500, display: 'inline-block',
                }}>
                  ${body ? 'File selected (' + (body.length * 0.75 / 1024).toFixed(1) + ' KB)' : 'Choose File'}
                  <input type="file" style=${{ display: 'none' }} onChange=${(e) => {
                    const file = e.target.files[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = () => setBody(reader.result.split(',')[1]);
                      reader.readAsDataURL(file);
                    }
                  }} />
                </label>
                ${body && html`<button className="btn btn-ghost btn-sm" style=${{ marginLeft: '8px' }}
                  onClick=${() => setBody('')}>Clear</button>`}
              </div>`}
            </div>`}
          </div>

          <!-- Saved response detail (inline) -->
          ${selectedResponse && (() => {
            const r = (savedResponses[selectedResponse.testId] || []).find(x => x.id === selectedResponse.respId);
            if (!r) return null;
            const rStatusClass = 's' + Math.floor((r.status || 0) / 100) + 'xx';
            return html`<div className="card" style=${{ padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
              <div style=${{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style=${{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Saved Response</span>
                <span className=${`api-tester-status ${rStatusClass}`}>${r.status} ${r.statusText}</span>
                <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>${r.time}ms</span>
                <span style=${{ fontSize: '13px', fontWeight: 500, marginLeft: 'auto', color: 'var(--text-secondary)' }}>${r.label}</span>
              </div>
              <div className="api-tester-response-body">${(() => {
                try { return JSON.stringify(JSON.parse(r.body), null, 2); } catch { return r.body || 'No response body'; }
              })()}</div>
            </div>`;
          })()}

          <!-- Response (live) -->
          ${response && !selectedResponse && html`<div className="card" style=${{ padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
            <div style=${{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style=${{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Response</span>
              <span className=${`api-tester-status ${statusClass}`}>
                ${response.status} ${response.statusText}
              </span>
              <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>${response.time}ms</span>
              <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>
                ${response.size > 1024 ? (response.size / 1024).toFixed(1) + ' KB' : response.size + ' B'}
              </span>
              <div style=${{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                <button className="btn btn-ghost btn-sm" style=${{ fontSize: '11px' }}
                  onClick=${() => { copyToClipboard(response.body || ''); toast('Copied', 'success'); }}>
                  <${LuCopy} size=${12} /> Copy
                </button>
                <button className="btn btn-ghost btn-sm" style=${{ fontSize: '11px' }}
                  onClick=${saveResponse}>
                  <${LuSave} size=${12} /> Save
                </button>
              </div>
            </div>
            <div style=${{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)' }}>
              <button style=${{
                padding: '5px 14px', fontSize: '11px', background: 'none', border: 'none', cursor: 'pointer',
                color: responseTab === 'body' ? 'var(--accent-light)' : 'var(--text-muted)',
                borderBottom: responseTab === 'body' ? '2px solid var(--accent)' : '2px solid transparent',
                fontWeight: responseTab === 'body' ? 600 : 400,
              }} onClick=${() => setResponseTab('body')}>Body</button>
              <button style=${{
                padding: '5px 14px', fontSize: '11px', background: 'none', border: 'none', cursor: 'pointer',
                color: responseTab === 'headers' ? 'var(--accent-light)' : 'var(--text-muted)',
                borderBottom: responseTab === 'headers' ? '2px solid var(--accent)' : '2px solid transparent',
                fontWeight: responseTab === 'headers' ? 600 : 400,
              }} onClick=${() => setResponseTab('headers')}>Headers <span style=${{ fontSize: '10px', color: 'var(--text-muted)' }}>(${Object.keys(response.headers || {}).length})</span></button>
            </div>
            ${responseTab === 'body' && html`<div className="api-tester-response-body">
              ${response.body || 'No response body'}
            </div>`}
            ${responseTab === 'headers' && html`<div style=${{ padding: '8px 0' }}>
              ${Object.entries(response.headers || {}).map(([k, v]) => html`<div key=${k} style=${{
                display: 'flex', padding: '4px 14px', fontSize: '12px', gap: '12px',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}>
                <span style=${{ fontWeight: 600, color: 'var(--accent-light)', minWidth: '180px', fontFamily: "'SF Mono', monospace", fontSize: '11px' }}>${k}</span>
                <span style=${{ color: 'var(--text-secondary)', fontFamily: "'SF Mono', monospace", fontSize: '11px', wordBreak: 'break-all' }}>${v}</span>
              </div>`)}
            </div>`}
          </div>`}

          ${!response && !loading && !selectedResponse && html`<div className="card">
            <div className="empty-state" style=${{ padding: '40px' }}>
              <div className="empty-icon"><${LuSend} size=${32} /></div>
              <h3>Send a Request</h3>
              <p>Enter a URL and click Send, or import from your existing routes</p>
            </div>
          </div>`}
        </div>`}

        <!-- Viewing a saved socket response detail -->
        ${selectedResponse && testerMode !== 'rest' && (() => {
          const r = (savedResponses[selectedResponse.testId] || []).find(x => x.id === selectedResponse.respId);
          const parentTest = savedTests.find(t => t.id === selectedResponse.testId);
          if (!r || !parentTest) return null;
          return html`<${SavedResponseDetail}
            key=${selectedResponse.respId}
            resp=${r}
            parentTest=${parentTest}
            onBack=${() => { setSelectedResponse(null); loadTest(parentTest); }}
            onUpdate=${(changes) => updateResponse(selectedResponse.testId, selectedResponse.respId, changes)} />`;
        })()}
      </div>
    </div>

    <!-- Import Route Panel -->
    <${AnimatePresence}>
      ${showImport && html`<${React.Fragment}>
        <${motion.div}
          key="import-overlay"
          initial=${{ opacity: 0 }}
          animate=${{ opacity: 1 }}
          exit=${{ opacity: 0 }}
          transition=${{ duration: 0.2 }}
          onClick=${() => setShowImport(false)}
          style=${{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }}
        />
        <${motion.div}
          key="import-panel"
          initial=${{ x: '100%' }}
          animate=${{ x: 0 }}
          exit=${{ x: '100%' }}
          transition=${{ type: 'tween', duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          style=${{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: '25%', minWidth: '300px',
            background: 'var(--bg-card)', borderLeft: '1px solid var(--border)',
            boxShadow: '-8px 0 30px rgba(0,0,0,0.3)', zIndex: 1001,
            display: 'flex', flexDirection: 'column',
          }}>
          <div style=${{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style=${{ fontWeight: 600, fontSize: '15px' }}>Import from Routes</div>
            <button onClick=${() => setShowImport(false)}
              style=${{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '18px', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px', lineHeight: 1 }}
              onMouseOver=${(e) => e.currentTarget.style.color = 'var(--text)'}
              onMouseOut=${(e) => e.currentTarget.style.color = 'var(--text-muted)'}>✕</button>
          </div>
          <div style=${{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            ${importLoading && html`<div style=${{ padding: '40px', textAlign: 'center' }}><span className="spinner" /></div>`}
            ${!importLoading && importRoutes.length === 0 && html`<div style=${{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>No routes found</div>`}
            ${!importLoading && importRoutes.map(route => html`<div key=${route.name}>
              <div style=${{ padding: '10px 20px 6px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 }}>
                ${route.name} <span style=${{ fontWeight: 400, textTransform: 'none' }}>(${route.prefix})</span>
              </div>
              ${route.endpoints.map((ep, i) => html`<div key=${i}
                style=${{ padding: '9px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', transition: 'background 0.1s', borderBottom: '1px solid rgba(255,255,255,0.02)' }}
                onClick=${() => importEndpoint(route, ep)}
                onMouseOver=${(e) => e.currentTarget.style.background = 'var(--bg-input)'}
                onMouseOut=${(e) => e.currentTarget.style.background = 'transparent'}>
                <span className=${`route-method ${ep.method.toLowerCase()}`} style=${{ fontSize: '10px', padding: '2px 7px' }}>${ep.method}</span>
                <span style=${{ fontFamily: "'SF Mono', monospace", fontSize: '12px', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${ep.fullPath}</span>
                ${ep.bodyFields?.length > 0 && html`<span style=${{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>${ep.bodyFields.length} fields</span>`}
              </div>`)}
            </div>`)}
          </div>
        <//>
      <//>`}
    <//>
  </div>`;
}

