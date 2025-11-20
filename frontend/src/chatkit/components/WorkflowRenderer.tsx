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
  const [isLoading, setIsLoading] = useState(false);
  const [fadeKey, setFadeKey] = useState(0);
  const displayStartTimeRef = useRef<number | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const toggleExpanded = () => {
    setExpanded(!expanded);
  };

  const isReasoning = workflow.type === 'reasoning';
  const isWorkflowCompleted = workflow.status === 'completed' || workflow.status === 'error';

  // Trouver la dernière tâche complète
  const lastCompletedTask = workflow.tasks.length > 0
    ? workflow.tasks.slice().reverse().find(task =>
        task.status_indicator === 'complete' || task.status_indicator === 'success'
      )
    : null;

  // Gérer l'affichage des tâches complètes avec délai minimum
  useEffect(() => {
    // Nettoyer le timeout précédent
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Si le workflow est terminé, cacher tout après 1 seconde
    if (isWorkflowCompleted) {
      if (displayedTask && displayStartTimeRef.current) {
        const elapsed = Date.now() - displayStartTimeRef.current;
        const remaining = Math.max(0, 1000 - elapsed);

        timeoutRef.current = setTimeout(() => {
          setDisplayedTask(null);
          setIsLoading(false);
          displayStartTimeRef.current = null;
        }, remaining);
      } else {
        setDisplayedTask(null);
        setIsLoading(false);
        displayStartTimeRef.current = null;
      }
      return;
    }

    // Si pas de tâche complète disponible, afficher le loading
    if (!lastCompletedTask) {
      setIsLoading(true);
      setDisplayedTask(null);
      displayStartTimeRef.current = null;
      return;
    }

    // Si on a une nouvelle tâche complète différente de celle affichée
    if (lastCompletedTask !== displayedTask) {
      // Si une tâche est déjà affichée, attendre 1 seconde avant de la remplacer
      if (displayedTask && displayStartTimeRef.current) {
        const elapsed = Date.now() - displayStartTimeRef.current;
        const remaining = Math.max(0, 1000 - elapsed);

        timeoutRef.current = setTimeout(() => {
          setDisplayedTask(lastCompletedTask);
          setFadeKey(prev => prev + 1);
          setIsLoading(false);
          displayStartTimeRef.current = Date.now();
        }, remaining);
      } else {
        // Première tâche complète : l'afficher immédiatement
        setDisplayedTask(lastCompletedTask);
        setFadeKey(prev => prev + 1);
        setIsLoading(false);
        displayStartTimeRef.current = Date.now();
      }
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [lastCompletedTask, displayedTask, isWorkflowCompleted]);

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

      {/* Afficher la dernière tâche complète ou un loader */}
      {!expanded && !isWorkflowCompleted && (
        <>
          {isLoading && !displayedTask && (
            <div className="chatkit-workflow-loading">
              <div className="chatkit-workflow-loading-spinner"></div>
            </div>
          )}
          {displayedTask && (
            <div className="chatkit-workflow-last-task" key={fadeKey}>
              <TaskRenderer task={displayedTask} theme={theme} />
            </div>
          )}
        </>
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
