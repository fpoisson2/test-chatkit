import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../../../auth";
import { useAppLayout } from "../../../components/AppLayout";
import { ChatKitHost } from "../../../components/my-chat/ChatKitHost";
import { ChatStatusMessage } from "../../../components/my-chat/ChatStatusMessage";
import { usePreferredColorScheme } from "../../../hooks/usePreferredColorScheme";
import { useChatkitSession } from "../../../hooks/useChatkitSession";
import { useHostedFlow } from "../../../hooks/useHostedFlow";
import { useWorkflowChatSession } from "../../../hooks/useWorkflowChatSession";
import { useI18n } from "../../../i18n";
import { getOrCreateDeviceId } from "../../../utils/device";
import type { WorkflowSummary, WorkflowVersionSummary } from "../types";
import styles from "../WorkflowBuilderPage.module.css";

type WorkflowPreviewPanelProps = {
  workflow: WorkflowSummary | null;
  version: WorkflowVersionSummary | null;
  onActiveStepChange: (slug: string | null) => void;
  onExitPreview: () => void;
  isMobile?: boolean;
};

type WorkflowIdentity = {
  workflowId: number | null;
  versionId: number | null;
};

const extractWorkflowIdentity = (workflow: WorkflowSummary | null, version: WorkflowVersionSummary | null): WorkflowIdentity => ({
  workflowId: workflow?.id ?? null,
  versionId: version?.id ?? null,
});

export function WorkflowPreviewPanel({
  workflow,
  version,
  onActiveStepChange,
  onExitPreview,
  isMobile = false,
}: WorkflowPreviewPanelProps) {
  const { token, user } = useAuth();
  const { openSidebar } = useAppLayout();
  const preferredColorScheme = usePreferredColorScheme();
  const { t } = useI18n();
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const sessionOwner = user?.email ?? deviceId;
  const [initialThreadId, setInitialThreadId] = useState<string | null>(null);
  const [chatInstanceKey, setChatInstanceKey] = useState(0);
  const identityRef = useRef<WorkflowIdentity | null>(null);

  const { hostedFlowEnabled, disableHostedFlow } = useHostedFlow({
    onDisable: () => {
      setInitialThreadId(null);
      setChatInstanceKey((value) => value + 1);
    },
  });

  const { getClientSecret, isLoading, error, reportError, resetError } = useChatkitSession({
    sessionOwner,
    token,
    hostedFlowEnabled,
    disableHostedFlow,
  });

  const currentIdentity = useMemo(() => extractWorkflowIdentity(workflow, version), [workflow, version]);

  useEffect(() => {
    const previous = identityRef.current;
    identityRef.current = currentIdentity;
    if (!previous) {
      return;
    }
    if (
      previous.workflowId !== currentIdentity.workflowId ||
      previous.versionId !== currentIdentity.versionId
    ) {
      setInitialThreadId(null);
      setChatInstanceKey((value) => value + 1);
      onActiveStepChange(null);
      resetError();
    }
  }, [currentIdentity, onActiveStepChange, resetError]);

  useEffect(() => () => onActiveStepChange(null), [onActiveStepChange]);

  const handleLog = useCallback(
    (entry: { name: string; data?: Record<string, unknown> }) => {
      if (!entry?.name?.startsWith("workflow.task.")) {
        return;
      }
      const taskData = entry.data;
      let slug: string | null = null;
      if (taskData && typeof taskData === "object" && "task" in taskData) {
        const task = (taskData as Record<string, unknown>).task;
        if (task && typeof task === "object" && "metadata" in task) {
          const metadata = (task as Record<string, unknown>).metadata;
          if (metadata && typeof metadata === "object" && "step_slug" in metadata) {
            const raw = (metadata as Record<string, unknown>).step_slug;
            if (typeof raw === "string") {
              slug = raw.trim() || null;
            }
          }
        }
      }
      onActiveStepChange(slug);
    },
    [onActiveStepChange],
  );

  const { control } = useWorkflowChatSession({
    workflow,
    token,
    chatInstanceKey,
    initialThreadId,
    setInitialThreadId,
    openSidebar,
    preferredColorScheme,
    getClientSecret,
    reportError,
    resetError,
    hostedFlowEnabled,
    onLog: handleLog,
  });

  const statusMessage = error ?? (isLoading ? t("workflowBuilder.preview.sessionLoading") : null);

  const title = useMemo(() => {
    if (!workflow) {
      return t("workflowBuilder.preview.title");
    }
    const parts: string[] = [workflow.display_name ?? workflow.slug ?? t("workflowBuilder.preview.title")];
    if (version) {
      const label = version.name?.trim() || `v${version.version}`;
      parts.push(label);
    }
    return parts.join(" • ");
  }, [t, version, workflow]);

  const panelClassName = isMobile
    ? `${styles.previewPanel} ${styles.previewPanelMobile}`
    : styles.previewPanel;

  return (
    <div className={panelClassName}>
      <header className={styles.previewPanelHeader}>
        <div className={styles.previewPanelHeaderMeta}>
          <span className={styles.previewPanelOverline}>{t("workflowBuilder.preview.overline")}</span>
          <h2 className={styles.previewPanelTitle}>{title}</h2>
        </div>
        <button type="button" onClick={onExitPreview} className={styles.previewPanelCloseButton}>
          {t("workflowBuilder.preview.exit")}
        </button>
      </header>
      <div className={styles.previewPanelBody}>
        {workflow && version ? (
          <>
            <ChatKitHost control={control} chatInstanceKey={chatInstanceKey} />
            <ChatStatusMessage message={statusMessage} isError={Boolean(error)} isLoading={isLoading} />
          </>
        ) : (
          <div className={styles.previewPanelPlaceholder}>
            {t("workflowBuilder.preview.missingSelection")}
          </div>
        )}
      </div>
    </div>
  );
}
