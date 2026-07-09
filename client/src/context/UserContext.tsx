import React, { createContext, useContext, useEffect, useState } from "react";
import type { User } from "../types";
import { api, setActiveUserId } from "../api/client";

const STORAGE_KEY = "oncue-active-user-id";

interface UserContextValue {
  users: User[];
  activeUser: User | null;
  setActiveUser: (user: User) => void;
  loading: boolean;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

/**
 * Phase 2 has no real authentication (Supabase Auth is a documented,
 * deferred seam — see README). This is the dev-mode stand-in: whoever is
 * picked here is attributed as the actor on every write via the x-user-id
 * header (see api/client.ts and server/src/middleware/actor.ts).
 */
export function UserProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [activeUser, setActiveUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getUsers().then((fetched) => {
      setUsers(fetched);
      const savedId = localStorage.getItem(STORAGE_KEY);
      const initial = fetched.find((u) => u.id === savedId) ?? fetched[0] ?? null;
      if (initial) {
        setActiveUserState(initial);
        setActiveUserId(initial.id);
      }
      setLoading(false);
    });
  }, []);

  function setActiveUser(user: User) {
    setActiveUserState(user);
    setActiveUserId(user.id);
    localStorage.setItem(STORAGE_KEY, user.id);
  }

  return <UserContext.Provider value={{ users, activeUser, setActiveUser, loading }}>{children}</UserContext.Provider>;
}

export function useUsers(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUsers must be used within a UserProvider");
  return ctx;
}
