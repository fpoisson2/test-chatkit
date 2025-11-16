import { useState, useEffect } from "react";
import { useI18n } from "../../../../../i18n";
import { HelpTooltip } from "../components/HelpTooltip";
import styles from "../NodeInspector.module.css";

type WhileInspectorSectionProps = {
  nodeId: string;
  condition: string;
  maxIterations: number;
  iterationVar: string;
  onConditionChange: (nodeId: string, value: string) => void;
  onMaxIterationsChange: (nodeId: string, value: number) => void;
  onIterationVarChange: (nodeId: string, value: string) => void;
};

export const WhileInspectorSection = ({
  nodeId,
  condition,
  maxIterations,
  iterationVar,
  onConditionChange,
  onMaxIterationsChange,
  onIterationVarChange,
}: WhileInspectorSectionProps) => {
  const { t } = useI18n();
  const [conditionDraft, setConditionDraft] = useState(condition);
  const [maxIterationsDraft, setMaxIterationsDraft] = useState(String(maxIterations));
  const [iterationVarDraft, setIterationVarDraft] = useState(iterationVar);

  // Sync drafts when props change (e.g., when switching nodes)
  useEffect(() => {
    setConditionDraft(condition);
  }, [nodeId, condition]);

  useEffect(() => {
    setMaxIterationsDraft(String(maxIterations));
  }, [nodeId, maxIterations]);

  useEffect(() => {
    setIterationVarDraft(iterationVar);
  }, [nodeId, iterationVar]);

  return (
    <div className={styles.nodeInspectorPanelInnerAccent}>
      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.while.conditionLabel")}
          <HelpTooltip label={t("workflowBuilder.while.conditionHelp")} />
        </span>
        <input
          type="text"
          value={conditionDraft}
          onChange={(event) => {
            setConditionDraft(event.target.value);
            onConditionChange(nodeId, event.target.value);
          }}
          placeholder={t("workflowBuilder.while.conditionPlaceholder")}
        />
      </label>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.while.maxIterationsLabel")}
          <HelpTooltip label={t("workflowBuilder.while.maxIterationsHelp")} />
        </span>
        <input
          type="number"
          value={maxIterationsDraft}
          onChange={(event) => {
            const value = event.target.value;
            setMaxIterationsDraft(value);
            const numValue = parseInt(value, 10);
            if (!isNaN(numValue) && numValue >= 1) {
              onMaxIterationsChange(nodeId, numValue);
            }
          }}
          onBlur={() => {
            const numValue = parseInt(maxIterationsDraft, 10);
            if (isNaN(numValue) || numValue < 1) {
              setMaxIterationsDraft("100");
              onMaxIterationsChange(nodeId, 100);
            }
          }}
          placeholder={t("workflowBuilder.while.maxIterationsPlaceholder")}
          min={1}
        />
      </label>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.while.iterationVarLabel")}
          <HelpTooltip label={t("workflowBuilder.while.iterationVarHelp")} />
        </span>
        <input
          type="text"
          value={iterationVarDraft}
          onChange={(event) => {
            setIterationVarDraft(event.target.value);
            onIterationVarChange(nodeId, event.target.value);
          }}
          placeholder={t("workflowBuilder.while.iterationVarPlaceholder")}
        />
      </label>
    </div>
  );
};
