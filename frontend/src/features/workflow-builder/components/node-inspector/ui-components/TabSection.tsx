import React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { LucideIcon } from 'lucide-react';
import styles from './TabSection.module.css';

export interface Tab {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: number;
  content: React.ReactNode;
}

interface TabSectionProps {
  tabs: Tab[];
  defaultTab?: string;
  onTabChange?: (tabId: string) => void;
}

export const TabSection: React.FC<TabSectionProps> = ({
  tabs,
  defaultTab,
  onTabChange,
}) => {
  return (
    <Tabs.Root
      className={styles.tabsRoot}
      defaultValue={defaultTab || tabs[0]?.id}
      onValueChange={onTabChange}
    >
      <Tabs.List className={styles.tabsList} aria-label="Configuration sections">
        {tabs.map((tab) => (
          <Tabs.Trigger
            key={tab.id}
            className={styles.tabsTrigger}
            value={tab.id}
          >
            {tab.icon && <tab.icon size={16} className={styles.tabIcon} />}
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={styles.tabBadge} aria-label={`${tab.badge} errors`}>
                {tab.badge}
              </span>
            )}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {tabs.map((tab) => (
        <Tabs.Content
          key={tab.id}
          className={styles.tabsContent}
          value={tab.id}
        >
          {tab.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
};
