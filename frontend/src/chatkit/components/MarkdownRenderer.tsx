/**
 * Composant pour afficher du contenu markdown
 */
import ReactMarkdown from 'react-markdown';
import './MarkdownRenderer.css';

export interface MarkdownRendererProps {
  content: string;
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
            return <pre className="chatkit-markdown-code-block"><code {...props}>{children}</code></pre>;
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
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
