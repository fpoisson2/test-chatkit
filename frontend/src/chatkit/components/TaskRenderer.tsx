import React from 'react';
import type {
  Task,
  CustomTask,
  SearchTask,
  ThoughtTask,
  FileTask,
  ImageTask,
  ComputerUseTask,
  ApplyPatchTask,
  ApplyPatchOperation,
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
  authToken?: string;
  apiUrl?: string;
  backendUrl?: string;
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
  shell_call: (
    <svg {...iconProps}>
      <path d="m5 7 3 3-3 3" />
      <path d="M10 14h5" />
      <rect x="3.5" y="5.5" width="13" height="9" rx="1.5" />
    </svg>
  ),
  apply_patch: (
    <svg {...iconProps}>
      <path d="M11.5 4h-5c-.5 0-.9.4-.9.9V15c0 .5.4 1 1 1h6.8c.5 0 1-.4 1-.9V7.3L11.5 4Z" />
      <path d="M14 7.3h-2.9c-.5 0-.9-.4-.9-.9V4" />
      <path d="M9 9h2" />
      <path d="M9 11h4" />
      <path d="M9 13h3" />
    </svg>
  ),
  voice_agent: (
    <svg {...iconProps}>
      <circle cx="10" cy="7" r="2.5" />
      <path d="M6 16c0-2.2 1.8-4 4-4s4 1.8 4 4" />
    </svg>
  ),
  outbound_call: (
    <svg {...iconProps}>
      <path d="M7 3.5h6M7 6h6M7 8.5h4" />
      <rect x="4.5" y="2" width="11" height="13" rx="1.5" />
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
  authToken,
  apiUrl,
  backendUrl,
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
          authToken={authToken}
          apiUrl={apiUrl}
          backendUrl={backendUrl}
        />
      )}
      {task.type === 'shell_call' && <ShellCallTaskRenderer task={task} theme={theme} icon={icon} />}
      {task.type === 'apply_patch' && <ApplyPatchTaskRenderer task={task} theme={theme} icon={icon} />}
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

function ShellCallTaskRenderer({ task, icon, theme = 'light' }: { task: Extract<Task, { type: 'shell_call' }>; icon?: React.ReactNode | null; theme?: 'light' | 'dark' }): JSX.Element {
  const { t } = useI18n();

  return (
    <div className="chatkit-task-shell-call">
      <TaskLayout icon={icon}>
        {task.title && <div className="chatkit-task-title">{task.title}</div>}
        {task.messages && task.messages.length > 0 && (
          <div className="chatkit-shell-call-messages">
            <div className="chatkit-shell-call-label">{t('chatkit.task.messages')}</div>
            <div className="chatkit-shell-call-message-list">
              {task.messages.map((message, messageIndex) => (
                <div key={messageIndex} className="chatkit-shell-call-message">
                  <span className="chatkit-shell-call-message-role">{message.role}</span>
                  <div className="chatkit-shell-call-message-content">
                    <MarkdownRenderer content={message.content} theme={theme} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {task.output && task.output.length > 0 && (
          <div className="chatkit-task-shell-calls">
            {task.output.map((call, index) => (
              <div key={index} className="chatkit-shell-call">
                <div className="chatkit-shell-call-header">
                  <span className="chatkit-shell-call-header-dot" aria-hidden="true" />
                  <span className="chatkit-shell-call-header-title">shell</span>
                </div>
                <div className="chatkit-shell-call-content">
                  <div className="chatkit-shell-call-command">
                    <span className="chatkit-shell-call-prompt">root@chatkit:/workspace#</span>
                    <code>{call.command}</code>
                  </div>
                  {(call.stdout || call.stderr) && (
                    <div className="chatkit-shell-call-outputs">
                      {call.stdout && (
                        <div className="chatkit-shell-call-output chatkit-shell-call-output--stdout">
                          <div className="chatkit-shell-call-label">{t('chatkit.task.stdout')}</div>
                          <pre>{call.stdout}</pre>
                        </div>
                      )}
                      {call.stderr && (
                        <div className="chatkit-shell-call-output chatkit-shell-call-output--stderr">
                          <div className="chatkit-shell-call-label">{t('chatkit.task.stderr')}</div>
                          <pre>{call.stderr}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
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
  authToken,
  apiUrl,
  backendUrl,
}: {
  task: ComputerUseTask;
  t: (key: string) => string;
  icon?: React.ReactNode | null;
  hideScreenshot?: boolean;
  authToken?: string;
  apiUrl?: string;
  backendUrl?: string;
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
                authToken={authToken}
                apiUrl={apiUrl}
                backendUrl={backendUrl}
              />
            </div>
          </div>
        )}
      </TaskLayout>
    </div>
  );
}

function ApplyPatchTaskRenderer({
  task,
  icon,
  theme = 'light',
}: {
  task: ApplyPatchTask;
  icon?: React.ReactNode | null;
  theme?: 'light' | 'dark';
}): JSX.Element {
  const { t } = useI18n();

  // Helper to render diff lines with color
  const renderDiffLines = (diff: string) => {
    const lines = diff.split('\n');
    return lines.map((line, index) => {
      let lineClass = 'chatkit-diff-line';
      if (line.startsWith('+')) {
        lineClass += ' chatkit-diff-line--addition';
      } else if (line.startsWith('-')) {
        lineClass += ' chatkit-diff-line--deletion';
      } else if (line.startsWith('@@')) {
        lineClass += ' chatkit-diff-line--context';
      }

      return (
        <div key={index} className={lineClass}>
          {line}
        </div>
      );
    });
  };

  // Helper to get operation type label
  const getOperationLabel = (opType: string) => {
    switch (opType) {
      case 'create_file':
        return t('chatkit.task.applyPatch.createFile') || 'Create';
      case 'update_file':
        return t('chatkit.task.applyPatch.updateFile') || 'Update';
      case 'delete_file':
        return t('chatkit.task.applyPatch.deleteFile') || 'Delete';
      default:
        return opType;
    }
  };

  return (
    <div className="chatkit-task-apply-patch">
      <TaskLayout icon={icon}>
        {task.title && <div className="chatkit-task-title">{task.title}</div>}
        {task.operations && task.operations.length > 0 && (
          <div className="chatkit-apply-patch-operations">
            {task.operations.map((operation, index) => (
              <div
                key={index}
                className={`chatkit-apply-patch-operation chatkit-apply-patch-operation--${operation.operation_type}`}
              >
                <div className="chatkit-apply-patch-operation-header">
                  <span className="chatkit-apply-patch-operation-type">
                    {getOperationLabel(operation.operation_type)}
                  </span>
                  <code className="chatkit-apply-patch-operation-path">{operation.path}</code>
                  {operation.status === 'failed' && (
                    <span className="chatkit-apply-patch-operation-status chatkit-apply-patch-operation-status--failed">
                      ✗ Failed
                    </span>
                  )}
                  {operation.status === 'completed' && (
                    <span className="chatkit-apply-patch-operation-status chatkit-apply-patch-operation-status--completed">
                      ✓
                    </span>
                  )}
                </div>
                {operation.diff_preview && (
                  <div className="chatkit-apply-patch-diff">
                    <pre className="chatkit-diff-preview">
                      {renderDiffLines(operation.diff_preview)}
                    </pre>
                  </div>
                )}
                {operation.output && operation.status === 'failed' && (
                  <div className="chatkit-apply-patch-error">
                    {operation.output}
                  </div>
                )}
              </div>
            ))}
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
