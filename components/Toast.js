'use client';

import { useState, useEffect, useCallback } from 'react';

let toastFn = null;

export function showToast(message, type = 'info', duration = 3000) {
  if (toastFn) toastFn(message, type, duration);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type, duration) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  useEffect(() => {
    toastFn = addToast;
    return () => { toastFn = null; };
  }, [addToast]);

  const bgColor = (type) => {
    if (type === 'error') return '#ef4444';
    if (type === 'success') return '#10b981';
    if (type === 'warning') return '#f59e0b';
    return '#1a2235';
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 300,
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast-enter"
          style={{
            background: bgColor(toast.type),
            color: '#fff',
            borderRadius: 12,
            padding: '10px 16px',
            fontSize: 14,
            fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
