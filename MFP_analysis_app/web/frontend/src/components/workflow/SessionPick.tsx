import { useEffect, useRef, useState } from "react";

interface Session {
  session_id: string;
  display_name: string;
}

// "Choose an open file" select plus an upload button, for a workflow's first step.
export function SessionPick<T extends Session>({
  value,
  onPick,
  list,
  upload,
  accept,
  noun,
  openLabel,
  exclude,
}: {
  value: string;
  onPick: (session: T) => void;
  list: () => Promise<T[]>;
  upload: (file: File) => Promise<T>;
  accept: string;
  noun: string;
  openLabel: string;
  exclude?: string;
}) {
  const [sessions, setSessions] = useState<T[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    list().then(setSessions).catch(() => setSessions([]));
    // The list is fetched once per step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choices = sessions.filter((s) => s.session_id !== exclude);
  return (
    <div className="flex flex-col gap-2">
      {choices.length > 0 && (
        <select
          className="input"
          aria-label={noun}
          value={value}
          onChange={(e) => {
            const s = choices.find((x) => x.session_id === e.target.value);
            if (s) onPick(s);
          }}
        >
          <option value="">{`Choose an open ${noun.toLowerCase()}…`}</option>
          {choices.map((s) => (
            <option key={s.session_id} value={s.session_id}>
              {s.display_name}
            </option>
          ))}
        </select>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const s = await upload(file);
            setSessions((prev) => [...prev, s]);
            onPick(s);
          } catch (err) {
            setError(String(err).replace(/^Error: (HTTP \d+: )?/, ""));
          } finally {
            setBusy(false);
          }
        }}
      />
      <button type="button" className="btn-ghost self-start border border-ink-200" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? "Opening…" : openLabel}
      </button>
      {error && <p className="text-[12px] text-danger-fg">{error}</p>}
    </div>
  );
}
