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
import edxoLogo from "../assets/favicon.svg";
import styles from "./LandingPage.module.css";
import { useI18n } from "../i18n";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

const LandingPage = () => {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <div className={styles.landingPage}>
      <header className={styles.header}>
        <div className={styles.container}>
          <nav className={styles.nav}>
            <div className={styles.logo}>
              <img src={edxoLogo} alt="edxo" style={{ height: 32 }} />
              <span>edxo</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <LanguageSwitcher />
              <button
                className="button button--primary"
                onClick={() => navigate("/login")}
              >
                {t("landing.nav.login")}
              </button>
            </div>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className={styles.hero}>
          <div className={styles.container}>
            <h1 className={styles.heroTitle}>
              {t("landing.hero.title")}
            </h1>
            <p className={styles.heroSubtitle}>
              {t("landing.hero.subtitle")}
            </p>
            <div className={styles.heroButtons}>
              <button
                className="button button--primary"
                style={{ padding: "16px 32px", fontSize: "1.1rem" }}
                onClick={() => navigate("/login")}
              >
                {t("landing.hero.getStarted")} <ArrowRight size={20} />
              </button>
              <a
                href="https://github.com/fpoisson2/test-chatkit"
                target="_blank"
                rel="noreferrer"
                className="button button--subtle"
                style={{ padding: "16px 32px", fontSize: "1.1rem" }}
              >
                <Github size={20} /> {t("landing.hero.github")}
              </a>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className={styles.features}>
          <div className={styles.container}>
            <h2 className={styles.sectionTitle}>{t("landing.features.title")}</h2>
            <div className={styles.featureGrid}>
              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <Workflow size={24} />
                </div>
                <h3 className={styles.featureTitle}>{t("landing.features.workflow.title")}</h3>
                <p className={styles.featureDescription}>
                  {t("landing.features.workflow.desc")}
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <Bot size={24} />
                </div>
                <h3 className={styles.featureTitle}>{t("landing.features.multimodel.title")}</h3>
                <p className={styles.featureDescription}>
                  {t("landing.features.multimodel.desc")}
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <Database size={24} />
                </div>
                <h3 className={styles.featureTitle}>{t("landing.features.vectorstore.title")}</h3>
                <p className={styles.featureDescription}>
                  {t("landing.features.vectorstore.desc")}
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <Mic size={24} />
                </div>
                <h3 className={styles.featureTitle}>{t("landing.features.voice.title")}</h3>
                <p className={styles.featureDescription}>
                  {t("landing.features.voice.desc")}
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <GraduationCap size={24} />
                </div>
                <h3 className={styles.featureTitle}>{t("landing.features.lms.title")}</h3>
                <p className={styles.featureDescription}>
                  {t("landing.features.lms.desc")}
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <ShieldCheck size={24} />
                </div>
                <h3 className={styles.featureTitle}>{t("landing.features.selfhost.title")}</h3>
                <p className={styles.featureDescription}>
                  {t("landing.features.selfhost.desc")}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Architecture Section */}
        <section className={styles.architecture}>
          <div className={styles.container}>
            <h2 className={styles.sectionTitle}>{t("landing.tech.title")}</h2>
            <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto' }}>
              <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {t("landing.tech.subtitle")}
              </p>

              <div className={styles.techStack}>
                <span className={styles.techBadge}><Layers size={14} style={{ marginRight: 6 }}/> FastAPI</span>
                <span className={styles.techBadge}><Cpu size={14} style={{ marginRight: 6 }}/> React 18 + Vite</span>
                <span className={styles.techBadge}><Database size={14} style={{ marginRight: 6 }}/> PostgreSQL + pgVector</span>
                <span className={styles.techBadge}><Bot size={14} style={{ marginRight: 6 }}/> LiteLLM</span>
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
              <img src={edxoLogo} alt="edxo" style={{ height: 24 }} />
              <span>edxo</span>
            </div>
            <div className={styles.copyright}>
              © {new Date().getFullYear()} edxo. {t("landing.footer.tagline")}
            </div>
            <div className={styles.socials}>
              <a href="https://github.com/fpoisson2/test-chatkit" className={styles.socialLink} target="_blank" rel="noreferrer">
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
