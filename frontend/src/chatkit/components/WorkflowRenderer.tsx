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
  const displayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCompletedIndexRef = useRef<number>(-1);
  const previousTaskCountRef = useRef(0);
  const wasCompletedOnMountRef = useRef<boolean>(false);
  const hasMountedRef = useRef<boolean>(false);
  const displayStartRef = useRef<number | null>(null);
  const displayedTaskRef = useRef<Task | null>(null);

  const MIN_DISPLAY_DURATION_MS = 2000;

  const toggleExpanded = () => {
    setExpanded(!expanded);
  };

  const isReasoning = workflow.type === 'reasoning';
  const isCompleted = workflow.completed === true || workflow.summary !== undefined;
  const currentTaskCount = workflow.tasks.length;

  // Détecter si une image est en cours de génération
  const hasImageGenerating = workflow.tasks.some(
    task => task.type === 'image' && task.status_indicator === 'loading'
  );

  // Détecter si le workflow était déjà complet au premier render
  if (!hasMountedRef.current) {
    hasMountedRef.current = true;
    wasCompletedOnMountRef.current = isCompleted;
  }

  const showTask = (task: Task) => {
    setDisplayedTask(task);
    displayedTaskRef.current = task;
    setFadeKey(prev => prev + 1);
    displayStartRef.current = Date.now();
  };

  // Planifie l'affichage de la prochaine tâche en respectant une durée minimale
  const scheduleNextTask = () => {
    if (taskQueueRef.current.length === 0) {
      return;
    }

    const elapsedSinceDisplay = displayStartRef.current
      ? Date.now() - displayStartRef.current
      : MIN_DISPLAY_DURATION_MS;
    const delay = Math.max(0, MIN_DISPLAY_DURATION_MS - elapsedSinceDisplay);

    if (displayTimeoutRef.current) {
      clearTimeout(displayTimeoutRef.current);
    }

    displayTimeoutRef.current = setTimeout(() => {
      displayTimeoutRef.current = null;

      const nextTask = taskQueueRef.current.shift();
      if (!nextTask) {
        return;
      }

      showTask(nextTask.task);

      // Si d'autres tâches sont en attente, planifier la suivante
      if (taskQueueRef.current.length > 0) {
        scheduleNextTask();
      }
    }, delay);
  };

  // Ajouter une tâche à la file d'attente
  const enqueueTask = (task: Task, index: number) => {
    // Vérifier si déjà dans la queue
    const alreadyQueued = taskQueueRef.current.some(item => item.index === index);
    if (!alreadyQueued && index > lastCompletedIndexRef.current) {
      taskQueueRef.current.push({ task, index });
      lastCompletedIndexRef.current = index;

      // Si aucune tâche n'est affichée, montrer celle-ci immédiatement
      if (!displayedTaskRef.current) {
        const nextTask = taskQueueRef.current.shift();
        if (nextTask) {
          showTask(nextTask.task);
        }
      }

      // Planifier le passage à la prochaine tâche (ou la garder affichée)
      scheduleNextTask();
    }
  };

  // Détecter les tâches complètes
  useEffect(() => {
    // Ignorer si le workflow était déjà complet au chargement (reload de thread)
    if (wasCompletedOnMountRef.current) {
      return;
    }

    // Cas 1: Nouvelle tâche ajoutée → la précédente est "done"
    if (currentTaskCount > previousTaskCountRef.current && previousTaskCountRef.current > 0) {
      const completedIndex = previousTaskCountRef.current - 1;
      const completedTask = workflow.tasks[completedIndex];

      if (completedTask) {
        enqueueTask(completedTask, completedIndex);
      }
    }

    // Cas 2: Workflow complété → la dernière tâche est "done"
    if (isCompleted && currentTaskCount > 0) {
      const lastIndex = currentTaskCount - 1;
      const lastTask = workflow.tasks[lastIndex];

      if (lastTask) {
        enqueueTask(lastTask, lastIndex);
      }
    }

    previousTaskCountRef.current = currentTaskCount;
  }, [currentTaskCount, isCompleted, workflow.summary]);

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
              {hasImageGenerating
                ? "Génération d'une image en cours..."
                : isReasoning
                  ? t('chatkit.workflow.reasoning')
                  : t('chatkit.workflow.workflow')}
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
