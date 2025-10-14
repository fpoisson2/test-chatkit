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
      </section>
    );
  }

  return (
    <section className="voice-page">
      <h1>Assistant vocal Realtime</h1>
      <p className="voice-page__intro">
        Retrouvez ici une expérience conversationnelle en voix avec l'agent ChatKit. Autorisez votre microphone puis démarrez
        la session pour échanger à l'oral.
      </p>
      <VoiceChat />
    </section>
  );
};

export default VoicePage;

