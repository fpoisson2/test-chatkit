import React from "react";
import { useNavigate } from "react-router-dom";
import {
  GraduationCap,
  Workflow,
  Bot,
  Database,
  Mic,
  ShieldCheck,
  ArrowRight,
  Github,
  Layers,
  Cpu
} from "lucide-react";
import edxoLogo from "../assets/edxo-logo.svg";
import styles from "./LandingPage.module.css";

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className={styles.landingPage}>
      <header className={styles.header}>
        <div className={styles.container}>
          <nav className={styles.nav}>
            <div className={styles.logo}>
              <img src={edxoLogo} alt="EDxo" style={{ height: 32 }} />
              <span>EDxo</span>
            </div>
            <button
              className="button button--primary"
              onClick={() => navigate("/login")}
            >
              Connexion
            </button>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className={styles.hero}>
          <div className={styles.container}>
            <h1 className={styles.heroTitle}>
              Créez des assistants IA pédagogiques intelligents
            </h1>
            <p className={styles.heroSubtitle}>
              La plateforme complète pour les éducateurs et institutions.
              Intégration LMS native, workflow builder visuel et assistants IA conversationnels
              sans écrire une seule ligne de code.
            </p>
            <div className={styles.heroButtons}>
              <button
                className="button button--primary"
                style={{ padding: "16px 32px", fontSize: "1.1rem" }}
                onClick={() => navigate("/login")}
              >
                Démarrer maintenant <ArrowRight size={20} />
              </button>
              <a
                href="https://github.com/edxo/edxo"
                target="_blank"
                rel="noreferrer"
                className="button button--subtle"
                style={{ padding: "16px 32px", fontSize: "1.1rem" }}
              >
                <Github size={20} /> GitHub
              </a>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className={styles.features}>
          <div className={styles.container}>
            <h2 className={styles.sectionTitle}>Pourquoi choisir EDxo ?</h2>
            <div className={styles.featureGrid}>
              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <GraduationCap size={24} />
                </div>
                <h3 className={styles.featureTitle}>Conçu pour l'éducation</h3>
                <p className={styles.featureDescription}>
                  Intégration native LTI 1.3 avec Moodle, Canvas et Blackboard.
                  Synchronisation automatique des notes et conformité RGPD.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <Workflow size={24} />
                </div>
                <h3 className={styles.featureTitle}>Workflow Builder Visuel</h3>
                <p className={styles.featureDescription}>
                  Interface no-code intuitive pour créer des parcours pédagogiques
                  complexes par simple glisser-déposer.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <Bot size={24} />
                </div>
                <h3 className={styles.featureTitle}>IA Multi-modèles</h3>
                <p className={styles.featureDescription}>
                  Utilisez le meilleur de l'IA : GPT-4, Claude, Gemini, Mistral.
                  Changez de modèle selon vos besoins pédagogiques.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <Database size={24} />
                </div>
                <h3 className={styles.featureTitle}>Bases de Connaissances</h3>
                <p className={styles.featureDescription}>
                  Indexez vos cours (PDF, Markdown) pour que l'IA réponde
                  précisément en se basant sur votre contenu.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <Mic size={24} />
                </div>
                <h3 className={styles.featureTitle}>Mode Vocal</h3>
                <p className={styles.featureDescription}>
                  Conversations vocales en temps réel pour l'apprentissage des langues
                  et l'accessibilité.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <ShieldCheck size={24} />
                </div>
                <h3 className={styles.featureTitle}>Confidentialité Totale</h3>
                <p className={styles.featureDescription}>
                  Gestion sécurisée des données étudiants. Auto-hébergement possible
                  pour une souveraineté totale.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Architecture Section */}
        <section className={styles.architecture}>
          <div className={styles.container}>
            <h2 className={styles.sectionTitle}>Architecture Moderne</h2>
            <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto' }}>
              <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                EDxo repose sur une stack technique robuste et open source, conçue pour la performance et l'évolutivité.
              </p>

              <div className={styles.techStack}>
                <span className={styles.techBadge}><Layers size={14} style={{ marginRight: 6 }}/> FastAPI</span>
                <span className={styles.techBadge}><Cpu size={14} style={{ marginRight: 6 }}/> React 18 + Vite</span>
                <span className={styles.techBadge}><Database size={14} style={{ marginRight: 6 }}/> PostgreSQL + pgVector</span>
                <span className={styles.techBadge}><Bot size={14} style={{ marginRight: 6 }}/> LangChain / LiteLLM</span>
                <span className={styles.techBadge}><Workflow size={14} style={{ marginRight: 6 }}/> React Flow</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.footerContent}>
            <div className={styles.logo} style={{ fontSize: '1.2rem' }}>
              <img src={edxoLogo} alt="EDxo" style={{ height: 24 }} />
              <span>EDxo</span>
            </div>
            <div className={styles.copyright}>
              © {new Date().getFullYear()} EDxo. Open Source Education.
            </div>
            <div className={styles.socials}>
              <a href="https://github.com/edxo/edxo" className={styles.socialLink} target="_blank" rel="noreferrer">
                <Github size={20} />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
