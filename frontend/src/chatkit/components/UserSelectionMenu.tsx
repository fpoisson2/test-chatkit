import React, { useState, useCallback } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import './UserSelectionMenu.css';

type UserTool = {
  id: string;
  enabled: boolean;
  config?: Record<string, unknown>;
};

type UserModel = {
  id: string;
  name?: string;
  enabled: boolean;
  config?: {
    temperature?: number;
    max_output_tokens?: number;
    top_p?: number;
  };
};

type UserSelectionMenuProps = {
  tools?: UserTool[];
  models?: UserModel[];
  onToolToggle?: (toolId: string, enabled: boolean) => void;
  onModelSelect?: (modelId: string) => void;
};

const TOOL_LABELS: Record<string, string> = {
  web_search: 'Recherche Web',
  file_search: 'Recherche de fichiers',
  computer_use: 'Computer Use',
  image_generation: 'Génération d'images',
  weather: 'Météo',
};

export const UserSelectionMenu: React.FC<UserSelectionMenuProps> = ({
  tools = [],
  models = [],
  onToolToggle,
  onModelSelect,
}) => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(
    new Set(tools.filter((tool) => tool.enabled).map((tool) => tool.id)),
  );
  const [selectedModelId, setSelectedModelId] = useState<string | null>(
    models.find((m) => m.enabled)?.id || (models.length > 0 ? models[0].id : null),
  );

  const handleToolToggle = useCallback(
    (toolId: string, checked: boolean) => {
      setEnabledTools((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(toolId);
        } else {
          next.delete(toolId);
        }
        return next;
      });
      onToolToggle?.(toolId, checked);
    },
    [onToolToggle],
  );

  const handleModelSelect = useCallback(
    (modelId: string) => {
      setSelectedModelId(modelId);
      onModelSelect?.(modelId);
    },
    [onModelSelect],
  );

  const hasTools = tools.length > 0;
  const hasModels = models.length > 0;
  const hasAnySelection = hasTools || hasModels;

  if (!hasAnySelection) {
    return null;
  }

  return (
    <div className="chatkit-user-selection">
      <button
        className="chatkit-user-selection-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-label="Options de conversation"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v6m0 6v6m8.66-13.66l-4.24 4.24m-4.24 4.24l-4.24 4.24M23 12h-6m-6 0H1m20.66 8.66l-4.24-4.24m-4.24-4.24l-4.24-4.24" />
        </svg>
        <span>Paramètres</span>
      </button>

      {isOpen && (
        <div className="chatkit-user-selection-menu">
          {hasTools && (
            <div className="chatkit-user-selection-section">
              <h4 className="chatkit-user-selection-title">Outils disponibles</h4>
              <div className="chatkit-user-selection-tools">
                {tools.map((tool) => (
                  <label key={tool.id} className="chatkit-user-selection-tool">
                    <input
                      type="checkbox"
                      checked={enabledTools.has(tool.id)}
                      onChange={(e) => handleToolToggle(tool.id, e.target.checked)}
                    />
                    <span>{TOOL_LABELS[tool.id] || tool.id}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {hasModels && (
            <div className="chatkit-user-selection-section">
              <h4 className="chatkit-user-selection-title">Modèle</h4>
              <div className="chatkit-user-selection-models">
                {models.map((model) => (
                  <label key={model.id} className="chatkit-user-selection-model">
                    <input
                      type="radio"
                      name="model-selection"
                      value={model.id}
                      checked={selectedModelId === model.id}
                      onChange={() => handleModelSelect(model.id)}
                    />
                    <span>{model.name || model.id}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
