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
  const previousTaskCountRef = useRef(0);
  const lastDisplayedTaskIndexRef = useRef<number>(-1);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const toggleExpanded = () => {
    setExpanded(!expanded);
  };

  const isReasoning = workflow.type === 'reasoning';
  const isCompleted = workflow.completed === true || workflow.summary !== undefined;
  const currentTaskCount = workflow.tasks.length;

  // Fonction pour afficher une tâche pendant 2 secondes
  const showTaskFor2Seconds = (task: Task, taskIndex: number) => {
    // Ne pas afficher si c'est la même tâche déjà affichée
    if (lastDisplayedTaskIndexRef.current === taskIndex) {
      return;
    }

    // Si un timeout est déjà en cours, mettre en file d'attente
    if (hideTimeoutRef.current) {
      // Mettre en file d'attente dans timeoutRef
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        showTaskFor2Seconds(task, taskIndex);
        timeoutRef.current = null;
      }, 100); // Réessayer dans 100ms
      return;
    }

    setDisplayedTask(task);
    setFadeKey(prev => prev + 1);
    lastDisplayedTaskIndexRef.current = taskIndex;

    // Cacher après 2 secondes
    hideTimeoutRef.current = setTimeout(() => {
      setDisplayedTask(null);
      hideTimeoutRef.current = null;
    }, 2000);
  };

  // Gérer l'affichage des tâches quand elles sont "done"
  useEffect(() => {
    // Détection: nouvelle tâche ajoutée → la précédente est "done"
    if (currentTaskCount > previousTaskCountRef.current && previousTaskCountRef.current > 0) {
      const completedTaskIndex = previousTaskCountRef.current - 1;
      const completedTask = workflow.tasks[completedTaskIndex];

      if (completedTask && lastDisplayedTaskIndexRef.current !== completedTaskIndex) {
        showTaskFor2Seconds(completedTask, completedTaskIndex);
      }
    }
    // Détection: workflow complété → la dernière tâche est "done"
    else if (isCompleted && currentTaskCount > 0) {
      const lastTaskIndex = currentTaskCount - 1;
      const lastTask = workflow.tasks[lastTaskIndex];

      if (lastTask && lastDisplayedTaskIndexRef.current !== lastTaskIndex) {
        showTaskFor2Seconds(lastTask, lastTaskIndex);
      }
    }

    previousTaskCountRef.current = currentTaskCount;

    // Ne pas nettoyer les timeouts dans le cleanup pour éviter d'interrompre l'affichage
  }, [currentTaskCount, isCompleted, workflow.tasks, workflow.summary]);

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

      {/* Afficher la dernière tâche complète */}
      {!expanded && displayedTask && (
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
