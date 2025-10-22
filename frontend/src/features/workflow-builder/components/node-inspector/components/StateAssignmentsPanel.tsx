import { useCallback } from "react";

import type { StateAssignment } from "../../../types";
import { HelpTooltip } from "./HelpTooltip";
import styles from "../NodeInspector.module.css";

type StateAssignmentsPanelProps = {
  title: string;
  description: string;
  assignments: StateAssignment[];
  onChange: (assignments: StateAssignment[]) => void;
  expressionPlaceholder?: string;
  targetPlaceholder?: string;
  addLabel: string;
  emptyLabel: string;
};

export const StateAssignmentsPanel = ({
  title,
  description,
  assignments,
  onChange,
  expressionPlaceholder,
  targetPlaceholder,
  addLabel,
  emptyLabel,
}: StateAssignmentsPanelProps) => {
  const handleAssignmentChange = useCallback(
    (index: number, field: keyof StateAssignment, value: string) => {
      const next = assignments.map((assignment, currentIndex) =>
        currentIndex === index ? { ...assignment, [field]: value } : assignment,
      );
      onChange(next);
    },
    [assignments, onChange],
  );

  const handleRemoveAssignment = useCallback(
    (index: number) => {
      onChange(assignments.filter((_, currentIndex) => currentIndex !== index));
    },
    [assignments, onChange],
  );

  const handleAddAssignment = useCallback(() => {
    onChange([...assignments, { expression: "", target: "" }]);
  }, [assignments, onChange]);

  return (
    <section aria-label={title} className={styles.nodeInspectorPanel}>
      <header>
        <h3 className={styles.nodeInspectorSectionHeading}>{title}</h3>
        <p className={styles.nodeInspectorSectionDescription}>
          {description}
        </p>
      </header>

      {assignments.length === 0 ? (
        <p className={styles.nodeInspectorEmptyLabel}>{emptyLabel}</p>
      ) : (
        assignments.map((assignment, index) => (
          <div
            key={`${title}-${index}`}
            className={styles.nodeInspectorPanelInner}
          >
            <label className={styles.nodeInspectorField}>
              <span className={styles.nodeInspectorLabel}>
                Affecter la valeur
                <HelpTooltip label="Utilisez le langage Common Expression Language pour créer une expression personnalisée." />
              </span>
              <input
                type="text"
                value={assignment.expression}
                placeholder={expressionPlaceholder}
                onChange={(event) =>
                  handleAssignmentChange(index, "expression", event.target.value)
                }
              />
            </label>

            <label className={styles.nodeInspectorField}>
              <span className={styles.nodeInspectorLabel}>Vers la variable</span>
              <input
                type="text"
                value={assignment.target}
                placeholder={targetPlaceholder}
                onChange={(event) => handleAssignmentChange(index, "target", event.target.value)}
              />
            </label>

            <div className={styles.nodeInspectorSectionFooter}>
              <button type="button" className="btn danger" onClick={() => handleRemoveAssignment(index)}>
                Supprimer la variable
              </button>
            </div>
          </div>
        ))
      )}

      <div>
        <button type="button" className="btn" onClick={handleAddAssignment}>
          {addLabel}
        </button>
      </div>
    </section>
  );
};
