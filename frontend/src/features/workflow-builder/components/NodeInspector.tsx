import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";

import type {
  AvailableModel,
  VectorStoreSummary,
  WidgetTemplateSummary,
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
  getVectorStoreNodeConfig,
  getStateAssignments,
  getEndMessage,
  getWidgetNodeConfig,
} from "../../../utils/workflows";
import type {
  FileSearchConfig,
  FlowNode,
  StateAssignment,
  StateAssignmentScope,
  VectorStoreNodeConfig,
  WebSearchConfig,
  WidgetVariableAssignment,
} from "../types";
import { labelForKind } from "../utils";
import WidgetLibraryModal from "./WidgetLibraryModal";

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
  onWidgetNodeSlugChange: (nodeId: string, slug: string) => void;
  onWidgetNodeVariablesChange: (
    nodeId: string,
    assignments: WidgetVariableAssignment[],
  ) => void;
  onAgentIncludeChatHistoryChange: (nodeId: string, value: boolean) => void;
  onAgentDisplayResponseInChatChange: (nodeId: string, value: boolean) => void;
  onAgentShowSearchSourcesChange: (nodeId: string, value: boolean) => void;
  onAgentContinueOnErrorChange: (nodeId: string, value: boolean) => void;
  onAgentStorePreferenceChange: (nodeId: string, value: boolean) => void;
  onAgentWebSearchChange: (nodeId: string, config: WebSearchConfig | null) => void;
  onAgentFileSearchChange: (nodeId: string, config: FileSearchConfig | null) => void;
  onVectorStoreNodeConfigChange: (
    nodeId: string,
    updates: Partial<VectorStoreNodeConfig>,
  ) => void;
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  isReasoningModel: (model: string) => boolean;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
  widgets: WidgetTemplateSummary[];
  widgetsLoading: boolean;
  widgetsError: string | null;
  onStateAssignmentsChange: (
    nodeId: string,
    scope: StateAssignmentScope,
    assignments: StateAssignment[],
  ) => void;
  onParametersChange: (nodeId: string, value: string) => void;
  onEndMessageChange: (nodeId: string, value: string) => void;
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
  onWidgetNodeSlugChange,
  onWidgetNodeVariablesChange,
  onAgentIncludeChatHistoryChange,
  onAgentDisplayResponseInChatChange,
  onAgentShowSearchSourcesChange,
  onAgentContinueOnErrorChange,
  onAgentStorePreferenceChange,
  onAgentWebSearchChange,
  onAgentFileSearchChange,
  onVectorStoreNodeConfigChange,
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
  onEndMessageChange,
  onRemove,
}: NodeInspectorProps) => {
  const { kind, displayName, isEnabled, parameters, parametersText, parametersError } =
    node.data;
  const isFixed = kind === "start";
  const endMessage = kind === "end" ? getEndMessage(parameters) : "";
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
  const vectorStoreNodeConfig = getVectorStoreNodeConfig(parameters);
  const vectorStoreNodeSlug = vectorStoreNodeConfig.vector_store_slug.trim();
  const vectorStoreNodeDocIdExpression = vectorStoreNodeConfig.doc_id_expression.trim();
  const vectorStoreNodeDocumentExpression = vectorStoreNodeConfig.document_expression.trim();
  const vectorStoreNodeMetadataExpression = vectorStoreNodeConfig.metadata_expression.trim();
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
  const widgetNodeConfig = useMemo(() => getWidgetNodeConfig(parameters), [parameters]);
  const widgetNodeSlug = widgetNodeConfig.slug;
  const widgetNodeVariables = widgetNodeConfig.variables;
  const trimmedWidgetNodeSlug = widgetNodeSlug.trim();
  const widgetNodeSelectedWidget = useMemo(() => {
    if (!trimmedWidgetNodeSlug) {
      return null;
    }
    return widgets.find((widget) => widget.slug === trimmedWidgetNodeSlug) ?? null;
  }, [trimmedWidgetNodeSlug, widgets]);
  const [widgetPickerTarget, setWidgetPickerTarget] = useState<"agent" | "widget" | null>(null);
  const canBrowseWidgets = !widgetsLoading && !widgetsError && widgets.length > 0;
  const widgetSlugSuggestionsId = useId();
  const widgetNodeSlugSuggestionsId = useId();

  const handleOpenWidgetPicker = (target: "agent" | "widget") => {
    if (!canBrowseWidgets) {
      return;
    }
    setWidgetPickerTarget(target);
  };

  const handleCloseWidgetPicker = () => {
    setWidgetPickerTarget(null);
  };

  const handleWidgetPickerSelect = (slug: string) => {
    const trimmedSlug = slug.trim();
    if (!trimmedSlug) {
      return;
    }
    if (widgetPickerTarget === "agent") {
      if (responseFormat.kind !== "widget") {
        onAgentResponseFormatKindChange(node.id, "widget");
      }
      onAgentResponseWidgetSlugChange(node.id, trimmedSlug);
    } else if (widgetPickerTarget === "widget") {
      onWidgetNodeSlugChange(node.id, trimmedSlug);
    }
  };
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
  let widgetNodeValidationMessage: string | null = null;
  if (kind === "widget" && !widgetsLoading && !widgetsError && widgets.length > 0) {
    if (!trimmedWidgetNodeSlug) {
      widgetNodeValidationMessage = "Sélectionnez un widget à afficher.";
    } else if (!widgetNodeSelectedWidget) {
      widgetNodeValidationMessage = "Le widget sélectionné n'est plus disponible. Choisissez-en un autre.";
    }
  }
  const widgetSelectValue = selectedWidgetExists ? trimmedWidgetSlug : "";
  const widgetNodeSelectValue = widgetNodeSelectedWidget ? trimmedWidgetNodeSlug : "";
  const vectorStoreNodeExists =
    vectorStoreNodeSlug.length > 0 && vectorStores.some((store) => store.slug === vectorStoreNodeSlug);
  const vectorStoreNodeValidationMessages: string[] = [];
  if (kind === "json_vector_store") {
    if (!vectorStoreNodeSlug) {
      vectorStoreNodeValidationMessages.push(
        "Sélectionnez un vector store pour enregistrer la réponse.",
      );
    } else if (
      !vectorStoresError &&
      vectorStores.length > 0 &&
      !vectorStoreNodeExists
    ) {
      vectorStoreNodeValidationMessages.push(
        "Le vector store sélectionné n'est plus disponible. Choisissez-en un autre.",
      );
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
  const widgetModalSelectedSlug =
    widgetPickerTarget === "agent"
      ? responseWidgetSlug
      : widgetPickerTarget === "widget"
        ? widgetNodeSlug
        : "";

  return (
    <>
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

      {kind === "end" && (
        <label style={fieldStyle}>
          <span>Message de fin</span>
          <textarea
            value={endMessage}
            rows={4}
            placeholder="Texte affiché lorsque le workflow se termine sur ce bloc"
            onChange={(event) => onEndMessageChange(node.id, event.target.value)}
          />
          <small style={{ color: "#475569" }}>
            Ce message est utilisé comme raison de clôture lorsque ce bloc termine le fil.
          </small>
        </label>
      )}

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
            <>
              <div style={fieldStyle}>
                <label htmlFor={`${widgetSlugSuggestionsId}-input`}>Slug du widget de sortie</label>
                <input
                  id={`${widgetSlugSuggestionsId}-input`}
                  type="text"
                  value={responseWidgetSlug}
                  onChange={(event) => onAgentResponseWidgetSlugChange(node.id, event.target.value)}
                  placeholder="Ex. resume"
                  list={widgets.length > 0 ? `${widgetSlugSuggestionsId}-list` : undefined}
                />
                {widgets.length > 0 && (
                  <>
                    <label htmlFor={`${widgetSlugSuggestionsId}-select`}>Widget de sortie</label>
                    <select
                      id={`${widgetSlugSuggestionsId}-select`}
                      value={widgetSelectValue}
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
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => handleOpenWidgetPicker("agent")}
                        disabled={!canBrowseWidgets}
                        aria-label="Parcourir la bibliothèque de widgets pour la réponse de l'agent"
                      >
                        Parcourir la bibliothèque
                      </button>
                    </div>
                  </>
                )}
                {widgetsLoading ? (
                  <p style={{ color: "#475569", margin: 0 }}>Chargement de la bibliothèque de widgets…</p>
                ) : widgetsError ? (
                  <p style={{ color: "#b91c1c", margin: 0 }}>
                    {widgetsError}
                    <br />
                    Vous pouvez saisir le slug du widget manuellement ci-dessus.
                  </p>
                ) : widgets.length === 0 ? (
                  <p style={{ color: "#475569", margin: 0 }}>
                    Créez un widget dans la bibliothèque dédiée ou saisissez son slug manuellement ci-dessus.
                  </p>
                ) : null}
              </div>
              {widgetValidationMessage ? (
                <p style={{ color: "#b91c1c", margin: "0.25rem 0 0" }}>{widgetValidationMessage}</p>
              ) : (
                <small style={{ color: "#475569" }}>
                  Le widget sélectionné sera affiché dans ChatKit lorsque l'agent répondra.
                </small>
              )}
              {widgets.length > 0 && (
                <datalist id={`${widgetSlugSuggestionsId}-list`}>
                  {widgets.map((widget) => (
                    <option key={widget.slug} value={widget.slug}>
                      {widget.title?.trim() ? widget.title : widget.slug}
                    </option>
                  ))}
                </datalist>
              )}
            </>
          )}

      {kind === "widget" && (
        <>
          <p style={{ color: "#475569", margin: "0 0 0.75rem" }}>
            Ce bloc diffuse un widget ChatKit en utilisant les données produites par le bloc
            précédent ou les variables d'état du workflow.
          </p>
          <div style={fieldStyle}>
            <label htmlFor={`${widgetNodeSlugSuggestionsId}-input`}>Slug du widget</label>
            <input
              id={`${widgetNodeSlugSuggestionsId}-input`}
              type="text"
              value={widgetNodeSlug}
              onChange={(event) => onWidgetNodeSlugChange(node.id, event.target.value)}
              placeholder="Ex. resume"
              list={widgets.length > 0 ? `${widgetNodeSlugSuggestionsId}-list` : undefined}
            />
            {widgets.length > 0 && (
              <>
                <label htmlFor={`${widgetNodeSlugSuggestionsId}-select`}>Widget à afficher</label>
                <select
                  id={`${widgetNodeSlugSuggestionsId}-select`}
                  value={widgetNodeSelectValue}
                  onChange={(event) => onWidgetNodeSlugChange(node.id, event.target.value)}
                >
                  <option value="">Sélectionnez un widget</option>
                  {widgets.map((widget) => (
                    <option key={widget.slug} value={widget.slug}>
                      {widget.title?.trim() ? `${widget.title} (${widget.slug})` : widget.slug}
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => handleOpenWidgetPicker("widget")}
                    disabled={!canBrowseWidgets}
                    aria-label="Parcourir la bibliothèque de widgets pour le bloc widget"
                  >
                    Parcourir la bibliothèque
                  </button>
                </div>
              </>
            )}
            {widgetsLoading ? (
              <p style={{ color: "#475569", margin: 0 }}>Chargement de la bibliothèque de widgets…</p>
            ) : widgetsError ? (
              <p style={{ color: "#b91c1c", margin: 0 }}>
                {widgetsError}
                <br />
                Vous pouvez saisir le slug du widget manuellement ci-dessus.
              </p>
            ) : widgets.length === 0 ? (
              <p style={{ color: "#475569", margin: 0 }}>
                Créez un widget dans la bibliothèque dédiée ou saisissez son slug manuellement ci-dessus.
              </p>
            ) : null}
          </div>
          {widgetNodeValidationMessage ? (
            <p style={{ color: "#b91c1c", margin: "0.25rem 0 0" }}>
              {widgetNodeValidationMessage}
            </p>
          ) : (
            <small style={{ color: "#475569" }}>
              Le widget sélectionné est diffusé immédiatement dans ChatKit lorsqu'on atteint ce bloc.
            </small>
          )}
          {widgets.length > 0 && (
            <datalist id={`${widgetNodeSlugSuggestionsId}-list`}>
              {widgets.map((widget) => (
                <option key={widget.slug} value={widget.slug}>
                  {widget.title?.trim() ? widget.title : widget.slug}
                </option>
              ))}
            </datalist>
          )}

          <WidgetVariablesPanel
            assignments={widgetNodeVariables}
            onChange={(next) => onWidgetNodeVariablesChange(node.id, next)}
          />
        </>
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

      {kind === "json_vector_store" && (
        <>
          <p style={{ color: "#475569", margin: "0 0 0.75rem" }}>
            Ce bloc enregistre le JSON produit par le bloc précédent dans le vector store
            sélectionné.
          </p>
          {vectorStoresError ? (
            <p style={{ color: "#b91c1c", margin: "0 0 0.75rem" }}>{vectorStoresError}</p>
          ) : null}
          {vectorStoresLoading ? (
            <p style={{ color: "#475569", margin: "0 0 0.75rem" }}>Chargement des vector stores…</p>
          ) : vectorStores.length === 0 ? (
            <p style={{ color: "#475569", margin: "0 0 0.75rem" }}>
              Aucun vector store disponible. Créez-en un depuis l'onglet « Vector stores JSON ».
            </p>
          ) : (
            <label style={fieldStyle}>
              <span>Vector store cible</span>
              <select
                value={vectorStoreNodeSlug}
                onChange={(event) =>
                  onVectorStoreNodeConfigChange(node.id, {
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
              <small style={{ color: "#475569" }}>
                Choisissez le magasin JSON dans lequel indexer la réponse structurée.
              </small>
            </label>
          )}
          <label style={fieldStyle}>
            <span>Expression de l'identifiant du document (facultatif)</span>
            <input
              type="text"
              value={vectorStoreNodeDocIdExpression}
              onChange={(event) =>
                onVectorStoreNodeConfigChange(node.id, {
                  doc_id_expression: event.target.value,
                })
              }
              placeholder="Ex. input.output_parsed.doc_id"
            />
            <small style={{ color: "#475569" }}>
              Laissez vide pour réutiliser la clé <code>doc_id</code> du JSON structuré ou générer un
              identifiant automatique.
            </small>
          </label>
          <label style={fieldStyle}>
            <span>Expression JSON à indexer (facultatif)</span>
            <input
              type="text"
              value={vectorStoreNodeDocumentExpression}
              onChange={(event) =>
                onVectorStoreNodeConfigChange(node.id, {
                  document_expression: event.target.value,
                })
              }
              placeholder="Ex. input.output_parsed"
            />
            <small style={{ color: "#475569" }}>
              Laissez vide pour indexer automatiquement la sortie structurée du bloc précédent.
            </small>
          </label>
          <label style={fieldStyle}>
            <span>Expression des métadonnées (facultatif)</span>
            <input
              type="text"
              value={vectorStoreNodeMetadataExpression}
              onChange={(event) =>
                onVectorStoreNodeConfigChange(node.id, {
                  metadata_expression: event.target.value,
                })
              }
              placeholder='Ex. {"source": "workflow"}'
            />
            <small style={{ color: "#475569" }}>
              Retourne un objet JSON fusionné avec les métadonnées automatiques du workflow.
            </small>
          </label>
          {vectorStoreNodeValidationMessages.map((message, index) => (
            <p key={`vector-store-node-${index}`} style={{ color: "#b91c1c", margin: 0 }}>
              {message}
            </p>
          ))}
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
      {widgetPickerTarget && canBrowseWidgets ? (
        <WidgetLibraryModal
          widgets={widgets}
          selectedSlug={widgetModalSelectedSlug}
          onClose={handleCloseWidgetPicker}
          onSelect={handleWidgetPickerSelect}
          title="Bibliothèque de widgets"
          description="Choisissez un widget enregistré pour l'utiliser dans ce workflow."
        />
      ) : null}
    </>
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

type WidgetVariablesPanelProps = {
  assignments: WidgetVariableAssignment[];
  onChange: (assignments: WidgetVariableAssignment[]) => void;
};

const WidgetVariablesPanel = ({ assignments, onChange }: WidgetVariablesPanelProps) => {
  const handleAssignmentChange = (
    index: number,
    field: keyof WidgetVariableAssignment,
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
    onChange([...assignments, { identifier: "", expression: "" }]);
  };

  return (
    <section
      aria-label="Variables de widget"
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
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Variables de widget</h3>
        <p style={{ margin: "0.25rem 0 0", color: "#475569", fontSize: "0.95rem" }}>
          Associez les identifiants du widget aux expressions évaluées lors de l'exécution.
        </p>
      </header>

      {assignments.length === 0 ? (
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
          Aucune variable dynamique n'est configurée pour ce widget.
        </p>
      ) : (
        assignments.map((assignment, index) => (
          <div
            key={`widget-variable-${index}`}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.35)",
              borderRadius: "0.65rem",
              padding: "0.75rem",
              display: "grid",
              gap: "0.75rem",
            }}
          >
            <label style={fieldStyle}>
              <span>Identifiant du widget</span>
              <input
                type="text"
                value={assignment.identifier}
                placeholder="Ex. title"
                onChange={(event) =>
                  handleAssignmentChange(index, "identifier", event.target.value)
                }
              />
              <small style={{ color: "#64748b" }}>
                Correspond aux attributs <code>id</code>, <code>name</code> ou aux zones éditables du widget.
              </small>
            </label>
            <label style={fieldStyle}>
              <span>Expression associée</span>
              <input
                type="text"
                value={assignment.expression}
                placeholder="Ex. input.output_parsed.titre"
                onChange={(event) =>
                  handleAssignmentChange(index, "expression", event.target.value)
                }
              />
              <small style={{ color: "#64748b" }}>
                Utilisez <code>state.</code> ou <code>input.</code> pour référencer les données du workflow.
              </small>
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn danger"
                onClick={() => handleRemoveAssignment(index)}
              >
                Supprimer la variable
              </button>
            </div>
          </div>
        ))
      )}

      <div>
        <button type="button" className="btn" onClick={handleAddAssignment}>
          Ajouter une variable
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
