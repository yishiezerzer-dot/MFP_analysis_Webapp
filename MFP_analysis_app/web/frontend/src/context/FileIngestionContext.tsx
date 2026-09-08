import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type IngestionRoute = "/lcms" | "/ftir" | "/plate-reader" | "/data-studio";

export interface FileRoutingRule {
  route: IngestionRoute;
  label: string;
  badge: string;
  description: string;
  extensions: string[];
}

export const ROUTING_RULES: Record<IngestionRoute, FileRoutingRule> = {
  "/lcms": {
    route: "/lcms",
    label: "LC-MS Spectrometry",
    badge: "LCMS",
    description: "Chromatograms, TIC, EIC, MS1 & MS2 spectra",
    extensions: [".mzml", ".mzxml", ".mzml.gz"],
  },
  "/ftir": {
    route: "/ftir",
    label: "FTIR Spectroscopy",
    badge: "FTIR",
    description: "Spectra, baseline correction & deconvolution",
    extensions: [".dx", ".jdx", ".spa", ".spc", ".csv", ".txt", ".tsv"],
  },
  "/plate-reader": {
    route: "/plate-reader",
    label: "Plate Reader / MIC",
    badge: "Plate",
    description: "96/384-well absorbance & 4PL sigmoidal IC50 fits",
    extensions: [".xlsx", ".xls"],
  },
  "/data-studio": {
    route: "/data-studio",
    label: "Data Studio",
    badge: "Studio",
    description: "Tabular datasets, transforms & publication charts",
    extensions: [".json", ".parquet", ".csv", ".tsv"],
  },
};

export function classifyFile(file: File, currentRoute?: string): IngestionRoute {
  const name = file.name.toLowerCase();

  // Explicit LC-MS
  if (name.endsWith(".mzml") || name.endsWith(".mzxml") || name.endsWith(".mzml.gz")) {
    return "/lcms";
  }

  // Explicit Plate Reader
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return "/plate-reader";
  }

  // Explicit FTIR vendor formats
  if (name.endsWith(".dx") || name.endsWith(".jdx") || name.endsWith(".spa") || name.endsWith(".spc")) {
    return "/ftir";
  }

  // Explicit Data Studio JSON / Parquet
  if (name.endsWith(".json") || name.endsWith(".parquet")) {
    return "/data-studio";
  }

  // Ambiguous text/tabular formats (.csv, .tsv, .txt)
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
    if (currentRoute === "/data-studio") return "/data-studio";
    if (currentRoute === "/ftir") return "/ftir";
    if (currentRoute === "/plate-reader") return "/plate-reader";
    // Default ambiguous CSVs to FTIR for spectral data or Data Studio
    return "/ftir";
  }

  return "/data-studio";
}

type IngestHandler = (files: File[]) => void | Promise<void>;

interface FileIngestionContextValue {
  isDragging: boolean;
  hoveredTarget: IngestionRoute | "auto" | null;
  setHoveredTarget: (target: IngestionRoute | "auto" | null) => void;
  ingestFiles: (files: File[], forcedRoute?: IngestionRoute) => Promise<void>;
  registerHandler: (route: IngestionRoute, handler: IngestHandler) => () => void;
}

const FileIngestionContext = createContext<FileIngestionContextValue | null>(null);

export const FileIngestionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredTarget, setHoveredTarget] = useState<IngestionRoute | "auto" | null>("auto");
  const dragCounter = useRef(0);

  const location = useLocation();
  const navigate = useNavigate();

  const handlersRef = useRef<Map<IngestionRoute, IngestHandler>>(new Map());
  const pendingFilesRef = useRef<Map<IngestionRoute, File[]>>(new Map());

  const registerHandler = useCallback((route: IngestionRoute, handler: IngestHandler) => {
    handlersRef.current.set(route, handler);

    // If there were pending files waiting for this route, flush them now
    const pending = pendingFilesRef.current.get(route);
    if (pending && pending.length > 0) {
      pendingFilesRef.current.delete(route);
      setTimeout(() => {
        void handler(pending);
      }, 50);
    }

    return () => {
      handlersRef.current.delete(route);
    };
  }, []);

  const ingestFiles = useCallback(
    async (files: File[], forcedRoute?: IngestionRoute) => {
      if (files.length === 0) return;

      const currentPath = location.pathname as IngestionRoute;

      // If a specific target route was forced (e.g. user dropped on a specific card)
      if (forcedRoute) {
        const handler = handlersRef.current.get(forcedRoute);
        if (handler && location.pathname === forcedRoute) {
          await handler(files);
        } else {
          pendingFilesRef.current.set(forcedRoute, files);
          navigate(forcedRoute);
        }
        return;
      }

      // Otherwise classify each file
      const grouped = new Map<IngestionRoute, File[]>();
      for (const file of files) {
        const route = classifyFile(file, currentPath);
        const group = grouped.get(route) || [];
        group.push(file);
        grouped.set(route, group);
      }

      // Execute each group
      for (const [route, routeFiles] of grouped.entries()) {
        const handler = handlersRef.current.get(route);
        if (handler && location.pathname === route) {
          await handler(routeFiles);
        } else {
          // If not currently on that route, buffer and navigate to it
          pendingFilesRef.current.set(route, routeFiles);
          navigate(route);
        }
      }
    },
    [location.pathname, navigate],
  );

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        dragCounter.current += 1;
        if (dragCounter.current === 1) {
          setIsDragging(true);
        }
      }
    };

    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        dragCounter.current = Math.max(0, dragCounter.current - 1);
        if (dragCounter.current === 0) {
          setIsDragging(false);
          setHoveredTarget("auto");
        }
      }
    };

    const handleDrop = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
          const target = hoveredTarget === "auto" || !hoveredTarget ? undefined : hoveredTarget;
          void ingestFiles(files, target);
        }
        setHoveredTarget("auto");
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [hoveredTarget, ingestFiles]);

  return (
    <FileIngestionContext.Provider
      value={{
        isDragging,
        hoveredTarget,
        setHoveredTarget,
        ingestFiles,
        registerHandler,
      }}
    >
      {children}
    </FileIngestionContext.Provider>
  );
};

export function useFileIngestion(): FileIngestionContextValue {
  const ctx = useContext(FileIngestionContext);
  if (!ctx) {
    throw new Error("useFileIngestion must be used within a FileIngestionProvider");
  }
  return ctx;
}

export function useRegisterFileIngest(route: IngestionRoute, handler: IngestHandler) {
  const { registerHandler } = useFileIngestion();
  useEffect(() => {
    return registerHandler(route, handler);
  }, [registerHandler, route, handler]);
}
