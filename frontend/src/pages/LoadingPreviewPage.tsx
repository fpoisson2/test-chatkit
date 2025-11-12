import { useEffect, useMemo, useState } from "react";

import { LoadingOverlay } from "../components/feedback/LoadingOverlay";
import { LoadingSpinner } from "../components/feedback/LoadingSpinner";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useI18n } from "../i18n";

import styles from "./LoadingPreviewPage.module.css";

type SpinnerVariant = {
  size: NonNullable<Parameters<typeof LoadingSpinner>[0]["size"]>;
  labelKey: string;
  descriptionKey: string;
};

const SPINNER_VARIANTS: SpinnerVariant[] = [
  {
    size: "sm",
    labelKey: "styleguide.loaders.variant.small",
    descriptionKey: "styleguide.loaders.variant.smallDescription",
  },
  {
    size: "md",
    labelKey: "styleguide.loaders.variant.medium",
    descriptionKey: "styleguide.loaders.variant.mediumDescription",
  },
  {
    size: "lg",
    labelKey: "styleguide.loaders.variant.large",
    descriptionKey: "styleguide.loaders.variant.largeDescription",
  },
];

export const LoadingPreviewPage = () => {
  const { t } = useI18n();
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [simulateSuspense, setSimulateSuspense] = useState(false);

  useEffect(() => {
    if (!simulateSuspense) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSimulateSuspense(false);
    }, 1600);

    return () => window.clearTimeout(timeout);
  }, [simulateSuspense]);

  const overlayMessage = useMemo(
    () => t("styleguide.loaders.overlayMessage"),
    [t],
  );

  const spinnerMessage = useMemo(
    () => t("styleguide.loaders.spinnerMessage"),
    [t],
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <h1 className={styles.title}>{t("styleguide.loaders.title")}</h1>
          <p className={styles.subtitle}>{t("styleguide.loaders.subtitle")}</p>
        </div>
        <LanguageSwitcher
          hideLabel={false}
          className={styles.languageSwitcher}
          labelClassName={styles.languageLabel}
          selectClassName={styles.languageSelect}
        />
      </header>

      <section className={styles.section}>
        <div>
          <h2 className={styles.sectionTitle}>{t("styleguide.loaders.section.spinner")}</h2>
          <p className={styles.sectionDescription}>{t("styleguide.loaders.section.spinnerDescription")}</p>
        </div>
        <div className={styles.cardGrid}>
          {SPINNER_VARIANTS.map((variant) => (
            <article key={variant.size} className={styles.card}>
              <div className={styles.spinnerShowcase}>
                <LoadingSpinner size={variant.size} text={spinnerMessage} />
              </div>
              <div>
                <h3 className={styles.cardTitle}>{t(variant.labelKey)}</h3>
                <p className={styles.cardSubtitle}>{t(variant.descriptionKey)}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div>
          <h2 className={styles.sectionTitle}>{t("styleguide.loaders.section.overlay")}</h2>
          <p className={styles.sectionDescription}>{t("styleguide.loaders.section.overlayDescription")}</p>
        </div>
        <div className={styles.cardGrid}>
          <article className={styles.card}>
            <h3 className={styles.cardTitle}>{t("styleguide.loaders.overlayCardTitle")}</h3>
            <p className={styles.cardSubtitle}>{t("styleguide.loaders.overlayCardSubtitle")}</p>
            <div className={styles.actions}>
              <button
                type="button"
                className="button button--primary"
                onClick={() => setOverlayVisible(true)}
                disabled={overlayVisible}
              >
                {overlayVisible
                  ? t("styleguide.loaders.overlayButtonDisabled")
                  : t("styleguide.loaders.overlayButton")}
              </button>
              {overlayVisible && (
                <button
                  type="button"
                  className="button button--subtle"
                  onClick={() => setOverlayVisible(false)}
                >
                  {t("styleguide.loaders.overlayHide")}
                </button>
              )}
            </div>
            <p className={styles.overlayHint}>{t("styleguide.loaders.overlayHint")}</p>
          </article>
        </div>
        <LoadingOverlay
          isVisible={overlayVisible}
          message={overlayMessage}
          cancelable
          onCancel={() => setOverlayVisible(false)}
        />
      </section>

      <section className={styles.section}>
        <div>
          <h2 className={styles.sectionTitle}>{t("styleguide.loaders.section.suspense")}</h2>
          <p className={styles.sectionDescription}>{t("styleguide.loaders.section.suspenseDescription")}</p>
        </div>
        <div className={styles.cardGrid}>
          <article className={styles.card}>
            <div className={styles.controlRow}>
              <button
                type="button"
                className="button button--primary"
                onClick={() => setSimulateSuspense(true)}
                disabled={simulateSuspense}
              >
                {simulateSuspense
                  ? t("styleguide.loaders.suspenseRunning")
                  : t("styleguide.loaders.suspenseTrigger")}
              </button>
            </div>
            <div className={styles.demoSurface}>
              {simulateSuspense ? (
                <LoadingSpinner size="lg" text={t("feedback.loading.page")} />
              ) : (
                <p className={styles.helperText}>{t("styleguide.loaders.suspenseHelper")}</p>
              )}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
};

export default LoadingPreviewPage;
