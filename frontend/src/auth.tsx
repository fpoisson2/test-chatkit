import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AuthUser = {
  id: number;
  email: string;
  is_admin: boolean;
  is_lti: boolean;
  created_at: string;
  updated_at: string;
};

export type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = "chatkit:auth:token";
const USER_KEY = "chatkit:auth:user";

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem(TOKEN_KEY);
  });

  const [user, setUser] = useState<AuthUser | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as AuthUser;
    } catch (_error) {
      return null;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  }, [token]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (user) {
      window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(USER_KEY);
    }
  }, [user]);

  const contextValue = useMemo<AuthContextValue>(() => ({
    token,
    user,
    login: (nextToken, nextUser) => {
      setToken(nextToken);
      setUser(nextUser);
    },
    logout: () => {
      setToken(null);
      setUser(null);
    },
  }), [token, user]);

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth doit être utilisé dans un AuthProvider");
  }
  return ctx;
};
