import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Show, ShowSummary } from "../types";
import { api } from "../api/client";

interface ShowContextValue {
  shows: ShowSummary[];
  selectedShowId: string | null;
  selectedShow: Show | null;
  loading: boolean;
  showLoading: boolean;
  error: string | null;
  selectShow: (id: string) => void;
  refreshShows: () => Promise<void>;
  refreshSelectedShow: () => Promise<void>;
}

const ShowContext = createContext<ShowContextValue | undefined>(undefined);

export function ShowProvider({ children }: { children: React.ReactNode }) {
  const [shows, setShows] = useState<ShowSummary[]>([]);
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshShows = useCallback(async () => {
    const fetched = await api.getShows();
    setShows(fetched);
    return fetched;
  }, []);

  const loadShow = useCallback(async (id: string) => {
    setShowLoading(true);
    try {
      const show = await api.getShow(id);
      setSelectedShow(show);
    } finally {
      setShowLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    refreshShows()
      .then((fetched) => {
        if (cancelled) return;
        const sorted = [...fetched].sort((a, b) => a.date.localeCompare(b.date));
        const initialId = sorted[0]?.id ?? null;
        setSelectedShowId(initialId);
        setLoading(false);
        if (initialId) loadShow(initialId);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "Failed to load show data. Is the API server running on :4000?");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshShows, loadShow]);

  const selectShow = useCallback(
    (id: string) => {
      setSelectedShowId(id);
      loadShow(id);
    },
    [loadShow]
  );

  const refreshSelectedShow = useCallback(async () => {
    if (selectedShowId) await loadShow(selectedShowId);
    await refreshShows();
  }, [selectedShowId, loadShow, refreshShows]);

  const value: ShowContextValue = {
    shows,
    selectedShowId,
    selectedShow,
    loading,
    showLoading,
    error,
    selectShow,
    refreshShows: async () => {
      await refreshShows();
    },
    refreshSelectedShow,
  };

  return <ShowContext.Provider value={value}>{children}</ShowContext.Provider>;
}

export function useShow(): ShowContextValue {
  const ctx = useContext(ShowContext);
  if (!ctx) throw new Error("useShow must be used within a ShowProvider");
  return ctx;
}
