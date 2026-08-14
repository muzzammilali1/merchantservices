import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { CurrentUser } from "../lib/types";

export function useAuth() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<CurrentUser>("/api/auth/me");
      setUser(me);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
      } else {
        throw error;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const loggedInUser = await api.post<CurrentUser>("/api/auth/login", { email, password });
      setUser(loggedInUser);
    },
    []
  );

  const logout = useCallback(async () => {
    await api.post("/api/auth/logout");
    setUser(null);
  }, []);

  return { user, loading, login, logout, refresh };
}
