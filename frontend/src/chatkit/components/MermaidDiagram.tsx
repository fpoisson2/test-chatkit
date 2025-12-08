/**
 * Composant pour afficher des diagrammes Mermaid
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import mermaid from 'mermaid';
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch';
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
  const [isModalOpen, setIsModalOpen] = useState(false);

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
    <>
      <TransformWrapper
        initialScale={1.8}
        minScale={0.5}
        maxScale={4}
        centerOnInit={true}
        wheel={{ step: 0.1 }}
        doubleClick={{ mode: 'reset' }}
      >
        <div className="chatkit-mermaid-zoom-wrapper">
          <button
            className="chatkit-mermaid-expand-btn"
            onClick={() => setIsModalOpen(true)}
            title="Agrandir le diagramme"
            aria-label="Agrandir le diagramme"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
          <Controls />
          <TransformComponent
            wrapperClass="chatkit-mermaid-transform-wrapper"
            contentClass="chatkit-mermaid-transform-content"
          >
            <div
              ref={containerRef}
              className="chatkit-mermaid-container"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </TransformComponent>
        </div>
      </TransformWrapper>

      {isModalOpen && (
        createPortal(
          <MermaidModal
            svg={svg}
            onClose={() => setIsModalOpen(false)}
          />,
          document.body,
        )
      )}
    </>
  );
}

// Zoom controls component
function Controls() {
  const { zoomIn, zoomOut, resetTransform } = useControls();

  return (
    <div className="chatkit-mermaid-controls">
      <button
        className="chatkit-mermaid-control-btn"
        onClick={() => zoomIn()}
        title="Zoom avant"
        aria-label="Zoom avant"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>
      <button
        className="chatkit-mermaid-control-btn"
        onClick={() => zoomOut()}
        title="Zoom arrière"
        aria-label="Zoom arrière"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>
      <button
        className="chatkit-mermaid-control-btn"
        onClick={() => resetTransform()}
        title="Réinitialiser le zoom"
        aria-label="Réinitialiser le zoom"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      </button>
    </div>
  );
}

// Modal component for expanded view
interface MermaidModalProps {
  svg: string;
  onClose: () => void;
}

function MermaidModal({ svg, onClose }: MermaidModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="chatkit-mermaid-modal-overlay" onClick={handleOverlayClick}>
      <div className="chatkit-mermaid-modal-content">
        <button
          className="chatkit-mermaid-modal-close"
          onClick={onClose}
          title="Fermer"
          aria-label="Fermer le modal"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <TransformWrapper
          initialScale={1.8}
          minScale={0.3}
          maxScale={8}
          centerOnInit={true}
          wheel={{ step: 0.15 }}
          doubleClick={{ mode: 'reset' }}
        >
          <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <Controls />
            <TransformComponent
              wrapperClass="chatkit-mermaid-transform-wrapper"
              contentClass="chatkit-mermaid-transform-content"
              wrapperStyle={{ width: '100%', height: '100%' }}
            >
              <div
                className="chatkit-mermaid-container"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </TransformComponent>
          </div>
        </TransformWrapper>
      </div>
    </div>
  );
}
