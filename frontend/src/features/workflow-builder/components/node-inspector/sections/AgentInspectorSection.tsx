import { useId, useState } from "react";

import type {
  AvailableModel,
  VectorStoreSummary,
  WidgetTemplateSummary,
} from "../../../../../utils/backend";
import { collectWidgetBindings } from "../../../../../utils/widgetPreview";
import type {
  FileSearchConfig,
  FlowNode,
  ImageGenerationToolConfig,
  WebSearchConfig,
} from "../../../types";
import {
  DEFAULT_IMAGE_TOOL_CONFIG,
  DEFAULT_WEB_SEARCH_CONFIG,
  IMAGE_TOOL_BACKGROUNDS,
  IMAGE_TOOL_MODELS,
  IMAGE_TOOL_OUTPUT_FORMATS,
  IMAGE_TOOL_QUALITIES,
  IMAGE_TOOL_SIZES,
  WEB_SEARCH_LOCATION_LABELS,
  reasoningEffortOptions,
  reasoningSummaryOptions,
  textVerbosityOptions,
} from "../constants";
import { useAgentInspectorState } from "../hooks/useAgentInspectorState";
import { fieldStyle, inlineFieldStyle, labelContentStyle } from "../styles";
import { HelpTooltip } from "../components/HelpTooltip";
import { ToggleRow } from "../components/ToggleRow";

type AgentInspectorSectionProps = {
  nodeId: string;
  parameters: FlowNode["data"]["parameters"];
  token: string | null;
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  isReasoningModel: (model: string) => boolean;
  widgets: WidgetTemplateSummary[];
  widgetsLoading: boolean;
  widgetsError: string | null;
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
  onAgentMessageChange: (nodeId: string, value: string) => void;
  onAgentModelChange: (nodeId: string, value: string) => void;
  onAgentReasoningChange: (nodeId: string, value: string) => void;
  onAgentReasoningSummaryChange: (nodeId: string, value: string) => void;
  onAgentTextVerbosityChange: (nodeId: string, value: string) => void;
  onAgentTemperatureChange: (nodeId: string, value: string) => void;
  onAgentTopPChange: (nodeId: string, value: string) => void;
  onAgentMaxOutputTokensChange: (nodeId: string, value: string) => void;
  onAgentIncludeChatHistoryChange: (nodeId: string, value: boolean) => void;
  onAgentDisplayResponseInChatChange: (nodeId: string, value: boolean) => void;
  onAgentShowSearchSourcesChange: (nodeId: string, value: boolean) => void;
  onAgentContinueOnErrorChange: (nodeId: string, value: boolean) => void;
  onAgentStorePreferenceChange: (nodeId: string, value: boolean) => void;
  onAgentResponseFormatKindChange: (
    nodeId: string,
    kind: "text" | "json_schema" | "widget",
  ) => void;
  onAgentResponseFormatNameChange: (nodeId: string, value: string) => void;
  onAgentResponseFormatSchemaChange: (nodeId: string, schema: unknown) => void;
  onAgentResponseWidgetSlugChange: (nodeId: string, slug: string) => void;
  onAgentResponseWidgetSourceChange: (
    nodeId: string,
    source: "library" | "variable",
  ) => void;
  onAgentResponseWidgetDefinitionChange: (nodeId: string, expression: string) => void;
  onAgentWebSearchChange: (nodeId: string, config: WebSearchConfig | null) => void;
  onAgentFileSearchChange: (nodeId: string, config: FileSearchConfig | null) => void;
  onAgentImageGenerationChange: (
    nodeId: string,
    config: ImageGenerationToolConfig | null,
  ) => void;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWidgetValidationToolChange: (nodeId: string, enabled: boolean) => void;
};

export const AgentInspectorSection = ({
  nodeId,
  parameters,
  token,
  availableModels,
  availableModelsLoading,
  availableModelsError,
  isReasoningModel,
  widgets,
  widgetsLoading,
  widgetsError,
  vectorStores,
  vectorStoresLoading,
  vectorStoresError,
  onAgentMessageChange,
  onAgentModelChange,
  onAgentReasoningChange,
  onAgentReasoningSummaryChange,
  onAgentTextVerbosityChange,
  onAgentTemperatureChange,
  onAgentTopPChange,
  onAgentMaxOutputTokensChange,
  onAgentIncludeChatHistoryChange,
  onAgentDisplayResponseInChatChange,
  onAgentShowSearchSourcesChange,
  onAgentContinueOnErrorChange,
  onAgentStorePreferenceChange,
  onAgentResponseFormatKindChange,
  onAgentResponseFormatNameChange,
  onAgentResponseFormatSchemaChange,
  onAgentResponseWidgetSlugChange,
  onAgentResponseWidgetSourceChange,
  onAgentResponseWidgetDefinitionChange,
  onAgentWebSearchChange,
  onAgentFileSearchChange,
  onAgentImageGenerationChange,
  onAgentWeatherToolChange,
  onAgentWidgetValidationToolChange,
}: AgentInspectorSectionProps) => {
  const {
    agentMessage,
    agentModel,
    reasoningEffort,
    reasoningSummaryValue,
    textVerbosityValue,
    responseFormat,
    temperatureValue,
    topPValue,
    maxOutputTokensValue,
    includeChatHistory,
    displayResponseInChat,
    showSearchSources,
    continueOnError,
    storeResponses,
    webSearchConfig,
    webSearchEnabled,
    fileSearchConfig,
    fileSearchEnabled,
    fileSearchValidationMessage,
    imageGenerationConfig,
    imageGenerationEnabled,
    imageModelValue,
    imageSizeValue,
    imageQualityValue,
    imageBackgroundValue,
    imageOutputFormatValue,
    updateImageTool,
    weatherFunctionEnabled,
    widgetValidationFunctionEnabled,
    selectedVectorStoreSlug,
    matchedModel,
    selectedModelOption,
    supportsReasoning,
    schemaText,
    setSchemaText,
    schemaError,
    setSchemaError,
    responseWidgetSource,
    responseWidgetSlug,
    trimmedWidgetSlug,
    responseWidgetDefinitionExpression,
    widgetSelectValue,
    widgetValidationMessage,
    responseWidgetDefinition,
    responseWidgetDefinitionLoading,
    responseWidgetDefinitionError,
  } = useAgentInspectorState({
    nodeId,
    parameters,
    token,
    widgets,
    widgetsLoading,
    widgetsError,
    vectorStores,
    vectorStoresLoading,
    vectorStoresError,
    availableModels,
    isReasoningModel,
    onAgentImageGenerationChange,
  });

  const widgetSelectId = useId();

  return (
    <>
      <label style={fieldStyle}>
        <span>Message système</span>
        <textarea
          value={agentMessage}
          rows={5}
          placeholder="Texte transmis à l'agent pour définir son rôle"
          onChange={(event) => onAgentMessageChange(nodeId, event.target.value)}
        />
      </label>

      <label style={inlineFieldStyle}>
        <span style={labelContentStyle}>
          Modèle OpenAI
          <HelpTooltip label="Sélectionnez un modèle autorisé pour exécuter ce bloc." />
        </span>
        <select
          value={selectedModelOption}
          onChange={(event) => onAgentModelChange(nodeId, event.target.value)}
          disabled={availableModelsLoading}
        >
          <option value="">Sélectionnez un modèle</option>
          {availableModels.map((model) => (
            <option key={model.id} value={model.name}>
              {model.display_name?.trim() ? `${model.display_name} (${model.name})` : model.name}
              {model.supports_reasoning ? " – raisonnement" : ""}
            </option>
          ))}
        </select>
      </label>

      {agentModel.trim() && !matchedModel && !availableModelsLoading ? (
        <p style={{ color: "#b91c1c", margin: "0.5rem 0 0" }}>
          Ce bloc utilise actuellement un modèle non listé ({agentModel}). Sélectionnez un modèle dans la liste ci-dessus.
        </p>
      ) : null}

      {availableModelsLoading ? (
        <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0" }}>
          Chargement des modèles autorisés…
        </p>
      ) : availableModelsError ? (
        <p style={{ color: "#b91c1c", margin: "0.5rem 0 0" }}>{availableModelsError}</p>
      ) : matchedModel?.description ? (
        <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0" }}>{matchedModel.description}</p>
      ) : null}

      {supportsReasoning ? (
        <>
          <label style={inlineFieldStyle}>
            <span style={labelContentStyle}>
              Niveau de raisonnement
              <HelpTooltip label="Ajuste la profondeur d'analyse du modèle (laisser vide pour utiliser la valeur par défaut)." />
            </span>
            <select
              value={reasoningEffort}
              onChange={(event) => onAgentReasoningChange(nodeId, event.target.value)}
            >
              {reasoningEffortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label style={inlineFieldStyle}>
            <span style={labelContentStyle}>
              Verbosité de la réponse
              <HelpTooltip label="Contrôle la quantité de texte renvoyée par le modèle (laisser vide pour appliquer le paramétrage par défaut)." />
            </span>
            <select
              value={textVerbosityValue}
              onChange={(event) => onAgentTextVerbosityChange(nodeId, event.target.value)}
            >
              {textVerbosityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label style={inlineFieldStyle}>
            <span style={labelContentStyle}>
              Résumé des étapes
              <HelpTooltip label="Détermine si l'agent doit générer un résumé automatique de son raisonnement." />
            </span>
            <select
              value={reasoningSummaryValue}
              onChange={(event) => onAgentReasoningSummaryChange(nodeId, event.target.value)}
            >
              {reasoningSummaryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <label style={fieldStyle}>
            <span style={labelContentStyle}>
              Température
              <HelpTooltip label="Ajuste la créativité des réponses pour les modèles sans raisonnement." />
            </span>
            <input
              type="number"
              min="0"
              max="2"
              step="0.01"
              value={temperatureValue}
              placeholder="Ex. 0.7"
              onChange={(event) => onAgentTemperatureChange(nodeId, event.target.value)}
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelContentStyle}>
              Top-p
              <HelpTooltip label="Détermine la diversité lexicale en limitant la probabilité cumulée." />
            </span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={topPValue}
              placeholder="Ex. 0.9"
              onChange={(event) => onAgentTopPChange(nodeId, event.target.value)}
            />
          </label>
        </>
      )}

      <label style={fieldStyle}>
        <span style={labelContentStyle}>
          Nombre maximal de tokens générés
          <HelpTooltip label="Limite la longueur maximale des réponses produites par cet agent." />
        </span>
        <input
          type="number"
          min="1"
          step="1"
          value={maxOutputTokensValue}
          placeholder="Laisser vide pour la valeur par défaut"
          onChange={(event) => onAgentMaxOutputTokensChange(nodeId, event.target.value)}
        />
      </label>

      <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
        <ToggleRow
          label="Inclure l'historique du chat"
          checked={includeChatHistory}
          onChange={(next) => onAgentIncludeChatHistoryChange(nodeId, next)}
        />
        <ToggleRow
          label="Afficher la réponse dans le chat"
          checked={displayResponseInChat}
          onChange={(next) => onAgentDisplayResponseInChatChange(nodeId, next)}
        />
        <ToggleRow
          label="Afficher les sources de recherche"
          checked={showSearchSources}
          onChange={(next) => onAgentShowSearchSourcesChange(nodeId, next)}
        />
        <ToggleRow
          label="Continuer l'exécution en cas d'erreur"
          checked={continueOnError}
          onChange={(next) => onAgentContinueOnErrorChange(nodeId, next)}
        />
        <ToggleRow
          label="Enregistrer la réponse dans l'historique de conversation"
          checked={storeResponses}
          onChange={(next) => onAgentStorePreferenceChange(nodeId, next)}
        />
      </div>

      <label style={inlineFieldStyle}>
        <span style={labelContentStyle}>
          Type de sortie
          <HelpTooltip label="Choisissez le format attendu pour la réponse de l'agent." />
        </span>
        <select
          value={responseFormat.kind}
          onChange={(event) => {
            const nextKind = event.target.value as "text" | "json_schema" | "widget";
            onAgentResponseFormatKindChange(nodeId, nextKind);
          }}
        >
          <option value="text">Texte libre</option>
          <option value="json_schema">Schéma JSON</option>
          <option value="widget">Widget de la bibliothèque</option>
        </select>
      </label>

      {responseFormat.kind === "json_schema" ? (
        <>
          <label style={fieldStyle}>
            <span>Nom du schéma JSON</span>
            <input
              type="text"
              value={responseFormat.name}
              onChange={(event) => onAgentResponseFormatNameChange(nodeId, event.target.value)}
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelContentStyle}>
              Définition du schéma JSON
              <HelpTooltip label="Fournissez un schéma JSON valide (Draft 2020-12) pour contraindre la sortie." />
            </span>
            <textarea
              value={schemaText}
              rows={8}
              onChange={(event) => {
                const value = event.target.value;
                setSchemaText(value);
                try {
                  const parsed = JSON.parse(value);
                  setSchemaError(null);
                  onAgentResponseFormatSchemaChange(nodeId, parsed);
                } catch (error) {
                  setSchemaError(error instanceof Error ? error.message : "Schéma JSON invalide");
                }
              }}
              style={schemaError ? { borderColor: "#b91c1c" } : undefined}
            />
            {schemaError ? (
              <span style={{ color: "#b91c1c", fontSize: "0.85rem" }}>{schemaError}</span>
            ) : null}
          </label>
        </>
      ) : null}

      {responseFormat.kind === "widget" ? (
        <>
          <label style={fieldStyle}>
            <span style={labelContentStyle}>
              Source du widget
              <HelpTooltip label="Choisissez entre un widget enregistré ou un JSON fourni par une variable du workflow." />
            </span>
            <select
              value={responseWidgetSource}
              onChange={(event) =>
                onAgentResponseWidgetSourceChange(nodeId, event.target.value as "library" | "variable")
              }
            >
              <option value="library">Bibliothèque de widgets</option>
              <option value="variable">Expression JSON (variable)</option>
            </select>
          </label>

          {responseWidgetSource === "library" ? (
            <>
              <label style={fieldStyle}>
                <span style={labelContentStyle}>
                  Widget de sortie
                  <HelpTooltip label="Sélectionnez un widget de la bibliothèque pour diffuser la réponse." />
                </span>
                <select
                  value={widgetSelectValue}
                  onChange={(event) => onAgentResponseWidgetSlugChange(nodeId, event.target.value)}
                  aria-describedby={widgetValidationMessage ? `${widgetSelectId}-message` : undefined}
                >
                  <option value="">Sélectionnez un widget</option>
                  {widgets.map((widget) => (
                    <option key={widget.slug} value={widget.slug}>
                      {widget.title?.trim() ? `${widget.title} (${widget.slug})` : widget.slug}
                    </option>
                  ))}
                </select>
              </label>

              {widgetsLoading ? (
                <p style={{ color: "var(--text-muted)", margin: 0 }}>Chargement de la bibliothèque de widgets…</p>
              ) : widgetsError ? (
                <p style={{ color: "#b91c1c", margin: 0 }}>
                  {widgetsError}
                  <br />
                  Vous pouvez saisir le slug du widget manuellement ci-dessus.
                </p>
              ) : widgets.length === 0 ? (
                <p style={{ color: "var(--text-muted)", margin: 0 }}>
                  Créez un widget dans la bibliothèque dédiée pour l'utiliser ici.
                </p>
              ) : null}

              {widgetValidationMessage ? (
                <p id={`${widgetSelectId}-message`} style={{ color: "#b91c1c", margin: "0.25rem 0 0" }}>
                  {widgetValidationMessage}
                </p>
              ) : null}

              {responseWidgetSlug && !widgetsLoading && widgetsError ? (
                <p style={{ color: "var(--text-muted)", margin: "0.25rem 0 0" }}>
                  Le widget sélectionné ({responseWidgetSlug}) sera conservé tant que la bibliothèque n'est pas disponible.
                </p>
              ) : null}

              {trimmedWidgetSlug && !widgetsLoading && !widgetsError ? (
                <WidgetJsonFormatInfo
                  definition={responseWidgetDefinition}
                  loading={responseWidgetDefinitionLoading}
                  error={responseWidgetDefinitionError}
                />
              ) : null}
            </>
          ) : (
            <>
              <label style={fieldStyle}>
                <span style={labelContentStyle}>
                  Expression JSON du widget
                  <HelpTooltip label="Saisissez une expression (ex. state.widget_json) qui renvoie la définition JSON complète du widget." />
                </span>
                <input
                  type="text"
                  value={responseWidgetDefinitionExpression}
                  onChange={(event) =>
                    onAgentResponseWidgetDefinitionChange(nodeId, event.target.value)
                  }
                  placeholder="Ex. state.widget_json"
                />
              </label>
              <p style={{ color: "var(--text-muted)", margin: "-0.35rem 0 0.35rem" }}>
                La valeur doit être un objet JSON valide conforme aux spécifications ChatKit Widget.
              </p>
              {widgetValidationMessage ? (
                <p id={`${widgetSelectId}-message`} style={{ color: "#b91c1c", margin: "0.25rem 0 0" }}>
                  {widgetValidationMessage}
                </p>
              ) : null}
            </>
          )}
        </>
      ) : null}

      <div
        style={{
          border: "1px solid rgba(15, 23, 42, 0.12)",
          borderRadius: "0.75rem",
          padding: "0.75rem",
          display: "grid",
          gap: "0.75rem",
          marginTop: "1rem",
        }}
      >
        <strong style={{ fontSize: "0.95rem" }}>Outils</strong>
        <ToggleRow
          label="Activer la recherche web"
          checked={webSearchEnabled}
          onChange={(next) =>
            onAgentWebSearchChange(
              nodeId,
              next ? webSearchConfig ?? { ...DEFAULT_WEB_SEARCH_CONFIG } : null,
            )
          }
        />
        {webSearchEnabled ? (
          <>
            <label style={inlineFieldStyle}>
              <span style={labelContentStyle}>
                Portée de la recherche
                <HelpTooltip label="Définit la quantité de contexte web récupérée pour l'agent." />
              </span>
              <select
                value={webSearchConfig?.search_context_size ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  const nextConfig: WebSearchConfig = { ...(webSearchConfig ?? {}) };
                  if (value) {
                    nextConfig.search_context_size = value;
                  } else {
                    delete nextConfig.search_context_size;
                  }
                  onAgentWebSearchChange(nodeId, nextConfig);
                }}
              >
                <option value="">(par défaut)</option>
                <option value="low">Petit contexte</option>
                <option value="medium">Contexte moyen</option>
                <option value="high">Grand contexte</option>
              </select>
            </label>

            <div style={{ display: "grid", gap: "0.5rem" }}>
              <span style={{ fontWeight: 600 }}>Localisation utilisateur</span>
              {Object.entries(WEB_SEARCH_LOCATION_LABELS).map(([key, label]) => {
                const typedKey = key as keyof typeof WEB_SEARCH_LOCATION_LABELS;
                const currentValue = (webSearchConfig?.user_location?.[typedKey] as string | undefined) ?? "";
                return (
                  <label key={key} style={fieldStyle}>
                    <span>{label}</span>
                    <input
                      type="text"
                      value={currentValue}
                      onChange={(event) => {
                        const value = event.target.value;
                        const nextLocation = {
                          ...(webSearchConfig?.user_location ?? {}),
                        } as Record<string, string>;
                        if (value.trim()) {
                          nextLocation[typedKey] = value;
                        } else {
                          delete nextLocation[typedKey];
                        }
                        const nextConfig: WebSearchConfig = { ...(webSearchConfig ?? {}) };
                        if (Object.keys(nextLocation).length > 0) {
                          nextConfig.user_location = nextLocation;
                        } else {
                          delete nextConfig.user_location;
                        }
                        onAgentWebSearchChange(nodeId, nextConfig);
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </>
        ) : null}

        <ToggleRow
          label="Activer la recherche documentaire"
          checked={fileSearchEnabled}
          onChange={(next) => {
            if (next) {
              const preferredSlug =
                (fileSearchConfig?.vector_store_slug?.trim() ?? "") || vectorStores[0]?.slug || "";
              onAgentFileSearchChange(nodeId, {
                vector_store_slug: preferredSlug,
              });
            } else {
              onAgentFileSearchChange(nodeId, null);
            }
          }}
        />

        {vectorStoresError ? (
          <p style={{ color: "#b91c1c", margin: 0 }}>{vectorStoresError}</p>
        ) : null}

        {fileSearchEnabled ? (
          <>
            {vectorStoresLoading ? (
              <p style={{ color: "var(--text-muted)", margin: 0 }}>Chargement des vector stores…</p>
            ) : vectorStores.length === 0 ? (
              <p style={{ color: "var(--text-muted)", margin: 0 }}>
                Aucun vector store disponible. Créez-en un depuis l'onglet « Vector stores JSON ».
              </p>
            ) : (
              <label style={inlineFieldStyle}>
                <span style={labelContentStyle}>
                  Vector store à interroger
                  <HelpTooltip label="Le document complet du résultat sera transmis à l'agent." />
                </span>
                <select
                  value={selectedVectorStoreSlug}
                  onChange={(event) =>
                    onAgentFileSearchChange(nodeId, {
                      vector_store_slug: event.target.value,
                    })
                  }
                >
                  <option value="">Sélectionnez un vector store…</option>
                  {vectorStores.map((store) => (
                    <option key={store.slug} value={store.slug}>
                      {store.title?.trim() ? `${store.title} (${store.slug})` : store.slug}
                    </option>
                  ))}
                </select>
                {fileSearchValidationMessage ? (
                  <p style={{ color: "#b91c1c", margin: 0 }}>{fileSearchValidationMessage}</p>
                ) : null}
              </label>
            )}
          </>
        ) : null}

        <ToggleRow
          label="Activer la génération d'image"
          checked={imageGenerationEnabled}
          onChange={(next) =>
            onAgentImageGenerationChange(
              nodeId,
              next ? { ...DEFAULT_IMAGE_TOOL_CONFIG } : null,
            )
          }
          help="Ajoute l'outil image_generation pour produire des visuels via l'API OpenAI."
        />

        {imageGenerationEnabled ? (
          <div
            style={{
              display: "grid",
              gap: "0.75rem",
              border: "1px solid rgba(148, 163, 184, 0.35)",
              borderRadius: "0.65rem",
              padding: "0.75rem",
              backgroundColor: "rgba(226, 232, 240, 0.25)",
            }}
          >
            <label style={inlineFieldStyle}>
              <span style={labelContentStyle}>
                Modèle de génération
                <HelpTooltip label="Sélectionnez le modèle image supporté par l'API OpenAI." />
              </span>
              <select
                value={imageModelValue}
                onChange={(event) =>
                  updateImageTool({ model: event.target.value || DEFAULT_IMAGE_TOOL_CONFIG.model })
                }
              >
                {IMAGE_TOOL_MODELS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={inlineFieldStyle}>
              <span style={labelContentStyle}>
                Taille de sortie
                <HelpTooltip label="Définit la résolution retournée par l'API." />
              </span>
              <select
                value={imageSizeValue}
                onChange={(event) =>
                  updateImageTool({ size: event.target.value || undefined })
                }
              >
                <option value="">(par défaut)</option>
                {IMAGE_TOOL_SIZES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={inlineFieldStyle}>
              <span style={labelContentStyle}>
                Qualité de rendu
                <HelpTooltip label="Ajuste la fidélité des images générées." />
              </span>
              <select
                value={imageQualityValue}
                onChange={(event) =>
                  updateImageTool({ quality: event.target.value || undefined })
                }
              >
                <option value="">(par défaut)</option>
                {IMAGE_TOOL_QUALITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={inlineFieldStyle}>
              <span style={labelContentStyle}>
                Arrière-plan
                <HelpTooltip label="Choisissez la transparence de l'image finale." />
              </span>
              <select
                value={imageBackgroundValue}
                onChange={(event) =>
                  updateImageTool({ background: event.target.value || undefined })
                }
              >
                <option value="">(par défaut)</option>
                {IMAGE_TOOL_BACKGROUNDS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={inlineFieldStyle}>
              <span style={labelContentStyle}>
                Format de sortie
                <HelpTooltip label="Détermine le format MIME restitué par l'outil." />
              </span>
              <select
                value={imageOutputFormatValue}
                onChange={(event) =>
                  updateImageTool({ output_format: event.target.value || undefined })
                }
              >
                <option value="">(par défaut)</option>
                {IMAGE_TOOL_OUTPUT_FORMATS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div
          style={{
            border: "1px solid rgba(148, 163, 184, 0.35)",
            borderRadius: "0.65rem",
            padding: "0.75rem",
            display: "grid",
            gap: "0.5rem",
            backgroundColor: "rgba(226, 232, 240, 0.25)",
          }}
        >
          <strong style={{ fontSize: "0.9rem" }}>Function tool</strong>
          <ToggleRow
            label="Autoriser la fonction météo Python"
            checked={weatherFunctionEnabled}
            onChange={(next) => onAgentWeatherToolChange(nodeId, next)}
            help="Ajoute l'outil fetch_weather pour récupérer la météo via le backend."
          />
          <ToggleRow
            label="Autoriser la fonction de validation de widget"
            checked={widgetValidationFunctionEnabled}
            onChange={(next) => onAgentWidgetValidationToolChange(nodeId, next)}
            help="Ajoute l'outil validate_widget pour vérifier une définition de widget ChatKit."
          />
        </div>
      </div>
    </>
  );
};

type WidgetJsonFormatInfoProps = {
  definition: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
};

const WidgetJsonFormatInfo = ({ definition, loading, error }: WidgetJsonFormatInfoProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (loading) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
        Chargement du format JSON…
      </div>
    );
  }

  if (error || !definition) {
    return null;
  }

  const bindings = collectWidgetBindings(definition);
  const bindingKeys = Object.keys(bindings);

  if (bindingKeys.length === 0) {
    return (
      <div
        style={{
          backgroundColor: "var(--bg-surface-secondary, #f8fafc)",
          border: "1px solid var(--border-secondary, #e2e8f0)",
          borderRadius: "0.5rem",
          padding: "0.75rem",
          marginTop: "0.5rem",
          fontSize: "0.85rem",
        }}
      >
        <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
          Ce widget n'a pas de champs dynamiques configurables.
        </div>
      </div>
    );
  }

  const jsonExample: Record<string, string> = {};
  bindingKeys.forEach((key) => {
    const sanitizedKey = key.replace(/[^0-9a-zA-Z_]+/g, "_").replace(/^_+|_+$/g, "");
    if (sanitizedKey) {
      jsonExample[sanitizedKey] = `"valeur pour ${key}"`;
    }
  });

  const jsonString = JSON.stringify(jsonExample, null, 2).replace(
    /"valeur pour ([^"]+)"/g,
    '"valeur pour $1"',
  );

  return (
    <div
      style={{
        backgroundColor: "var(--bg-surface-secondary, #f8fafc)",
        border: "1px solid var(--border-secondary, #e2e8f0)",
        borderRadius: "0.5rem",
        padding: "0.75rem",
        marginTop: "0.5rem",
      }}
    >
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontSize: "0.85rem",
          fontWeight: 500,
          color: "var(--text-primary, #0f172a)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span
            style={{
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
              display: "inline-block",
            }}
          >
            ▶
          </span>
          Format JSON attendu
        </span>
        <span
          style={{
            backgroundColor: "var(--bg-primary, #3b82f6)",
            color: "white",
            fontSize: "0.75rem",
            padding: "0.125rem 0.375rem",
            borderRadius: "0.25rem",
            fontWeight: 600,
          }}
        >
          {bindingKeys.length}
        </span>
      </button>

      {isExpanded ? (
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            Champs dynamiques disponibles :
          </div>
          <ul
            style={{
              margin: "0 0 0.75rem 0",
              paddingLeft: "1.5rem",
              fontSize: "0.85rem",
              color: "var(--text-secondary, #475569)",
            }}
          >
            {bindingKeys.sort().map((key) => {
              const sanitizedKey = key.replace(/[^0-9a-zA-Z_]+/g, "_").replace(/^_+|_+$/g, "");
              return (
                <li key={key} style={{ marginBottom: "0.25rem" }}>
                  <code
                    style={{
                      backgroundColor: "var(--bg-code, #f1f5f9)",
                      padding: "0.125rem 0.375rem",
                      borderRadius: "0.25rem",
                      fontSize: "0.8rem",
                      fontFamily: "monospace",
                    }}
                  >
                    {sanitizedKey}
                  </code>
                  {sanitizedKey !== key ? (
                    <span
                      style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginLeft: "0.25rem" }}
                    >
                      (pour {key})
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            Exemple de JSON à générer par l'agent :
          </div>
          <pre
            style={{
              backgroundColor: "var(--bg-code, #1e293b)",
              color: "var(--text-code, #e2e8f0)",
              padding: "0.75rem",
              borderRadius: "0.375rem",
              fontSize: "0.8rem",
              fontFamily: "monospace",
              overflowX: "auto",
              margin: 0,
            }}
          >
            {jsonString}
          </pre>
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginTop: "0.5rem",
              fontStyle: "italic",
            }}
          >
            Note : Les clés avec des caractères spéciaux sont normalisées (points remplacés par underscores).
          </div>
        </div>
      ) : null}
    </div>
  );
};
