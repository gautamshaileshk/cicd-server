import React from "react";
import { LuZap, LuRocket } from "react-icons/lu";
import { html, Icons } from "../lib.js";
import { useApp } from "../context.js";

export function DashboardPage() {
  const { data, setPage, status } = useApp();
  const modelCount = data.models?.length || 0;
  const routeCount = data.routes?.length || 0;
  const dbOk = data.mongoConfigured;
  const totalFields =
    data.models?.reduce((sum, m) => sum + (m.fields?.length || 0), 0) ||
    0;
  const featuresActive = [
    status?.socketConfigured,
    status?.websocketConfigured,
    status?.serialportConfigured,
  ].filter(Boolean);

  const steps = [
    {
      label: "Database",
      done: dbOk,
      page: "database",
      icon: Icons.database,
    },
    {
      label: "Schemas",
      done: modelCount > 0,
      page: "schemas",
      icon: Icons.schema,
    },
    {
      label: "Routes",
      done: routeCount > 0,
      page: "routes",
      icon: Icons.route,
    },
  ];
  const firstIncomplete = steps.findIndex((s) => !s.done);
  const allDone = steps.every((s) => s.done);

  const nextAction = !dbOk
    ? {
        label: "Connect Database",
        page: "database",
        desc: "Set up your database connection to get started",
      }
    : modelCount === 0
      ? {
          label: "Create First Schema",
          page: "schemas",
          desc: "Define your data models to structure your application",
        }
      : routeCount === 0
        ? {
            label: "Create First Route",
            page: "routes",
            desc: "Add API endpoints to expose your data",
          }
        : null;

  return html`<div>
    <div className="pipeline">
      ${steps.map(
        (step, i) =>
          html`<${React.Fragment} key=${i}>
            ${i > 0 &&
            html`<div
              className=${`pipeline-connector ${steps[i - 1].done ? "done" : ""}`}
            />`}
            <div
              className="pipeline-step"
              onClick=${() => setPage(step.page)}
              style=${{ cursor: "pointer" }}
            >
              <div
                className=${`pipeline-dot ${step.done ? "done" : i === firstIncomplete ? "current" : ""}`}
              >
                ${step.done ? "\u2713" : i + 1}
              </div>
              <div
                className=${`pipeline-label ${step.done ? "done" : i === firstIncomplete ? "current" : ""}`}
              >
                ${step.label}
              </div>
            </div>
          <//>`,
      )}
    </div>

    ${nextAction &&
    html`<div
      className="card mb-6"
      style=${{
        borderColor: "var(--accent)",
        borderWidth: "1px",
        borderStyle: "solid",
        background:
          "linear-gradient(135deg, rgba(124,58,237,0.06), rgba(124,58,237,0.02))",
      }}
    >
      <div className="flex items-center gap-4">
        <div
          style=${{
            width: "44px",
            height: "44px",
            borderRadius: "12px",
            background: "var(--accent-glow)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <${LuZap} size=${20} color="var(--accent-light)" />
        </div>
        <div style=${{ flex: 1 }}>
          <div
            style=${{
              fontWeight: 600,
              fontSize: "14px",
              marginBottom: "2px",
            }}
          >
            Next Step: ${nextAction.label}
          </div>
          <div className="text-sm text-muted">${nextAction.desc}</div>
        </div>
        <button
          className="btn btn-primary"
          onClick=${() => setPage(nextAction.page)}
        >
          ${nextAction.label}
        </button>
      </div>
    </div>`}
    ${allDone &&
    html`<div
      className="card mb-6"
      style=${{
        borderColor: "rgba(34,197,94,0.3)",
        background:
          "linear-gradient(135deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02))",
      }}
    >
      <div className="flex items-center gap-4">
        <div
          style=${{
            width: "44px",
            height: "44px",
            borderRadius: "12px",
            background: "var(--success-glow)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: "20px",
          }}
        >
          \u2713
        </div>
        <div style=${{ flex: 1 }}>
          <div
            style=${{
              fontWeight: 600,
              fontSize: "14px",
              marginBottom: "2px",
              color: "var(--success)",
            }}
          >
            Project Ready
          </div>
          <div className="text-sm text-muted">
            Database, schemas, and routes are configured. Add features or
            refine your API.
          </div>
        </div>
      </div>
    </div>`}

    <div
      className="stats-grid"
      style=${{ gridTemplateColumns: "repeat(4, 1fr)" }}
    >
      <div
        className="stat-card"
        onClick=${() => setPage("database")}
        style=${{ cursor: "pointer" }}
      >
        <div
          className="flex items-center gap-2"
          style=${{ marginBottom: "10px" }}
        >
          <span className="stat-label" style=${{ margin: 0 }}
            >Database</span
          >
          <span
            className=${`stat-badge ${dbOk ? "success" : "warning"}`}
            style=${{ marginLeft: "auto" }}
            >${dbOk ? "Connected" : "Pending"}</span
          >
        </div>
        <span
          className="stat-value"
          style=${{ fontSize: "18px", fontWeight: 600 }}
          >${dbOk ? data.dbType || "MongoDB" : "\u2014"}</span
        >
      </div>
      <div
        className="stat-card"
        onClick=${() => setPage("schemas")}
        style=${{ cursor: "pointer" }}
      >
        <span className="stat-label">Models</span>
        <div className="flex items-center gap-2">
          <span className="stat-value">${modelCount}</span>
          <span
            className="text-sm text-muted"
            style=${{ marginTop: "6px" }}
            >${totalFields} field${totalFields !== 1 ? "s" : ""}</span
          >
        </div>
      </div>
      <div
        className="stat-card"
        onClick=${() => setPage("routes")}
        style=${{ cursor: "pointer" }}
      >
        <span className="stat-label">Routes</span>
        <span className="stat-value">${routeCount}</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">Features</span>
        <span className="stat-value">${featuresActive.length}</span>
        <div
          className="flex gap-1"
          style=${{ flexWrap: "wrap", marginTop: "4px" }}
        >
          ${status?.socketConfigured &&
          html`<span className="stat-badge info">Socket.io</span>`}
          ${status?.websocketConfigured &&
          html`<span className="stat-badge info">WebSocket</span>`}
          ${status?.serialportConfigured &&
          html`<span className="stat-badge info">Serial</span>`}
          ${featuresActive.length === 0 &&
          html`<span className="stat-badge info">None yet</span>`}
        </div>
      </div>
    </div>

    ${(modelCount > 0 || routeCount > 0) &&
    html`<div className="grid-2">
      ${modelCount > 0 &&
      html`<div className="card">
        <div className="flex items-center justify-between mb-3">
          <div
            className="card-title"
            style=${{ margin: 0, fontSize: "13px" }}
          >
            Models
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick=${() => setPage("schemas")}
            style=${{ fontSize: "11px" }}
          >
            View All
          </button>
        </div>
        ${data.models.slice(0, 5).map(
          (m) =>
            html`<div
              key=${m.name}
              className="flex items-center gap-3"
              style=${{
                padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <div
                style=${{
                  width: "28px",
                  height: "28px",
                  borderRadius: "6px",
                  background: "var(--accent-glow)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <span
                  style=${{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "var(--accent-light)",
                  }}
                  >${m.name.charAt(0).toUpperCase()}</span
                >
              </div>
              <div style=${{ flex: 1, minWidth: 0 }}>
                <div style=${{ fontWeight: 500, fontSize: "13px" }}>
                  ${m.name}
                </div>
                <div
                  className="text-sm text-muted"
                  style=${{ fontSize: "11px" }}
                >
                  ${m.fields?.length || 0} fields
                </div>
              </div>
              <div className="flex gap-1">
                ${(m.fields || []).filter((f) => f.required).length > 0 &&
                html`<span
                  style=${{
                    fontSize: "9px",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    background: "var(--success-glow)",
                    color: "var(--success)",
                    fontWeight: 600,
                  }}
                  >${(m.fields || []).filter((f) => f.required).length}
                  REQ</span
                >`}
                ${(m.fields || []).filter((f) => f.unique).length > 0 &&
                html`<span
                  style=${{
                    fontSize: "9px",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    background: "var(--warning-glow)",
                    color: "var(--warning)",
                    fontWeight: 600,
                  }}
                  >${(m.fields || []).filter((f) => f.unique).length}
                  UNQ</span
                >`}
              </div>
            </div>`,
        )}
        ${modelCount > 5 &&
        html`<div
          className="text-sm text-muted"
          style=${{ padding: "8px 0", textAlign: "center" }}
        >
          +${modelCount - 5} more
        </div>`}
      </div>`}
      ${routeCount > 0 &&
      html`<div className="card">
        <div className="flex items-center justify-between mb-3">
          <div
            className="card-title"
            style=${{ margin: 0, fontSize: "13px" }}
          >
            Routes
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick=${() => setPage("routes")}
            style=${{ fontSize: "11px" }}
          >
            View All
          </button>
        </div>
        ${data.routes.slice(0, 5).map((r) => {
          const rName = r.replace(".js", "");
          return html`<div
            key=${r}
            className="flex items-center gap-3"
            style=${{
              padding: "8px 0",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <div
              style=${{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                background: "rgba(59,130,246,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span
                style=${{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#60a5fa",
                }}
                >${rName.charAt(0).toUpperCase()}</span
              >
            </div>
            <div style=${{ flex: 1, minWidth: 0 }}>
              <div style=${{ fontWeight: 500, fontSize: "13px" }}>
                ${rName}
              </div>
              <div
                className="text-sm text-muted"
                style=${{
                  fontSize: "11px",
                  fontFamily: "'SF Mono', monospace",
                }}
              >
                src/routes/${r}
              </div>
            </div>
          </div>`;
        })}
        ${routeCount > 5 &&
        html`<div
          className="text-sm text-muted"
          style=${{ padding: "8px 0", textAlign: "center" }}
        >
          +${routeCount - 5} more
        </div>`}
      </div>`}
    </div>`}
    ${modelCount === 0 &&
    routeCount === 0 &&
    !nextAction &&
    html`<div className="card">
      <div className="empty-state">
        <div className="empty-icon"><${LuRocket} size=${36} /></div>
        <h3>Ready to Build</h3>
        <p>Start by creating schemas and routes for your API</p>
      </div>
    </div>`}
  </div>`;
}
