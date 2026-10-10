'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { cx } from '@/components/ui/primitives';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

interface ToastApi {
  push: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-positive/35 bg-positive-soft text-ink',
  error: 'border-danger/35 bg-danger-soft text-ink',
  info: 'border-edge bg-surface text-ink',
};

const TONE_GLYPH: Record<ToastTone, string> = {
  success: '✓',
  error: '!',
  info: 'i',
};

/**
 * Toasts report what actually happened. Every call site feeds them from a real
 * server response, never from an optimistic assumption, so DevAtlas can't show
 * a success message for an operation Git refused.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      // Errors stay longer; they usually carry text worth reading.
      window.setTimeout(() => dismiss(id), toast.tone === 'error' ? 12_000 : 5_000);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              'pointer-events-auto w-full max-w-md rounded-lg border px-4 py-3 shadow-lg',
              TONE_STYLES[toast.tone],
            )}
          >
            <div className="flex items-start gap-2.5">
              <span aria-hidden className="mt-0.5 font-semibold">
                {TONE_GLYPH[toast.tone]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{toast.title}</p>
                {toast.detail ? (
                  <p className="mt-1 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-ink-muted">
                    {toast.detail}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded px-1 text-ink-faint hover:text-ink"
                aria-label="Dismiss notification"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
