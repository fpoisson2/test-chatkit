import { useCallback } from "react";

import type { StateAssignment } from "../../../types";
import { fieldStyle, labelContentStyle } from "../styles";
import { HelpTooltip } from "./HelpTooltip";

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
    <section
      aria-label={title}
      style={{
        marginTop: "1rem",
        border: "1px solid rgba(15, 23, 42, 0.12)",
        borderRadius: "0.75rem",
        padding: "0.75rem",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <header>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>{title}</h3>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.95rem" }}>
          {description}
        </p>
      </header>

      {assignments.length === 0 ? (
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>{emptyLabel}</p>
      ) : (
        assignments.map((assignment, index) => (
          <div
            key={`${title}-${index}`}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.35)",
              borderRadius: "0.65rem",
              padding: "0.75rem",
              display: "grid",
              gap: "0.75rem",
            }}
          >
            <label style={fieldStyle}>
              <span style={labelContentStyle}>
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

            <label style={fieldStyle}>
              <span style={labelContentStyle}>Vers la variable</span>
              <input
                type="text"
                value={assignment.target}
                placeholder={targetPlaceholder}
                onChange={(event) => handleAssignmentChange(index, "target", event.target.value)}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
