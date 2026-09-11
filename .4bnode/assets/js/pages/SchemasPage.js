import React, { useState, useEffect, useRef } from "react";
import { LuFileCode, LuLock } from "react-icons/lu";
import { html, api, Icons } from "../lib.js";
import { useApp } from "../context.js";

export function SchemasPage() {
  const { data, toast, refresh, setPage, showConfirm } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [editModel, setEditModel] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);

  // Auto-select first model
  useEffect(() => {
    if (
      data.models?.length > 0 &&
      !selectedModel &&
      !showCreate &&
      !editModel
    ) {
      setSelectedModel(data.models[0].name);
    }
  }, [data.models]);

  if (!data.mongoConfigured) {
    return html`<div className="locked-state">
      <div className="locked-icon"><${LuLock} size=${24} /></div>
      <h3>Database Required</h3>
      <p>
        You need to set up a database before creating schemas. Schemas
        define the structure of your data.
      </p>
      <button
        className="btn btn-primary"
        onClick=${() => setPage("database")}
      >
        Set Up Database
      </button>
    </div>`;
  }

  const selected = data.models?.find((m) => m.name === selectedModel);
  const reqCount =
    selected?.fields?.filter((f) => f.required).length || 0;
  const uniqCount = selected?.fields?.filter((f) => f.unique).length || 0;
  const isEditing = showCreate || !!editModel;

  // Empty state + no create open
  if (data.models?.length === 0 && !showCreate) {
    return html`<div>
      <div className="flex items-center justify-between mb-4">
        <div className="card-subtitle">0 models defined</div>
        <button
          className="btn btn-primary"
          onClick=${() => {
            setShowCreate(true);
            setSelectedModel(null);
            setEditModel(null);
          }}
        >
          <span className="sidebar-icon">${Icons.plus}</span> New Schema
        </button>
      </div>
      <div className="empty-state">
        <div className="empty-icon"><${LuFileCode} size=${36} /></div>
        <h3>No schemas yet</h3>
        <p>
          Create your first model schema to define your data structure
        </p>
        <button
          className="btn btn-primary"
          onClick=${() => setShowCreate(true)}
        >
          Create Schema
        </button>
      </div>
    </div>`;
  }

  return html`<div>
    <div className="flex items-center justify-between mb-4">
      <div className="card-subtitle">
        ${data.models?.length || 0}
        model${data.models?.length !== 1 ? "s" : ""} defined
      </div>
      <button
        className=${`btn ${isEditing ? "btn-ghost" : "btn-primary"}`}
        onClick=${() => {
          if (isEditing) {
            setShowCreate(false);
            setEditModel(null);
            if (data.models?.length)
              setSelectedModel(data.models[0].name);
          } else {
            setShowCreate(true);
            setSelectedModel(null);
            setEditModel(null);
          }
        }}
      >
        ${isEditing
          ? "Cancel"
          : html`<span className="sidebar-icon">${Icons.plus}</span> New
              Schema`}
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
            >Models</span
          >
        </div>
        <div className="routes-list">
          ${(data.models || []).map((m) => {
            const isActive =
              selectedModel === m.name && !showCreate && !editModel;
            const isEditActive = editModel?.name === m.name;
            return html`<div
              key=${m.name}
              className=${`route-item ${isActive || isEditActive ? "active" : ""}`}
              onClick=${() => {
                setShowCreate(false);
                setEditModel(null);
                setSelectedModel(m.name);
              }}
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
                <span className="ri-name">${m.name}</span>
                <span className="ri-file">src/models/${m.name}.js</span>
              </div>
              <span className="field-count"
                >${m.fields?.length || 0}</span
              >
            </div>`;
          })}
          <div
            className=${`route-item ${showCreate ? "active" : ""}`}
            onClick=${() => {
              setShowCreate(true);
              setSelectedModel(null);
              setEditModel(null);
            }}
            style=${{
              borderTop: data.models?.length
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
              >New Schema</span
            >
          </div>
        </div>
      </div>

      <div className="routes-detail">
        ${showCreate &&
        html`<${SchemaBuilderPanel}
          onDone=${() => {
            setShowCreate(false);
            refresh();
          }}
        />`}
        ${editModel &&
        !showCreate &&
        html`<${SchemaBuilderPanel}
          model=${editModel}
          onDone=${() => {
            setEditModel(null);
            refresh();
          }}
        />`}
        ${!showCreate &&
        !editModel &&
        !selected &&
        html`<div className="card">
          <div className="empty-state" style=${{ padding: "40px" }}>
            <p>Select a model to view its fields</p>
          </div>
        </div>`}
        ${!showCreate &&
        !editModel &&
        selected &&
        html`<${SchemaDetailPanel} model=${selected} reqCount=${reqCount} uniqCount=${uniqCount}
          onEdit=${() => { setEditModel(selected); setSelectedModel(null); }}
          onDelete=${async () => {
            const ok = await showConfirm('Are you sure you want to delete the model "' + selected.name + '"? This will remove the schema file.', { danger: true, confirmLabel: 'Delete Model' });
            if (!ok) return;
            try { await api("/models/" + selected.name, { method: "DELETE" }); toast('Model "' + selected.name + '" deleted', "success"); setSelectedModel(null); refresh(); }
            catch (err) { toast(err.message, "error"); }
          }}
        />`}
      </div>
    </div>
  </div>`;
}

function SchemaDetailPanel({ model, reqCount, uniqCount, onEdit, onDelete }) {
  const thStyle = { padding: '10px 16px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border)' };
  const tdStyle = { padding: '8px 16px', fontSize: '12px', borderBottom: '1px solid var(--border)' };

  return html`<div>
    <div className="card mb-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div style=${{ fontWeight: 600, fontSize: '16px', marginBottom: '2px' }}>${model.name}</div>
          <div className="text-sm text-muted" style=${{ fontFamily: "'SF Mono', monospace" }}>src/models/${model.name}.js</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" onClick=${onEdit}>
            <span className="sidebar-icon">${Icons.edit}</span> Edit
          </button>
          <button className="btn btn-danger btn-sm btn-icon" onClick=${onDelete}>
            <span className="sidebar-icon">${Icons.trash}</span>
          </button>
        </div>
      </div>
      <div className="flex gap-3">
        ${[['Fields', model.fields?.length || 0, null], ['Required', reqCount, reqCount > 0 ? 'var(--success)' : null], ['Unique', uniqCount, uniqCount > 0 ? 'var(--warning)' : null], ['Indexes', (model.fields?.filter(f => f.index).length || 0) + (model.indexes?.length || 0), ((model.fields?.filter(f => f.index).length || 0) + (model.indexes?.length || 0)) > 0 ? 'var(--info)' : null]].map(([label, count, color]) =>
          html`<div key=${label} style=${{ padding: '8px 14px', background: 'var(--bg-input)', borderRadius: 'var(--radius)', fontSize: '13px' }}>
            <span style=${{ color: 'var(--text-muted)' }}>${label} </span>
            <span style=${{ fontWeight: 600, color: color || 'var(--text-secondary)' }}>${count}</span>
          </div>`
        )}
      </div>
    </div>

    <div className="card" style=${{ padding: 0, overflow: 'hidden' }}>
      <div style=${{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style=${{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Schema Fields</span>
      </div>
      <table style=${{ width: '100%' }}>
        <thead><tr>
          <th style=${thStyle}>#</th><th style=${thStyle}>Name</th><th style=${thStyle}>Type</th><th style=${thStyle}>Properties</th>
        </tr></thead>
        <tbody>
          ${model.fields?.map((f, i) => html`<tr key=${f.name} style=${{ borderBottom: '1px solid var(--border)' }}>
            <td style=${{ ...tdStyle, color: 'var(--text-muted)' }}>${i + 1}</td>
            <td style=${{ ...tdStyle, fontWeight: 500, fontSize: '13px', fontFamily: "'SF Mono', monospace" }}>${f.name}</td>
            <td style=${tdStyle}><span style=${{ fontSize: '12px', padding: '2px 8px', borderRadius: '4px', background: 'var(--accent-glow)', color: 'var(--accent-light)' }}>${f.type || 'String'}</span></td>
            <td style=${tdStyle}><div className="flex gap-1">
              ${f.required && html`<span className="badge badge-success" style=${{ fontSize: '10px' }}>required</span>`}
              ${f.unique && html`<span className="badge badge-warning" style=${{ fontSize: '10px' }}>unique</span>`}
              ${f.index && html`<span className="badge badge-info" style=${{ fontSize: '10px' }}>indexed</span>`}
              ${!f.required && !f.unique && !f.index && html`<span style=${{ fontSize: '12px', color: 'var(--text-muted)' }}>—</span>`}
            </div></td>
          </tr>`)}
        </tbody>
      </table>
    </div>
  </div>`;
}

function SchemaBuilderPanel({ model, onDone }) {
  const { data, toast, refresh } = useApp();
  const [name, setName] = useState(model?.name || "");
  const [fields, setFields] = useState(
    model?.fields?.map((f) => ({ ...f })) || [],
  );
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editIndex, setEditIndex] = useState(null);
  const isEdit = !!model;

  // Add/edit field form state
  const [fname, setFname] = useState("");
  const [ftype, setFtype] = useState("String");
  const [freq, setFreq] = useState(false);
  const [funiq, setFuniq] = useState(false);
  const [fref, setFref] = useState("");
  const [findex, setFindex] = useState(false);
  const [indexes, setIndexes] = useState(model?.indexes || []);
  const [idxFields, setIdxFields] = useState([]);
  const [idxType, setIdxType] = useState('compound');
  const [idxUnique, setIdxUnique] = useState(false);
  const nameRef = useRef(null);
  const fieldNameRef = useRef(null);

  const fieldTypes = [
    "String",
    "Number",
    "Boolean",
    "Date",
    "ObjectId",
    "Array",
    "Mixed",
    "Buffer",
    "Map",
  ];

  // Get other model names for ObjectId ref
  const otherModels = (data.models || [])
    .map((m) => m.name)
    .filter((n) => n !== name);

  useEffect(() => {
    if (!isEdit && nameRef.current) nameRef.current.focus();
    else if (isEdit && fieldNameRef.current) fieldNameRef.current.focus();
  }, []);

  function resetFieldForm() {
    setFname("");
    setFtype("String");
    setFreq(false);
    setFuniq(false);
    setFref("");
    setFindex(false);
    setEditIndex(null);
  }

  function addOrUpdateField() {
    if (!fname.trim()) return;
    const fieldData = {
      name: fname.trim(),
      type: ftype,
      required: freq,
      unique: funiq,
    };
    if (ftype === "ObjectId" && fref) fieldData.ref = fref;
    if (findex) fieldData.index = true;

    if (editIndex !== null) {
      setFields((prev) =>
        prev.map((f, i) => (i === editIndex ? fieldData : f)),
      );
      setEditIndex(null);
    } else {
      setFields((prev) => [...prev, fieldData]);
    }
    resetFieldForm();
    setSaved(false);
    setTimeout(() => fieldNameRef.current?.focus(), 50);
  }

  function startEdit(index) {
    const f = fields[index];
    setFname(f.name);
    setFtype(f.type || "String");
    setFreq(!!f.required);
    setFuniq(!!f.unique);
    setFref(f.ref || "");
    setFindex(!!f.index);
    setEditIndex(index);
    setTimeout(() => fieldNameRef.current?.focus(), 50);
  }

  function removeField(index) {
    setFields((prev) => prev.filter((_, i) => i !== index));
    if (editIndex === index) resetFieldForm();
    setSaved(false);
  }

  async function handleSave() {
    if (!name.trim()) {
      toast("Model name is required", "error");
      return;
    }
    if (fields.length === 0) {
      toast("Add at least one field", "error");
      return;
    }
    setLoading(true);
    try {
      if (isEdit) {
        await api("/models/" + model.name, {
          method: "PUT",
          body: { fields, indexes },
        });
        toast('Model "' + model.name + '" updated', "success");
      } else {
        await api("/models", {
          method: "POST",
          body: { name: name.trim(), fields, indexes },
        });
        toast('Model "' + name.trim() + '" created', "success");
      }
      setSaved(true);
      refresh();
      onDone();
    } catch (err) {
      toast(err.message, "error");
    }
    setLoading(false);
  }

  const typeColors = {
    String: "var(--accent-light)",
    Number: "var(--success)",
    Boolean: "var(--warning)",
    Date: "#a78bfa",
    ObjectId: "#f472b6",
    Array: "#22d3ee",
    Mixed: "var(--text-secondary)",
    Buffer: "#fb923c",
    Map: "#34d399",
  };

  return html`<div>
    <div className="card mb-4">
      <div
        className="flex items-center justify-between"
        style=${{ marginBottom: "16px" }}
      >
        <div style=${{ fontSize: "15px", fontWeight: 600 }}>
          ${isEdit ? "Edit Schema: " + model.name : "Create New Schema"}
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick=${handleSave}
          disabled=${loading || fields.length === 0 || !name.trim()}
        >
          ${loading ? html`<span className="spinner" />` : null}
          ${saved ? "\u2713 Saved" : isEdit ? "Update" : "Save Schema"}
        </button>
      </div>

      ${!isEdit &&
      html`<div className="form-group">
        <label className="form-label">Model Name</label>
        <input
          ref=${nameRef}
          className="form-input"
          value=${name}
          onInput=${(e) => setName(e.target.value)}
          placeholder="e.g. user, product, post"
          style=${{ fontSize: "14px", padding: "11px 14px" }}
        />
      </div>`}

      <div
        style=${{
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color:
            editIndex !== null ? "var(--warning)" : "var(--text-muted)",
          marginBottom: "10px",
          marginTop: isEdit ? 0 : "8px",
        }}
      >
        ${editIndex !== null ? "Edit Field" : "Add Field"}
      </div>

      <div
        className="flex items-center gap-3 mb-3"
        style=${{ flexWrap: "wrap" }}
      >
        <input
          ref=${fieldNameRef}
          className="form-input"
          value=${fname}
          onInput=${(e) => setFname(e.target.value)}
          onKeyDown=${(e) => e.key === "Enter" && addOrUpdateField()}
          placeholder="Field name"
          style=${{
            fontSize: "13px",
            flex: "1 1 120px",
            minWidth: "100px",
          }}
        />
        <select
          className="form-select"
          value=${ftype}
          onChange=${(e) => {
            setFtype(e.target.value);
            if (e.target.value !== "ObjectId") setFref("");
          }}
          style=${{ fontSize: "13px", width: "110px", flex: "0 0 110px" }}
        >
          ${fieldTypes.map(
            (t) => html`<option key=${t} value=${t}>${t}</option>`,
          )}
        </select>
        ${ftype === "ObjectId" &&
        html`<select
          className="form-select"
          value=${fref}
          onChange=${(e) => setFref(e.target.value)}
          style=${{ fontSize: "13px", width: "110px", flex: "0 0 110px" }}
        >
          <option value="">Ref...</option>
          ${otherModels.map(
            (m) => html`<option key=${m} value=${m}>${m}</option>`,
          )}
        </select>`}
        <div style=${{ display: 'flex', alignItems: 'center', gap: '16px', padding: '0 4px' }}>
          <label
            className="flex items-center gap-2"
            style=${{
              cursor: "pointer",
              fontSize: "12px",
              whiteSpace: "nowrap",
              color: freq ? "var(--success)" : "var(--text-muted)",
            }}
          >
            <div className="form-toggle">
              <input
                type="checkbox"
                checked=${freq}
                onChange=${(e) => setFreq(e.target.checked)}
              />
              <span className="slider" />
            </div>
            Required
          </label>
          <label
            className="flex items-center gap-2"
            style=${{
              cursor: "pointer",
              fontSize: "12px",
              whiteSpace: "nowrap",
              color: funiq ? "var(--warning)" : "var(--text-muted)",
            }}
          >
            <div className="form-toggle">
              <input
                type="checkbox"
                checked=${funiq}
                onChange=${(e) => setFuniq(e.target.checked)}
              />
              <span className="slider" />
            </div>
            Unique
          </label>
          <label
            className="flex items-center gap-2"
            style=${{
              cursor: "pointer",
              fontSize: "12px",
              whiteSpace: "nowrap",
              color: findex ? "var(--info)" : "var(--text-muted)",
            }}
          >
            <div className="form-toggle">
              <input
                type="checkbox"
                checked=${findex}
                onChange=${(e) => setFindex(e.target.checked)}
              />
              <span className="slider" />
            </div>
            Index
          </label>
        </div>
        ${editIndex !== null &&
        html`<button
          className="btn btn-ghost btn-sm"
          onClick=${resetFieldForm}
          style=${{ padding: "5px 8px" }}
        >
          Cancel
        </button>`}
        <button
          className="btn ${editIndex !== null
            ? "btn-warning"
            : "btn-primary"} btn-sm"
          onClick=${addOrUpdateField}
          disabled=${!fname.trim()}
          style=${{ padding: "5px 10px", whiteSpace: "nowrap" }}
        >
          ${editIndex !== null
            ? "Update"
            : html`<span className="sidebar-icon">${Icons.plus}</span>
                Add`}
        </button>
      </div>
    </div>

    ${fields.length > 0 &&
    html`<div
      className="card mb-4"
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
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "var(--text-muted)",
          }}
          >Fields</span
        >
        <span className="field-count">${fields.length}</span>
      </div>
      <div style=${{ maxHeight: "340px", overflowY: "auto" }}>
        ${fields.map(
          (f, i) =>
            html`<div
              key=${i}
              className="flex items-center gap-3"
              style=${{
                padding: "8px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.03)",
                background:
                  editIndex === i ? "var(--warning-glow)" : "transparent",
                transition: "background var(--transition)",
              }}
              onMouseEnter=${(e) => {
                if (editIndex !== i)
                  e.currentTarget.style.background =
                    "rgba(255,255,255,0.02)";
              }}
              onMouseLeave=${(e) => {
                if (editIndex !== i)
                  e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                style=${{
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  width: "20px",
                  fontVariantNumeric: "tabular-nums",
                }}
                >${i + 1}</span
              >
              <span
                style=${{
                  fontWeight: 500,
                  fontSize: "13px",
                  flex: 1,
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                }}
                >${f.name}</span
              >
              <span
                style=${{
                  fontSize: "11px",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: "rgba(255,255,255,0.04)",
                  color: typeColors[f.type] || "var(--text-secondary)",
                }}
                >${f.type}${f.ref ? " \u2192 " + f.ref : ""}</span
              >
              ${f.required &&
              html`<span
                style=${{
                  fontSize: "9px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: "var(--success-glow)",
                  color: "var(--success)",
                  fontWeight: 600,
                }}
                >REQ</span
              >`}
              ${f.unique &&
              html`<span
                style=${{
                  fontSize: "9px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: "var(--warning-glow)",
                  color: "var(--warning)",
                  fontWeight: 600,
                }}
                >UNQ</span
              >`}
              ${f.index &&
              html`<span
                style=${{
                  fontSize: "9px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: "rgba(59,130,246,0.15)",
                  color: "var(--info)",
                  fontWeight: 600,
                }}
                >IDX</span
              >`}
              <button
                className="btn btn-ghost btn-sm btn-icon"
                onClick=${() => startEdit(i)}
                style=${{
                  color: "var(--accent-light)",
                  opacity: 0.6,
                  padding: "4px",
                }}
              >
                <span className="sidebar-icon">${Icons.edit}</span>
              </button>
              <button
                className="btn btn-ghost btn-sm btn-icon"
                onClick=${() => removeField(i)}
                style=${{
                  color: "var(--error)",
                  opacity: 0.5,
                  padding: "4px",
                }}
              >
                <span className="sidebar-icon">${Icons.trash}</span>
              </button>
            </div>`,
        )}
      </div>
    </div>`}
    ${fields.length === 0 &&
    html`<div
      className="card mb-4"
      style=${{
        background: "var(--bg)",
        padding: "30px",
        textAlign: "center",
      }}
    >
      <div style=${{ fontSize: "12px", color: "var(--text-muted)" }}>
        Add fields above to define your schema
      </div>
    </div>`}

    <div className="card mb-4" style=${{ padding: '16px' }}>
      <div style=${{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '12px' }}>
        Compound Indexes
      </div>

      <div className="flex items-center gap-3 mb-3" style=${{ flexWrap: 'wrap' }}>
        <select className="form-select" value=${idxType}
          onChange=${(e) => setIdxType(e.target.value)}
          style=${{ fontSize: '13px', width: '120px' }}>
          <option value="compound">Compound</option>
          <option value="text">Text</option>
        </select>

        ${idxType === 'compound' && html`<label className="flex items-center gap-2" style=${{ cursor: 'pointer', fontSize: '12px', color: idxUnique ? 'var(--warning)' : 'var(--text-muted)' }}>
          <div className="form-toggle">
            <input type="checkbox" checked=${idxUnique} onChange=${(e) => setIdxUnique(e.target.checked)} />
            <span className="slider" />
          </div>
          Unique
        </label>`}

        <button className="btn btn-primary btn-sm"
          disabled=${idxFields.length < (idxType === 'text' ? 1 : 2)}
          onClick=${() => {
            const newIdx = {
              fields: idxFields.map(f => ({ field: f.field, direction: idxType === 'text' ? 'text' : f.direction })),
              unique: idxType === 'compound' ? idxUnique : false,
              type: idxType,
            };
            setIndexes(prev => [...prev, newIdx]);
            setIdxFields([]);
            setIdxUnique(false);
            setSaved(false);
          }}>
          Add Index
        </button>
      </div>

      <div className="flex gap-2 mb-3" style=${{ flexWrap: 'wrap' }}>
        ${fields.map(f => {
          const selected = idxFields.find(i => i.field === f.name);
          return html`<button key=${f.name}
            onClick=${() => {
              if (selected) {
                if (idxType !== 'text') {
                  if (selected.direction === 1) {
                    setIdxFields(prev => prev.map(i => i.field === f.name ? { ...i, direction: -1 } : i));
                  } else {
                    setIdxFields(prev => prev.filter(i => i.field !== f.name));
                  }
                } else {
                  setIdxFields(prev => prev.filter(i => i.field !== f.name));
                }
              } else {
                setIdxFields(prev => [...prev, { field: f.name, direction: 1 }]);
              }
            }}
            style=${{ padding: '4px 10px', fontSize: '11px', borderRadius: '4px', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'monospace',
              background: selected ? 'var(--accent-glow)' : 'transparent',
              color: selected ? 'var(--accent-light)' : 'var(--text-muted)' }}>
            ${f.name}${selected && idxType !== 'text' ? (selected.direction === 1 ? ' ASC' : ' DESC') : ''}
          </button>`;
        })}
      </div>
      ${idxFields.length > 0 && html`<div style=${{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
        ${idxType === 'text' ? 'Click to select/deselect fields' : 'Click once = ASC, twice = DESC, third = remove'}
      </div>`}

      ${indexes.length > 0 && html`<div style=${{ marginTop: '12px' }}>
        ${indexes.map((idx, i) => html`<div key=${i} className="flex items-center gap-2" style=${{ padding: '6px 12px', background: 'var(--bg-input)', borderRadius: '6px', marginBottom: '4px', fontSize: '12px' }}>
          <span style=${{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600,
            background: idx.type === 'text' ? 'rgba(59,130,246,0.15)' : 'rgba(124,58,237,0.15)',
            color: idx.type === 'text' ? 'var(--info)' : 'var(--accent-light)' }}>
            ${idx.type === 'text' ? 'TEXT' : 'COMPOUND'}
          </span>
          <span style=${{ fontFamily: 'monospace', flex: 1 }}>
            { ${idx.fields.map(f => f.field + ': ' + (f.direction === 'text' ? "'text'" : f.direction)).join(', ')} }
          </span>
          ${idx.unique && html`<span style=${{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: 'var(--warning-glow)', color: 'var(--warning)', fontWeight: 600 }}>UNIQUE</span>`}
          <button className="btn btn-ghost btn-sm btn-icon" onClick=${() => { setIndexes(prev => prev.filter((_, j) => j !== i)); setSaved(false); }}
            style=${{ color: 'var(--error)', opacity: 0.5, padding: '4px' }}>
            ${Icons.trash}
          </button>
        </div>`)}
      </div>`}
    </div>
  </div>`;
}
