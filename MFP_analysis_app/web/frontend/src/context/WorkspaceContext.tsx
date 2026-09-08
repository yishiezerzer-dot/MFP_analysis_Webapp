import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getActiveWorkspaceId, setActiveWorkspaceId, WorkspaceSummary } from "../api";

interface WorkspaceContextType {
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  activeWorkspaceId: string;
  selectWorkspace: (id: string) => void;
  createWorkspace: (name: string) => Promise<WorkspaceSummary>;
  refreshWorkspaces: () => Promise<void>;
  isLoading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveIdState] = useState<string>(() => getActiveWorkspaceId());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const list = await api.workspaces.list();
      setWorkspaces(list);

      // Ensure activeId is valid, otherwise pick first
      const currentId = getActiveWorkspaceId();
      if (list.length > 0 && !list.some((w) => w.id === currentId)) {
        const fallback = list[0].id;
        setActiveWorkspaceId(fallback);
        setActiveIdState(fallback);
      }
    } catch (err) {
      console.error("Failed to load workspaces:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  const selectWorkspace = useCallback((id: string) => {
    setActiveWorkspaceId(id);
    setActiveIdState(id);
  }, []);

  const createWorkspace = useCallback(
    async (name: string): Promise<WorkspaceSummary> => {
      const created = await api.workspaces.create(name);
      await refreshWorkspaces();
      selectWorkspace(created.id);
      return created;
    },
    [refreshWorkspaces, selectWorkspace],
  );

  const activeWorkspace =
    workspaces.find((w) => w.id === activeWorkspaceId) ||
    (workspaces.length > 0 ? workspaces[0] : null);

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        activeWorkspaceId,
        selectWorkspace,
        createWorkspace,
        refreshWorkspaces,
        isLoading,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export function useWorkspace(): WorkspaceContextType {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}
