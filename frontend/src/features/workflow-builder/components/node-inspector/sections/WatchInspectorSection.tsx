import styles from "../NodeInspector.module.css";

export const WatchInspectorSection = () => (
  <section
    aria-label="Informations du bloc watch"
    className={styles.nodeInspectorPanelSpacious}
  >
    <p className={styles.nodeInspectorMutedNote}>
      Aucune configuration n'est requise : reliez-le simplement après le bloc dont vous souhaitez inspecter la sortie.
    </p>
  </section>
);
