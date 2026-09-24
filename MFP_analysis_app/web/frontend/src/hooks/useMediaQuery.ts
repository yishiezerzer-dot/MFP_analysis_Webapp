import { useEffect, useState } from "react";

// Below this width (laptops) the nav and LCMS session list collapse to rails that open as overlays.
export const COMPACT_LAYOUT_QUERY = "(max-width: 1599px)";

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const [isMatch, setIsMatch] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const onChange = () => setIsMatch(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return isMatch;
}
