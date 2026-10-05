import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

// `/tab?open=<session id>` (from Home) selects that session once the tab's list contains it.
export function useOpenFromUrl(sessionIds: string[], select: (sid: string) => void): void {
  const [params, setParams] = useSearchParams();
  const wanted = params.get("open");
  const known = sessionIds.join("|");
  useEffect(() => {
    if (!wanted || !sessionIds.includes(wanted)) return;
    select(wanted);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("open");
        return next;
      },
      { replace: true },
    );
    // Only when the wanted id or the list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, known]);
}
