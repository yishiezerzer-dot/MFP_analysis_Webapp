import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import { TAB_LABELS, TAB_ROUTES, getControl } from "./controls";
import { revealControl } from "./reveal";

// Go to a control: switch tab if needed, open its panel, scroll to it and highlight it.
export function useShowControl() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  return useCallback(
    async (id: string) => {
      const control = getControl(id);
      if (!control) return;
      const route = TAB_ROUTES[control.tab];
      if (route && route !== location.pathname.replace(/\/$/, "")) navigate(route);
      if ((await revealControl(id)) === "not-found") {
        toast(`"${control.label}" appears once a file is open on the ${TAB_LABELS[control.tab]} tab.`, "info");
      }
    },
    [location.pathname, navigate, toast],
  );
}
