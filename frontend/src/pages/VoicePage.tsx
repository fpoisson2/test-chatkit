import { Link } from "react-router-dom";

import { useAuth } from "../auth";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { VoiceChat } from "../voice/VoiceChat";
import styles from "./VoicePage.module.css";

export const VoicePage = () => {
  const { user } = useAuth();

  if (!user) {
    return (
      <ManagementPageLayout
        title="Assistant vocal"
        subtitle="Vous devez être connecté pour accéder à l'interface vocale."
        actions={
          <>
            <Link className="button" to="/login">
              Se connecter
            </Link>
            <Link className="button button--subtle" to="/">
              ← Chat texte
            </Link>
          </>
        }
        maxWidth="md"
      >
        <div className={styles.emptyState}>
          <p>
            Connectez-vous pour lancer des sessions Realtime, autoriser votre microphone et consulter les transcriptions en
            direct.
          </p>
        </div>
      </ManagementPageLayout>
    );
  }

  return (
    <ManagementPageLayout
      title="Assistant vocal"
      headerVariant="compact"
      maxWidth="lg"
    >
      <VoiceChat />
    </ManagementPageLayout>
  );
};

export default VoicePage;

