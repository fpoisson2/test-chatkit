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
  const taskQueueRef = useRef<Array<{ task: Task; index: number }>>([]);
  const isProcessingRef = useRef(false);
  const displayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const processedTasksRef = useRef<Set<number>>(new Set());

  const toggleExpanded = () => {
    setExpanded(!expanded);
  };

  const isReasoning = workflow.type === 'reasoning';
  const isCompleted = workflow.completed === true || workflow.summary !== undefined;

  // Fonction pour traiter la file d'attente
  const processQueue = () => {
    if (isProcessingRef.current || taskQueueRef.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;
    const { task, index } = taskQueueRef.current.shift()!;

    // Afficher la tâche
    setDisplayedTask(task);
    setFadeKey(prev => prev + 1);
    processedTasksRef.current.add(index);

    // Cacher après 2 secondes et passer à la suivante
    displayTimeoutRef.current = setTimeout(() => {
      setDisplayedTask(null);
      isProcessingRef.current = false;
      displayTimeoutRef.current = null;

      // Traiter la tâche suivante dans la file
      processQueue();
    }, 2000);
  };

  // Détecter les nouvelles tâches et les ajouter à la file
  useEffect(() => {
    workflow.tasks.forEach((task, index) => {
      // Si la tâche n'a pas encore été traitée
      if (!processedTasksRef.current.has(index)) {
        // Vérifier si elle n'est pas déjà dans la queue
        const alreadyQueued = taskQueueRef.current.some(item => item.index === index);
        if (!alreadyQueued) {
          taskQueueRef.current.push({ task, index });
        }
      }
    });

    // Démarrer le traitement de la file
    processQueue();
  }, [workflow.tasks, workflow.tasks.length]);

  // Cleanup au démontage
  useEffect(() => {
    return () => {
      if (displayTimeoutRef.current) {
        clearTimeout(displayTimeoutRef.current);
      }
    };
  }, []);

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
