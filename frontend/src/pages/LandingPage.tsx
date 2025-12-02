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

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className={styles.landingPage}>
      <header className={styles.header}>
        <div className={styles.container}>
          <nav className={styles.nav}>
            <div className={styles.logo}>
              <img src={edxoLogo} alt="edxo" style={{ height: 32 }} />
              <span>edxo</span>
            </div>
            <button
              className="button button--primary"
              onClick={() => navigate("/login")}
            >
              Login
            </button>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className={styles.hero}>
          <div className={styles.container}>
            <h1 className={styles.heroTitle}>
              Open-source workflow builder for conversational AI
            </h1>
            <p className={styles.heroSubtitle}>
              Build intelligent conversational assistants with a visual no-code interface.
              Started as an enhancement to OpenAI's AgentKit, now a complete platform
              for creating custom AI workflows, LMS integrations, and voice-enabled assistants.
            </p>
            <div className={styles.heroButtons}>
              <button
                className="button button--primary"
                style={{ padding: "16px 32px", fontSize: "1.1rem" }}
                onClick={() => navigate("/login")}
              >
                Get Started <ArrowRight size={20} />
              </button>
              <a
                href="https://github.com/fpoisson2/test-chatkit"
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
            <h2 className={styles.sectionTitle}>Why edxo?</h2>
            <div className={styles.featureGrid}>
              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <Workflow size={24} />
                </div>
                <h3 className={styles.featureTitle}>Visual Workflow Builder</h3>
                <p className={styles.featureDescription}>
                  Intuitive no-code interface to create complex conversational
                  flows with drag-and-drop simplicity.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <Bot size={24} />
                </div>
                <h3 className={styles.featureTitle}>Multi-model AI</h3>
                <p className={styles.featureDescription}>
                  Use the best of AI: GPT-4, Claude, Gemini, Mistral.
                  Switch between models based on your needs.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <Database size={24} />
                </div>
                <h3 className={styles.featureTitle}>Vector Stores</h3>
                <p className={styles.featureDescription}>
                  Index your documents (PDF, Markdown) so AI can answer
                  accurately based on your content.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <Mic size={24} />
                </div>
                <h3 className={styles.featureTitle}>Voice Mode</h3>
                <p className={styles.featureDescription}>
                  Real-time voice conversations with OpenAI Realtime API
                  and SIP telephony support.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <GraduationCap size={24} />
                </div>
                <h3 className={styles.featureTitle}>LMS Integration</h3>
                <p className={styles.featureDescription}>
                  Native LTI 1.3 integration with Moodle, Canvas, and Blackboard.
                  Automatic grade sync and deep linking.
                </p>
              </div>

              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <ShieldCheck size={24} />
                </div>
                <h3 className={styles.featureTitle}>Self-hosting Ready</h3>
                <p className={styles.featureDescription}>
                  Full control over your data. Deploy on your own infrastructure
                  for complete data sovereignty.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Architecture Section */}
        <section className={styles.architecture}>
          <div className={styles.container}>
            <h2 className={styles.sectionTitle}>Modern Tech Stack</h2>
            <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto' }}>
              <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Built on a robust, open-source stack designed for performance and scalability.
                Started with AgentKit, evolved into a complete platform.
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
              © {new Date().getFullYear()} edxo. Built for fun. Shared in case it helps others.
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
