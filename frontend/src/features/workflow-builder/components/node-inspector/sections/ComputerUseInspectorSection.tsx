import { COMPUTER_USE_ENVIRONMENTS } from "../constants";
import { HelpTooltip } from "../components/HelpTooltip";
import styles from "../NodeInspector.module.css";
import type { ComputerUseConfig } from "../../../types";

type ComputerUseInspectorSectionProps = {
  nodeId: string;
  computerUseConfig: ComputerUseConfig | null;
  onComputerUseConfigChange: (nodeId: string, config: ComputerUseConfig | null) => void;
};

export const ComputerUseInspectorSection = ({
  nodeId,
  computerUseConfig,
  onComputerUseConfigChange,
}: ComputerUseInspectorSectionProps) => {
  const config = computerUseConfig || {
    display_width: 1024,
    display_height: 768,
    environment: "browser",
  };

  const isSSH = config.environment === "ssh";

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

      {!isSSH && (
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

      <p className={styles.nodeInspectorHintTextTight}>
        {isSSH
          ? "Configure la connexion SSH pour permettre à Claude d'interagir avec un serveur distant via l'outil Computer Use."
          : "Configure l'environnement de bureau virtuel pour permettre à Claude d'interagir avec un ordinateur via l'outil Computer Use."}
      </p>
    </>
  );
};
