import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { WorkflowDialog } from "../components/workflow/WorkflowDialog";
import { micPlateWorkflow, type MicAnswers } from "./micPlate";
import { lcmsProductWorkflow, type ProductAnswers } from "./lcmsProduct";
import { ftirPeaksWorkflow, type FtirAnswers } from "./ftirPeaks";

// Each workflow with the answers it can be started with (e.g. the plate the user is looking at).
type Start =
  | { id: "mic-plate"; initial?: Partial<MicAnswers> }
  | { id: "lcms-product"; initial?: Partial<ProductAnswers> }
  | { id: "ftir-peaks"; initial?: Partial<FtirAnswers> };

export type WorkflowId = Start["id"];

interface WorkflowContextValue {
  startWorkflow: (start: Start) => void;
}

const WorkflowContext = createContext<WorkflowContextValue>({ startWorkflow: () => {} });

export function useWorkflow() {
  return useContext(WorkflowContext);
}

export function WorkflowProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<Start | null>(null);
  const go = useCallback((path: string) => navigate(path), [navigate]);
  const mic = useMemo(() => micPlateWorkflow(go), [go]);
  const product = useMemo(() => lcmsProductWorkflow(go), [go]);
  const ftir = useMemo(() => ftirPeaksWorkflow(go), [go]);
  const value = useMemo(() => ({ startWorkflow: (start: Start) => setOpen(start) }), []);
  const close = () => setOpen(null);
  return (
    <WorkflowContext.Provider value={value}>
      {children}
      {open?.id === "mic-plate" && <WorkflowDialog workflow={mic} initial={open.initial} onClose={close} />}
      {open?.id === "lcms-product" && <WorkflowDialog workflow={product} initial={open.initial} onClose={close} />}
      {open?.id === "ftir-peaks" && <WorkflowDialog workflow={ftir} initial={open.initial} onClose={close} />}
    </WorkflowContext.Provider>
  );
}
