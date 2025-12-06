/**
 * Composant pour afficher des diagrammes Mermaid
 */
import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import './MermaidDiagram.css';

export interface MermaidDiagramProps {
  chart: string;
  theme?: 'light' | 'dark';
}

// Counter for unique IDs
let mermaidIdCounter = 0;
const mermaidSvgCache = new Map<string, { svg: string; error: string | null }>();

export function MermaidDiagram({ chart, theme = 'light' }: MermaidDiagramProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const cacheKey = `${theme}:${chart}`;
  const cached = mermaidSvgCache.get(cacheKey) ?? { svg: '', error: null };
  const [svg, setSvg] = useState<string>(cached.svg);
  const [error, setError] = useState<string | null>(cached.error);
  const [idRef] = useState(() => `mermaid-${++mermaidIdCounter}-${Date.now()}`);

  useEffect(() => {
    const renderDiagram = async () => {
      if (!containerRef.current) return;

      // Configure mermaid with theme
      mermaid.initialize({
        startOnLoad: false,
        theme: theme === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
        fontFamily: 'var(--font-sans)',
        flowchart: {
          useMaxWidth: true,
          htmlLabels: true,
          curve: 'basis',
        },
        themeVariables: theme === 'dark' ? {
          primaryColor: '#3b82f6',
          primaryTextColor: '#f8fafc',
          primaryBorderColor: '#60a5fa',
          lineColor: '#94a3b8',
          secondaryColor: '#1e293b',
          tertiaryColor: '#334155',
          background: '#0f172a',
          mainBkg: '#1e293b',
          nodeBorder: '#60a5fa',
          clusterBkg: '#1e293b',
          clusterBorder: '#475569',
          titleColor: '#f8fafc',
          edgeLabelBackground: '#1e293b',
        } : {
          primaryColor: '#3b82f6',
          primaryTextColor: '#0f172a',
          primaryBorderColor: '#2563eb',
          lineColor: '#64748b',
          secondaryColor: '#f1f5f9',
          tertiaryColor: '#e2e8f0',
          background: '#ffffff',
          mainBkg: '#f8fafc',
          nodeBorder: '#2563eb',
          clusterBkg: '#f1f5f9',
          clusterBorder: '#cbd5e1',
          titleColor: '#0f172a',
          edgeLabelBackground: '#ffffff',
        },
      });

      try {
        // Validate the diagram first
        const isValid = await mermaid.parse(chart);
        if (!isValid) {
          setError('Invalid Mermaid syntax');
          mermaidSvgCache.set(cacheKey, { svg: '', error: 'Invalid Mermaid syntax' });
          return;
        }

        // Render the diagram
        const { svg: renderedSvg } = await mermaid.render(idRef, chart);
        setSvg(renderedSvg);
        setError(null);
        mermaidSvgCache.set(cacheKey, { svg: renderedSvg, error: null });
      } catch (err) {
        console.error('Mermaid rendering error:', err);
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
        setSvg('');
        mermaidSvgCache.set(cacheKey, { svg: '', error: err instanceof Error ? err.message : 'Failed to render diagram' });
      }
    };

    renderDiagram();
  }, [cacheKey, chart, theme, idRef]);

  if (error) {
    return (
      <div className="chatkit-mermaid-error">
        <div className="chatkit-mermaid-error-title">Diagram Error</div>
        <div className="chatkit-mermaid-error-message">{error}</div>
        <pre className="chatkit-mermaid-error-code">{chart}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="chatkit-mermaid-container"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
