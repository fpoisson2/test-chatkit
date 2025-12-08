/**
 * Composant pour afficher du contenu markdown avec support LaTeX
 */
import React, { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useI18n } from '../../i18n/I18nProvider';
import mermaid from 'mermaid';
import { MermaidDiagram } from './MermaidDiagram';
import 'katex/dist/katex.min.css';
import './MarkdownRenderer.css';

export interface MarkdownRendererProps {
  content: string;
  theme?: 'light' | 'dark';
  isStreaming?: boolean;
}

interface CodeBlockProps {
  children: string;
  language?: string;
  theme?: 'light' | 'dark';
}

function CodeBlock({ children, language, theme = 'light' }: CodeBlockProps): JSX.Element {
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
        title={copied ? t('chatkit.code.copied') : t('chatkit.code.copy')}
      >
        {copied ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        )}
      </button>
      <SyntaxHighlighter
        language={language || 'text'}
        style={theme === 'dark' ? vscDarkPlus : vs}
        customStyle={{
          margin: 0,
          padding: '0.75rem 1rem',
          fontSize: '16px',
        }}
        codeTagProps={{
          style: {
            fontFamily: 'var(--font-mono)',
          }
        }}
        PreTag="div"
        className="chatkit-markdown-code-block"
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

interface MermaidBlockProps {
  codeContent: string;
  theme?: 'light' | 'dark';
  isStreaming?: boolean;
}

function MermaidBlock({ codeContent, theme = 'light', isStreaming = false }: MermaidBlockProps): JSX.Element {
  const [renderableChart, setRenderableChart] = useState<string | null>(!isStreaming ? codeContent : null);

  useEffect(() => {
    let cancelled = false;

    const attemptParse = () => {
      try {
        mermaid.parse(codeContent);
        if (!cancelled) {
          setRenderableChart(prev => (prev === codeContent ? prev : codeContent));
        }
      } catch {
        // Keep showing the last valid render while streaming continues.
      }
    };

    if (isStreaming) {
      const timeoutId = window.setTimeout(attemptParse, 150);
      return () => {
        cancelled = true;
        clearTimeout(timeoutId);
      };
    }

    const rafId = requestAnimationFrame(attemptParse);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [codeContent, isStreaming]);

  if (!renderableChart) {
    return <CodeBlock language="mermaid" theme={theme}>{codeContent}</CodeBlock>;
  }

  return <MermaidDiagram chart={renderableChart} theme={theme} />;
}

export function MarkdownRenderer({ content, theme = 'light', isStreaming = false }: MarkdownRendererProps): JSX.Element {
  return (
    <div className="chatkit-markdown">
      <ReactMarkdown
        components={{
          // Customisation des composants HTML générés
          p: ({ children }) => <p className="chatkit-markdown-paragraph">{children}</p>,
          code: ({ inline, children, className, ...props }: any) => {
            const isInline = inline || !className?.includes('language-');
            const codeContent = String(children).replace(/\n$/, '');

            // Si c'est inline ou qu'il n'y a pas de langage spécifié et pas de retour à la ligne
            if (isInline && !codeContent.includes('\n')) {
              return <code className="chatkit-markdown-code-inline" {...props}>{children}</code>;
            }

            // Extraire le langage de la className (format: "language-javascript")
            const language = className?.replace('language-', '') || 'text';

            // Rendu spécial pour les diagrammes Mermaid
            if (language === 'mermaid') {
              return (
                <MermaidBlock
                  codeContent={codeContent}
                  theme={theme}
                  isStreaming={isStreaming}
                />
              );
            }

            return <CodeBlock language={language} theme={theme}>{codeContent}</CodeBlock>;
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
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MemoizedMarkdownRenderer = memo(
  MarkdownRenderer,
  (prev, next) =>
    prev.content === next.content && prev.theme === next.theme && prev.isStreaming === next.isStreaming
);
