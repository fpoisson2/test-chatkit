import { conditionModeOptions } from "../constants";
import { HelpTooltip } from "../components/HelpTooltip";
import styles from "../NodeInspector.module.css";

type AvailableVariable = {
  name: string;
  description?: string;
};

type ConditionInspectorSectionProps = {
  nodeId: string;
  conditionPath: string;
  conditionMode: string;
  conditionValue: string;
  onConditionPathChange: (nodeId: string, value: string) => void;
  onConditionModeChange: (nodeId: string, value: string) => void;
  onConditionValueChange: (nodeId: string, value: string) => void;
  availableVariables?: AvailableVariable[];
  previousNodeLabel?: string;
};

export const ConditionInspectorSection = ({
  nodeId,
  conditionPath,
  conditionMode,
  conditionValue,
  onConditionPathChange,
  onConditionModeChange,
  onConditionValueChange,
  availableVariables = [],
  previousNodeLabel,
}: ConditionInspectorSectionProps) => (
  <>
    {availableVariables.length > 0 && (
      <div className={styles.nodeInspectorPanelInner}>
        <p className={styles.nodeInspectorLabel}>
          Variables disponibles
          {previousNodeLabel && (
            <span className={styles.nodeInspectorCodeNote}> depuis « {previousNodeLabel} »</span>
          )}
        </p>
        <ul className={styles.nodeInspectorList}>
          {availableVariables.map(({ name, description }) => (
            <li key={name} className={styles.nodeInspectorListItem}>
              <code className={styles.nodeInspectorCode}>{name}</code>
              {description && (
                <span className={styles.nodeInspectorCodeNote}> — {description}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    )}

    <label className={styles.nodeInspectorField}>
      <span className={styles.nodeInspectorLabel}>
        Variable observée
        <HelpTooltip label="Référencez une valeur disponible dans l'état ou le résultat de l'étape précédente (ex. state.status, input.output_structured.champ, ou input.output_parsed)." />
      </span>
      <input
        type="text"
        value={conditionPath}
        onChange={(event) => onConditionPathChange(nodeId, event.target.value)}
         placeholder="Ex. input.output_structured.status"
      />
    </label>

    <label className={styles.nodeInspectorField}>
      <span className={styles.nodeInspectorLabel}>
        Mode d'évaluation
        <HelpTooltip label="Choisissez comment interpréter la valeur observée pour déterminer la branche à suivre." />
      </span>
      <select
        value={conditionMode}
        onChange={(event) => onConditionModeChange(nodeId, event.target.value)}
      >
        {conditionModeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>

    {(conditionMode === "equals" || conditionMode === "not_equals") && (
      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          Valeur de comparaison
          <HelpTooltip label="La valeur (chaîne, nombre…) qui servira de référence pour la comparaison." />
        </span>
        <input
          type="text"
          value={conditionValue}
          onChange={(event) => onConditionValueChange(nodeId, event.target.value)}
          placeholder="Ex. approuvée"
        />
      </label>
    )}

    <p className={styles.nodeInspectorHintTextTight}>
      Définissez les différentes branches dans les propriétés des connexions. Laissez le champ vide pour créer une branche par
      défaut.
    </p>
  </>
);
