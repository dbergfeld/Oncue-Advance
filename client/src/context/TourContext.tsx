import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AppData, Tour, TourStop } from "../types";
import { api } from "../api/client";

interface TourContextValue {
  tour: Tour | null;
  tourStops: TourStop[];
  selectedStopId: string | null;
  selectedStop: TourStop | null;
  loading: boolean;
  error: string | null;
  selectStop: (id: string) => void;
  updateStop: (id: string, updater: (stop: TourStop) => TourStop) => void;
  savingStopIds: Set<string>;
}

const TourContext = createContext<TourContextValue | undefined>(undefined);

const SAVE_DEBOUNCE_MS = 600;

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [appData, setAppData] = useState<AppData | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingStopIds, setSavingStopIds] = useState<Set<string>>(new Set());

  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    let cancelled = false;
    api
      .getData()
      .then((data) => {
        if (cancelled) return;
        setAppData(data);
        const sorted = [...data.tourStops].sort((a, b) => a.date.localeCompare(b.date));
        setSelectedStopId(sorted[0]?.id ?? null);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "Failed to load tour data. Is the API server running on :4000?");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectStop = useCallback((id: string) => {
    setSelectedStopId(id);
  }, []);

  const persistStop = useCallback((stop: TourStop) => {
    setSavingStopIds((prev) => new Set(prev).add(stop.id));
    api
      .updateTourStop(stop.id, stop)
      .then((saved) => {
        setAppData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tourStops: prev.tourStops.map((s) => (s.id === saved.id ? saved : s)),
          };
        });
      })
      .catch(() => {
        // Optimistic local state is preserved even if the persist call fails —
        // the in-session edit is not lost, it just won't survive a server restart.
      })
      .finally(() => {
        setSavingStopIds((prev) => {
          const next = new Set(prev);
          next.delete(stop.id);
          return next;
        });
      });
  }, []);

  const updateStop = useCallback(
    (id: string, updater: (stop: TourStop) => TourStop) => {
      setAppData((prev) => {
        if (!prev) return prev;
        let updatedStop: TourStop | null = null;
        const tourStops = prev.tourStops.map((s) => {
          if (s.id !== id) return s;
          updatedStop = updater(s);
          return updatedStop;
        });
        if (!updatedStop) return prev;

        const existingTimer = saveTimers.current.get(id);
        if (existingTimer) clearTimeout(existingTimer);
        const stopToSave = updatedStop;
        saveTimers.current.set(
          id,
          setTimeout(() => persistStop(stopToSave), SAVE_DEBOUNCE_MS)
        );

        return { ...prev, tourStops };
      });
    },
    [persistStop]
  );

  const selectedStop = useMemo(
    () => appData?.tourStops.find((s) => s.id === selectedStopId) ?? null,
    [appData, selectedStopId]
  );

  const value: TourContextValue = {
    tour: appData?.tour ?? null,
    tourStops: appData?.tourStops ?? [],
    selectedStopId,
    selectedStop,
    loading,
    error,
    selectStop,
    updateStop,
    savingStopIds,
  };

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within a TourProvider");
  return ctx;
}
