import { useCallback, useMemo } from "react";

import { useAuth } from "../auth";
import { makeApiEndpointCandidates } from "../utils/backend";

const sanitizeEnvValue = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const DEFAULT_VOICE_SESSION_PATH = "/api/chatkit/voice/session";
const RAW_BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? "").trim();
const RAW_VOICE_SESSION_URL = sanitizeEnvValue(import.meta.env.VITE_VOICE_SESSION_URL);
const VOICE_SESSION_IS_ABSOLUTE =
  typeof RAW_VOICE_SESSION_URL === "string" && /^https?:\/\//i.test(RAW_VOICE_SESSION_URL);

const VOICE_SESSION_ENDPOINTS = VOICE_SESSION_IS_ABSOLUTE
  ? [RAW_VOICE_SESSION_URL as string]
  : makeApiEndpointCandidates(
      RAW_BACKEND_URL,
      RAW_VOICE_SESSION_URL ?? DEFAULT_VOICE_SESSION_PATH,
    );

const VOICE_REQUEST_DEFAULTS = {
  model: sanitizeEnvValue(import.meta.env.VITE_VOICE_DEFAULT_MODEL),
  instructions: sanitizeEnvValue(import.meta.env.VITE_VOICE_DEFAULT_INSTRUCTIONS),
  voice: sanitizeEnvValue(import.meta.env.VITE_VOICE_DEFAULT_VOICE),
};

export const VOICE_SESSION_UNAUTHORIZED_MESSAGE = "Session expirée, veuillez vous reconnecter.";
export const VOICE_SESSION_GENERIC_ERROR = "Impossible de récupérer le secret temps réel.";

export type VoiceSessionSecret = {
  client_secret: { value?: string } | string;
  expires_at?: string | null;
  instructions: string;
  model: string;
  model_provider_id?: string | null;
  model_provider_slug?: string | null;
  voice: string;
  prompt_id?: string | null;
  prompt_version?: string | null;
  prompt_variables?: Record<string, string>;
};

type UseVoiceSecretResult = {
  fetchSecret: () => Promise<VoiceSessionSecret>;
};

export const useVoiceSecret = (): UseVoiceSecretResult => {
  const { token, logout } = useAuth();

  const fetchSecret = useCallback(async (): Promise<VoiceSessionSecret> => {
    if (!token) {
      throw new Error("Authentification requise pour démarrer une session vocale.");
    }

    const payload: Record<string, string> = {};
    if (VOICE_REQUEST_DEFAULTS.model) {
      payload.model = VOICE_REQUEST_DEFAULTS.model;
    }
    if (VOICE_REQUEST_DEFAULTS.instructions) {
      payload.instructions = VOICE_REQUEST_DEFAULTS.instructions;
    }
    if (VOICE_REQUEST_DEFAULTS.voice) {
      payload.voice = VOICE_REQUEST_DEFAULTS.voice;
    }

    const body = JSON.stringify(Object.keys(payload).length > 0 ? payload : {});
    let lastError: Error | null = null;

    for (let index = 0; index < VOICE_SESSION_ENDPOINTS.length; index += 1) {
      const endpoint = VOICE_SESSION_ENDPOINTS[index];
      const hasFallback = index < VOICE_SESSION_ENDPOINTS.length - 1;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body,
        });

        if (response.status === 401) {
          logout();
          throw new Error(VOICE_SESSION_UNAUTHORIZED_MESSAGE);
        }

        if (!response.ok) {
          const error = new Error(
            `Échec de la récupération du secret temps réel (HTTP ${response.status}).`,
          );
          const isSameOrigin = endpoint.startsWith("/");
          if (isSameOrigin && hasFallback) {
            lastError = error;
            continue;
          }
          throw error;
        }

        const data = (await response.json()) as VoiceSessionSecret;
        return data;
      } catch (error) {
        if (error instanceof Error && error.message === VOICE_SESSION_UNAUTHORIZED_MESSAGE) {
          throw error;
        }
        const normalized = error instanceof Error ? error : new Error(VOICE_SESSION_GENERIC_ERROR);
        if (!hasFallback) {
          throw normalized;
        }
        lastError = normalized;
      }
    }

    throw lastError ?? new Error(VOICE_SESSION_GENERIC_ERROR);
  }, [logout, token]);

  return useMemo(
    () => ({
      fetchSecret,
    }),
    [fetchSecret],
  );
};

