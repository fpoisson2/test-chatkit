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

      <p className={styles.nodeInspectorHintTextTight}>
        Configure l'environnement de bureau virtuel pour permettre à Claude d'interagir avec
        un ordinateur via l'outil Computer Use.
      </p>
    </>
  );
};
