import { memo, type CSSProperties, type ReactNode } from "react";
import styles from "../../WorkflowBuilderPage.module.css";

interface PropertiesPanelProps {
  isMobileLayout: boolean;
  selectedElementLabel: string;
  floatingPanelStyle?: CSSProperties;
  onClose: () => void;
  closeButtonRef: React.RefObject<HTMLButtonElement>;
  children: ReactNode;
}

/**
 * Properties panel wrapper for NodeInspector and EdgeInspector
 * Handles responsive layout (desktop vs mobile) and panel styling
 * Memoized to prevent unnecessary re-renders
 */
const PropertiesPanelComponent = ({
  isMobileLayout,
  selectedElementLabel,
  floatingPanelStyle,
  onClose,
  closeButtonRef,
  children,
}: PropertiesPanelProps) => {
  const propertiesPanelId = "properties-panel";
  const propertiesPanelTitleId = "properties-panel-title";

  return (
    <aside
      id={propertiesPanelId}
      aria-label="Propriétés du bloc sélectionné"
      aria-labelledby={propertiesPanelTitleId}
      className={isMobileLayout ? styles.propertiesPanelMobile : styles.propertiesPanel}
      role={isMobileLayout ? "dialog" : undefined}
      aria-modal={isMobileLayout ? true : undefined}
      onClick={isMobileLayout ? (event) => event.stopPropagation() : undefined}
      style={!isMobileLayout ? floatingPanelStyle : undefined}
    >
      <header className={styles.propertiesPanelHeader}>
        <div className={styles.propertiesPanelHeaderMeta}>
          <p className={styles.propertiesPanelOverline}>Propriétés du bloc</p>
          <h2 id={propertiesPanelTitleId} className={styles.propertiesPanelTitle}>
            {selectedElementLabel || "Bloc"}
          </h2>
        </div>
        <button
          type="button"
          ref={closeButtonRef}
          onClick={onClose}
          aria-label="Fermer le panneau de propriétés"
          className={styles.propertiesPanelCloseButton}
        >
          ×
        </button>
      </header>
      <div className={styles.propertiesPanelBody}>{children}</div>
    </aside>
  );
};

/**
 * Memoized PropertiesPanel component
 * Only re-renders when props change
 */
export const PropertiesPanel = memo(PropertiesPanelComponent);
