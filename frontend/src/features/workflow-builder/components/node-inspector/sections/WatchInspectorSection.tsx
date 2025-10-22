import styles from "../NodeInspector.module.css";

export const WatchInspectorSection = () => (
  <section
    aria-label="Informations du bloc watch"
    className={styles.nodeInspectorPanelSpacious}
  >
    <header>
      <h3 className={styles.nodeInspectorSectionHeading}>Observation du flux</h3>
      <p className={styles.nodeInspectorMutedTextHighlight}>
        Ce bloc diffuse dans ChatKit le payload produit par le bloc précédent sous forme de notice informative.
      </p>
    </header>
    <p className={styles.nodeInspectorMutedNote}>
      Aucune configuration n'est requise : reliez-le simplement après le bloc dont vous souhaitez inspecter la sortie.
    </p>
  </section>
);
