import type { FlowNode } from "../../../types";
import { getFrontendTriggerConfig } from "../../../../../utils/workflows";
import { HelpTooltip } from "../components/HelpTooltip";
import styles from "../NodeInspector.module.css";

type FrontendTriggerInspectorSectionProps = {
  nodeId: string;
  parameters: FlowNode["data"]["parameters"];
  onFrontendTriggerActionTypeChange: (
    nodeId: string,
    actionType: "modal" | "notification" | "redirect" | "custom",
  ) => void;
  onFrontendTriggerActionConfigChange: (
    nodeId: string,
    config: Record<string, unknown>,
  ) => void;
  onFrontendTriggerAwaitResponseChange: (nodeId: string, awaitResponse: boolean) => void;
};

export const FrontendTriggerInspectorSection = ({
  nodeId,
  parameters,
  onFrontendTriggerActionTypeChange,
  onFrontendTriggerActionConfigChange,
  onFrontendTriggerAwaitResponseChange,
}: FrontendTriggerInspectorSectionProps) => {
  const config = getFrontendTriggerConfig(parameters);
  const { actionType, actionConfig, awaitResponse } = config;

  const handleConfigFieldChange = (field: string, value: string) => {
    onFrontendTriggerActionConfigChange(nodeId, {
      ...actionConfig,
      [field]: value,
    });
  };

  return (
    <>
      <p className={styles.nodeInspectorMutedTextSpacedTop}>
        Déclenchez une action frontend personnalisée (modal, notification, redirection, etc.).
      </p>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          Type d'action
          <HelpTooltip label="Choisissez le type d'action à déclencher dans l'interface frontend." />
        </span>
        <select
          value={actionType}
          onChange={(event) =>
            onFrontendTriggerActionTypeChange(
              nodeId,
              event.target.value as "modal" | "notification" | "redirect" | "custom",
            )
          }
        >
          <option value="modal">Modal</option>
          <option value="notification">Notification</option>
          <option value="redirect">Redirection</option>
          <option value="custom">Action personnalisée</option>
        </select>
      </label>

      {actionType === "modal" && (
        <>
          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Titre du modal
              <HelpTooltip label="Titre affiché en haut du modal." />
            </span>
            <input
              type="text"
              value={(actionConfig.title as string) || ""}
              onChange={(event) => handleConfigFieldChange("title", event.target.value)}
              placeholder="Ex. Confirmer l'action"
            />
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Composant ou Widget
              <HelpTooltip label="Nom du composant React ou slug du widget à afficher dans le modal." />
            </span>
            <input
              type="text"
              value={(actionConfig.component as string) || ""}
              onChange={(event) => handleConfigFieldChange("component", event.target.value)}
              placeholder="Ex. MyCustomModal ou widget-slug"
            />
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Propriétés (JSON)
              <HelpTooltip label="Propriétés à passer au composant React, au format JSON ou expression." />
            </span>
            <textarea
              value={
                typeof actionConfig.props === "string"
                  ? actionConfig.props
                  : JSON.stringify(actionConfig.props || {}, null, 2)
              }
              onChange={(event) => handleConfigFieldChange("props", event.target.value)}
              placeholder='{"key": "value"} ou state.modal_props'
              rows={4}
            />
          </label>
        </>
      )}

      {actionType === "notification" && (
        <>
          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Message
              <HelpTooltip label="Texte de la notification ou expression pour le générer dynamiquement." />
            </span>
            <textarea
              value={(actionConfig.message as string) || ""}
              onChange={(event) => handleConfigFieldChange("message", event.target.value)}
              placeholder="Ex. Opération réussie ! ou state.notification_message"
              rows={3}
            />
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Niveau de gravité
              <HelpTooltip label="Importance de la notification (affecte la couleur et l'icône)." />
            </span>
            <select
              value={(actionConfig.level as string) || "info"}
              onChange={(event) => handleConfigFieldChange("level", event.target.value)}
            >
              <option value="info">Information</option>
              <option value="success">Succès</option>
              <option value="warning">Avertissement</option>
              <option value="error">Erreur</option>
            </select>
          </label>
        </>
      )}

      {actionType === "redirect" && (
        <label className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            URL de redirection
            <HelpTooltip label="URL vers laquelle rediriger l'utilisateur ou expression pour la générer." />
          </span>
          <input
            type="text"
            value={(actionConfig.url as string) || ""}
            onChange={(event) => handleConfigFieldChange("url", event.target.value)}
            placeholder="Ex. /dashboard ou state.redirect_url"
          />
        </label>
      )}

      {actionType === "custom" && (
        <label className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            Code de l'action personnalisée
            <HelpTooltip label="Code JavaScript ou expression à exécuter côté frontend." />
          </span>
          <textarea
            value={(actionConfig.customAction as string) || ""}
            onChange={(event) => handleConfigFieldChange("customAction", event.target.value)}
            placeholder="Ex. window.myCustomAction(state.data)"
            rows={6}
          />
        </label>
      )}

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>Progression du workflow</span>
        <div className={styles.nodeInspectorInlineStack}>
          <input
            type="checkbox"
            checked={awaitResponse}
            onChange={(event) =>
              onFrontendTriggerAwaitResponseChange(nodeId, event.target.checked)
            }
          />
          <div className={styles.nodeInspectorStackText}>
            <strong>Attendre une réponse avant de continuer</strong>
            <p className={styles.nodeInspectorHintTextTight}>
              Lorsque cette option est activée, le workflow se met en pause jusqu'à ce que
              l'action frontend renvoie une réponse (ex. formulaire soumis dans un modal).
              Désactivez-la pour continuer automatiquement.
            </p>
          </div>
        </div>
      </label>
    </>
  );
};
