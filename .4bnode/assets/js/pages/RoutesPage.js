import React, { useState, useEffect, useRef } from "react";
import { LuPlug } from "react-icons/lu";
import { html, api, Icons } from "../lib.js";
import { useApp } from "../context.js";

export function RoutesPage() {
  const { data, toast, refresh, showConfirm } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [routeContents, setRouteContents] = useState({});
  const [loadingRoute, setLoadingRoute] = useState(null);
  const [showAddMethod, setShowAddMethod] = useState(false);
  const [amRouteType, setAmRouteType] = useState(null);
  const [amMethods, setAmMethods] = useState([]);
  const [amModelName, setAmModelName] = useState("");
  const [amLoginField, setAmLoginField] = useState("");
  const [amPasswordField, setAmPasswordField] = useState("");
  const [amRegisterFields, setAmRegisterFields] = useState([]);
  const [amSelectedFields, setAmSelectedFields] = useState([]);
  const [amCustomFields, setAmCustomFields] = useState([]);
  const [amNewFieldName, setAmNewFieldName] = useState("");
  const [amNewFieldType, setAmNewFieldType] = useState("String");
  const [amLoading, setAmLoading] = useState(false);

  // Auto-select first route
  useEffect(() => {
    if (data.routes?.length > 0 && !selectedRoute && !showCreate) {
      selectRoute(data.routes[0]);
    }
  }, [data.routes]);

  async function selectRoute(filename) {
    setShowCreate(false);
    setSelectedRoute(filename);
    if (!routeContents[filename]) {
      setLoadingRoute(filename);
      try {
        const result = await api("/routes/" + filename + "/content");
        setRouteContents((prev) => ({ ...prev, [filename]: result }));
      } catch (err) {
        toast(err.message, "error");
      }
      setLoadingRoute(null);
    }
  }

  function parseEndpoints(content) {
    if (!content) return [];
    const endpoints = [];
    const regex =
      /router\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]*?)['"`]/gi;
    let m;
    while ((m = regex.exec(content)) !== null) {
      endpoints.push({ method: m[1].toUpperCase(), path: m[2] });
    }
    return endpoints;
  }

  function getMethodsForFile(filename) {
    const content = routeContents[filename]?.content;
    if (!content) return [];
    const methods = [];
    const regex = /router\.(get|post|put|patch|delete)\(/gi;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const method = m[1].toUpperCase();
      if (!methods.includes(method)) methods.push(method);
    }
    return methods;
  }

  const selName = selectedRoute?.replace(".js", "") || "";
  const selContent = routeContents[selectedRoute]?.content;
  const selEndpoints = parseEndpoints(selContent);
  const hasAuth = selContent?.includes("import auth") || false;
  const hasModel = selContent?.match(
    /import\s+(\w+)\s+from\s+'\.\.\/models/,
  );

  // When no routes yet, show empty + create in a simpler layout
  if (data.routes?.length === 0 && !showCreate) {
    return html`<div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="card-title">API Routes</div>
          <div className="card-subtitle">0 route files</div>
        </div>
        <button
          className="btn btn-primary"
          onClick=${() => setShowCreate(true)}
        >
          <span className="sidebar-icon">${Icons.plus}</span> New Route
        </button>
      </div>
      <div className="empty-state">
        <div className="empty-icon"><${LuPlug} size=${36} /></div>
        <h3>No routes yet</h3>
        <p>Create your first API endpoint to get started</p>
        <button
          className="btn btn-primary"
          onClick=${() => setShowCreate(true)}
        >
          Create Route
        </button>
      </div>
    </div>`;
  }

  return html`<div>
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="card-title">API Routes</div>
        <div className="card-subtitle">
          ${data.routes?.length || 0} route
          file${data.routes?.length !== 1 ? "s" : ""}
        </div>
      </div>
      <button
        className=${`btn ${showCreate ? "btn-ghost" : "btn-primary"}`}
        onClick=${() => {
          if (showCreate) {
            setShowCreate(false);
            if (data.routes?.length) selectRoute(data.routes[0]);
          } else {
            setShowCreate(true);
            setSelectedRoute(null);
          }
        }}
      >
        ${showCreate
          ? "Cancel"
          : html`<span className="sidebar-icon">${Icons.plus}</span> New
              Route`}
      </button>
    </div>

    <div className="routes-layout">
      <div className="card" style=${{ padding: 0, overflow: "hidden" }}>
        <div
          style=${{
            padding: "14px 16px 10px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span
            style=${{
              fontWeight: 600,
              fontSize: "12px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--text-muted)",
            }}
            >Files</span
          >
        </div>
        <div className="routes-list">
          ${(data.routes || []).map((r) => {
            const rName = r.replace(".js", "");
            const methods = getMethodsForFile(r);
            const isActive = selectedRoute === r && !showCreate;
            return html`<div
              key=${r}
              className=${`route-item ${isActive ? "active" : ""}`}
              onClick=${() => selectRoute(r)}
            >
              <div
                style=${{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <span className="ri-name">${rName}</span>
                <span className="ri-file">src/routes/${r}</span>
              </div>
              <div className="flex gap-1" style=${{ flexWrap: "wrap" }}>
                ${methods.length > 0
                  ? methods.map(
                      (m) =>
                        html`<span
                          key=${m}
                          className=${`route-method ${m.toLowerCase()}`}
                          >${m}</span
                        >`,
                    )
                  : html`<span className="route-method multi">...</span>`}
              </div>
            </div>`;
          })}
          <div
            className=${`route-item ${showCreate ? "active" : ""}`}
            onClick=${() => {
              setShowCreate(true);
              setSelectedRoute(null);
            }}
            style=${{
              borderTop: data.routes?.length
                ? "1px solid var(--border)"
                : "none",
            }}
          >
            <span
              className="sidebar-icon"
              style=${{ color: "var(--accent-light)" }}
              >${Icons.plus}</span
            >
            <span
              className="ri-name"
              style=${{ color: "var(--accent-light)" }}
              >New Route</span
            >
          </div>
        </div>
      </div>

      <div className="routes-detail">
        ${showCreate &&
        html`<${CreateRoutePanel}
          onCreated=${() => {
            setShowCreate(false);
            refresh();
          }}
        />`}
        ${!showCreate &&
        !selectedRoute &&
        html`<div className="card">
          <div className="empty-state" style=${{ padding: "40px" }}>
            <p>Select a route to view details</p>
          </div>
        </div>`}
        ${!showCreate &&
        selectedRoute &&
        html`<div>
          <div className="card mb-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div
                  style=${{
                    fontWeight: 600,
                    fontSize: "16px",
                    marginBottom: "2px",
                  }}
                >
                  ${selName}
                </div>
                <div
                  className="text-sm text-muted"
                  style=${{
                    fontFamily: "'SF Mono', 'Fira Code', monospace",
                  }}
                >
                  src/routes/${selectedRoute}
                </div>
              </div>
              <div className="flex gap-2 items-center">
                ${hasAuth &&
                html`<span className="badge badge-warning">Auth</span>`}
                ${hasModel &&
                html`<span className="badge badge-info"
                  >Model: ${hasModel[1]}</span
                >`}
                <button
                  className=${`btn btn-sm ${showAddMethod ? 'btn-primary' : 'btn-ghost'}`}
                  onClick=${() => {
                    setShowAddMethod(!showAddMethod);
                    setAmRouteType(null);
                    setAmMethods([]);
                    setAmModelName("");
                    setAmLoginField("");
                    setAmPasswordField("");
                    setAmRegisterFields([]);
                    setAmSelectedFields([]);
                    setAmCustomFields([]);
                  }}
                >
                  ${showAddMethod ? "Cancel" : html`<span className="sidebar-icon">${Icons.plus}</span> Add`}
                </button>
                <button
                  className="btn btn-danger btn-sm btn-icon"
                  onClick=${async () => {
                    const ok = await showConfirm('Delete route "' + selName + '"? This will remove the route file and its registration from index.js.', { danger: true, confirmLabel: 'Delete Route' });
                    if (!ok) return;
                    try {
                      await api("/routes/" + selectedRoute, {
                        method: "DELETE",
                      });
                      toast('Route "' + selName + '" deleted', "success");
                      setSelectedRoute(null);
                      setRouteContents((prev) => {
                        const n = { ...prev };
                        delete n[selectedRoute];
                        return n;
                      });
                      refresh();
                    } catch (err) {
                      toast(err.message, "error");
                    }
                  }}
                >
                  <span className="sidebar-icon">${Icons.trash}</span>
                </button>
              </div>
            </div>

            ${selEndpoints.length > 0 &&
            html`<div>
              <div
                style=${{
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: "var(--text-muted)",
                  marginBottom: "8px",
                }}
              >
                Endpoints
              </div>
              ${selEndpoints.map(
                (ep, i) =>
                  html`<div className="route-endpoint-row" key=${i}>
                    <span
                      className=${`route-method ${ep.method.toLowerCase()}`}
                      >${ep.method}</span
                    >
                    <span className="route-endpoint-path"
                      >/api/${selName}${ep.path === "/"
                        ? ""
                        : ep.path}</span
                    >
                  </div>`,
              )}
            </div>`}
          </div>

          ${(() => {
            const amNeedsModel = amRouteType && amRouteType !== "methods" && amRouteType !== "plain";
            const amIsAuthType = amRouteType === "login" || amRouteType === "register";
            const amModelObj = data.models?.find(m => m.name === amModelName);
            const amModelFields = amModelObj?.fields || [];
            const amMethodColors = { get: "#22c55e", post: "#3b82f6", put: "#f59e0b", patch: "#a855f7", delete: "#ef4444" };
            const existingMethods = selEndpoints.map(ep => ep.method.toLowerCase());
            const amCanSubmit = amRouteType && (amRouteType !== "methods" || amMethods.length > 0) && (amRouteType !== "crud" || amMethods.length > 0) && (!amNeedsModel || amModelName) && (!amIsAuthType || amLoginField);

            return showAddMethod && html`<div className="card mb-4">
            <div style=${{ fontSize: "15px", fontWeight: 600, marginBottom: "14px" }}>Add to ${selName}</div>

            <div className="form-group">
              <label className="form-label">Type</label>
              <div style=${{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px" }}>
                ${[
                  { id: "methods", label: "Methods", desc: "GET, POST, PUT...", color: "var(--accent-light)" },
                  { id: "crud", label: "CRUD", desc: "Model CRUD ops", color: "#3b82f6" },
                  { id: "login", label: "Login", desc: "JWT login", color: "#22d3ee" },
                  { id: "register", label: "Register", desc: "Sign up", color: "#34d399" },
                ].map(t => {
                  const active = amRouteType === t.id;
                  return html`<button key=${t.id} style=${{
                    padding: "8px 4px", borderRadius: "var(--radius)", cursor: "pointer", textAlign: "center",
                    border: active ? "1.5px solid " + t.color : "1.5px solid var(--border)",
                    background: active ? "rgba(255,255,255,0.04)" : "var(--bg-input)",
                    opacity: active ? 1 : 0.5, transition: "all 0.15s",
                  }} onClick=${() => { setAmRouteType(prev => prev === t.id ? null : t.id); if (t.id !== "methods" && t.id !== "crud") setAmMethods([]); }}>
                    <div style=${{ fontSize: "11px", fontWeight: 700, color: active ? t.color : "var(--text-secondary)" }}>${t.label}</div>
                    <div style=${{ fontSize: "9px", color: "var(--text-muted)", marginTop: "1px" }}>${t.desc}</div>
                  </button>`;
                })}
              </div>
            </div>

            ${amRouteType === "methods" && html`<div className="form-group">
              <label className="form-label">HTTP Methods</label>
              <div className="flex gap-2">
                ${["get", "post", "put", "patch", "delete"].map(m => html`<button key=${m}
                  className=${`route-method ${m}`}
                  style=${{
                    cursor: existingMethods.includes(m) ? "not-allowed" : "pointer",
                    border: amMethods.includes(m) ? "2px solid " + amMethodColors[m] : "2px solid transparent",
                    padding: "6px 12px", fontSize: "11px",
                    opacity: existingMethods.includes(m) ? 0.15 : amMethods.includes(m) ? 1 : 0.35,
                    borderRadius: "6px", transition: "all 0.15s",
                    textDecoration: existingMethods.includes(m) ? "line-through" : "none",
                  }}
                  disabled=${existingMethods.includes(m)}
                  onClick=${() => !existingMethods.includes(m) && setAmMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])}
                >${m.toUpperCase()}</button>`)}
              </div>
            </div>`}

            ${amRouteType === "crud" && html`<div className="form-group">
              <label className="form-label">CRUD Methods <span style=${{ color: "var(--text-muted)", fontWeight: 400 }}>(select operations)</span></label>
              <div className="flex gap-2">
                ${["get", "post", "put", "patch", "delete"].map(m => {
                  const labels = { get: "READ", post: "CREATE", put: "UPDATE", patch: "PATCH", delete: "DELETE" };
                  return html`<button key=${m} className=${`route-method ${m}`} style=${{
                    cursor: existingMethods.includes(m) ? "not-allowed" : "pointer",
                    border: amMethods.includes(m) ? "2px solid " + amMethodColors[m] : "2px solid transparent",
                    padding: "6px 12px", fontSize: "11px",
                    opacity: existingMethods.includes(m) ? 0.15 : amMethods.includes(m) ? 1 : 0.35,
                    borderRadius: "6px", transition: "all 0.15s",
                    textDecoration: existingMethods.includes(m) ? "line-through" : "none",
                  }} disabled=${existingMethods.includes(m)}
                    onClick=${() => !existingMethods.includes(m) && setAmMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])}
                  >${labels[m]}</button>`;
                })}
              </div>
            </div>`}

            ${amNeedsModel && html`<div className="form-group">
              <label className="form-label">Model</label>
              <select className="form-select" value=${amModelName} onChange=${(e) => { setAmModelName(e.target.value); setAmLoginField(""); setAmPasswordField(""); setAmRegisterFields([]); }}>
                <option value="">Select a model...</option>
                ${(data.models || []).map(m => html`<option key=${m.name} value=${m.name}>${m.name}</option>`)}
              </select>
            </div>`}

            ${amRouteType === "methods" && html`<div className="form-group">
              <label className="form-label">Fields from Model <span style=${{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span></label>
              ${data.models?.length > 0 ? html`<select className="form-select" style=${{ marginBottom: "8px" }} value=${amModelName}
                onChange=${(e) => { setAmModelName(e.target.value); setAmSelectedFields([]); }}>
                <option value="">Select a model...</option>
                ${data.models.map(m => html`<option key=${m.name} value=${m.name}>${m.name}</option>`)}
              </select>
              ${amModelName && amModelFields.length > 0 && html`<div className="flex gap-2" style=${{ flexWrap: "wrap" }}>
                ${amModelFields.map(f => {
                  const active = amSelectedFields.includes(f.name);
                  return html`<button key=${f.name} style=${{
                    padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer",
                    border: active ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
                    background: active ? "var(--accent-glow)" : "var(--bg-input)",
                    color: active ? "var(--accent-light)" : "var(--text-secondary)",
                    fontWeight: active ? 600 : 400, transition: "all 0.15s",
                  }} onClick=${() => setAmSelectedFields(prev => active ? prev.filter(x => x !== f.name) : [...prev, f.name])}>
                    ${f.name} <span style=${{ fontSize: "10px", color: "var(--text-muted)", marginLeft: "4px" }}>${f.type}</span>
                  </button>`;
                })}
              </div>`}` : html`<div style=${{ fontSize: "11px", color: "var(--text-muted)" }}>No models found.</div>`}
            </div>`}

            ${amRouteType === "login" && amModelName && amModelFields.length > 0 && html`<div className="form-group">
              <label className="form-label">Find user by</label>
              <div className="flex gap-2" style=${{ flexWrap: "wrap" }}>
                ${amModelFields.map(f => html`<button key=${f.name} style=${{
                  padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer",
                  border: amLoginField === f.name ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
                  background: amLoginField === f.name ? "var(--accent-glow)" : "var(--bg-input)",
                  color: amLoginField === f.name ? "var(--accent-light)" : "var(--text-secondary)",
                  fontWeight: amLoginField === f.name ? 600 : 400, transition: "all 0.15s",
                }} onClick=${() => setAmLoginField(f.name)}>${f.name}</button>`)}
              </div>
            </div>`}

            ${amIsAuthType && amModelName && amModelFields.length > 0 && html`<div className="form-group">
              <label className="form-label">Password field <span style=${{ color: "var(--text-muted)", fontWeight: 400 }}>(optional — enables bcrypt)</span></label>
              <div className="flex gap-2" style=${{ flexWrap: "wrap" }}>
                <button style=${{
                  padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer",
                  border: !amPasswordField ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
                  background: !amPasswordField ? "var(--accent-glow)" : "var(--bg-input)",
                  color: !amPasswordField ? "var(--accent-light)" : "var(--text-secondary)",
                  fontWeight: !amPasswordField ? 600 : 400, transition: "all 0.15s",
                }} onClick=${() => setAmPasswordField("")}>None</button>
                ${amModelFields.map(f => html`<button key=${f.name} style=${{
                  padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer",
                  border: amPasswordField === f.name ? "1.5px solid var(--warning)" : "1.5px solid var(--border)",
                  background: amPasswordField === f.name ? "var(--warning-glow)" : "var(--bg-input)",
                  color: amPasswordField === f.name ? "var(--warning)" : "var(--text-secondary)",
                  fontWeight: amPasswordField === f.name ? 600 : 400, transition: "all 0.15s",
                }} onClick=${() => setAmPasswordField(f.name)}>${f.name}</button>`)}
              </div>
            </div>`}

            ${amRouteType === "register" && amModelName && amModelFields.length > 0 && html`<div className="form-group">
              <label className="form-label">Registration fields</label>
              <div className="flex gap-2" style=${{ flexWrap: "wrap" }}>
                ${amModelFields.map(f => {
                  const active = amRegisterFields.includes(f.name);
                  return html`<button key=${f.name} style=${{
                    padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer",
                    border: active ? "1.5px solid var(--success)" : "1.5px solid var(--border)",
                    background: active ? "var(--success-glow)" : "var(--bg-input)",
                    color: active ? "var(--success)" : "var(--text-secondary)",
                    fontWeight: active ? 600 : 400, transition: "all 0.15s",
                  }} onClick=${() => setAmRegisterFields(prev => active ? prev.filter(x => x !== f.name) : [...prev, f.name])}>${f.name}</button>`;
                })}
              </div>
            </div>`}

            ${amRouteType === "register" && amModelName && amModelFields.length > 0 && html`<div className="form-group">
              <label className="form-label">Check duplicate by</label>
              <div className="flex gap-2" style=${{ flexWrap: "wrap" }}>
                ${amModelFields.map(f => html`<button key=${f.name} style=${{
                  padding: "5px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer",
                  border: amLoginField === f.name ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
                  background: amLoginField === f.name ? "var(--accent-glow)" : "var(--bg-input)",
                  color: amLoginField === f.name ? "var(--accent-light)" : "var(--text-secondary)",
                  fontWeight: amLoginField === f.name ? 600 : 400, transition: "all 0.15s",
                }} onClick=${() => setAmLoginField(f.name)}>${f.name}</button>`)}
              </div>
            </div>`}

            ${amRouteType === "methods" && html`<div className="form-group">
              <label className="form-label">Custom Fields <span style=${{ color: "var(--text-muted)", fontWeight: 400 }}>(from client)</span></label>
              ${amCustomFields.length > 0 && html`<div style=${{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                ${amCustomFields.map((f, i) => html`<span key=${i} style=${{
                  padding: "4px 10px", borderRadius: "6px", fontSize: "12px",
                  background: "var(--bg-input)", border: "1.5px solid var(--border)",
                  color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px",
                }}>
                  ${f.name} <span style=${{ fontSize: "10px", color: f.type === "File" ? "var(--warning)" : "var(--text-muted)" }}>${f.type}</span>
                  <span style=${{ cursor: "pointer", color: "var(--text-muted)", fontSize: "14px", lineHeight: 1 }}
                    onClick=${() => setAmCustomFields(prev => prev.filter((_, idx) => idx !== i))}>×</span>
                </span>`)}
              </div>`}
              <div className="flex gap-2" style=${{ alignItems: "center" }}>
                <input className="form-input" value=${amNewFieldName}
                  onInput=${(e) => setAmNewFieldName(e.target.value)} placeholder="Field name"
                  style=${{ fontSize: "13px", padding: "8px 12px", flex: 1 }}
                  onKeyDown=${(e) => { if (e.key === "Enter" && amNewFieldName.trim()) { setAmCustomFields(prev => [...prev, { name: amNewFieldName.trim(), type: amNewFieldType }]); setAmNewFieldName(""); }}} />
                <select className="form-select" value=${amNewFieldType} onChange=${(e) => setAmNewFieldType(e.target.value)} style=${{ width: "auto", minWidth: "100px" }}>
                  <option value="String">String</option><option value="Number">Number</option><option value="Boolean">Boolean</option>
                  <option value="Date">Date</option><option value="Array">Array</option><option value="Object">Object</option><option value="File">File</option>
                </select>
                <button className="btn btn-sm" style=${{
                  padding: "8px 14px", fontSize: "12px", background: "var(--bg-input)",
                  border: "1.5px solid var(--border)", color: "var(--text-primary)",
                  cursor: amNewFieldName.trim() ? "pointer" : "not-allowed",
                  opacity: amNewFieldName.trim() ? 1 : 0.4, borderRadius: "6px",
                }} disabled=${!amNewFieldName.trim()} onClick=${() => { if (amNewFieldName.trim()) { setAmCustomFields(prev => [...prev, { name: amNewFieldName.trim(), type: amNewFieldType }]); setAmNewFieldName(""); } }}>+ Add</button>
              </div>
            </div>`}

            ${amCanSubmit && html`<button className="btn btn-primary" disabled=${amLoading}
              onClick=${async () => {
                setAmLoading(true);
                try {
                  const result = await api("/routes/" + selectedRoute + "/add-method", {
                    method: "POST",
                    body: {
                      routeType: amRouteType,
                      methods: (amRouteType === "methods" || amRouteType === "crud") ? amMethods : undefined,
                      modelName: amModelName || undefined,
                      loginField: amIsAuthType ? amLoginField : undefined,
                      passwordField: amIsAuthType && amPasswordField ? amPasswordField : undefined,
                      registerFields: amRouteType === "register" ? amRegisterFields : undefined,
                      selectedFields: amRouteType === "methods" && amSelectedFields.length > 0 ? amSelectedFields : undefined,
                      customFields: amRouteType === "methods" && amCustomFields.length > 0 ? amCustomFields : undefined,
                    },
                  });
                  toast(result.message, "success");
                  setRouteContents(prev => ({ ...prev, [selectedRoute]: { content: result.content } }));
                  setShowAddMethod(false);
                  refresh();
                } catch (err) { toast(err.message, "error"); }
                setAmLoading(false);
              }}
            >${amLoading ? html`<span className="spinner" />` : "Add to Route"}</button>`}
          </div>`;
          })()}

          <div
            className="card"
            style=${{ padding: 0, overflow: "hidden" }}
          >
            <div
              style=${{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style=${{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                }}
                >Source Code</span
              >
              <span className="field-count"
                >${selContent
                  ? selContent.split("\\n").length + " lines"
                  : ""}</span
              >
            </div>
            ${loadingRoute === selectedRoute &&
            html`<div style=${{ padding: "30px", textAlign: "center" }}>
              <span className="spinner" />
            </div>`}
            ${selContent &&
            html`<div className="route-code-wrap">
              <div className="code-block">${selContent}</div>
            </div>`}
          </div>
        </div>`}
      </div>
    </div>
  </div>`;
}

function CreateRoutePanel({ onCreated }) {
  const { data, toast } = useApp();
  const [name, setName] = useState("");
  const [routeType, setRouteType] = useState(null);
  const [methods, setMethods] = useState([]);
  const pathPrefix = "/api/";
  const [modelName, setModelName] = useState("");
  const [loginField, setLoginField] = useState("");
  const [passwordField, setPasswordField] = useState("");
  const [registerFields, setRegisterFields] = useState([]);
  const [selectedFields, setSelectedFields] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [authRequired, setAuthRequired] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState("String");
  const [newFieldRequired, setNewFieldRequired] = useState(true);
  const [loading, setLoading] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const typeOptions = [
    {
      id: "plain",
      label: "Plain",
      desc: "Empty route",
      color: "#94a3b8",
    },
    {
      id: "methods",
      label: "Methods",
      desc: "GET, POST, PUT...",
      color: "var(--accent-light)",
    },
    {
      id: "crud",
      label: "CRUD",
      desc: "Model CRUD ops",
      color: "#3b82f6",
    },
    { id: "login", label: "Login", desc: "JWT login", color: "#22d3ee" },
    {
      id: "register",
      label: "Register",
      desc: "Sign up",
      color: "#34d399",
    },
  ];

  function selectType(id) {
    setRouteType((prev) => (prev === id ? null : id));
    if (id !== "methods" && id !== "crud") setMethods([]);
  }

  function toggleMethod(m) {
    setMethods((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );
  }

  const needsModel =
    routeType && routeType !== "methods" && routeType !== "plain";
  const isAuthType = routeType === "login" || routeType === "register";

  // Get fields from selected model
  const selectedModelObj = data.models?.find((m) => m.name === modelName);
  const modelFields = selectedModelObj?.fields || [];

  // Auto-select fields when model changes
  useEffect(() => {
    if (modelFields.length > 0 && isAuthType) {
      if (!loginField) {
        const emailField =
          modelFields.find((f) => f.name === "email") || modelFields[0];
        setLoginField(emailField?.name || "");
      }
      if (!passwordField) {
        const pwField = modelFields.find((f) => f.name === "password");
        setPasswordField(pwField?.name || "");
      }
      if (routeType === "register" && registerFields.length === 0) {
        setRegisterFields(modelFields.map((f) => f.name));
      }
    }
  }, [modelName, routeType]);

  async function handleCreate() {
    if (!name.trim() || !routeType) return;
    if (routeType === "methods" && methods.length === 0) {
      toast("Select at least one method", "error");
      return;
    }
    if (routeType === "crud" && methods.length === 0) {
      toast("Select at least one CRUD method", "error");
      return;
    }
    if (needsModel && !modelName) {
      toast("Select a model", "error");
      return;
    }
    if (isAuthType && !loginField) {
      toast("Select a login field", "error");
      return;
    }
    setLoading(true);
    try {
      const result = await api("/add-api", {
        method: "POST",
        body: {
          name: name.trim(),
          routeType,
          pathPrefix,
          methods:
            routeType === "methods" || routeType === "crud"
              ? methods
              : undefined,
          modelName: modelName || undefined,
          loginField: isAuthType ? loginField : undefined,
          passwordField:
            isAuthType && passwordField ? passwordField : undefined,
          registerFields:
            routeType === "register" ? registerFields : undefined,
          selectedFields:
            (routeType === "methods" || routeType === "crud") && selectedFields.length > 0
              ? selectedFields
              : undefined,
          customFields:
            (routeType === "methods" || routeType === "crud") && customFields.length > 0
              ? customFields
              : undefined,
          authRequired: !isAuthType ? authRequired : undefined,
        },
      });
      toast(result.message, "success");
      onCreated();
    } catch (err) {
      toast(err.message, "error");
    }
    setLoading(false);
  }

  const methodColors = {
    get: "#22c55e",
    post: "#3b82f6",
    put: "#f59e0b",
    patch: "#a855f7",
    delete: "#ef4444",
  };
  const canCreate =
    name.trim() &&
    routeType &&
    (routeType !== "methods" || methods.length > 0) &&
    (routeType !== "crud" || methods.length > 0) &&
    (!needsModel || modelName) &&
    (!isAuthType || loginField);

  return html`<div>
    <div className="card mb-4">
      <div
        className="flex items-center justify-between"
        style=${{ marginBottom: "16px" }}
      >
        <div style=${{ fontSize: "15px", fontWeight: 600 }}>
          Create New Route
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick=${handleCreate}
          disabled=${loading || !canCreate}
        >
          ${loading
            ? html`<span className="spinner" />`
            : html`<span className="sidebar-icon">${Icons.plus}</span>`}
          ${loading ? "Creating..." : "Create Route"}
        </button>
      </div>

      <div className="form-group">
        <label className="form-label">Route Name</label>
        <input
          ref=${nameRef}
          className="form-input"
          value=${name}
          onInput=${(e) => setName(e.target.value)}
          onKeyDown=${(e) =>
            e.key === "Enter" && canCreate && handleCreate()}
          placeholder="e.g. users, login, products"
          style=${{ fontSize: "14px", padding: "11px 14px" }}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Type</label>
        <div
          style=${{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "6px",
          }}
        >
          ${typeOptions.map((t) => {
            const active = routeType === t.id;
            return html`<button
              key=${t.id}
              style=${{
                padding: "8px 4px",
                borderRadius: "var(--radius)",
                cursor: "pointer",
                textAlign: "center",
                border: active
                  ? "1.5px solid " + t.color
                  : "1.5px solid var(--border)",
                background: active
                  ? "rgba(255,255,255,0.04)"
                  : "var(--bg-input)",
                opacity: active ? 1 : 0.5,
                transition: "all 0.15s",
              }}
              onClick=${() => selectType(t.id)}
            >
              <div
                style=${{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: active ? t.color : "var(--text-secondary)",
                }}
              >
                ${t.label}
              </div>
              <div
                style=${{
                  fontSize: "9px",
                  color: "var(--text-muted)",
                  marginTop: "1px",
                }}
              >
                ${t.desc}
              </div>
            </button>`;
          })}
        </div>
      </div>

      ${routeType === "methods" &&
      html`<div className="form-group">
        <label className="form-label">HTTP Methods</label>
        <div className="flex gap-2">
          ${["get", "post", "put", "patch", "delete"].map(
            (m) =>
              html`<button
                key=${m}
                className=${`route-method ${m}`}
                style=${{
                  cursor: "pointer",
                  border: methods.includes(m)
                    ? "2px solid " + methodColors[m]
                    : "2px solid transparent",
                  padding: "6px 12px",
                  fontSize: "11px",
                  opacity: methods.includes(m) ? 1 : 0.35,
                  borderRadius: "6px",
                  transition: "all 0.15s",
                }}
                onClick=${() => toggleMethod(m)}
              >
                ${m.toUpperCase()}
              </button>`,
          )}
        </div>
      </div>`}
      ${routeType === "crud" &&
      html`<div className="form-group">
        <label className="form-label"
          >CRUD Methods
          <span style=${{ color: "var(--text-muted)", fontWeight: 400 }}
            >(select which operations to include)</span
          ></label
        >
        <div className="flex gap-2">
          ${["get", "post", "put", "patch", "delete"].map((m) => {
            const labels = {
              get: "READ",
              post: "CREATE",
              put: "UPDATE",
              patch: "PATCH",
              delete: "DELETE",
            };
            return html`<button
              key=${m}
              className=${`route-method ${m}`}
              style=${{
                cursor: "pointer",
                border: methods.includes(m)
                  ? "2px solid " + methodColors[m]
                  : "2px solid transparent",
                padding: "6px 12px",
                fontSize: "11px",
                opacity: methods.includes(m) ? 1 : 0.35,
                borderRadius: "6px",
                transition: "all 0.15s",
              }}
              onClick=${() => toggleMethod(m)}
            >
              ${labels[m]}
            </button>`;
          })}
        </div>
      </div>`}
      ${isAuthType &&
      html`<div className="form-group">
        <label className="form-label">Model</label>
        <select
          className="form-select"
          value=${modelName}
          onChange=${(e) => {
            setModelName(e.target.value);
            setLoginField("");
            setPasswordField("");
            setRegisterFields([]);
            setSelectedFields([]);
          }}
        >
          <option value="">Select a model...</option>
          ${(data.models || []).map(
            (m) =>
              html`<option key=${m.name} value=${m.name}>
                ${m.name}
              </option>`,
          )}
        </select>
        ${!data.models?.length &&
        html`<div
          style=${{
            fontSize: "11px",
            color: "var(--warning)",
            marginTop: "4px",
          }}
        >
          No models found. Create a schema first.
        </div>`}
      </div>`}
      ${(routeType === "methods" || routeType === "crud") &&
      html`<div className="form-group">
        <label className="form-label"
          >Model Fields
          <span style=${{ color: "var(--text-muted)", fontWeight: 400 }}
            >(select fields to include in request)</span
          ></label
        >
        <select
          className="form-select"
          style=${{ marginBottom: "8px" }}
          value=${modelName}
          onChange=${(e) => {
            setModelName(e.target.value);
            setSelectedFields([]);
          }}
        >
          <option value="">Select a model...</option>
          ${(data.models || []).map(
            (m) =>
              html`<option key=${m.name} value=${m.name}>
                ${m.name}
              </option>`,
          )}
        </select>
        ${modelName &&
        modelFields.length > 0 &&
        html`<div>
          <div className="flex gap-2" style=${{ flexWrap: "wrap" }}>
            ${modelFields.map((f) => {
              const active = selectedFields.includes(f.name);
              return html`<button
                key=${f.name}
                style=${{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  border: active
                    ? "1.5px solid var(--accent)"
                    : "1.5px solid var(--border)",
                  background: active
                    ? "var(--accent-glow)"
                    : "var(--bg-input)",
                  color: active
                    ? "var(--accent-light)"
                    : "var(--text-secondary)",
                  fontWeight: active ? 600 : 400,
                  transition: "all 0.15s",
                }}
                onClick=${() =>
                  setSelectedFields((prev) =>
                    active
                      ? prev.filter((x) => x !== f.name)
                      : [...prev, f.name],
                  )}
              >
                ${f.name}
                <span
                  style=${{
                    fontSize: "10px",
                    color: "var(--text-muted)",
                    marginLeft: "4px",
                  }}
                  >${f.type}</span
                >
              </button>`;
            })}
          </div>
          <div style=${{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button
              style=${{
                padding: "3px 10px",
                fontSize: "10px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--accent)",
                cursor: "pointer",
              }}
              onClick=${() => setSelectedFields(modelFields.map((f) => f.name))}
            >
              Select All
            </button>
            <button
              style=${{
                padding: "3px 10px",
                fontSize: "10px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
              onClick=${() => setSelectedFields([])}
            >
              Clear
            </button>
          </div>
        </div>`}
        ${!data.models?.length &&
        html`<div
          style=${{
            fontSize: "11px",
            color: "var(--text-muted)",
            marginTop: "4px",
          }}
        >
          No models found. You can still add custom fields below.
        </div>`}
      </div>`}
      ${(routeType === "methods" || routeType === "crud") &&
      html`<div className="form-group">
        <label className="form-label"
          >Custom Fields
          <span style=${{ color: "var(--text-muted)", fontWeight: 400 }}
            >(add extra fields received from client)</span
          ></label
        >
        ${customFields.length > 0 &&
        html`<div
          style=${{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            marginBottom: "8px",
          }}
        >
          ${customFields.map(
            (f, i) =>
              html`<span
                key=${i}
                style=${{
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  background: "var(--bg-input)",
                  border: "1.5px solid var(--border)",
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                ${f.name}
                <span
                  style=${{
                    fontSize: "10px",
                    color:
                      f.type === "File"
                        ? "var(--warning)"
                        : "var(--text-muted)",
                  }}
                  >${f.type}</span
                >
                <span
                  title="Click to toggle required / optional"
                  style=${{
                    cursor: "pointer",
                    fontSize: "9px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.3px",
                    padding: "1px 5px",
                    borderRadius: "4px",
                    color:
                      f.required === false
                        ? "var(--text-muted)"
                        : "var(--success)",
                    background:
                      f.required === false
                        ? "var(--bg-input)"
                        : "var(--success-glow)",
                  }}
                  onClick=${() =>
                    setCustomFields((prev) =>
                      prev.map((x, idx) =>
                        idx === i
                          ? { ...x, required: x.required === false }
                          : x,
                      ),
                    )}
                  >${f.required === false ? "optional" : "required"}</span
                >
                <span
                  style=${{
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    fontSize: "14px",
                    lineHeight: 1,
                    marginLeft: "2px",
                  }}
                  onClick=${() =>
                    setCustomFields((prev) =>
                      prev.filter((_, idx) => idx !== i),
                    )}
                  >×</span
                >
              </span>`,
          )}
        </div>`}
        <div className="flex gap-2" style=${{ alignItems: "center" }}>
          <input
            className="form-input"
            value=${newFieldName}
            onInput=${(e) => setNewFieldName(e.target.value)}
            placeholder="Field name"
            style=${{
              fontSize: "13px",
              padding: "8px 12px",
              flex: 1,
            }}
            onKeyDown=${(e) => {
              if (e.key === "Enter" && newFieldName.trim()) {
                setCustomFields((prev) => [
                  ...prev,
                  { name: newFieldName.trim(), type: newFieldType, required: newFieldRequired },
                ]);
                setNewFieldName("");
              }
            }}
          />
          <select
            className="form-select"
            value=${newFieldType}
            onChange=${(e) => setNewFieldType(e.target.value)}
            style=${{ width: "auto", minWidth: "100px" }}
          >
            <option value="String">String</option>
            <option value="Number">Number</option>
            <option value="Boolean">Boolean</option>
            <option value="Date">Date</option>
            <option value="Array">Array</option>
            <option value="Object">Object</option>
            <option value="File">File</option>
          </select>
          <label
            title="New field is required in the request body (validated by Zod)"
            style=${{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              fontSize: "12px",
              color: "var(--text-secondary)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <input
              type="checkbox"
              checked=${newFieldRequired}
              onChange=${(e) => setNewFieldRequired(e.target.checked)}
            />
            required
          </label>
          <button
            className="btn btn-sm"
            style=${{
              padding: "8px 14px",
              fontSize: "12px",
              background: "var(--bg-input)",
              border: "1.5px solid var(--border)",
              color: "var(--text-primary)",
              cursor: newFieldName.trim() ? "pointer" : "not-allowed",
              opacity: newFieldName.trim() ? 1 : 0.4,
              borderRadius: "6px",
            }}
            disabled=${!newFieldName.trim()}
            onClick=${() => {
              if (newFieldName.trim()) {
                setCustomFields((prev) => [
                  ...prev,
                  { name: newFieldName.trim(), type: newFieldType, required: newFieldRequired },
                ]);
                setNewFieldName("");
              }
            }}
          >
            + Add
          </button>
        </div>
      </div>`}
      ${routeType && !isAuthType &&
      html`<div className="form-group" style=${{ marginTop: "4px" }}>
        <label style=${{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
          <input type="checkbox" checked=${authRequired} onChange=${(e) => setAuthRequired(e.target.checked)} />
          <span>Require authentication (JWT)</span>
        </label>
        <div className="text-sm text-muted" style=${{ marginTop: "4px", marginLeft: "24px" }}>
          Protects every endpoint with the <span style=${{ fontFamily: "monospace" }}>auth</span> middleware — callers must send a valid Bearer token in the Authorization header.
        </div>
      </div>`}
      ${routeType === "login" &&
      modelName &&
      modelFields.length > 0 &&
      html`<div className="form-group">
        <label className="form-label">Find user by</label>
        <div className="flex gap-2" style=${{ flexWrap: "wrap" }}>
          ${modelFields.map(
            (f) =>
              html`<button
                key=${f.name}
                style=${{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  border:
                    loginField === f.name
                      ? "1.5px solid var(--accent)"
                      : "1.5px solid var(--border)",
                  background:
                    loginField === f.name
                      ? "var(--accent-glow)"
                      : "var(--bg-input)",
                  color:
                    loginField === f.name
                      ? "var(--accent-light)"
                      : "var(--text-secondary)",
                  fontWeight: loginField === f.name ? 600 : 400,
                  transition: "all 0.15s",
                }}
                onClick=${() => setLoginField(f.name)}
              >
                ${f.name}
              </button>`,
          )}
        </div>
      </div>`}
      ${routeType === "login" &&
      modelName &&
      modelFields.length > 0 &&
      html`<div className="form-group">
        <label className="form-label"
          >Password field
          <span style=${{ color: "var(--text-muted)", fontWeight: 400 }}
            >(optional — enables bcrypt)</span
          ></label
        >
        <div className="flex gap-2" style=${{ flexWrap: "wrap" }}>
          <button
            style=${{
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              cursor: "pointer",
              border: !passwordField
                ? "1.5px solid var(--accent)"
                : "1.5px solid var(--border)",
              background: !passwordField
                ? "var(--accent-glow)"
                : "var(--bg-input)",
              color: !passwordField
                ? "var(--accent-light)"
                : "var(--text-secondary)",
              fontWeight: !passwordField ? 600 : 400,
              transition: "all 0.15s",
            }}
            onClick=${() => setPasswordField("")}
          >
            None
          </button>
          ${modelFields.map(
            (f) =>
              html`<button
                key=${f.name}
                style=${{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  border:
                    passwordField === f.name
                      ? "1.5px solid var(--warning)"
                      : "1.5px solid var(--border)",
                  background:
                    passwordField === f.name
                      ? "var(--warning-glow)"
                      : "var(--bg-input)",
                  color:
                    passwordField === f.name
                      ? "var(--warning)"
                      : "var(--text-secondary)",
                  fontWeight: passwordField === f.name ? 600 : 400,
                  transition: "all 0.15s",
                }}
                onClick=${() => setPasswordField(f.name)}
              >
                ${f.name}
              </button>`,
          )}
        </div>
      </div>`}
      ${routeType === "register" &&
      modelName &&
      modelFields.length > 0 &&
      html`<div className="form-group">
        <label className="form-label">Registration fields</label>
        <div className="flex gap-2" style=${{ flexWrap: "wrap" }}>
          ${modelFields.map((f) => {
            const active = registerFields.includes(f.name);
            return html`<button
              key=${f.name}
              style=${{
                padding: "5px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                cursor: "pointer",
                border: active
                  ? "1.5px solid var(--success)"
                  : "1.5px solid var(--border)",
                background: active
                  ? "var(--success-glow)"
                  : "var(--bg-input)",
                color: active
                  ? "var(--success)"
                  : "var(--text-secondary)",
                fontWeight: active ? 600 : 400,
                transition: "all 0.15s",
              }}
              onClick=${() =>
                setRegisterFields((prev) =>
                  active
                    ? prev.filter((x) => x !== f.name)
                    : [...prev, f.name],
                )}
            >
              ${f.name}
            </button>`;
          })}
        </div>
      </div>`}
      ${routeType === "register" &&
      modelName &&
      modelFields.length > 0 &&
      html`<div className="form-group">
        <label className="form-label">Check duplicate by</label>
        <div className="flex gap-2" style=${{ flexWrap: "wrap" }}>
          ${modelFields.map(
            (f) =>
              html`<button
                key=${f.name}
                style=${{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  border:
                    loginField === f.name
                      ? "1.5px solid var(--accent)"
                      : "1.5px solid var(--border)",
                  background:
                    loginField === f.name
                      ? "var(--accent-glow)"
                      : "var(--bg-input)",
                  color:
                    loginField === f.name
                      ? "var(--accent-light)"
                      : "var(--text-secondary)",
                  fontWeight: loginField === f.name ? 600 : 400,
                  transition: "all 0.15s",
                }}
                onClick=${() => setLoginField(f.name)}
              >
                ${f.name}
              </button>`,
          )}
        </div>
      </div>`}
      ${routeType === "register" &&
      modelName &&
      modelFields.length > 0 &&
      html`<div className="form-group">
        <label className="form-label"
          >Password field
          <span style=${{ color: "var(--text-muted)", fontWeight: 400 }}
            >(optional — saves as hashed)</span
          ></label
        >
        <div className="flex gap-2" style=${{ flexWrap: "wrap" }}>
          <button
            style=${{
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              cursor: "pointer",
              border: !passwordField
                ? "1.5px solid var(--accent)"
                : "1.5px solid var(--border)",
              background: !passwordField
                ? "var(--accent-glow)"
                : "var(--bg-input)",
              color: !passwordField
                ? "var(--accent-light)"
                : "var(--text-secondary)",
              fontWeight: !passwordField ? 600 : 400,
              transition: "all 0.15s",
            }}
            onClick=${() => setPasswordField("")}
          >
            None
          </button>
          ${registerFields.map(
            (f) =>
              html`<button
                key=${f}
                style=${{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  border:
                    passwordField === f
                      ? "1.5px solid var(--warning)"
                      : "1.5px solid var(--border)",
                  background:
                    passwordField === f
                      ? "var(--warning-glow)"
                      : "var(--bg-input)",
                  color:
                    passwordField === f
                      ? "var(--warning)"
                      : "var(--text-secondary)",
                  fontWeight: passwordField === f ? 600 : 400,
                  transition: "all 0.15s",
                }}
                onClick=${() => setPasswordField(f)}
              >
                ${f}
              </button>`,
          )}
        </div>
      </div>`}

    </div>
  </div>`;
}

