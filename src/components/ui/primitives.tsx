'use client';

import { useEffect, useRef } from 'react';

/** Join class names, dropping falsy entries. */
export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white hover:brightness-110 disabled:bg-edge-strong disabled:text-ink-faint',
  secondary:
    'bg-surface text-ink border border-edge hover:bg-raised disabled:text-ink-faint',
  ghost: 'text-ink-muted hover:bg-raised hover:text-ink disabled:text-ink-faint',
  danger:
    'bg-surface text-danger border border-danger/35 hover:bg-danger-soft disabled:text-ink-faint',
};

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
        'transition-[background-color,color,filter] disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
      <span
        aria-hidden
        className="devatlas-spin inline-block size-3.5 rounded-full border-2 border-edge-strong border-t-accent"
      />
      {label}
    </span>
  );
}

/**
 * A modal built on the native <dialog> element, which gives focus trapping,
 * Escape handling and inertness for free rather than reimplementing them.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      aria-labelledby="devatlas-modal-title"
      className={cx(
        'w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-edge bg-surface p-0 text-ink shadow-2xl',
        'backdrop:bg-black/40 m-auto',
      )}
    >
      <form method="dialog" className="contents">
        <div className="border-b border-edge px-5 py-4">
          <h2 id="devatlas-modal-title" className="text-base font-semibold">
            {title}
          </h2>
          {description ? (
            <div className="mt-1.5 text-sm leading-relaxed text-ink-muted">{description}</div>
          ) : null}
        </div>
        {children ? <div className="px-5 py-4">{children}</div> : null}
        <div className="flex justify-end gap-2 border-t border-edge bg-raised px-5 py-3">
          {footer}
        </div>
      </form>
    </dialog>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-ink">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-sm text-danger" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextInput({
  className,
  ref,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  ref?: React.Ref<HTMLInputElement>;
}) {
  return (
    <input
      ref={ref}
      className={cx(
        'w-full rounded-md border border-edge bg-surface px-2.5 py-1.5 text-sm text-ink',
        'placeholder:text-ink-faint focus:border-accent focus:outline-none',
        className,
      )}
      {...props}
    />
  );
}

/** Monospace path display that truncates from the left so the tail stays visible. */
export function PathText({ value, className }: { value: string; className?: string }) {
  return (
    <span
      dir="rtl"
      title={value}
      className={cx('block truncate text-left font-mono text-xs', className)}
    >
      <bdi>{value}</bdi>
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
  glyph = '○',
}: {
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
  glyph?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-edge-strong px-6 py-12 text-center">
      <span aria-hidden className="text-2xl text-ink-faint">
        {glyph}
      </span>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="max-w-md text-sm leading-relaxed text-ink-muted">{body}</div>
      {action}
    </div>
  );
}
