import { Link } from "react-router-dom";

import { useAuth } from "../auth";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { VoiceChat } from "../voice/VoiceChat";
import { useI18n } from "../i18n";
import styles from "./VoicePage.module.css";

export const VoicePage = () => {
  const { user } = useAuth();
  const { t } = useI18n();

  if (!user) {
    return (
      <ManagementPageLayout
        title={t("voice.title")}
        subtitle={t("voice.subtitle")}
        actions={
          <>
            <Link className="button" to="/login">
              {t("voice.actions.signIn")}
            </Link>
            <Link className="button button--subtle" to="/">
              {t("voice.actions.backToChat")}
            </Link>
          </>
        }
        maxWidth="md"
      >
        <div className={styles.emptyState}>
          <p>{t("voice.description")}</p>
        </div>
      </ManagementPageLayout>
    );
  }

  return (
    <ManagementPageLayout
      title={t("voice.title")}
      hideHeader
      maxWidth="lg"
    >
      <VoiceChat />
    </ManagementPageLayout>
  );
};

export default VoicePage;

