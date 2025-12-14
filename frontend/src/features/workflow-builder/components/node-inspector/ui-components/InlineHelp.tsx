import React, { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronUp, Copy, ExternalLink } from 'lucide-react';
import styles from './InlineHelp.module.css';

export interface CodeExample {
  label: string;
  value: string;
}

interface InlineHelpProps {
  title: string;
  children: React.ReactNode;
  examples?: CodeExample[];
  learnMoreUrl?: string;
  defaultExpanded?: boolean;
}

export const InlineHelp: React.FC<InlineHelpProps> = ({
  title,
  children,
  examples,
  learnMoreUrl,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = async (value: string, index: number) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
    }
  };

  return (
    <div className={styles.inlineHelp}>
      <button
        className={styles.inlineHelpToggle}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        type="button"
      >
        <HelpCircle size={16} aria-hidden />
        <span className={styles.inlineHelpTitle}>{title}</span>
        {expanded ? (
          <ChevronUp size={14} aria-hidden />
        ) : (
          <ChevronDown size={14} aria-hidden />
        )}
      </button>

      {expanded && (
        <div className={styles.inlineHelpContent}>
          <div className={styles.helpText}>{children}</div>

          {examples && examples.length > 0 && (
            <div className={styles.helpExamples}>
              <h5 className={styles.examplesHeading}>Exemples:</h5>
              {examples.map((ex, i) => (
                <div key={i} className={styles.example}>
                  <div className={styles.exampleHeader}>
                    <span className={styles.exampleLabel}>{ex.label}</span>
                    <button
                      className={styles.copyButton}
                      onClick={() => handleCopy(ex.value, i)}
                      title={copiedIndex === i ? 'Copié !' : 'Copier'}
                      type="button"
                    >
                      {copiedIndex === i ? (
                        <span className={styles.copiedText}>✓</span>
                      ) : (
                        <Copy size={14} aria-hidden />
                      )}
                    </button>
                  </div>
                  <code className={styles.exampleCode}>{ex.value}</code>
                </div>
              ))}
            </div>
          )}

          {learnMoreUrl && (
            <a
              href={learnMoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.learnMore}
            >
              En savoir plus <ExternalLink size={12} aria-hidden />
            </a>
          )}
        </div>
      )}
    </div>
  );
};
