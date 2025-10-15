import { useEffect, useMemo, useState, type CSSProperties } from "react";

import type {
  AvailableModel,
  VectorStoreSummary,
  WidgetTemplate,
} from "../../../utils/backend";
import {
  getAgentContinueOnError,
  getAgentDisplayResponseInChat,
  getAgentFileSearchConfig,
  getAgentIncludeChatHistory,
  getAgentMaxOutputTokens,
  getAgentMessage,
  getAgentModel,
  getAgentReasoningEffort,
  getAgentReasoningSummary,
  getAgentReasoningVerbosity,
  getAgentResponseFormat,
  getAgentShowSearchSources,
  getAgentStorePreference,
  getAgentTemperature,
  getAgentTopP,
  getAgentWeatherToolEnabled,
  getAgentWebSearchConfig,
  getStateAssignments,
} from "../../../utils/workflows";
import type {
  FileSearchConfig,
  FlowNode,
  StateAssignment,
  StateAssignmentScope,
  WebSearchConfig,
} from "../types";
import { labelForKind } from "../utils";

const reasoningEffortOptions = [
  { value: "", label: "Comportement par défaut" },
  { value: "minimal", label: "Effort minimal" },
  { value: "medium", label: "Effort moyen" },
  { value: "high", label: "Effort élevé" },
];

const reasoningVerbosityOptions = [
  { value: "", label: "Verbosité par défaut" },
  { value: "low", label: "Verbosité faible" },
  { value: "medium", label: "Verbosité moyenne" },
  { value: "high", label: "Verbosité élevée" },
];

const reasoningSummaryOptions = [
  { value: "none", label: "Pas de résumé" },
  { value: "auto", label: "Résumé automatique" },
  { value: "detailed", label: "Résumé détaillé" },
];

const DEFAULT_JSON_SCHEMA_OBJECT = { type: "object", properties: {} } as const;
const DEFAULT_JSON_SCHEMA_TEXT = JSON.stringify(DEFAULT_JSON_SCHEMA_OBJECT, null, 2);
const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = { search_context_size: "medium" };
const WEB_SEARCH_LOCATION_LABELS = {
  city: "Ville",
  region: "Région",
  country: "Pays",
  type: "Type de précision",
} as const;

export type NodeInspectorProps = {
  node: FlowNode;
  onToggle: (nodeId: string) => void;
  onDisplayNameChange: (nodeId: string, value: string) => void;
  onAgentMessageChange: (nodeId: string, value: string) => void;
  onAgentModelChange: (nodeId: string, value: string) => void;
  onAgentReasoningChange: (nodeId: string, value: string) => void;
  onAgentReasoningVerbosityChange: (nodeId: string, value: string) => void;
  onAgentReasoningSummaryChange: (nodeId: string, value: string) => void;
  onAgentTemperatureChange: (nodeId: string, value: string) => void;
  onAgentTopPChange: (nodeId: string, value: string) => void;
  onAgentMaxOutputTokensChange: (nodeId: string, value: string) => void;
  onAgentResponseFormatKindChange: (nodeId: string, kind: "text" | "json_schema" | "widget") => void;
  onAgentResponseFormatNameChange: (nodeId: string, value: string) => void;
  onAgentResponseFormatSchemaChange: (nodeId: string, schema: unknown) => void;
  onAgentResponseWidgetSlugChange: (nodeId: string, slug: string) => void;
  onAgentIncludeChatHistoryChange: (nodeId: string, value: boolean) => void;
  onAgentDisplayResponseInChatChange: (nodeId: string, value: boolean) => void;
  onAgentShowSearchSourcesChange: (nodeId: string, value: boolean) => void;
  onAgentContinueOnErrorChange: (nodeId: string, value: boolean) => void;
  onAgentStorePreferenceChange: (nodeId: string, value: boolean) => void;
  onAgentWebSearchChange: (nodeId: string, config: WebSearchConfig | null) => void;
  onAgentFileSearchChange: (nodeId: string, config: FileSearchConfig | null) => void;
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  isReasoningModel: (model: string) => boolean;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
  widgets: WidgetTemplate[];
  widgetsLoading: boolean;
  widgetsError: string | null;
  onStateAssignmentsChange: (
    nodeId: string,
    scope: StateAssignmentScope,
    assignments: StateAssignment[],
  ) => void;
  onParametersChange: (nodeId: string, value: string) => void;
  onRemove: (nodeId: string) => void;
};

const NodeInspector = ({
  node,
  onToggle,
  onDisplayNameChange,
  onAgentMessageChange,
  onAgentModelChange,
  onAgentReasoningChange,
  onAgentReasoningVerbosityChange,
  onAgentReasoningSummaryChange,
  onAgentTemperatureChange,
  onAgentTopPChange,
  onAgentMaxOutputTokensChange,
  onAgentResponseFormatKindChange,
  onAgentResponseFormatNameChange,
  onAgentResponseFormatSchemaChange,
  onAgentResponseWidgetSlugChange,
  onAgentIncludeChatHistoryChange,
  onAgentDisplayResponseInChatChange,
  onAgentShowSearchSourcesChange,
  onAgentContinueOnErrorChange,
  onAgentStorePreferenceChange,
  onAgentWebSearchChange,
  onAgentFileSearchChange,
  availableModels,
  availableModelsLoading,
  availableModelsError,
  isReasoningModel,
  onAgentWeatherToolChange,
  vectorStores,
  vectorStoresLoading,
  vectorStoresError,
  widgets,
  widgetsLoading,
  widgetsError,
  onStateAssignmentsChange,
  onParametersChange,
  onRemove,
}: NodeInspectorProps) => {
  const { kind, displayName, isEnabled, parameters, parametersText, parametersError } =
    node.data;
  const isFixed = kind === "start" || kind === "end";
  const agentMessage = getAgentMessage(parameters);
  const agentModel = getAgentModel(parameters);
  const reasoningEffort = getAgentReasoningEffort(parameters);
  const responseFormat = getAgentResponseFormat(parameters);
  const temperature = getAgentTemperature(parameters);
  const topP = getAgentTopP(parameters);
  const reasoningVerbosity = getAgentReasoningVerbosity(parameters);
  const rawReasoningSummary = getAgentReasoningSummary(parameters);
  const reasoningSummaryValue = rawReasoningSummary.trim() ? rawReasoningSummary : "none";
  const maxOutputTokens = getAgentMaxOutputTokens(parameters);
  const maxOutputTokensValue =
    typeof maxOutputTokens === "number" ? String(maxOutputTokens) : "";
  const includeChatHistory = getAgentIncludeChatHistory(parameters);
  const displayResponseInChat = getAgentDisplayResponseInChat(parameters);
  const showSearchSources = getAgentShowSearchSources(parameters);
  const continueOnError = getAgentContinueOnError(parameters);
  const storeResponses = getAgentStorePreference(parameters);
  const webSearchConfig = getAgentWebSearchConfig(parameters);
  const webSearchEnabled = Boolean(webSearchConfig);
  const fileSearchConfig = getAgentFileSearchConfig(parameters);
  const fileSearchEnabled = Boolean(fileSearchConfig);
  const weatherFunctionEnabled = getAgentWeatherToolEnabled(parameters);
  const selectedVectorStoreSlug = fileSearchConfig?.vector_store_slug ?? "";
  const trimmedVectorStoreSlug = selectedVectorStoreSlug.trim();
  const selectedVectorStoreExists =
    trimmedVectorStoreSlug.length > 0 && vectorStores.some((store) => store.slug === trimmedVectorStoreSlug);
  const fileSearchMissingVectorStore =
    fileSearchEnabled &&
    (!trimmedVectorStoreSlug || (!vectorStoresError && vectorStores.length > 0 && !selectedVectorStoreExists));
  const responseWidgetSlug = responseFormat.kind === "widget" ? responseFormat.slug : "";
  const trimmedWidgetSlug = responseWidgetSlug.trim();
  const selectedWidget = useMemo(() => {
    if (responseFormat.kind !== "widget") {
      return null;
    }
    if (!trimmedWidgetSlug) {
      return null;
    }
    return widgets.find((widget) => widget.slug === trimmedWidgetSlug) ?? null;
  }, [responseFormat.kind, trimmedWidgetSlug, widgets]);
  const selectedWidgetExists =
    responseFormat.kind === "widget" && trimmedWidgetSlug.length > 0 && Boolean(selectedWidget);
  let fileSearchValidationMessage: string | null = null;
  if (fileSearchMissingVectorStore && !vectorStoresLoading) {
    if (!vectorStoresError && vectorStores.length === 0) {
      fileSearchValidationMessage =
        "Créez un vector store avant d'activer la recherche documentaire.";
    } else if (trimmedVectorStoreSlug && !selectedVectorStoreExists) {
      fileSearchValidationMessage =
        "Le vector store sélectionné n'est plus disponible. Choisissez-en un autre.";
    } else {
      fileSearchValidationMessage =
        "Sélectionnez un vector store pour activer la recherche documentaire.";
    }
  }
  let widgetValidationMessage: string | null = null;
  if (responseFormat.kind === "widget" && !widgetsLoading && !widgetsError && widgets.length > 0) {
    if (!trimmedWidgetSlug) {
      widgetValidationMessage = "Sélectionnez un widget de sortie.";
    } else if (!selectedWidgetExists) {
      widgetValidationMessage = "Le widget sélectionné n'est plus disponible. Choisissez-en un autre.";
    }
  }
  const matchedModel = availableModels.find((model) => model.name === agentModel);
  const selectedModelOption = matchedModel ? matchedModel.name : "";
  const supportsReasoning = isReasoningModel(agentModel);
  const temperatureValue = typeof temperature === "number" ? String(temperature) : "";
  const topPValue = typeof topP === "number" ? String(topP) : "";
  const globalAssignments = useMemo(
    () => getStateAssignments(parameters, "globals"),
    [parameters],
  );
  const stateAssignments = useMemo(
    () => getStateAssignments(parameters, "state"),
    [parameters],
  );
  const [schemaText, setSchemaText] = useState(() =>
    responseFormat.kind === "json_schema"
      ? JSON.stringify(responseFormat.schema ?? {}, null, 2)
      : DEFAULT_JSON_SCHEMA_TEXT,
  );
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const schemaSignature =
    responseFormat.kind === "json_schema"
      ? JSON.stringify(responseFormat.schema ?? {})
      : "";
  useEffect(() => {
    if (responseFormat.kind === "json_schema") {
      setSchemaText(JSON.stringify(responseFormat.schema ?? {}, null, 2));
    } else {
      setSchemaText(DEFAULT_JSON_SCHEMA_TEXT);
    }
    setSchemaError(null);
  }, [node.id, responseFormat.kind, schemaSignature]);
  return (
    <section aria-label={`Propriétés du nœud ${node.data.slug}`}>
      <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>Nœud sélectionné</h2>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 0.75rem" }}>
        <dt>Identifiant</dt>
        <dd>{node.data.slug}</dd>
        <dt>Type</dt>
        <dd>{labelForKind(kind)}</dd>
      </dl>

      <label style={fieldStyle}>
        <span>Nom affiché</span>
        <input
          type="text"
          value={displayName}
          onChange={(event) => onDisplayNameChange(node.id, event.target.value)}
        />
      </label>

      {kind === "agent" && (
        <>
          <label style={fieldStyle}>
            <span>Message système</span>
            <textarea
              value={agentMessage}
              rows={5}
              placeholder="Texte transmis à l'agent pour définir son rôle"
              onChange={(event) => onAgentMessageChange(node.id, event.target.value)}
            />
          </label>

          <label style={fieldStyle}>
            <span>Modèle OpenAI</span>
            <select
              value={selectedModelOption}
              onChange={(event) => onAgentModelChange(node.id, event.target.value)}
              disabled={availableModelsLoading}
            >
              <option value="">Modèle personnalisé ou non listé</option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.name}>
                  {model.display_name?.trim()
                    ? `${model.display_name} (${model.name})`
                    : model.name}
                  {model.supports_reasoning ? " – raisonnement" : ""}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={agentModel}
              placeholder="Ex. gpt-4.1-mini"
              onChange={(event) => onAgentModelChange(node.id, event.target.value)}
            />
            {availableModelsLoading ? (
              <small style={{ color: "#475569" }}>Chargement des modèles autorisés…</small>
            ) : availableModelsError ? (
              <span style={{ color: "#b91c1c", fontSize: "0.85rem" }}>{availableModelsError}</span>
            ) : matchedModel?.description ? (
              <small style={{ color: "#475569" }}>{matchedModel.description}</small>
            ) : null}
            <small style={{ color: "#475569" }}>
              Sélectionnez un modèle autorisé ou saisissez une valeur personnalisée dans le champ texte.
            </small>
          </label>

          {supportsReasoning ? (
            <>
              <label style={fieldStyle}>
                <span>Niveau de raisonnement</span>
                <select
                  value={reasoningEffort}
                  onChange={(event) => onAgentReasoningChange(node.id, event.target.value)}
                >
                  {reasoningEffortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small style={{ color: "#475569" }}>
                  Ajuste la profondeur d'analyse du modèle (laisser vide pour utiliser la valeur par
                  défaut).
                </small>
              </label>

              <label style={fieldStyle}>
                <span>Verbosité du raisonnement</span>
                <select
                  value={reasoningVerbosity}
                  onChange={(event) => onAgentReasoningVerbosityChange(node.id, event.target.value)}
                >
                  {reasoningVerbosityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small style={{ color: "#475569" }}>
                  Contrôle la quantité de texte générée pendant les étapes de raisonnement.
                </small>
              </label>

              <label style={fieldStyle}>
                <span>Résumé des étapes</span>
                <select
                  value={reasoningSummaryValue}
                  onChange={(event) => onAgentReasoningSummaryChange(node.id, event.target.value)}
                >
                  {reasoningSummaryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small style={{ color: "#475569" }}>
                  Détermine si l'agent doit générer un résumé automatique de son raisonnement.
                </small>
              </label>
            </>
          ) : (
            <>
              <label style={fieldStyle}>
                <span>Température</span>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.01"
                  value={temperatureValue}
                  placeholder="Ex. 0.7"
                  onChange={(event) => onAgentTemperatureChange(node.id, event.target.value)}
                />
                <small style={{ color: "#475569" }}>
                  Ajuste la créativité des réponses pour les modèles sans raisonnement.
                </small>
              </label>
              <label style={fieldStyle}>
                <span>Top-p</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={topPValue}
                  placeholder="Ex. 0.9"
                  onChange={(event) => onAgentTopPChange(node.id, event.target.value)}
                />
                <small style={{ color: "#475569" }}>
                  Détermine la diversité lexicale en limitant la probabilité cumulée.
                </small>
              </label>
            </>
          )}

          <label style={fieldStyle}>
            <span>Nombre maximal de tokens générés</span>
            <input
              type="number"
              min="1"
              step="1"
              value={maxOutputTokensValue}
              placeholder="Laisser vide pour la valeur par défaut"
              onChange={(event) => onAgentMaxOutputTokensChange(node.id, event.target.value)}
            />
            <small style={{ color: "#475569" }}>
              Limite la longueur maximale des réponses produites par cet agent.
            </small>
          </label>

          <div style={{ display: "grid", gap: "0.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={includeChatHistory}
                onChange={(event) =>
                  onAgentIncludeChatHistoryChange(node.id, event.target.checked)
                }
              />
              Inclure l'historique du chat
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={displayResponseInChat}
                onChange={(event) =>
                  onAgentDisplayResponseInChatChange(node.id, event.target.checked)
                }
              />
              Afficher la réponse dans le chat
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={showSearchSources}
                onChange={(event) =>
                  onAgentShowSearchSourcesChange(node.id, event.target.checked)
                }
              />
              Afficher les sources de recherche
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={continueOnError}
                onChange={(event) =>
                  onAgentContinueOnErrorChange(node.id, event.target.checked)
                }
              />
              Continuer l'exécution en cas d'erreur
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={storeResponses}
                onChange={(event) =>
                  onAgentStorePreferenceChange(node.id, event.target.checked)
                }
              />
              Enregistrer la réponse dans l'historique de conversation
            </label>
          </div>

          <label style={fieldStyle}>
            <span>Type de sortie</span>
            <select
              value={responseFormat.kind}
              onChange={(event) => {
                const nextKind = event.target.value as "text" | "json_schema" | "widget";
                onAgentResponseFormatKindChange(node.id, nextKind);
              }}
            >
              <option value="text">Texte libre</option>
              <option value="json_schema">Schéma JSON</option>
              <option value="widget">Widget de la bibliothèque</option>
            </select>
            <small style={{ color: "#475569" }}>
              Choisissez le format attendu pour la réponse de l'agent.
            </small>
          </label>

          {responseFormat.kind === "json_schema" && (
            <>
              <label style={fieldStyle}>
                <span>Nom du schéma JSON</span>
                <input
                  type="text"
                  value={responseFormat.name}
                  onChange={(event) => onAgentResponseFormatNameChange(node.id, event.target.value)}
                />
              </label>

              <label style={fieldStyle}>
                <span>Définition du schéma JSON</span>
                <textarea
                  value={schemaText}
                  rows={8}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSchemaText(value);
                    try {
                      const parsed = JSON.parse(value);
                      setSchemaError(null);
                      onAgentResponseFormatSchemaChange(node.id, parsed);
                    } catch (error) {
                      setSchemaError(
                        error instanceof Error ? error.message : "Schéma JSON invalide",
                      );
                    }
                  }}
                  style={schemaError ? { borderColor: "#b91c1c" } : undefined}
                />
                {schemaError ? (
                  <span style={{ color: "#b91c1c", fontSize: "0.85rem" }}>{schemaError}</span>
                ) : (
                  <small style={{ color: "#475569" }}>
                    Fournissez un schéma JSON valide (Draft 2020-12) pour contraindre la sortie.
                  </small>
                )}
              </label>
            </>
          )}

          {responseFormat.kind === "widget" && (
            <label style={fieldStyle}>
              <span>Widget de sortie</span>
              {widgetsLoading ? (
                <p style={{ color: "#475569", margin: 0 }}>Chargement de la bibliothèque de widgets…</p>
              ) : widgetsError ? (
                <p style={{ color: "#b91c1c", margin: 0 }}>{widgetsError}</p>
              ) : widgets.length === 0 ? (
                <>
                  <select value="" disabled>
                    <option value="">Aucun widget disponible</option>
                  </select>
                  <p style={{ color: "#b45309", margin: "0.25rem 0 0" }}>
                    Créez un widget dans la bibliothèque dédiée pour l'afficher dans le chat.
                  </p>
                </>
              ) : (
                <>
                  <select
                    value={responseWidgetSlug}
                    onChange={(event) => onAgentResponseWidgetSlugChange(node.id, event.target.value)}
                  >
                    <option value="">Sélectionnez un widget</option>
                    {widgets.map((widget) => (
                      <option key={widget.slug} value={widget.slug}>
                        {widget.title?.trim()
                          ? `${widget.title} (${widget.slug})`
                          : widget.slug}
                      </option>
                    ))}
                  </select>
                  {widgetValidationMessage ? (
                    <p style={{ color: "#b91c1c", margin: "0.25rem 0 0" }}>{widgetValidationMessage}</p>
                  ) : (
                    <small style={{ color: "#475569" }}>
                      Le widget sélectionné sera affiché dans ChatKit lorsque l'agent répondra.
                    </small>
                  )}
                </>
              )}
            </label>
          )}

          <div
            style={{
              border: "1px solid rgba(15, 23, 42, 0.12)",
              borderRadius: "0.75rem",
              padding: "0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <strong style={{ fontSize: "0.95rem" }}>Outils</strong>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={webSearchEnabled}
                onChange={(event) =>
                  onAgentWebSearchChange(
                    node.id,
                    event.target.checked
                      ? webSearchConfig ?? { ...DEFAULT_WEB_SEARCH_CONFIG }
                      : null,
                  )
                }
              />
              Activer la recherche web
            </label>
            {webSearchEnabled && (
              <>
                <label style={fieldStyle}>
                  <span>Portée de la recherche</span>
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
                      onAgentWebSearchChange(node.id, nextConfig);
                    }}
                  >
                    <option value="">(par défaut)</option>
                    <option value="small">Petit contexte</option>
                    <option value="medium">Contexte moyen</option>
                    <option value="large">Grand contexte</option>
                  </select>
                </label>

                <div style={{ display: "grid", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 600 }}>Localisation utilisateur</span>
                  {Object.entries(WEB_SEARCH_LOCATION_LABELS).map(([key, label]) => {
                    const typedKey = key as keyof typeof WEB_SEARCH_LOCATION_LABELS;
                    const currentValue =
                      (webSearchConfig?.user_location?.[typedKey] as string | undefined) ?? "";
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
                            onAgentWebSearchChange(node.id, nextConfig);
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={fileSearchEnabled}
                onChange={(event) => {
                  if (event.target.checked) {
                    const preferredSlug =
                      (fileSearchConfig?.vector_store_slug?.trim() ?? "") ||
                      vectorStores[0]?.slug ||
                      "";
                    onAgentFileSearchChange(node.id, {
                      vector_store_slug: preferredSlug,
                    });
                  } else {
                    onAgentFileSearchChange(node.id, null);
                  }
                }}
              />
              Activer la recherche documentaire
            </label>
            {vectorStoresError ? (
              <p style={{ color: "#b91c1c", margin: 0 }}>{vectorStoresError}</p>
            ) : null}
            {fileSearchEnabled && (
              <>
                {vectorStoresLoading ? (
                  <p style={{ color: "#475569", margin: 0 }}>Chargement des vector stores…</p>
                ) : vectorStores.length === 0 ? (
                  <p style={{ color: "#475569", margin: 0 }}>
                    Aucun vector store disponible. Créez-en un depuis l'onglet « Vector stores JSON
                    ».
                  </p>
                ) : (
                  <label style={fieldStyle}>
                    <span>Vector store à interroger</span>
                    <select
                      value={selectedVectorStoreSlug}
                      onChange={(event) =>
                        onAgentFileSearchChange(node.id, {
                          vector_store_slug: event.target.value,
                        })
                      }
                    >
                      <option value="">Sélectionnez un vector store…</option>
                      {vectorStores.map((store) => (
                        <option key={store.slug} value={store.slug}>
                          {store.title?.trim()
                            ? `${store.title} (${store.slug})`
                            : store.slug}
                        </option>
                      ))}
                    </select>
                    <small style={{ color: "#475569" }}>
                      Le document complet du résultat sera transmis à l'agent.
                    </small>
                    {fileSearchValidationMessage && (
                      <p style={{ color: "#b91c1c", margin: 0 }}>{fileSearchValidationMessage}</p>
                    )}
                  </label>
                )}
              </>
            )}
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
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={weatherFunctionEnabled}
                  onChange={(event) =>
                    onAgentWeatherToolChange(node.id, event.target.checked)
                  }
                />
                Autoriser la fonction météo Python
              </label>
              <small style={{ color: "#475569" }}>
                Ajoute l'outil <code>fetch_weather</code> pour récupérer la météo via le
                backend.
              </small>
            </div>
          </div>
        </>
      )}

      {kind === "state" && (
        <>
          <StateAssignmentsPanel
            title="Variables globales"
            description="Définissez des variables disponibles pour l'ensemble du workflow."
            assignments={globalAssignments}
            onChange={(next) => onStateAssignmentsChange(node.id, "globals", next)}
            expressionPlaceholder="Ex. input.output_parsed"
            targetPlaceholder="global.nom_variable"
            addLabel="Ajouter une variable globale"
            emptyLabel="Aucune variable globale n'est définie pour ce nœud."
          />
          <StateAssignmentsPanel
            title="Variables d'état"
            description="Affectez des valeurs aux variables d'état du workflow."
            assignments={stateAssignments}
            onChange={(next) => onStateAssignmentsChange(node.id, "state", next)}
            expressionPlaceholder="Ex. input.output_text"
            targetPlaceholder="state.nom_variable"
            addLabel="Ajouter une variable d'état"
            emptyLabel="Aucune variable d'état n'est configurée pour ce nœud."
          />
        </>
      )}

      <label style={fieldStyle}>
        <span>Paramètres JSON avancés</span>
        <textarea
          value={parametersText}
          rows={8}
          onChange={(event) => onParametersChange(node.id, event.target.value)}
          style={parametersError ? { borderColor: "#b91c1c" } : undefined}
        />
        {parametersError && (
          <span style={{ color: "#b91c1c", fontSize: "0.875rem" }}>{parametersError}</span>
        )}
        {kind === "agent" && !parametersError && (
          <span style={{ color: "#475569", fontSize: "0.85rem" }}>
            Utilisez ce champ pour ajouter des paramètres avancés (JSON) comme les réglages du modèle
            ou des options d'inférence supplémentaires.
          </span>
        )}
      </label>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={() => onToggle(node.id)}
            disabled={isFixed}
          />
          Activer ce nœud
        </label>
        {!isFixed && (
          <button type="button" className="btn danger" onClick={() => onRemove(node.id)}>
            Supprimer
          </button>
        )}
      </div>
    </section>
  );
};


type StateAssignmentsPanelProps = {
  title: string;
  description: string;
  assignments: StateAssignment[];
  onChange: (assignments: StateAssignment[]) => void;
  expressionPlaceholder?: string;
  targetPlaceholder?: string;
  addLabel: string;
  emptyLabel: string;
};

const StateAssignmentsPanel = ({
  title,
  description,
  assignments,
  onChange,
  expressionPlaceholder,
  targetPlaceholder,
  addLabel,
  emptyLabel,
}: StateAssignmentsPanelProps) => {
  const handleAssignmentChange = (
    index: number,
    field: keyof StateAssignment,
    value: string,
  ) => {
    const next = assignments.map((assignment, currentIndex) =>
      currentIndex === index ? { ...assignment, [field]: value } : assignment,
    );
    onChange(next);
  };

  const handleRemoveAssignment = (index: number) => {
    onChange(assignments.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleAddAssignment = () => {
    onChange([...assignments, { expression: "", target: "" }]);
  };

  return (
    <section
      aria-label={title}
      style={{
        marginTop: "1rem",
        border: "1px solid rgba(15, 23, 42, 0.12)",
        borderRadius: "0.75rem",
        padding: "0.75rem",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <header>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>{title}</h3>
        <p style={{ margin: "0.25rem 0 0", color: "#475569", fontSize: "0.95rem" }}>{description}</p>
      </header>

      {assignments.length === 0 ? (
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>{emptyLabel}</p>
      ) : (
        assignments.map((assignment, index) => (
          <div
            key={`${title}-${index}`}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.35)",
              borderRadius: "0.65rem",
              padding: "0.75rem",
              display: "grid",
              gap: "0.75rem",
            }}
          >
            <label style={fieldStyle}>
              <span>Affecter la valeur</span>
              <input
                type="text"
                value={assignment.expression}
                placeholder={expressionPlaceholder}
                onChange={(event) =>
                  handleAssignmentChange(index, "expression", event.target.value)
                }
              />
              <small style={{ color: "#64748b" }}>
                Utilisez le langage Common Expression Language pour créer une expression
                personnalisée.{" "}
                <a href="https://opensource.google/projects/cel" target="_blank" rel="noreferrer">
                  En savoir plus
                </a>
                .
              </small>
            </label>

            <label style={fieldStyle}>
              <span>Vers la variable</span>
              <input
                type="text"
                value={assignment.target}
                placeholder={targetPlaceholder}
                onChange={(event) => handleAssignmentChange(index, "target", event.target.value)}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn danger"
                onClick={() => handleRemoveAssignment(index)}
              >
                Supprimer cette affectation
              </button>
            </div>
          </div>
        ))
      )}

      <div>
        <button type="button" className="btn" onClick={handleAddAssignment}>
          {addLabel}
        </button>
      </div>
    </section>
  );
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
  marginTop: "0.75rem",
};

export default NodeInspector;
