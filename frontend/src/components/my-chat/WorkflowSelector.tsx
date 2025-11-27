/**
 * WorkflowSelector - Dropdown to select the active workflow for new conversations
 */
import { useCallback, useMemo } from "react";
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
  // Only show active workflows (those with active_version_id)
  const activeWorkflows = useMemo(() =>
    workflows.filter((w) => w.active_version_id !== null),
    [workflows]
  );

  const handleChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const workflowId = parseInt(event.target.value, 10);
    if (!isNaN(workflowId)) {
      onWorkflowChange(workflowId);
    }
  }, [onWorkflowChange]);

  // Don't render if there are no active workflows
  if (activeWorkflows.length === 0) {
    return null;
  }

  const selectedWorkflow = activeWorkflows.find((w) => w.id === selectedWorkflowId);

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
        disabled={disabled || activeWorkflows.length === 1}
      >
        {!selectedWorkflow && (
          <option value="" disabled>
            Sélectionner un workflow
          </option>
        )}
        {activeWorkflows.map((workflow) => (
          <option key={workflow.id} value={workflow.id}>
            {workflow.display_name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default WorkflowSelector;
