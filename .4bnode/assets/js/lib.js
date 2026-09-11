import React from "react";
import htm from "htm";
import {
  LuLayoutDashboard,
  LuDatabase,
  LuFileText,
  LuRadio,
  LuPlus,
  LuTrash2,
  LuCheck,
  LuLock,
  LuArrowRight,
  LuPencil,
  LuCable,
  LuActivity,
  LuZap,
  LuShield,
  LuBox,
  LuFlaskConical,
  LuSend,
  LuSettings,
  LuScrollText,
  LuSparkles,
  LuBookOpen,
  LuMail,
  LuWifi,
} from "react-icons/lu";

export const html = htm.bind(React.createElement);
export const API = "/_dev/api";

export function getStoredPasskey() {
  return sessionStorage.getItem("_dev_passkey") || "";
}

export function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  return Promise.resolve();
}

export async function api(path, options = {}) {
  const passkey = getStoredPasskey();
  const headers = { "Content-Type": "application/json" };
  if (passkey) headers["x-passkey"] = passkey;
  const res = await fetch(API + path, {
    headers,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (res.ok) return { message: "Done" };
    throw new Error("Server restarting, please wait...");
  }
  if (!res.ok) {
    const e = new Error(data.error || data.message || "Request failed");
    e.data = data; // expose extra fields (e.g. command output) to callers
    throw e;
  }
  return data;
}

export const Icons = {
  dashboard: html`<${LuLayoutDashboard} size=${16} />`,
  database: html`<${LuDatabase} size=${16} />`,
  schema: html`<${LuFileText} size=${16} />`,
  route: html`<${LuRadio} size=${16} />`,
  realtime: html`<${LuActivity} size=${16} />`,
  env: html`<${LuSettings} size=${16} />`,
  plus: html`<${LuPlus} size=${16} />`,
  trash: html`<${LuTrash2} size=${16} />`,
  check: html`<${LuCheck} size=${16} />`,
  lock: html`<${LuLock} size=${12} />`,
  arrow: html`<${LuArrowRight} size=${14} />`,
  edit: html`<${LuPencil} size=${16} />`,
  serial: html`<${LuCable} size=${16} />`,
  zap: html`<${LuZap} size=${16} />`,
  shield: html`<${LuShield} size=${16} />`,
  box: html`<${LuBox} size=${16} />`,
  apiTester: html`<${LuFlaskConical} size=${16} />`,
  send: html`<${LuSend} size=${16} />`,
  logs: html`<${LuScrollText} size=${16} />`,
  ai: html`<${LuSparkles} size=${16} />`,
  docs: html`<${LuBookOpen} size=${16} />`,
  mail: html`<${LuMail} size=${16} />`,
  network: html`<${LuWifi} size=${16} />`,
};

export const PAGE_TITLES = {
  dashboard: "Dashboard",
  "ai-builder": "AI Builder",
  database: "Database",
  schemas: "Schemas",
  routes: "API Routes",
  docs: "API Docs",
  security: "Security",
  "api-tester": "API Tester",
  realtime: "Real-time",
  serialport: "SerialPort",
  mail: "Email",
  discovery: "Discovery",
  logs: "Logs",
  env: "Environment",
};
