/**
 * Page displayed to LTI users when their session has expired.
 * Instructs them to re-launch from Moodle since they cannot use /login.
 */
export const LTIExpiredPage = () => {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      padding: "2rem",
      textAlign: "center",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
        Session expirée
      </h1>
      <p style={{ color: "#666", maxWidth: "400px", lineHeight: 1.6 }}>
        Votre session a expiré. Veuillez retourner sur Moodle et relancer l'activité pour continuer.
      </p>
      <p style={{ color: "#999", fontSize: "0.875rem", marginTop: "1.5rem" }}>
        Vous serez automatiquement redirigé vers votre conversation en cours.
      </p>
    </div>
  );
};

export default LTIExpiredPage;
