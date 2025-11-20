/**
 * Composant pour afficher du contenu markdown
 */
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '../../i18n/I18nProvider';
import './MarkdownRenderer.css';

export interface MarkdownRendererProps {
  content: string;
}

function CodeBlock({ children }: { children: string }): JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="chatkit-code-block-wrapper">
      <button
        className={`chatkit-copy-code-button ${copied ? 'copied' : ''}`}
        onClick={handleCopy}
      >
        {copied ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            {t('chatkit.code.copied')}
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            {t('chatkit.code.copy')}
          </>
        )}
      </button>
      <pre className="chatkit-markdown-code-block">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content }: MarkdownRendererProps): JSX.Element {
  return (
    <div className="chatkit-markdown">
      <ReactMarkdown
        components={{
          // Customisation des composants HTML générés
          p: ({ children }) => <p className="chatkit-markdown-paragraph">{children}</p>,
          code: ({ inline, children, ...props }: any) => {
            if (inline) {
              return <code className="chatkit-markdown-code-inline" {...props}>{children}</code>;
            }
            return <CodeBlock>{String(children)}</CodeBlock>;
          },
          ul: ({ children }) => <ul className="chatkit-markdown-list">{children}</ul>,
          ol: ({ children }) => <ol className="chatkit-markdown-list">{children}</ol>,
          li: ({ children }) => <li className="chatkit-markdown-list-item">{children}</li>,
          blockquote: ({ children }) => <blockquote className="chatkit-markdown-blockquote">{children}</blockquote>,
          h1: ({ children }) => <h1 className="chatkit-markdown-heading chatkit-markdown-h1">{children}</h1>,
          h2: ({ children }) => <h2 className="chatkit-markdown-heading chatkit-markdown-h2">{children}</h2>,
          h3: ({ children }) => <h3 className="chatkit-markdown-heading chatkit-markdown-h3">{children}</h3>,
          h4: ({ children }) => <h4 className="chatkit-markdown-heading chatkit-markdown-h4">{children}</h4>,
          a: ({ children, href }) => <a className="chatkit-markdown-link" href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
          strong: ({ children }) => <strong className="chatkit-markdown-strong">{children}</strong>,
          em: ({ children }) => <em className="chatkit-markdown-em">{children}</em>,
          hr: () => <hr className="chatkit-markdown-hr" />,
          table: ({ children }) => <table className="chatkit-markdown-table">{children}</table>,
          thead: ({ children }) => <thead className="chatkit-markdown-thead">{children}</thead>,
          tbody: ({ children }) => <tbody className="chatkit-markdown-tbody">{children}</tbody>,
          tr: ({ children }) => <tr className="chatkit-markdown-tr">{children}</tr>,
          th: ({ children }) => <th className="chatkit-markdown-th">{children}</th>,
          td: ({ children }) => <td className="chatkit-markdown-td">{children}</td>,
        }}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
