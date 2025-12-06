import styles from "../NodeInspector.module.css";

type WatchAvailableVariable = {
  name: string;
  description?: string;
};

type WatchInspectorSectionProps = {
  availableVariables: WatchAvailableVariable[];
  previousNodeLabel?: string;
};

export const WatchInspectorSection = ({
  availableVariables,
  previousNodeLabel,
}: WatchInspectorSectionProps) => (
  <section
    aria-label="Informations du bloc watch"
    className={styles.nodeInspectorPanelSpacious}
  >
    <p className={styles.nodeInspectorMutedNote}>
      Aucune configuration n'est requise : reliez-le simplement après le bloc dont vous souhaitez inspecter la sortie.
    </p>

    <div className={styles.nodeInspectorPanelInner}>
      <p className={styles.nodeInspectorLabel}>
        Variables disponibles à la prochaine étape
        {previousNodeLabel ? (
          <span className={styles.nodeInspectorCodeNote}> basées sur « {previousNodeLabel} »</span>
        ) : null}
      </p>

      {availableVariables.length > 0 ? (
        <ul className={styles.nodeInspectorList}>
          {availableVariables.map(({ name, description }) => (
            <li key={name} className={styles.nodeInspectorListItem}>
              <code className={styles.nodeInspectorCode}>{name}</code>
              {description ? (
                <span className={styles.nodeInspectorCodeNote}> — {description}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.nodeInspectorHintText}>
          Reliez ce bloc à une étape précédente pour afficher les variables transmises à la suite du workflow.
        </p>
      )}
    </div>
  </section>
);
