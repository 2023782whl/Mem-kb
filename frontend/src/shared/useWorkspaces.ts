import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Workspace } from "../types/domain";

export function useWorkspaces(kind?: "document" | "image") {
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.workspaces();
      setAllWorkspaces(result.workspaces);
      const filtered = kind ? result.workspaces.filter((item) => item.kind === kind || item.kind === "mixed") : result.workspaces;
      setWorkspaces(filtered);
      const requestedId = new URLSearchParams(window.location.search).get("workspace");
      setActiveId((current) => {
        if (requestedId && filtered.some((item) => item.id === requestedId)) return requestedId;
        return filtered.some((item) => item.id === current) ? current : filtered[0]?.id || "";
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Workspace 加载失败");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => { void refresh(); }, [refresh]);
  const active = useMemo(() => workspaces.find((item) => item.id === activeId) || null, [workspaces, activeId]);
  return { allWorkspaces, workspaces, active, activeId, setActiveId, loading, error, refresh };
}
