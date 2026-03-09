/**
 * Reusable rich message field with:
 * - Textarea editor
 * - Expand button → modal with edit/preview toggle (markdown)
 * - "Improve with AI" button + prompt input
 * - Optional "Publish live" button
 *
 * Used by evaluated_step, help_loop, guided_exercise inspectors
 * (same UX as AssistantMessageInspectorSection).
 */
import { Maximize2, Send, Sparkles } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { useAuth } from "../../../../../auth";
import { useI18n } from "../../../../../i18n";
import { workflowsApi } from "../../../../../utils/backend";
import { AssistantMessageModal } from "./AssistantMessageModal";
import inspectorStyles from "../NodeInspector.module.css";

type RichMessageFieldProps = {
  /** Current field value */
  value: string;
  /** Called when value changes */
  onChange: (value: string) => void;
  /** Label shown above the field */
  label: string;
  /** Hint text below the field */
  hint?: string;
  /** Placeholder for the textarea */
  placeholder?: string;
  /** Number of rows for the inline textarea */
  rows?: number;
  /** Content type sent to the improve API ("assistant_message" | "system_prompt") */
  contentType?: "assistant_message" | "system_prompt";
  /** Workflow ID for live publishing (optional) */
  workflowId?: number | null;
  /** Step slug for live publishing (optional) */
  stepSlug?: string;
  /** Whether this is the active version (enables live publish) */
  isActiveVersion?: boolean;
};

export const RichMessageField = ({
  value,
  onChange,
  label,
  hint,
  placeholder,
  rows = 4,
  contentType = "assistant_message",
  workflowId,
  stepSlug,
  isActiveVersion,
}: RichMessageFieldProps) => {
  const { t } = useI18n();
  const { token } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImproving, setIsImproving] = useState(false);
  const [showImproveInput, setShowImproveInput] = useState(false);
  const [improveInstructions, setImproveInstructions] = useState("");
  const improveInputRef = useRef<HTMLInputElement>(null);

  const handleImproveWithAI = useCallback(async () => {
    if (!value.trim()) return;
    setIsImproving(true);
    try {
      const result = await workflowsApi.improveContent(
        token, value, contentType, improveInstructions.trim() || undefined,
      );
      onChange(result.improved_content);
      setShowImproveInput(false);
      setImproveInstructions("");
    } catch {
      // silently fail
    } finally {
      setIsImproving(false);
    }
  }, [token, value, contentType, onChange, improveInstructions]);

  return (
    <>
      <label className={inspectorStyles.nodeInspectorField}>
        <span className={inspectorStyles.nodeInspectorLabel}>{label}</span>
        <div className={inspectorStyles.nodeInspectorTextareaWithAction}>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={rows}
            placeholder={placeholder}
            className={inspectorStyles.nodeInspectorTextarea}
          />
          <div className={inspectorStyles.nodeInspectorTextareaActions}>
            <button
              type="button"
              className={`${inspectorStyles.nodeInspectorExpandButton}${showImproveInput ? ` ${inspectorStyles.nodeInspectorExpandButtonActive}` : ""}`}
              onClick={() => {
                setShowImproveInput((v) => !v);
                setTimeout(() => improveInputRef.current?.focus(), 0);
              }}
              disabled={isImproving}
              title={t("workflowBuilder.improveWithAI")}
              aria-label={t("workflowBuilder.improveWithAI")}
            >
              <Sparkles size={16} className={isImproving ? inspectorStyles.nodeInspectorSpinning : ""} />
            </button>
            <button
              type="button"
              className={inspectorStyles.nodeInspectorExpandButton}
              onClick={() => setIsModalOpen(true)}
              title={t("workflowBuilder.assistantMessageInspector.modal.expand")}
              aria-label={t("workflowBuilder.assistantMessageInspector.modal.expand")}
            >
              <Maximize2 size={16} />
            </button>
          </div>
        </div>
        {showImproveInput ? (
          <div className={inspectorStyles.nodeInspectorImproveRow}>
            <input
              ref={improveInputRef}
              type="text"
              className={inspectorStyles.nodeInspectorImproveInput}
              value={improveInstructions}
              onChange={(e) => setImproveInstructions(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleImproveWithAI(); }}
              placeholder={t("workflowBuilder.improveWithAIPlaceholder")}
              disabled={isImproving}
            />
            <button
              type="button"
              className={inspectorStyles.nodeInspectorImproveSendButton}
              onClick={handleImproveWithAI}
              disabled={isImproving || !value.trim()}
              title={t("workflowBuilder.improveWithAI")}
            >
              {isImproving
                ? <Sparkles size={14} className={inspectorStyles.nodeInspectorSpinning} />
                : <Send size={14} />}
            </button>
          </div>
        ) : null}
        {hint ? (
          <p className={inspectorStyles.nodeInspectorHintTextTight}>{hint}</p>
        ) : null}
      </label>

      <AssistantMessageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        value={value}
        onChange={onChange}
        workflowId={workflowId}
        stepSlug={stepSlug}
        isActiveVersion={isActiveVersion}
      />
    </>
  );
};
