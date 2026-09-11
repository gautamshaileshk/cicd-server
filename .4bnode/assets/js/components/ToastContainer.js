import { html } from "../lib.js";
import { useApp } from "../context.js";

export function ToastContainer() {
  const { toasts } = useApp();
  if (toasts.length === 0) return null;
  return html`<div className="toast-container">
    ${toasts.map(
      (t) =>
        html`<div key=${t.id} className=${`toast ${t.type}`}>
          ${t.message}
        </div>`,
    )}
  </div>`;
}
