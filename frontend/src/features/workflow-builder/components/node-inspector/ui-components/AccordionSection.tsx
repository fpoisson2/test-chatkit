import React from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import { ChevronRight, LucideIcon } from 'lucide-react';
import styles from './AccordionSection.module.css';

interface AccordionSectionProps {
  id: string;
  title: string;
  icon?: LucideIcon;
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  expandedByDefault?: boolean;
  children: React.ReactNode;
  showToggle?: boolean;
}

export const AccordionSection: React.FC<AccordionSectionProps> = ({
  id,
  title,
  icon: Icon,
  enabled = true,
  onToggle,
  expandedByDefault = false,
  children,
  showToggle = true,
}) => {
  return (
    <Accordion.Root
      className={styles.accordionRoot}
      type="single"
      collapsible
      defaultValue={expandedByDefault ? id : undefined}
    >
      <Accordion.Item className={styles.accordionItem} value={id}>
        <div className={styles.accordionHeaderWrapper}>
          <Accordion.Trigger className={styles.accordionTrigger}>
            <div className={styles.accordionTriggerContent}>
              <ChevronRight
                size={16}
                className={styles.accordionChevron}
                aria-hidden
              />
              {Icon && <Icon size={16} className={styles.accordionIcon} />}
              <span className={styles.accordionTitle}>{title}</span>
            </div>
          </Accordion.Trigger>

          {showToggle && onToggle && (
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              className={`${styles.accordionToggle} ${enabled ? styles.accordionToggleOn : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(!enabled);
              }}
            >
              <span className={styles.accordionToggleThumb} />
            </button>
          )}
        </div>

        {enabled && (
          <Accordion.Content className={styles.accordionContent}>
            <div className={styles.accordionContentInner}>
              {children}
            </div>
          </Accordion.Content>
        )}
      </Accordion.Item>
    </Accordion.Root>
  );
};
