import React, { useState } from 'react';
import type { Workflow, WorkflowSummary, CustomSummary, DurationSummary } from '../types';
import { TaskRenderer } from './TaskRenderer';

interface WorkflowRendererProps {
  workflow: Workflow;
  className?: string;
}

export function WorkflowRenderer({ workflow, className = '' }: WorkflowRendererProps): JSX.Element {
  const [expanded, setExpanded] = useState(workflow.expanded ?? false);

  const toggleExpanded = () => {
    setExpanded(!expanded);
  };

  const isReasoning = workflow.type === 'reasoning';

  return (
    <div className={`chatkit-workflow chatkit-workflow--${workflow.type} ${className}`}>
      <div className="chatkit-workflow-header" onClick={toggleExpanded}>
        <div className="chatkit-workflow-summary">
          {workflow.summary ? (
            <SummaryRenderer summary={workflow.summary} />
          ) : (
            <div className="chatkit-workflow-default-title">
              {isReasoning ? 'Reasoning' : 'Workflow'}
            </div>
          )}
        </div>
        <button className="chatkit-workflow-toggle" aria-expanded={expanded}>
          {expanded ? '▼' : '▶'}
        </button>
      </div>
      {expanded && (
        <div className="chatkit-workflow-tasks">
          {workflow.tasks.map((task, i) => (
            <TaskRenderer key={i} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryRenderer({ summary }: { summary: WorkflowSummary }): JSX.Element {
  if ('duration' in summary) {
    return <DurationSummaryRenderer summary={summary} />;
  }
  return <CustomSummaryRenderer summary={summary} />;
}

function CustomSummaryRenderer({ summary }: { summary: CustomSummary }): JSX.Element {
  return (
    <div className="chatkit-workflow-summary-custom">
      {summary.icon && <span className="chatkit-workflow-icon">{summary.icon}</span>}
      <span className="chatkit-workflow-title">{summary.title}</span>
    </div>
  );
}

function DurationSummaryRenderer({ summary }: { summary: DurationSummary }): JSX.Element {
  const formatDuration = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <div className="chatkit-workflow-summary-duration">
      <span>Duration: {formatDuration(summary.duration)}</span>
    </div>
  );
}
