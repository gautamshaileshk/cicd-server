import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LuTrash2, LuZap } from "react-icons/lu";
import { html } from "../lib.js";

export function Modal({ title, children, onClose, actions }) {
  return html`<${AnimatePresence}><${motion.div}
    className="modal-overlay"
    onClick=${(e) => e.target === e.currentTarget && onClose()}
    initial=${{ opacity: 0 }} animate=${{ opacity: 1 }} exit=${{ opacity: 0 }}
    transition=${{ duration: 0.15 }}
  >
    <${motion.div} className="modal"
      initial=${{ opacity: 0, scale: 0.95, y: 10 }}
      animate=${{ opacity: 1, scale: 1, y: 0 }}
      exit=${{ opacity: 0, scale: 0.95, y: 10 }}
      transition=${{ duration: 0.15 }}>
      <div className="modal-title">${title}</div>
      ${children}
      ${actions && html`<div className="modal-actions">${actions}</div>`}
    <//>
  <//><//>`;
}

export function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel, danger }) {
  return html`<${AnimatePresence}><${motion.div}
    className="modal-overlay"
    onClick=${onCancel}
    initial=${{ opacity: 0 }} animate=${{ opacity: 1 }} exit=${{ opacity: 0 }}
    transition=${{ duration: 0.15 }}
  >
    <${motion.div} className="modal" onClick=${e => e.stopPropagation()}
      style=${{ minWidth: '380px', maxWidth: '440px' }}
      initial=${{ opacity: 0, scale: 0.95, y: 10 }}
      animate=${{ opacity: 1, scale: 1, y: 0 }}
      exit=${{ opacity: 0, scale: 0.95, y: 10 }}
      transition=${{ duration: 0.15 }}>
      <div className="flex items-center gap-3" style=${{ marginBottom: '16px' }}>
        <div style=${{ width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: danger ? 'var(--error-glow)' : 'var(--warning-glow)' }}>
          <${danger ? LuTrash2 : LuZap} size=${18} color=${danger ? 'var(--error)' : 'var(--warning)'} />
        </div>
        <div style=${{ fontSize: '15px', fontWeight: 600 }}>Confirm Action</div>
      </div>
      <div style=${{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '20px' }}>${message}</div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick=${onCancel}>Cancel</button>
        <button className=${`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick=${onConfirm}>${confirmLabel || 'Confirm'}</button>
      </div>
    <//>
  <//><//>`;
}
