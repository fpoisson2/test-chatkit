import { useMemo } from "react";
import { COMPUTER_USE_ENVIRONMENTS } from "../constants";
import { HelpTooltip } from "../components/HelpTooltip";
import styles from "../NodeInspector.module.css";
import type { ComputerUseConfig, FlowNode } from "../../../types";
import { useAgentInspectorState } from "../hooks/useAgentInspectorState";
import type { AvailableModel } from "../../../../../utils/backend";
import { useI18n } from "../../../../../i18n";
import { Field } from "../ui-components";

type ComputerUseInspectorSectionProps = {
  nodeId: string;
  computerUseConfig: ComputerUseConfig | null;
  onComputerUseConfigChange: (nodeId: string, config: ComputerUseConfig | null) => void;
  // New props for model selection
  parameters: FlowNode['data']['parameters'];
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  onAgentModelChange: (
    nodeId: string,
    selection: {
      model: string;
      providerId?: string | null;
      providerSlug?: string | null;
      store?: boolean | null;
    },
  ) => void;
  onAgentProviderChange: (
    nodeId: string,
    selection: { providerId?: string | null; providerSlug?: string | null },
  ) => void;
};

export const ComputerUseInspectorSection = ({
  nodeId,
  computerUseConfig,
  onComputerUseConfigChange,
  parameters,
  availableModels,
  availableModelsLoading,
  availableModelsError,
  onAgentModelChange,
  onAgentProviderChange,
}: ComputerUseInspectorSectionProps) => {
  const { t } = useI18n();
  const config = computerUseConfig || {
    display_width: 1024,
    display_height: 768,
    environment: "browser",
    mode: "agent",
  };

  const isSSH = config.environment === "ssh";
  const isVNC = config.environment === "vnc";
  const isAgentMode = (config.mode || "agent") === "agent";

  // State for model selection
  const {
    agentModel,
    agentProviderId,
    agentProviderSlug,
    selectedProviderValue,
    providerOptions,
    modelsForProvider,
    matchedModel,
    selectedModelOption,
  } = useAgentInspectorState({
    nodeId,
    parameters,
    token: null, // Not needed for model selection
    widgets: [], // Not needed
    widgetsLoading: false,
    widgetsError: null,
    vectorStores: [], // Not needed
    vectorStoresLoading: false,
    vectorStoresError: null,
    workflows: [], // Not needed
    currentWorkflowId: null,
    availableModels,
    isReasoningModel: () => false, // Not critical for basic selection
    onAgentImageGenerationChange: () => {}, // Not needed
  });

  const handleWidthChange = (value: string) => {
    const width = parseInt(value, 10);
    if (!isNaN(width) && width > 0) {
      onComputerUseConfigChange(nodeId, { ...config, display_width: width });
    }
  };

  const handleHeightChange = (value: string) => {
    const height = parseInt(value, 10);
    if (!isNaN(height) && height > 0) {
      onComputerUseConfigChange(nodeId, { ...config, display_height: height });
    }
  };

  const handleEnvironmentChange = (value: string) => {
    onComputerUseConfigChange(nodeId, { ...config, environment: value });
  };

  const handleModeChange = (value: string) => {
    if (value === "agent" || value === "manual") {
      onComputerUseConfigChange(nodeId, { ...config, mode: value });
    }
  };

  const handleStartUrlChange = (value: string) => {
    // Allow typing freely, don't trim during input
    if (value === "") {
      // If cleared, remove start_url from config
      const { start_url: _, ...rest } = config;
      onComputerUseConfigChange(nodeId, rest);
    } else {
      onComputerUseConfigChange(nodeId, { ...config, start_url: value });
    }
  };

  const handleSSHHostChange = (value: string) => {
    if (value === "") {
      const { ssh_host: _, ...rest } = config;
      onComputerUseConfigChange(nodeId, rest);
    } else {
      onComputerUseConfigChange(nodeId, { ...config, ssh_host: value });
    }
  };

  const handleSSHPortChange = (value: string) => {
    const port = parseInt(value, 10);
    if (value === "" || isNaN(port)) {
      const { ssh_port: _, ...rest } = config;
      onComputerUseConfigChange(nodeId, rest);
    } else if (port > 0 && port <= 65535) {
      onComputerUseConfigChange(nodeId, { ...config, ssh_port: port });
    }
  };

  const handleSSHUsernameChange = (value: string) => {
    if (value === "") {
      const { ssh_username: _, ...rest } = config;
      onComputerUseConfigChange(nodeId, rest);
    } else {
      onComputerUseConfigChange(nodeId, { ...config, ssh_username: value });
    }
  };

  const handleSSHPasswordChange = (value: string) => {
    if (value === "") {
      const { ssh_password: _, ...rest } = config;
      onComputerUseConfigChange(nodeId, rest);
    } else {
      onComputerUseConfigChange(nodeId, { ...config, ssh_password: value });
    }
  };

  const handleSSHPrivateKeyChange = (value: string) => {
    if (value === "") {
      const { ssh_private_key: _, ...rest } = config;
      onComputerUseConfigChange(nodeId, rest);
    } else {
      onComputerUseConfigChange(nodeId, { ...config, ssh_private_key: value });
    }
  };

  // VNC handlers
  const handleVNCHostChange = (value: string) => {
    if (value === "") {
      const { vnc_host: _, ...rest } = config;
      onComputerUseConfigChange(nodeId, rest);
    } else {
      onComputerUseConfigChange(nodeId, { ...config, vnc_host: value });
    }
  };

  const handleVNCPortChange = (value: string) => {
    const port = parseInt(value, 10);
    if (value === "" || isNaN(port)) {
      const { vnc_port: _, ...rest } = config;
      onComputerUseConfigChange(nodeId, rest);
    } else if (port > 0 && port <= 65535) {
      onComputerUseConfigChange(nodeId, { ...config, vnc_port: port });
    }
  };

  const handleVNCPasswordChange = (value: string) => {
    if (value === "") {
      const { vnc_password: _, ...rest } = config;
      onComputerUseConfigChange(nodeId, rest);
    } else {
      onComputerUseConfigChange(nodeId, { ...config, vnc_password: value });
    }
  };

  const handleNoVNCPortChange = (value: string) => {
    const port = parseInt(value, 10);
    if (value === "" || isNaN(port)) {
      const { novnc_port: _, ...rest } = config;
      onComputerUseConfigChange(nodeId, rest);
    } else if (port > 0 && port <= 65535) {
      onComputerUseConfigChange(nodeId, { ...config, novnc_port: port });
    }
  };

  // Model handlers
  const handleProviderChange = (value: string) => {
    if (!value) {
      onAgentProviderChange(nodeId, { providerId: null, providerSlug: null });
      return;
    }
    const option = providerOptions.find((candidate) => candidate.value === value);
    onAgentProviderChange(nodeId, {
      providerId: option?.id ?? null,
      providerSlug: option?.slug ?? null,
    });
  };

  const handleModelChange = (value: string) => {
    if (!value) {
      onAgentModelChange(nodeId, {
        model: '',
        providerId: agentProviderId || null,
        providerSlug: agentProviderSlug || null,
        store: null,
      });
      return;
    }
    try {
      const parsed = JSON.parse(value) as {
        name: string;
        providerId: string | null;
        providerSlug: string | null;
        store: boolean | null;
      };
      onAgentModelChange(nodeId, {
        model: parsed.name,
        providerId: parsed.providerId,
        providerSlug: parsed.providerSlug,
        store: parsed.store,
      });
    } catch (error) {
    }
  };

  return (
    <>
      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          Largeur de l'affichage (pixels)
          <HelpTooltip label="Largeur de l'environnement de bureau virtuel (par défaut: 1024)." />
        </span>
        <input
          type="number"
          min="1"
          value={config.display_width}
          onChange={(event) => handleWidthChange(event.target.value)}
          placeholder="1024"
        />
      </label>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          Hauteur de l'affichage (pixels)
          <HelpTooltip label="Hauteur de l'environnement de bureau virtuel (par défaut: 768)." />
        </span>
        <input
          type="number"
          min="1"
          value={config.display_height}
          onChange={(event) => handleHeightChange(event.target.value)}
          placeholder="768"
        />
      </label>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          Environnement
          <HelpTooltip label="Type d'environnement de bureau virtuel à utiliser pour l'interaction avec l'ordinateur." />
        </span>
        <select
          value={config.environment}
          onChange={(event) => handleEnvironmentChange(event.target.value)}
        >
          {COMPUTER_USE_ENVIRONMENTS.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          Mode
          <HelpTooltip label="Mode de fonctionnement: Agent (autonome) ou Manuel (contrôlé étape par étape)." />
        </span>
        <select
          value={config.mode || "agent"}
          onChange={(event) => handleModeChange(event.target.value)}
        >
          <option value="agent">Agent</option>
          <option value="manual">Manuel</option>
        </select>
      </label>

      {/* Model Selection - Only shown in Agent mode */}
      {isAgentMode && (
        <div className={styles.sectionCard} style={{ marginTop: '1rem' }}>
          <div className={styles.sectionHeader}>
            <h4 className={styles.sectionTitle}>Modèle de l'agent</h4>
            <p className={styles.sectionDescription}>
              Choisissez le modèle à utiliser pour le contrôle de l'ordinateur.
            </p>
          </div>

          <Field
            label={t('workflowBuilder.agentInspector.providerLabel')}
            hint={t('workflowBuilder.agentInspector.providerHint')}
          >
            <select
              value={selectedProviderValue}
              onChange={(event) => handleProviderChange(event.target.value)}
              disabled={availableModelsLoading}
            >
              <option value="">
                {t('workflowBuilder.agentInspector.providerPlaceholder')}
              </option>
              {providerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={t('workflowBuilder.agentInspector.modelLabel')}
            hint={t('workflowBuilder.agentInspector.modelHelp')}
          >
            <select
              value={selectedModelOption}
              onChange={(event) => handleModelChange(event.target.value)}
              disabled={availableModelsLoading}
            >
              <option value="">
                {t('workflowBuilder.agentInspector.modelPlaceholder')}
              </option>
              {modelsForProvider.map((model) => {
                const displayLabel = model.display_name?.trim()
                  ? `${model.display_name.trim()} (${model.name})`
                  : model.name;
                const reasoningSuffix = model.supports_reasoning
                  ? t('workflowBuilder.agentInspector.reasoningSuffix')
                  : '';
                const providerSuffix = model.provider_slug?.trim()
                  ? ` – ${model.provider_slug.trim()}`
                  : model.provider_id?.trim()
                    ? ` – ${model.provider_id.trim()}`
                    : '';
                return (
                  <option
                    key={`${model.id}:${model.name}`}
                    value={JSON.stringify({
                      name: model.name,
                      providerId: model.provider_id ?? null,
                      providerSlug: model.provider_slug ?? null,
                      store: model.store ?? null,
                    })}
                  >
                    {`${displayLabel}${reasoningSuffix}${providerSuffix}`}
                  </option>
                );
              })}
            </select>
          </Field>

          {availableModelsLoading ? (
            <p className={styles.mutedMessage}>
              {t('workflowBuilder.agentInspector.modelsLoading')}
            </p>
          ) : availableModelsError ? (
            <p className={styles.errorMessage}>{availableModelsError}</p>
          ) : matchedModel?.description ? (
            <p className={styles.mutedMessage}>{matchedModel.description}</p>
          ) : null}
        </div>
      )}

      {!isSSH && !isVNC && (
        <label className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            URL de démarrage (optionnel)
            <HelpTooltip label="URL à ouvrir automatiquement au démarrage de l'environnement (pour l'environnement navigateur)." />
          </span>
          <input
            type="text"
            value={config.start_url || ""}
            onChange={(event) => handleStartUrlChange(event.target.value)}
            placeholder="https://example.com"
          />
        </label>
      )}

      {isSSH && (
        <>
          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Hôte SSH
              <HelpTooltip label="Adresse IP ou nom d'hôte du serveur SSH." />
            </span>
            <input
              type="text"
              value={config.ssh_host || ""}
              onChange={(event) => handleSSHHostChange(event.target.value)}
              placeholder="192.168.1.100"
            />
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Port SSH
              <HelpTooltip label="Port du serveur SSH (par défaut: 22)." />
            </span>
            <input
              type="number"
              min="1"
              max="65535"
              value={config.ssh_port || 22}
              onChange={(event) => handleSSHPortChange(event.target.value)}
              placeholder="22"
            />
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Nom d'utilisateur
              <HelpTooltip label="Nom d'utilisateur pour la connexion SSH." />
            </span>
            <input
              type="text"
              value={config.ssh_username || ""}
              onChange={(event) => handleSSHUsernameChange(event.target.value)}
              placeholder="root"
            />
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Mot de passe (optionnel)
              <HelpTooltip label="Mot de passe pour l'authentification SSH. Laissez vide si vous utilisez une clé privée." />
            </span>
            <input
              type="password"
              value={config.ssh_password || ""}
              onChange={(event) => handleSSHPasswordChange(event.target.value)}
              placeholder="••••••••"
            />
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Clé privée SSH (optionnel)
              <HelpTooltip label="Contenu de la clé privée SSH pour l'authentification. Laissez vide si vous utilisez un mot de passe." />
            </span>
            <textarea
              value={config.ssh_private_key || ""}
              onChange={(event) => handleSSHPrivateKeyChange(event.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
              rows={4}
              style={{ fontFamily: "monospace", fontSize: "12px" }}
            />
          </label>
        </>
      )}

      {isVNC && (
        <>
          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Hote VNC
              <HelpTooltip label="Adresse IP ou nom d'hote du serveur VNC." />
            </span>
            <input
              type="text"
              value={config.vnc_host || ""}
              onChange={(event) => handleVNCHostChange(event.target.value)}
              placeholder="192.168.1.100"
            />
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Port VNC
              <HelpTooltip label="Port du serveur VNC (par defaut: 5900)." />
            </span>
            <input
              type="number"
              min="1"
              max="65535"
              value={config.vnc_port || 5900}
              onChange={(event) => handleVNCPortChange(event.target.value)}
              placeholder="5900"
            />
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Mot de passe VNC (optionnel)
              <HelpTooltip label="Mot de passe pour l'authentification VNC. Laissez vide si aucun mot de passe n'est requis." />
            </span>
            <input
              type="password"
              value={config.vnc_password || ""}
              onChange={(event) => handleVNCPasswordChange(event.target.value)}
              placeholder="••••••••"
            />
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Port noVNC
              <HelpTooltip label="Port pour l'interface web noVNC (par defaut: 6080). Ce port est utilise pour acceder au bureau distant via le navigateur." />
            </span>
            <input
              type="number"
              min="1"
              max="65535"
              value={config.novnc_port || 6080}
              onChange={(event) => handleNoVNCPortChange(event.target.value)}
              placeholder="6080"
            />
          </label>
        </>
      )}

      <p className={styles.nodeInspectorHintTextTight}>
        {isSSH
          ? isAgentMode
            ? "En mode Agent avec SSH, Claude utilisera l'outil Shell pour exécuter des commandes directement sur le serveur distant."
            : "Configure la connexion SSH pour permettre a Claude d'interagir avec un serveur distant via l'outil Computer Use."
          : isVNC
          ? "Configure la connexion VNC via noVNC pour permettre a Claude d'interagir avec un bureau distant via l'outil Computer Use."
          : "Configure l'environnement de bureau virtuel pour permettre a Claude d'interagir avec un ordinateur via l'outil Computer Use."}
      </p>
    </>
  );
};
