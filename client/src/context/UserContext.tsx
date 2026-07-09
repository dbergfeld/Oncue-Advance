import React, { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { User } from "../types";
import { api, setActiveUserId, setAccessToken } from "../api/client";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";

const STORAGE_KEY = "oncue-active-user-id";

interface UserContextValue {
  /** Full roster — powers owner-assignment dropdowns everywhere, in both modes. */
  users: User[];
  /** The signed-in (Supabase mode) or picked (demo mode) user attributed on writes. */
  activeUser: User | null;
  /** Demo mode only — switches who writes are attributed to. No-op in Supabase mode. */
  setActiveUser: (user: User) => void;
  loading: boolean;
  /** Supabase mode only — null in demo mode. */
  session: Session | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

/**
 * Dual-mode identity provider (see README "State Management"):
 *  - Demo mode (no Supabase project configured): the Phase 1/2 dev-mode
 *    stand-in — whoever is picked is attributed as the actor on every write
 *    via the x-user-id header (api/client.ts, server middleware/auth.ts).
 *  - Supabase mode: a real signed-in session's access token is sent as a
 *    bearer token; the server resolves it to the matching app User
 *    (GET /api/me).
 * `users` (the full roster, for owner-assignment dropdowns) is fetched in
 * both modes — only how `activeUser` is determined differs.
 */
export function UserProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [activeUser, setActiveUserState] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getUsers().then(
      (fetched) => {
        setUsers(fetched);
        if (!isSupabaseConfigured) {
          // Demo mode bootstrap: restore the last-picked user, or default to the first.
          const savedId = localStorage.getItem(STORAGE_KEY);
          const initial = fetched.find((u) => u.id === savedId) ?? fetched[0] ?? null;
          if (initial) {
            setActiveUserState(initial);
            setActiveUserId(initial.id);
          }
          setLoading(false);
        }
      },
      () => setUsers([])
    );
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const client = supabase!;

    async function syncActiveUser(nextSession: Session | null) {
      setSession(nextSession);
      setAccessToken(nextSession?.access_token ?? null);
      if (!nextSession) {
        setActiveUserState(null);
        return;
      }
      try {
        setActiveUserState(await api.getMe());
      } catch {
        setActiveUserState(null);
      }
    }

    client.auth.getSession().then(({ data }) => syncActiveUser(data.session).finally(() => setLoading(false)));

    const { data: subscription } = client.auth.onAuthStateChange((_event, nextSession) => {
      syncActiveUser(nextSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  function setActiveUser(user: User) {
    if (isSupabaseConfigured) return; // identity comes from the session, not a picker
    setActiveUserState(user);
    setActiveUserId(user.id);
    localStorage.setItem(STORAGE_KEY, user.id);
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase!.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  }

  async function signUp(email: string, password: string) {
    const { error } = await supabase!.auth.signUp({ email, password });
    return error?.message ?? null;
  }

  async function signOut() {
    await supabase!.auth.signOut();
  }

  return (
    <UserContext.Provider value={{ users, activeUser, setActiveUser, loading, session, signIn, signUp, signOut }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUsers(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUsers must be used within a UserProvider");
  return ctx;
}
