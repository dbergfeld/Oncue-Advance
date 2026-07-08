import type { AppData, TourStop } from "../types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${init?.method ?? "GET"} ${path} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getData: () => request<AppData>("/data"),
  updateTourStop: (id: string, stop: TourStop) =>
    request<TourStop>(`/tourstops/${id}`, { method: "PUT", body: JSON.stringify(stop) }),
  reset: () => request<AppData>("/reset", { method: "POST" }),
};
