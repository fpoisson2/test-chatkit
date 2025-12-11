import { useCallback, useEffect, useState } from "react";

import { Modal } from "../../../components/Modal";
import { LoadingSpinner, FormField } from "../../../components";
import { useI18n } from "../../../i18n";
import { useAuth } from "../../../auth";
import {
  useGenerationPrompts,
  useStartWorkflowGeneration,
  useGenerationTaskStatus,
  useApplyWorkflowGeneration,
} from "../../../hooks";
import { useModalContext } from "../contexts/ModalContext";
import { useWorkflowContext } from "../contexts/WorkflowContext";
import { useGraphContext } from "../contexts/GraphContext";

type WorkflowGenerationModalProps = {
  workflowId: number;
};

export const WorkflowGenerationModal = ({ workflowId }: WorkflowGenerationModalProps) => {
  const { t } = useI18n();
  const { token } = useAuth();
  const {
    isGenerationModalOpen,
    closeGenerationModal,
    isGenerating,
    setIsGenerating,
    generationTaskId,
    setGenerationTaskId,
    generationError,
    setGenerationError,
  } = useModalContext();
  const { refetch: refetchWorkflow } = useWorkflowContext();
  const { setNodes, setEdges } = useGraphContext();

  // Form state
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null);
  const [userMessage, setUserMessage] = useState("");

  // Query hooks
  const { data: prompts = [], isLoading: isLoadingPrompts } = useGenerationPrompts(token);
  const startGeneration = useStartWorkflowGeneration();
  const applyGeneration = useApplyWorkflowGeneration();
  const {
    data: taskStatus,
    isLoading: isLoadingTask,
  } = useGenerationTaskStatus(token, generationTaskId, isGenerating);

  // Auto-select first prompt when loaded
  useEffect(() => {
    if (prompts.length > 0 && selectedPromptId === null) {
      setSelectedPromptId(prompts[0].id);
    }
  }, [prompts, selectedPromptId]);

  // Watch for task completion
  useEffect(() => {
    if (!taskStatus) return;

    if (taskStatus.status === "completed") {
      setIsGenerating(false);
      // Apply the generated workflow
      handleApplyGeneration();
    } else if (taskStatus.status === "failed") {
      setIsGenerating(false);
      setGenerationError(taskStatus.error_message || t("workflowGeneration.errors.generationFailed"));
    }
  }, [taskStatus]);

  const handleApplyGeneration = useCallback(async () => {
    if (!generationTaskId) return;

    try {
      await applyGeneration.mutateAsync({
        token,
        workflowId,
        taskId: generationTaskId,
      });

      // Refetch workflow to get the new version
      await refetchWorkflow();

      closeGenerationModal();
    } catch (err) {
      setGenerationError(
        err instanceof Error ? err.message : t("workflowGeneration.errors.applyFailed")
      );
    }
  }, [
    applyGeneration,
    closeGenerationModal,
    generationTaskId,
    refetchWorkflow,
    setGenerationError,
    t,
    token,
    workflowId,
  ]);

  const handleStartGeneration = useCallback(async () => {
    if (!selectedPromptId || !userMessage.trim()) return;

    setGenerationError(null);
    setIsGenerating(true);

    try {
      const result = await startGeneration.mutateAsync({
        token,
        workflowId,
        promptId: selectedPromptId,
        userMessage: userMessage.trim(),
      });
      setGenerationTaskId(result.task_id);
    } catch (err) {
      setIsGenerating(false);
      setGenerationError(
        err instanceof Error ? err.message : t("workflowGeneration.errors.startFailed")
      );
    }
  }, [
    selectedPromptId,
    setGenerationError,
    setGenerationTaskId,
    setIsGenerating,
    startGeneration,
    t,
    token,
    userMessage,
    workflowId,
  ]);

  const handleClose = useCallback(() => {
    if (!isGenerating) {
      closeGenerationModal();
    }
  }, [closeGenerationModal, isGenerating]);

  if (!isGenerationModalOpen) {
    return null;
  }

  const progress = taskStatus?.progress ?? 0;
  const canGenerate = selectedPromptId !== null && userMessage.trim().length > 0;

  return (
    <Modal
      title={t("workflowGeneration.modal.title")}
      onClose={handleClose}
      size="lg"
      footer={
        isGenerating ? null : (
          <>
            <button type="button" className="btn btn-ghost" onClick={handleClose}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleStartGeneration}
              disabled={!canGenerate || startGeneration.isPending}
            >
              {startGeneration.isPending
                ? t("workflowGeneration.modal.starting")
                : t("workflowGeneration.modal.generate")}
            </button>
          </>
        )
      }
    >
      <div className="workflow-generation-modal">
        {isGenerating ? (
          <div className="workflow-generation-modal__progress">
            <LoadingSpinner text={t("workflowGeneration.modal.generating")} />
            <div className="workflow-generation-modal__progress-bar">
              <div
                className="workflow-generation-modal__progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="workflow-generation-modal__progress-text">
              {progress}% - {taskStatus?.status === "running"
                ? t("workflowGeneration.modal.statusRunning")
                : t("workflowGeneration.modal.statusPending")}
            </p>
          </div>
        ) : (
          <>
            {generationError && (
              <div className="alert alert--danger">{generationError}</div>
            )}

            <FormField label={t("workflowGeneration.modal.promptLabel")}>
              {isLoadingPrompts ? (
                <LoadingSpinner text={t("workflowGeneration.modal.loadingPrompts")} />
              ) : prompts.length === 0 ? (
                <p className="text-muted">{t("workflowGeneration.modal.noPrompts")}</p>
              ) : (
                <select
                  className="input"
                  value={selectedPromptId ?? ""}
                  onChange={(e) => setSelectedPromptId(Number(e.target.value) || null)}
                >
                  {prompts.map((prompt) => (
                    <option key={prompt.id} value={prompt.id}>
                      {prompt.name} ({prompt.model})
                    </option>
                  ))}
                </select>
              )}
            </FormField>

            <FormField label={t("workflowGeneration.modal.userMessageLabel")}>
              <textarea
                className="textarea"
                rows={8}
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                placeholder={t("workflowGeneration.modal.userMessagePlaceholder")}
              />
            </FormField>
          </>
        )}
      </div>
    </Modal>
  );
};
