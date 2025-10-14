import { Link } from "react-router-dom";

import { useAuth } from "../auth";
import { VoiceChat } from "../voice/VoiceChat";

export const VoicePage = () => {
  const { user } = useAuth();

  if (!user) {
    return (
      <section className="voice-page voice-page--unauthenticated">
        <h1>Assistant vocal</h1>
        <p>Vous devez être connecté pour accéder à l'interface vocale.</p>
        <Link className="button" to="/login">
          Se connecter
        </Link>
        <Link className="voice-page__mode voice-page__mode--link" to="/">
          ← Revenir au chat texte
        </Link>
      </section>
    );
  }

  return (
    <section className="voice-page">
      <header className="voice-page__header">
        <div>
          <h1>Assistant vocal Realtime</h1>
          <p className="voice-page__intro">
            Retrouvez ici une expérience conversationnelle en voix avec l'agent ChatKit. Autorisez votre microphone puis
            démarrez la session pour échanger à l'oral.
          </p>
        </div>
        <Link className="button button--subtle voice-page__back" to="/">
          ← Chat texte
        </Link>
      </header>
      <nav className="voice-page__mode-switch" aria-label="Changer de mode de conversation">
        <span className="voice-page__mode voice-page__mode--active">Mode voix</span>
        <Link className="voice-page__mode voice-page__mode--link" to="/">
          Chat texte
        </Link>
      </nav>
      <VoiceChat />
    </section>
  );
};

export default VoicePage;

