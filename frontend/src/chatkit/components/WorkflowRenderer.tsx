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
  const lastCompletedIndexRef = useRef<number>(-1);
  const previousTaskCountRef = useRef(0);
  const wasCompletedOnMountRef = useRef<boolean>(false);
  const hasMountedRef = useRef<boolean>(false);
  const minDisplayTimeRef = useRef<number | null>(null);

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
    minDisplayTimeRef.current = Date.now();

    // Attendre 2 secondes minimum
    displayTimeoutRef.current = setTimeout(() => {
      displayTimeoutRef.current = null;

      // Vérifier si on peut passer à la suivante
      if (taskQueueRef.current.length > 0) {
        // Il y a une tâche en attente, passer directement à la suivante
        isProcessingRef.current = false;
        minDisplayTimeRef.current = null;
        processQueue();
      } else {
        // Pas de tâche en attente, continuer à afficher la tâche actuelle
        // On reste en mode processing jusqu'à ce qu'une nouvelle tâche arrive
      }
    }, 2000);
  };

  // Ajouter une tâche à la file d'attente
  const enqueueTask = (task: Task, index: number) => {
    // Vérifier si déjà dans la queue
    const alreadyQueued = taskQueueRef.current.some(item => item.index === index);
    if (!alreadyQueued && index > lastCompletedIndexRef.current) {
      taskQueueRef.current.push({ task, index });
      lastCompletedIndexRef.current = index;

      // Si on affiche déjà une tâche
      if (isProcessingRef.current && minDisplayTimeRef.current !== null) {
        const elapsed = Date.now() - minDisplayTimeRef.current;

        // Si le temps minimum est écoulé et qu'on n'a plus de timeout actif
        // (c'est-à-dire qu'on attend juste une nouvelle tâche)
        if (elapsed >= 2000 && !displayTimeoutRef.current) {
          // On peut passer directement à la nouvelle tâche
          isProcessingRef.current = false;
          minDisplayTimeRef.current = null;
          processQueue();
          return;
        }
      }

      // Démarrer le traitement si rien n'est en cours
      if (!isProcessingRef.current) {
        processQueue();
      }
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
