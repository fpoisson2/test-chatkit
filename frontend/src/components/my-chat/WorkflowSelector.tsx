/**
 * WorkflowSelector - Dropdown to select the active workflow for new conversations
 */
import { useCallback } from "react";
import type { WorkflowSummary } from "../../types/workflows";
import "./WorkflowSelector.css";

export interface WorkflowSelectorProps {
  workflows: WorkflowSummary[];
  selectedWorkflowId: number | null;
  onWorkflowChange: (workflowId: number) => void;
  disabled?: boolean;
}

export function WorkflowSelector({
  workflows,
  selectedWorkflowId,
  onWorkflowChange,
  disabled = false,
}: WorkflowSelectorProps): JSX.Element | null {
  const handleChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const workflowId = parseInt(event.target.value, 10);
    if (!isNaN(workflowId)) {
      onWorkflowChange(workflowId);
    }
  }, [onWorkflowChange]);

  // Don't render if there are no workflows
  if (workflows.length === 0) {
    return null;
  }

  const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId);

  return (
    <div className="workflow-selector">
      <label htmlFor="workflow-select" className="workflow-selector__label">
        Workflow :
      </label>
      <select
        id="workflow-select"
        className="workflow-selector__select"
        value={selectedWorkflowId ?? ""}
        onChange={handleChange}
        disabled={disabled || workflows.length === 1}
      >
        {!selectedWorkflow && (
          <option value="" disabled>
            Sélectionner un workflow
          </option>
        )}
        {workflows.map((workflow) => (
          <option key={workflow.id} value={workflow.id}>
            {workflow.display_name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default WorkflowSelector;
