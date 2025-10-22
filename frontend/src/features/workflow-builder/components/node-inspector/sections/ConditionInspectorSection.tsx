import { conditionModeOptions } from "../constants";
import { HelpTooltip } from "../components/HelpTooltip";
import styles from "../NodeInspector.module.css";

type ConditionInspectorSectionProps = {
  nodeId: string;
  conditionPath: string;
  conditionMode: string;
  conditionValue: string;
  onConditionPathChange: (nodeId: string, value: string) => void;
  onConditionModeChange: (nodeId: string, value: string) => void;
  onConditionValueChange: (nodeId: string, value: string) => void;
};

export const ConditionInspectorSection = ({
  nodeId,
  conditionPath,
  conditionMode,
  conditionValue,
  onConditionPathChange,
  onConditionModeChange,
  onConditionValueChange,
}: ConditionInspectorSectionProps) => (
  <>
    <label className={styles.nodeInspectorField}>
      <span className={styles.nodeInspectorLabel}>
        Variable observée
        <HelpTooltip label="Référencez une valeur disponible dans l'état (ex. state.status ou globals.client_type)." />
      </span>
      <input
        type="text"
        value={conditionPath}
        onChange={(event) => onConditionPathChange(nodeId, event.target.value)}
        placeholder="Ex. state.statut_demande"
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
