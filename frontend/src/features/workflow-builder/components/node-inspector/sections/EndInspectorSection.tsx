import { useI18n } from "../../../../../i18n";
import { HelpTooltip } from "../components/HelpTooltip";
import styles from "../NodeInspector.module.css";

type EndInspectorSectionProps = {
  nodeId: string;
  endMessage: string;
  agsVariableId: string;
  agsScoreExpression: string;
  agsMaximumExpression: string;
  agsCommentExpression: string;
  onEndMessageChange: (nodeId: string, value: string) => void;
  onAgsVariableIdChange: (nodeId: string, value: string) => void;
  onAgsScoreExpressionChange: (nodeId: string, value: string) => void;
  onAgsMaximumExpressionChange: (nodeId: string, value: string) => void;
  onAgsCommentExpressionChange: (nodeId: string, value: string) => void;
};

export const EndInspectorSection = ({
  nodeId,
  endMessage,
  agsVariableId,
  agsScoreExpression,
  agsMaximumExpression,
  agsCommentExpression,
  onEndMessageChange,
  onAgsVariableIdChange,
  onAgsScoreExpressionChange,
  onAgsMaximumExpressionChange,
  onAgsCommentExpressionChange,
}: EndInspectorSectionProps) => {
  const { t } = useI18n();

  return (
    <>
      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.endInspector.messageLabel")}
          <HelpTooltip label={t("workflowBuilder.endInspector.messageHelp")} />
        </span>
        <textarea
          value={endMessage}
          rows={4}
          placeholder={t("workflowBuilder.endInspector.messagePlaceholder")}
          onChange={(event) => onEndMessageChange(nodeId, event.target.value)}
          className={styles.nodeInspectorTextarea}
        />
      </label>

      <section className={styles.nodeInspectorPanel} aria-label={t("workflowBuilder.endInspector.agsSectionAriaLabel")}>
        <h3 className={styles.nodeInspectorSectionHeading}>
          {t("workflowBuilder.endInspector.agsSectionTitle")}
        </h3>
        <p className={styles.nodeInspectorHintTextTight}>
          {t("workflowBuilder.endInspector.agsSectionHint")}
        </p>

        <label className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            {t("workflowBuilder.endInspector.agsVariableLabel")}
            <HelpTooltip label={t("workflowBuilder.endInspector.agsVariableHelp")} />
          </span>
          <input
            type="text"
            value={agsVariableId}
            onChange={(event) => onAgsVariableIdChange(nodeId, event.target.value)}
            placeholder={t("workflowBuilder.endInspector.agsVariablePlaceholder")}
          />
        </label>

        <label className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            {t("workflowBuilder.endInspector.agsScoreLabel")}
            <HelpTooltip label={t("workflowBuilder.endInspector.agsScoreHelp")} />
          </span>
          <input
            type="text"
            value={agsScoreExpression}
            onChange={(event) => onAgsScoreExpressionChange(nodeId, event.target.value)}
            placeholder={t("workflowBuilder.endInspector.agsScorePlaceholder")}
          />
        </label>

        <label className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            {t("workflowBuilder.endInspector.agsMaximumLabel")}
            <HelpTooltip label={t("workflowBuilder.endInspector.agsMaximumHelp")} />
          </span>
          <input
            type="text"
            value={agsMaximumExpression}
            onChange={(event) => onAgsMaximumExpressionChange(nodeId, event.target.value)}
            placeholder={t("workflowBuilder.endInspector.agsMaximumPlaceholder")}
          />
        </label>

        <label className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            {t("workflowBuilder.endInspector.agsCommentLabel")}
            <HelpTooltip label={t("workflowBuilder.endInspector.agsCommentHelp")} />
          </span>
          <input
            type="text"
            value={agsCommentExpression}
            onChange={(event) => onAgsCommentExpressionChange(nodeId, event.target.value)}
            placeholder={t("workflowBuilder.endInspector.agsCommentPlaceholder")}
          />
        </label>
      </section>
    </>
  );
};
