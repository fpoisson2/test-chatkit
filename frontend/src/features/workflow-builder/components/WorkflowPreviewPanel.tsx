import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatKitOptions } from "@openai/chatkit";

import { useAuth } from "../../../auth";
import { useI18n } from "../../../i18n";
import { ChatKitHost } from "../../../components/my-chat/ChatKitHost";
import { ChatStatusMessage } from "../../../components/my-chat/ChatStatusMessage";
import { usePreferredColorScheme } from "../../../hooks/usePreferredColorScheme";
import { useChatkitSession } from "../../../hooks/useChatkitSession";
import { useWorkflowChatSession } from "../../../hooks/useWorkflowChatSession";
import type { WorkflowSummary } from "../../../types/workflows";
import { makeApiEndpointCandidates } from "../../../utils/backend";
import { getOrCreateDeviceId } from "../../../utils/device";
import { clearStoredChatKitSecret } from "../../../utils/chatkitSession";
import styles from "../WorkflowBuilderPage.module.css";
import type { WorkflowVersionResponse } from "../types";

type WorkflowPreviewPanelProps = {
  workflow: WorkflowSummary | null;
  version: WorkflowVersionResponse | null;
  onActiveStepChange: (slug: string | null) => void;
  onExitPreview: () => void;
  mode?: "local" | "hosted";
};

type WorkflowLogEntry = {
  name: string;
  data?: Record<string, unknown> | null;
};

type ThreadChangePayload = { threadId: string | null };

type ErrorPayload = { error: Error };

type WorkflowTaskMetadata = {
  step_slug?: unknown;
};

type WorkflowTaskPayload = {
  metadata?: WorkflowTaskMetadata | null;
};

type WorkflowLogData = {
  task?: WorkflowTaskPayload | null;
};

const buildWorkflowLabel = (workflow: WorkflowSummary | null, t: ReturnType<typeof useI18n>["t"]) => {
  if (!workflow) {
    return t("workflowBuilder.preview.untitled");
  }
  return workflow.display_name?.trim() || workflow.slug || t("workflowBuilder.preview.untitled");
};

const resolveDomainKey = () => {
  const rawDomainKey = import.meta.env.VITE_CHATKIT_DOMAIN_KEY?.trim();
  if (rawDomainKey) {
    return rawDomainKey;
  }

  if (typeof window === "undefined") {
    return undefined;
  }

  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1"
    ? "domain_pk_localhost_dev"
    : undefined;
};

const buildVersionLabel = (
  version: WorkflowVersionResponse | null,
  t: ReturnType<typeof useI18n>["t"],
): string => {
  if (!version) {
    return t("workflowBuilder.preview.draftLabel");
  }
  const displayName = version.name?.trim();
  if (displayName) {
    return displayName;
  }
  if (version.version != null) {
    return t("workflowBuilder.preview.versionLabel", { version: version.version });
  }
  return t("workflowBuilder.preview.draftLabel");
};

export function WorkflowPreviewPanel({
  workflow,
  version,
  onActiveStepChange,
  onExitPreview,
  mode = "local",
}: WorkflowPreviewPanelProps) {
  const { token, user } = useAuth();
  const { t } = useI18n();
  const preferredColorScheme = usePreferredColorScheme();
  const workflowId = workflow?.id ?? null;
  const versionId = version?.id ?? null;
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const sessionOwner = `${user?.email ?? deviceId}:preview`;
  const sessionStorageKey = `${sessionOwner}:${mode}`;
  const [chatInstanceKey, setChatInstanceKey] = useState(0);
  const [initialThreadId, setInitialThreadId] = useState<string | null>(null);
  const requestRefreshRef = useRef<((context?: string) => Promise<void> | undefined) | null>(null);
  const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? "").trim();
  const disableHostedPreview = useCallback(() => {}, []);

  const { getClientSecret, isLoading, error, reportError, resetError } = useChatkitSession({
    sessionOwner,
    storageKey: sessionStorageKey,
    token,
    mode,
    disableHostedFlow: disableHostedPreview,
  });

  useEffect(() => {
    clearStoredChatKitSecret(sessionStorageKey);
    setInitialThreadId(null);
    setChatInstanceKey((value) => value + 1);
    onActiveStepChange(null);
  }, [onActiveStepChange, sessionStorageKey, workflowId, versionId]);

  const endpointCandidates = useMemo(
    () => makeApiEndpointCandidates(backendUrl, "/api/chatkit"),
    [backendUrl],
  );

  const resolveApiConfig = useCallback(
    (): ChatKitOptions["api"] => {
      if (mode === "hosted") {
        return { getClientSecret };
      }

      const [fallbackUrl] = endpointCandidates;
      const customApiUrl = fallbackUrl || "/api/chatkit";
      const domainKey = resolveDomainKey();

      const authFetch: typeof fetch = async (resource, init) => {
        const headers = new Headers(init?.headers ?? {});
        if (token) {
          headers.set("Authorization", `Bearer ${token}`);
        }
        const response = await fetch(resource, { ...init, headers });
        if (!response.ok) {
          let detail: string | null = null;
          try {
            detail = await response.clone().text();
          } catch (err) {
            console.warn("[WorkflowPreview] unable to read error body", err);
          }
          const message = detail?.trim()
            ? `${response.status} ${response.statusText} – ${detail.trim()}`
            : `${response.status} ${response.statusText}`;
          throw new Error(`ChatKit request failed (${message})`);
        }
        return response;
      };

      return { url: customApiUrl, fetch: authFetch, ...(domainKey ? { domainKey } : {}) } as ChatKitOptions["api"];
    },
    [endpointCandidates, getClientSecret, mode, token],
  );

  const handleLog = useCallback(
    ({ name, data }: WorkflowLogEntry) => {
      if (!name.startsWith("workflow.task")) {
        return;
      }
      const record = (data ?? {}) as WorkflowLogData;
      const task = record.task ?? null;
      const metadata = task?.metadata ?? null;
      const slug = typeof metadata?.step_slug === "string" ? metadata.step_slug : null;
      onActiveStepChange(slug);
    },
    [onActiveStepChange],
  );

  const chatkitOptions = useMemo(
    () =>
      ({
        api: resolveApiConfig(),
        initialThread: initialThreadId,
        theme: {
          colorScheme: preferredColorScheme,
          radius: "pill",
          density: "normal",
          typography: {
            baseSize: 16,
            fontFamily:
              '"OpenAI Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
            fontFamilyMono:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace',
            fontSources: [
              {
                family: "OpenAI Sans",
                src: "https://cdn.openai.com/common/fonts/openai-sans/v2/OpenAISans-Regular.woff2",
                weight: 400,
                style: "normal",
                display: "swap",
              },
              // ...and 7 more font sources
            ],
          },
        },
        composer: {
          placeholder: t("workflowBuilder.preview.composerPlaceholder"),
          attachments: { enabled: false },
        },
        onError: ({ error: caughtError }: ErrorPayload) => {
          reportError(caughtError.message, caughtError);
        },
        onResponseStart: () => {
          resetError();
        },
        onResponseEnd: () => {
          requestRefreshRef.current?.("[WorkflowPreview] post-response refresh failed");
        },
        onThreadChange: ({ threadId }: ThreadChangePayload) => {
          setInitialThreadId(threadId);
        },
        onLog: handleLog,
      }) satisfies ChatKitOptions,
    [
      handleLog,
      initialThreadId,
      preferredColorScheme,
      reportError,
      resetError,
      resolveApiConfig,
      t,
    ],
  );

  const { control, requestRefresh } = useWorkflowChatSession({
    chatkitOptions,
    token,
    activeWorkflow: workflow,
    initialThreadId,
    reportError,
    mode,
  });

  useEffect(() => {
    requestRefreshRef.current = requestRefresh;
    return () => {
      requestRefreshRef.current = null;
    };
  }, [requestRefresh]);

  const statusMessage = error ?? (isLoading ? t("workflowBuilder.preview.initializing") : null);

  const workflowLabel = buildWorkflowLabel(workflow, t);
  const versionLabel = buildVersionLabel(version, t);

  return (
    <aside className={styles.previewPanel} aria-live="polite">
      <header className={styles.previewPanelHeader}>
        <div className={styles.previewPanelMeta}>
          <p className={styles.previewPanelLabel}>{t("workflowBuilder.preview.title")}</p>
          <h2 className={styles.previewPanelName}>{workflowLabel}</h2>
          <p className={styles.previewPanelVersion}>{versionLabel}</p>
        </div>
        <button
          type="button"
          onClick={onExitPreview}
          className={styles.previewPanelExitButton}
        >
          {t("workflowBuilder.preview.exit")}
        </button>
      </header>
      <div className={styles.previewPanelBody}>
        <ChatKitHost control={control} chatInstanceKey={chatInstanceKey} />
      </div>
      <ChatStatusMessage message={statusMessage} isError={Boolean(error)} isLoading={isLoading} />
    </aside>
  );
}
