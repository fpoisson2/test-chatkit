import React from 'react';
import type { Annotation, Source, URLSource, FileSource, EntitySource } from '../types';

interface AnnotationRendererProps {
  annotations: Annotation[];
  className?: string;
}

export function AnnotationRenderer({ annotations, className = '' }: AnnotationRendererProps): JSX.Element | null {
  if (!annotations || annotations.length === 0) {
    return null;
  }

  return (
    <div className={`chatkit-annotations ${className}`}>
      {annotations.map((annotation, i) => (
        <div key={i} className="chatkit-annotation">
          <SourceRenderer source={annotation.source} index={annotation.index} />
        </div>
      ))}
    </div>
  );
}

interface SourceRendererProps {
  source: Source;
  index?: number;
}

function SourceRenderer({ source, index }: SourceRendererProps): JSX.Element {
  return (
    <div className={`chatkit-source chatkit-source--${source.type}`}>
      {index !== undefined && <span className="chatkit-source-index">[{index}]</span>}
      {source.type === 'url' && <URLSourceRenderer source={source} />}
      {source.type === 'file' && <FileSourceRenderer source={source} />}
      {source.type === 'entity' && <EntitySourceRenderer source={source} />}
    </div>
  );
}

function URLSourceRenderer({ source }: { source: URLSource }): JSX.Element {
  return (
    <div className="chatkit-source-content">
      <a href={source.url} target="_blank" rel="noopener noreferrer" className="chatkit-source-link">
        {source.title}
      </a>
      {source.description && <p className="chatkit-source-description">{source.description}</p>}
      {source.attribution && <span className="chatkit-source-attribution">{source.attribution}</span>}
      {source.timestamp && <span className="chatkit-source-timestamp">{source.timestamp}</span>}
      {source.group && <span className="chatkit-source-group">{source.group}</span>}
    </div>
  );
}

function FileSourceRenderer({ source }: { source: FileSource }): JSX.Element {
  return (
    <div className="chatkit-source-content">
      <div className="chatkit-source-filename">
        📄 {source.filename}
      </div>
      <div className="chatkit-source-title">{source.title}</div>
      {source.description && <p className="chatkit-source-description">{source.description}</p>}
      {source.timestamp && <span className="chatkit-source-timestamp">{source.timestamp}</span>}
      {source.group && <span className="chatkit-source-group">{source.group}</span>}
    </div>
  );
}

function EntitySourceRenderer({ source }: { source: EntitySource }): JSX.Element {
  return (
    <div className="chatkit-source-content">
      {source.icon && <span className="chatkit-source-icon">{source.icon}</span>}
      <div className="chatkit-source-title">{source.title}</div>
      <div className="chatkit-source-entity-id">{source.id}</div>
      {source.description && <p className="chatkit-source-description">{source.description}</p>}
      {source.timestamp && <span className="chatkit-source-timestamp">{source.timestamp}</span>}
      {source.group && <span className="chatkit-source-group">{source.group}</span>}
    </div>
  );
}
