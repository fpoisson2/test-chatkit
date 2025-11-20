import React from 'react';
import type {
  Task,
  CustomTask,
  SearchTask,
  ThoughtTask,
  FileTask,
  ImageTask,
  URLSource,
  FileSource,
} from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface TaskRendererProps {
  task: Task;
  className?: string;
  theme?: 'light' | 'dark';
}

export function TaskRenderer({ task, className = '', theme = 'light' }: TaskRendererProps): JSX.Element {
  // Ne pas ajouter la classe --loading
  const statusClass = task.status_indicator && task.status_indicator !== 'loading'
    ? `chatkit-task--${task.status_indicator}`
    : '';

  return (
    <div className={`chatkit-task chatkit-task--${task.type} ${statusClass} ${className}`}>
      {task.type === 'custom' && <CustomTaskRenderer task={task} theme={theme} />}
      {task.type === 'web_search' && <SearchTaskRenderer task={task} />}
      {task.type === 'thought' && <ThoughtTaskRenderer task={task} theme={theme} />}
      {task.type === 'file' && <FileTaskRenderer task={task} />}
      {task.type === 'image' && <ImageTaskRenderer task={task} />}
    </div>
  );
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

function ThoughtTaskRenderer({ task, theme = 'light' }: { task: ThoughtTask; theme?: 'light' | 'dark' }): JSX.Element {
  return (
    <div className="chatkit-task-thought">
      {task.title && <div className="chatkit-task-title">{task.title}</div>}
      <div className="chatkit-task-content">
        <MarkdownRenderer content={task.content} theme={theme} />
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

function ImageTaskRenderer({ task }: { task: ImageTask }): JSX.Element {
  return (
    <div className="chatkit-task-image">
      {task.title && <div className="chatkit-task-title">{task.title}</div>}
      {task.images && task.images.length > 0 && (
        <div className="chatkit-task-images">
          {task.images.map((image, i) => {
            const src = image.data_url || image.image_url || (image.b64_json ? `data:image/png;base64,${image.b64_json}` : '');
            return src ? (
              <img
                key={i}
                src={src}
                alt={`Generated image ${i + 1}`}
                className="chatkit-task-image-item"
              />
            ) : null;
          })}
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
