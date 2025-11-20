import React, { useState, useEffect, useRef } from 'react';
import type { Workflow, WorkflowSummary, CustomSummary, DurationSummary, Task } from '../types';
import { TaskRenderer } from './TaskRenderer';
import { useI18n } from '../../i18n/I18nProvider';

interface WorkflowRendererProps {
  workflow: Workflow;
  className?: string;
  theme?: 'light' | 'dark';
}

export function WorkflowRenderer({ workflow, className = '', theme = 'light' }: WorkflowRendererProps): JSX.Element {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(workflow.expanded ?? false);
  const [displayedTask, setDisplayedTask] = useState<Task | null>(null);
  const [fadeKey, setFadeKey] = useState(0);
  const lastUpdateTimeRef = useRef<number>(Date.now());
  const lastTaskIndexRef = useRef<number>(-1);

  const toggleExpanded = () => {
    setExpanded(!expanded);
  };

  const isReasoning = workflow.type === 'reasoning';
  const isCompleted = workflow.status === 'completed' || workflow.status === 'error';
  const lastTask = workflow.tasks.length > 0 ? workflow.tasks[workflow.tasks.length - 1] : null;

  // Gérer l'affichage des tâches avec un délai minimum d'1 seconde
  useEffect(() => {
    const currentTaskIndex = workflow.tasks.length - 1;

    // Si le workflow est terminé, ne pas afficher de tâche
    if (isCompleted) {
      setDisplayedTask(null);
      return;
    }

    // Si pas de nouvelle tâche, ne rien faire
    if (currentTaskIndex === lastTaskIndexRef.current) {
      return;
    }

    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;
    const minimumDelay = 1000; // 1 seconde

    // Si moins d'1 seconde s'est écoulée, attendre
    if (timeSinceLastUpdate < minimumDelay && displayedTask !== null) {
      const remainingTime = minimumDelay - timeSinceLastUpdate;
      const timeoutId = setTimeout(() => {
        setDisplayedTask(lastTask);
        setFadeKey(prev => prev + 1);
        lastUpdateTimeRef.current = Date.now();
        lastTaskIndexRef.current = currentTaskIndex;
      }, remainingTime);

      return () => clearTimeout(timeoutId);
    } else {
      // Plus d'1 seconde s'est écoulée ou première tâche
      setDisplayedTask(lastTask);
      setFadeKey(prev => prev + 1);
      lastUpdateTimeRef.current = now;
      lastTaskIndexRef.current = currentTaskIndex;
    }
  }, [workflow.tasks.length, lastTask, isCompleted, displayedTask]);

  return (
    <div className={`chatkit-workflow chatkit-workflow--${workflow.type} ${className}`}>
      <div className="chatkit-workflow-header" onClick={toggleExpanded}>
        <div className="chatkit-workflow-summary">
          {workflow.summary ? (
            <SummaryRenderer summary={workflow.summary} />
          ) : (
            <div className="chatkit-workflow-default-title">
              {isReasoning ? t('chatkit.workflow.reasoning') : t('chatkit.workflow.workflow')}
            </div>
          )}
        </div>
        <button className="chatkit-workflow-toggle" aria-expanded={expanded} aria-label={expanded ? t('chatkit.workflow.collapse') : t('chatkit.workflow.expand')}>
          {expanded ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          )}
        </button>
      </div>

      {/* Afficher la dernière tâche même quand collapsed (sauf si terminé) */}
      {!expanded && displayedTask && !isCompleted && (
        <div className="chatkit-workflow-last-task" key={fadeKey}>
          <TaskRenderer task={displayedTask} theme={theme} />
        </div>
      )}

      {/* Afficher toutes les tâches quand expanded */}
      {expanded && (
        <div className="chatkit-workflow-tasks">
          {workflow.tasks.map((task, i) => (
            <TaskRenderer key={i} task={task} theme={theme} />
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
  const { t } = useI18n();

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds} s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes} m ${remainingSeconds} s`;
  };

  return (
    <div className="chatkit-workflow-summary-duration">
      <span>{t('chatkit.workflow.executionDuration', { duration: formatDuration(summary.duration) })}</span>
    </div>
  );
}
