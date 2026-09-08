import { ReactNode } from "react";
import clsx from "clsx";

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = "max-w-xl",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/40 p-4">
      <div
        className={clsx(
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-xl",
          width,
        )}
      >
        <header className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            className="rounded-md p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-auto p-5 text-sm">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-ink-200 bg-ink-50/40 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function GroupBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-md border border-ink-200 bg-surface p-3">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {title}
      </legend>
      <div className="flex flex-col gap-2">{children}</div>
    </fieldset>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-sm text-ink-700">{label}</label>
      {children}
    </div>
  );
}

export function Check({
  label,
  checked,
  onChange,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <label className={clsx("flex items-center gap-2 text-sm text-ink-800", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function TextSetting({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="label">{label}</div>
      <input
        type="text"
        className="input mt-1 w-full"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function NumberSetting({
  label,
  value,
  nullable,
  min,
  max,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number | null;
  nullable?: boolean;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="block">
      <div className="label">{label}</div>
      <input
        type="number"
        className="input mt-1 w-full"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        placeholder={nullable ? "auto" : undefined}
        onChange={(e) => {
          if (e.target.value === "") {
            onChange(nullable ? null : value);
            return;
          }
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

export function SelectSetting({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="label">{label}</div>
      <select
        className="input mt-1 w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ColorSetting({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="label">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          className="h-9 w-12 rounded border border-ink-200 bg-surface p-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          className="input w-full font-mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </label>
  );
}
