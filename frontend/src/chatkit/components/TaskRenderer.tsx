import React from 'react';
import type {
  Task,
  CustomTask,
  SearchTask,
  ThoughtTask,
  ActionTask,
  FileTask,
  ImageTask,
  ComputerUseTask,
  URLSource,
  FileSource,
} from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useI18n } from '../../i18n';

interface TaskRendererProps {
  task: Task;
  className?: string;
  theme?: 'light' | 'dark';
}

export function TaskRenderer({ task, className = '', theme = 'light' }: TaskRendererProps): JSX.Element {
  const { t } = useI18n();
  // Ne pas ajouter la classe --loading
  const statusClass = task.status_indicator && task.status_indicator !== 'loading'
    ? `chatkit-task--${task.status_indicator}`
    : '';

  const reasoningClass = (task.type === 'thought' || isActionTask(task))
    ? 'chatkit-task--reasoning'
    : '';

  return (
    <div className={`chatkit-task chatkit-task--${task.type} ${statusClass} ${reasoningClass} ${className}`}>
      {task.type === 'custom' && <CustomTaskRenderer task={task} theme={theme} />}
      {task.type === 'web_search' && <SearchTaskRenderer task={task} />}
      {(task.type === 'thought' || isActionTask(task)) && (
        <ThoughtTaskRenderer task={task} theme={theme} />
      )}
      {task.type === 'file' && <FileTaskRenderer task={task} />}
      {task.type === 'image' && <ImageTaskRenderer task={task} t={t} />}
      {task.type === 'computer_use' && <ComputerUseTaskRenderer task={task} t={t} />}
    </div>
  );
}

function isActionTask(task: Task): task is ThoughtTask | ActionTask {
  const actionType = (task as ActionTask).action_type || task.type;
  return [
    'thought',
    'tool_call',
    'tool_calls',
    'mcp',
    'cua',
    'client_ui_action',
    'computer_use_action',
  ].includes(actionType as ActionTask['type'] | ThoughtTask['type']);
}

function CustomTaskRenderer({ task, theme = 'light' }: { task: CustomTask; theme?: 'light' | 'dark' }): JSX.Element {
  return (
    <div className="chatkit-task-custom">
      {task.icon && <span className="chatkit-task-icon">{task.icon}</span>}
      {task.title && <div className="chatkit-task-title">{task.title}</div>}
      {task.content && (
        <div className="chatkit-task-content">
          <MarkdownRenderer content={task.content} theme={theme} />
        </div>
      )}
    </div>
  );
}

function SearchTaskRenderer({ task }: { task: SearchTask }): JSX.Element {
  return (
    <div className="chatkit-task-search">
      {task.title && <div className="chatkit-task-title">{task.title}</div>}
      {task.title_query && (
        <div className="chatkit-task-query">
          <strong>Query:</strong> {task.title_query}
        </div>
      )}
      {task.queries && task.queries.length > 0 && (
        <div className="chatkit-task-queries">
          <strong>Queries:</strong>
          <ul>
            {task.queries.map((query, i) => (
              <li key={i}>{query}</li>
            ))}
          </ul>
        </div>
      )}
      {task.sources && task.sources.length > 0 && (
        <div className="chatkit-task-sources">
          <strong>Sources:</strong>
          <ul>
            {task.sources.map((source, i) => (
              <li key={i}>
                <URLSourceRenderer source={source} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ThoughtTaskRenderer({ task, theme = 'light' }: { task: ThoughtTask | ActionTask; theme?: 'light' | 'dark' }): JSX.Element {
  return (
    <div className="chatkit-task-thought">
      {task.title && <div className="chatkit-task-title">{task.title}</div>}
      <div className="chatkit-task-content">
        <MarkdownRenderer content={task.content || ''} theme={theme} />
      </div>
    </div>
  );
}

function FileTaskRenderer({ task }: { task: FileTask }): JSX.Element {
  return (
    <div className="chatkit-task-file">
      {task.title && <div className="chatkit-task-title">{task.title}</div>}
      {task.sources && task.sources.length > 0 && (
        <div className="chatkit-task-sources">
          <ul>
            {task.sources.map((source, i) => (
              <li key={i}>
                <FileSourceRenderer source={source} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ImageTaskRenderer({ task, t }: { task: ImageTask; t: (key: string) => string }): JSX.Element {
  return (
    <div className="chatkit-task-image">
      {task.images && task.images.length > 0 && (
        <div className="chatkit-task-content">
          {t('chatkit.task.imageCompleted')}
        </div>
      )}
    </div>
  );
}

function ComputerUseTaskRenderer({ task, t }: { task: ComputerUseTask; t: (key: string) => string }): JSX.Element {
  const latestScreenshot = task.screenshots && task.screenshots.length > 0
    ? task.screenshots[task.screenshots.length - 1]
    : null;

  const imageSrc = latestScreenshot
    ? (latestScreenshot.data_url || (latestScreenshot.b64_image ? `data:image/png;base64,${latestScreenshot.b64_image}` : null))
    : null;

  const actionTitle = task.current_action || latestScreenshot?.action_description || task.title;

  const clickPosition = latestScreenshot?.click_position || latestScreenshot?.click;

  const toPercent = (value: number): number => {
    const scaled = value <= 1 ? value * 100 : value;
    return Math.min(100, Math.max(0, scaled));
  };

  const clickCoordinates = clickPosition
    ? {
        x: toPercent(clickPosition.x),
        y: toPercent(clickPosition.y),
      }
    : null;

  return (
    <div className="chatkit-task-computer-use">
      {actionTitle && <div className="chatkit-task-title">{actionTitle}</div>}

      {imageSrc && (
        <div className="chatkit-task-browser-screenshot">
          <div className="chatkit-browser-screenshot-image-wrapper">
            <img
              src={imageSrc}
              alt={actionTitle || t('chatkit.task.browserScreenshot')}
              className="chatkit-browser-screenshot-image"
            />
            {clickCoordinates && (
              <div
                className="chatkit-browser-click-indicator"
                style={{ left: `${clickCoordinates.x}%`, top: `${clickCoordinates.y}%` }}
                aria-label={t('chatkit.task.currentAction')}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function URLSourceRenderer({ source }: { source: URLSource }): JSX.Element {
  return (
    <div className="chatkit-source chatkit-source--url">
      <a href={source.url} target="_blank" rel="noopener noreferrer">
        {source.title}
      </a>
      {source.description && <p className="chatkit-source-description">{source.description}</p>}
      {source.attribution && <span className="chatkit-source-attribution">{source.attribution}</span>}
    </div>
  );
}

function FileSourceRenderer({ source }: { source: FileSource }): JSX.Element {
  return (
    <div className="chatkit-source chatkit-source--file">
      <span className="chatkit-source-filename">{source.filename}</span>
      {source.title && <span className="chatkit-source-title">{source.title}</span>}
      {source.description && <p className="chatkit-source-description">{source.description}</p>}
    </div>
  );
}
