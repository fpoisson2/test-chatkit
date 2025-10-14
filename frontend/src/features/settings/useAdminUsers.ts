import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { AuthUser } from "../../auth";
import { makeApiEndpointCandidates } from "../../utils/backend";

const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? "").trim();

export type EditableUser = AuthUser;

export type CreateUserPayload = {
  email: string;
  password: string;
  is_admin: boolean;
};

export type AdminUsersState = {
  users: EditableUser[];
  isLoading: boolean;
  error: string | null;
  createPayload: CreateUserPayload;
  isCreatingUser: boolean;
};

export type AdminUsersActions = {
  setCreatePayload: Dispatch<SetStateAction<CreateUserPayload>>;
  refresh: () => Promise<void>;
  createUser: () => Promise<void>;
  toggleAdmin: (user: EditableUser) => Promise<void>;
  deleteUser: (user: EditableUser) => Promise<void>;
  updatePassword: (user: EditableUser, password: string) => Promise<void>;
};

export type UseAdminUsersResult = {
  state: AdminUsersState;
  actions: AdminUsersActions;
};

export type UseAdminUsersOptions = {
  token: string | null;
  isEnabled: boolean;
  onUnauthorized: () => void;
};

export function useAdminUsers({
  token,
  isEnabled,
  onUnauthorized,
}: UseAdminUsersOptions): UseAdminUsersResult {
  const [users, setUsers] = useState<EditableUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createPayload, setCreatePayload] = useState<CreateUserPayload>({
    email: "",
    password: "",
    is_admin: false,
  });
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  const headers = useMemo(() => {
    const base: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      base.Authorization = `Bearer ${token}`;
    }
    return base;
  }, [token]);

  const requestWithFallback = useCallback(async (path: string, init?: RequestInit) => {
    const endpoints = makeApiEndpointCandidates(backendUrl, path);
    let lastError: Error | null = null;

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, init);
        const isSameOriginEndpoint = endpoint.startsWith("/");

        if (!response.ok && isSameOriginEndpoint && endpoints.length > 1) {
          let detail = `${response.status} ${response.statusText}`;
          try {
            const body = await response.clone().json();
            if (body?.detail) {
              detail = String(body.detail);
            }
          } catch (parseError) {
            if (parseError instanceof Error) {
              detail = parseError.message;
            }
          }
          lastError = new Error(detail);
          continue;
        }

        return response;
      } catch (networkError) {
        if (networkError instanceof Error) {
          lastError = networkError;
        } else {
          lastError = new Error("Une erreur inattendue est survenue");
        }
      }
    }

    throw lastError ?? new Error("Impossible de joindre le backend d'administration");
  }, []);

  const handleUnauthorized = useCallback(() => {
    onUnauthorized();
    setUsers([]);
    setError("Session expirée, veuillez vous reconnecter.");
  }, [onUnauthorized]);

  const fetchUsers = useCallback(async () => {
    if (!token || !isEnabled) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await requestWithFallback("/api/admin/users", {
        headers,
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        const { detail } = await response.json();
        throw new Error(detail ?? "Impossible de récupérer les utilisateurs");
      }
      const data: EditableUser[] = await response.json();
      setUsers(data);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur inattendue est survenue");
      }
    } finally {
      setIsLoading(false);
    }
  }, [handleUnauthorized, headers, isEnabled, requestWithFallback, token]);

  useEffect(() => {
    if (isEnabled) {
      void fetchUsers();
    } else {
      setIsLoading(false);
    }
  }, [fetchUsers, isEnabled]);

  const createUser = useCallback(async () => {
    if (!token || !isEnabled) {
      return;
    }
    if (!createPayload.email || !createPayload.password) {
      return;
    }
    setError(null);
    setIsCreatingUser(true);
    try {
      const response = await requestWithFallback("/api/admin/users", {
        method: "POST",
        headers,
        body: JSON.stringify(createPayload),
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        const { detail } = await response.json();
        throw new Error(detail ?? "Impossible de créer l'utilisateur");
      }
      const created: EditableUser = await response.json();
      setUsers((prev) => [...prev, created]);
      setCreatePayload({ email: "", password: "", is_admin: false });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur inattendue est survenue");
      }
    } finally {
      setIsCreatingUser(false);
    }
  }, [createPayload, handleUnauthorized, headers, isEnabled, requestWithFallback, token]);

  const toggleAdmin = useCallback(
    async (editableUser: EditableUser) => {
      if (!token || !isEnabled) {
        return;
      }
      setError(null);
      try {
        const response = await requestWithFallback(`/api/admin/users/${editableUser.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ is_admin: !editableUser.is_admin }),
        });
        if (response.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!response.ok) {
          const { detail } = await response.json();
          throw new Error(detail ?? "Impossible de mettre à jour l'utilisateur");
        }
        const updated: EditableUser = await response.json();
        setUsers((prev) => prev.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Une erreur inattendue est survenue");
        }
      }
    },
    [handleUnauthorized, headers, isEnabled, requestWithFallback, token],
  );

  const deleteUser = useCallback(
    async (editableUser: EditableUser) => {
      if (!token || !isEnabled) {
        return;
      }
      setError(null);
      try {
        const response = await requestWithFallback(`/api/admin/users/${editableUser.id}`, {
          method: "DELETE",
          headers,
        });
        if (response.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!response.ok && response.status !== 204) {
          const { detail } = await response.json();
          throw new Error(detail ?? "Impossible de supprimer l'utilisateur");
        }
        setUsers((prev) => prev.filter((candidate) => candidate.id !== editableUser.id));
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Une erreur inattendue est survenue");
        }
      }
    },
    [handleUnauthorized, headers, isEnabled, requestWithFallback, token],
  );

  const updatePassword = useCallback(
    async (editableUser: EditableUser, password: string) => {
      if (!token || !isEnabled) {
        return;
      }
      setError(null);
      try {
        const response = await requestWithFallback(`/api/admin/users/${editableUser.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ password }),
        });
        if (response.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!response.ok) {
          const { detail } = await response.json();
          throw new Error(detail ?? "Impossible de mettre à jour le mot de passe");
        }
        const updated: EditableUser = await response.json();
        setUsers((prev) => prev.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Une erreur inattendue est survenue");
        }
      }
    },
    [handleUnauthorized, headers, isEnabled, requestWithFallback, token],
  );

  const refresh = useCallback(async () => {
    await fetchUsers();
  }, [fetchUsers]);

  return {
    state: {
      users,
      isLoading,
      error,
      createPayload,
      isCreatingUser,
    },
    actions: {
      setCreatePayload,
      refresh,
      createUser,
      toggleAdmin,
      deleteUser,
      updatePassword,
    },
  };
}
