export const WatchInspectorSection = () => (
  <section
    aria-label="Informations du bloc watch"
    style={{
      marginTop: "1rem",
      border: "1px solid rgba(15, 23, 42, 0.12)",
      borderRadius: "0.75rem",
      padding: "0.9rem",
      display: "grid",
      gap: "0.75rem",
    }}
  >
    <header>
      <h3 style={{ margin: 0, fontSize: "1rem" }}>Observation du flux</h3>
      <p style={{ margin: "0.25rem 0 0", color: "#475569", fontSize: "0.95rem" }}>
        Ce bloc diffuse dans ChatKit le payload produit par le bloc précédent sous forme de notice informative.
      </p>
    </header>
    <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
      Aucune configuration n'est requise : reliez-le simplement après le bloc dont vous souhaitez inspecter la sortie.
    </p>
  </section>
);
