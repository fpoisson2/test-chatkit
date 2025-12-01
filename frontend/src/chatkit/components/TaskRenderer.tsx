import React from 'react';
import type {
  Task,
  CustomTask,
  SearchTask,
  ThoughtTask,
  FileTask,
  ImageTask,
  ComputerUseTask,
  URLSource,
  FileSource,
} from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useI18n } from '../../i18n';
import { ImageWithBlobUrl } from '../utils';

interface TaskRendererProps {
  task: Task;
  className?: string;
  theme?: 'light' | 'dark';
  hideComputerUseScreenshot?: boolean;
}

type IconKey = Exclude<Task['type'], 'custom'>;

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const taskTypeIcons: Record<IconKey, React.ReactNode> = {
  thought: (
    <svg {...iconProps}>
      <path d="M10 3.5a4.5 4.5 0 0 0-2.4 8.3c.2.1.4.4.4.6v1.1c0 .3.2.5.5.5h3c.3 0 .5-.2.5-.5V12c0-.3.2-.5.4-.6A4.5 4.5 0 0 0 10 3.5Z" />
      <path d="M8.5 14h3" />
      <path d="M9 16h2" />
    </svg>
  ),
  web_search: (
    <svg {...iconProps}>
      <circle cx="9" cy="9" r="4.5" />
      <path d="m12.5 12.5 3 3" />
    </svg>
  ),
  file: (
    <svg {...iconProps}>
      <path d="M6 4.8c0-.5.4-.8.9-.8h4.3l2.8 2.8V15c0 .5-.4 1-1 1H6.9c-.5 0-.9-.4-.9-.9V4.8Z" />
      <path d="M14 7.3h-2.9c-.5 0-.9-.4-.9-.9V4" />
    </svg>
  ),
  image: (
    <svg {...iconProps}>
      <rect x="4.5" y="4.5" width="11" height="11" rx="1.2" />
      <path d="m6.5 12 2.5-2.5 2.5 2.5 2-1.9 1.5 1.4" />
      <circle cx="8" cy="8" r="1" />
    </svg>
  ),
  computer_use: (
    <svg {...iconProps}>
      <rect x="4" y="4.5" width="12" height="8.5" rx="1.2" />
      <path d="M9 16h2" />
      <path d="M8.2 13h3.6" />
    </svg>
  ),
};

function getTaskIcon(task: Task): React.ReactNode | null {
  if (task.type === 'custom') {
    return task.icon || null;
  }

  return taskTypeIcons[task.type] || null;
}

export function TaskRenderer({
  task,
  className = '',
  theme = 'light',
  hideComputerUseScreenshot = false,
}: TaskRendererProps): JSX.Element {
  const { t } = useI18n();
  // Ne pas ajouter la classe --loading
  const statusClass = task.status_indicator && task.status_indicator !== 'loading'
    ? `chatkit-task--${task.status_indicator}`
    : '';

  const icon = getTaskIcon(task);

  return (
    <div className={`chatkit-task chatkit-task--${task.type} ${statusClass} ${className}`}>
      {task.type === 'custom' && <CustomTaskRenderer task={task} theme={theme} icon={icon} />}
      {task.type === 'web_search' && <SearchTaskRenderer task={task} icon={icon} />}
      {task.type === 'thought' && <ThoughtTaskRenderer task={task} theme={theme} icon={icon} />}
      {task.type === 'file' && <FileTaskRenderer task={task} icon={icon} />}
      {task.type === 'image' && <ImageTaskRenderer task={task} t={t} icon={icon} />}
      {task.type === 'computer_use' && (
        <ComputerUseTaskRenderer
          task={task}
          t={t}
          icon={icon}
          hideScreenshot={hideComputerUseScreenshot}
        />
      )}
    </div>
  );
}

function TaskLayout({ icon, children }: { icon?: React.ReactNode | null; children: React.ReactNode }): JSX.Element {
  return (
    <div className="chatkit-task-body">
      {icon && <span className="chatkit-task-icon" aria-hidden="true">{icon}</span>}
      <div className="chatkit-task-main">{children}</div>
    </div>
  );
}

function CustomTaskRenderer({ task, theme = 'light', icon }: { task: CustomTask; theme?: 'light' | 'dark'; icon?: React.ReactNode | null }): JSX.Element {
  return (
    <div className="chatkit-task-custom">
      <TaskLayout icon={icon}>
        {task.title && <div className="chatkit-task-title">{task.title}</div>}
        {task.content && (
          <div className="chatkit-task-content">
            <MarkdownRenderer content={task.content} theme={theme} />
          </div>
        )}
      </TaskLayout>
    </div>
  );
}

function SearchTaskRenderer({ task, icon }: { task: SearchTask; icon?: React.ReactNode | null }): JSX.Element {
  const { t } = useI18n();

  // Éviter les doublons : filtrer les queries pour enlever title_query
  const additionalQueries = task.queries.filter(query => query !== task.title_query);

  return (
    <div className="chatkit-task-search">
      <TaskLayout icon={icon}>
        {task.title && <div className="chatkit-task-title">{task.title}</div>}
        {task.title_query && (
          <div className="chatkit-task-query">
            <strong>{t('chatkit.task.query')}:</strong> {task.title_query}
          </div>
        )}
        {additionalQueries.length > 0 && (
          <div className="chatkit-task-queries">
            <strong>{t('chatkit.task.queries')}:</strong>
            <ul>
              {additionalQueries.map((query, i) => (
                <li key={i}>{query}</li>
              ))}
            </ul>
          </div>
        )}
        {task.sources && task.sources.length > 0 && (
          <div className="chatkit-task-sources">
            <strong>{t('chatkit.task.sources')}:</strong>
            <ul>
              {task.sources.map((source, i) => (
                <li key={i}>
                  <URLSourceRenderer source={source} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </TaskLayout>
    </div>
  );
}

function ThoughtTaskRenderer({ task, theme = 'light', icon }: { task: ThoughtTask; theme?: 'light' | 'dark'; icon?: React.ReactNode | null }): JSX.Element {
  return (
    <div className="chatkit-task-thought">
      <TaskLayout icon={icon}>
        {task.title && <div className="chatkit-task-title">{task.title}</div>}
        <div className="chatkit-task-content">
          <MarkdownRenderer content={task.content} theme={theme} />
        </div>
      </TaskLayout>
    </div>
  );
}

function FileTaskRenderer({ task, icon }: { task: FileTask; icon?: React.ReactNode | null }): JSX.Element {
  return (
    <div className="chatkit-task-file">
      <TaskLayout icon={icon}>
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
      </TaskLayout>
    </div>
  );
}

function ImageTaskRenderer({ task, t, icon }: { task: ImageTask; t: (key: string) => string; icon?: React.ReactNode | null }): JSX.Element {
  return (
    <div className="chatkit-task-image">
      <TaskLayout icon={icon}>
        {task.title && <div className="chatkit-task-title">{task.title}</div>}
        {task.images && task.images.length > 0 && (
          <div className="chatkit-task-content">
            {t('chatkit.task.imageCompleted')}
          </div>
        )}
      </TaskLayout>
    </div>
  );
}

function ComputerUseTaskRenderer({
  task,
  t,
  icon,
  hideScreenshot = false,
}: {
  task: ComputerUseTask;
  t: (key: string) => string;
  icon?: React.ReactNode | null;
  hideScreenshot?: boolean;
}): JSX.Element {
  // Show static screenshots in a card
  const latestScreenshot = task.screenshots && task.screenshots.length > 0
    ? task.screenshots[task.screenshots.length - 1]
    : null;

  const imageSrc = !hideScreenshot && latestScreenshot
    ? (latestScreenshot.data_url || (latestScreenshot.b64_image ? `data:image/png;base64,${latestScreenshot.b64_image}` : null))
    : null;

  const actionTitle = task.current_action || latestScreenshot?.action_description || task.title;

  if (!actionTitle && !imageSrc) {
    return <></>;
  }

  return (
    <div className="chatkit-task-computer-use">
      <TaskLayout icon={icon}>
        {actionTitle && <div className="chatkit-task-title">{actionTitle}</div>}
        {imageSrc && (
          <div className="chatkit-task-content">
            <div className="chatkit-task-browser-screenshot">
              <ImageWithBlobUrl
                src={imageSrc}
                alt={actionTitle || t('chatkit.task.browserScreenshot')}
                className="chatkit-browser-screenshot-image"
              />
            </div>
          </div>
        )}
      </TaskLayout>
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
