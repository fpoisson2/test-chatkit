import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { MarkdownWidget } from '../types';

export function MarkdownComponent(props: MarkdownWidget): JSX.Element {
  const { value, streaming } = props;

  return (
    <div className={`chatkit-markdown${streaming ? ' chatkit-markdown-streaming' : ''}`}>
      <ReactMarkdown>{value}</ReactMarkdown>
    </div>
  );
}
