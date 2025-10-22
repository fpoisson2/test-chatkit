import { useId, useMemo } from "react";

import { WidgetPreview } from "../../../../../components/WidgetPreview";
import {
  applyWidgetInputValues,
  buildWidgetInputSample,
  collectWidgetBindings,
} from "../../../../../utils/widgetPreview";
import type {
  FlowNode,
  WidgetVariableAssignment,
} from "../../../types";
import type { WidgetTemplateSummary } from "../../../../../utils/backend";
import { isTestEnvironment } from "../constants";
import { useWidgetInspectorState } from "../hooks/useWidgetInspectorState";
import { fieldStyle, inlineFieldStyle, labelContentStyle } from "../styles";
import { HelpTooltip } from "../components/HelpTooltip";

type WidgetInspectorSectionProps = {
  nodeId: string;
  parameters: FlowNode["data"]["parameters"];
  token: string | null;
  widgets: WidgetTemplateSummary[];
  widgetsLoading: boolean;
  widgetsError: string | null;
  onWidgetNodeSlugChange: (nodeId: string, slug: string) => void;
  onWidgetNodeSourceChange: (
    nodeId: string,
    source: "library" | "variable",
  ) => void;
  onWidgetNodeDefinitionExpressionChange: (nodeId: string, expression: string) => void;
  onWidgetNodeVariablesChange: (
    nodeId: string,
    assignments: WidgetVariableAssignment[],
  ) => void;
  onWidgetNodeAwaitActionChange: (nodeId: string, value: boolean) => void;
};

export const WidgetInspectorSection = ({
  nodeId,
  parameters,
  token,
  widgets,
  widgetsLoading,
  widgetsError,
  onWidgetNodeSlugChange,
  onWidgetNodeSourceChange,
  onWidgetNodeDefinitionExpressionChange,
  onWidgetNodeVariablesChange,
  onWidgetNodeAwaitActionChange,
}: WidgetInspectorSectionProps) => {
  const {
    widgetNodeSource,
    widgetNodeSlug,
    trimmedWidgetNodeSlug,
    widgetNodeDefinitionExpression,
    widgetNodeVariables,
    widgetNodeAwaitAction,
    widgetDefinition,
    widgetDefinitionLoading,
    widgetDefinitionError,
    widgetNodeSelectValue,
    widgetNodeValidationMessage,
  } = useWidgetInspectorState({
    parameters,
    token,
    widgets,
    widgetsLoading,
    widgetsError,
  });

  const widgetNodeSlugSuggestionsId = useId();

  return (
    <>
      <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0" }}>
        Affichez un widget existant ou fournissez une expression qui renvoie sa définition JSON.
      </p>

      <label style={fieldStyle}>
        <span style={labelContentStyle}>
          Source du widget
          <HelpTooltip label="Diffusez un widget de la bibliothèque ou un JSON stocké dans les variables du workflow." />
        </span>
        <select
          value={widgetNodeSource}
          onChange={(event) =>
            onWidgetNodeSourceChange(nodeId, event.target.value as "library" | "variable")
          }
        >
          <option value="library">Bibliothèque de widgets</option>
          <option value="variable">Expression JSON (variable)</option>
        </select>
      </label>

      {widgetNodeSource === "library" ? (
        <>
          <label style={fieldStyle} htmlFor={`${widgetNodeSlugSuggestionsId}-input`}>
            <span style={labelContentStyle}>
              Slug du widget
              <HelpTooltip label="Correspond au slug défini lors de l'enregistrement du widget dans la bibliothèque." />
            </span>
            <input
              id={`${widgetNodeSlugSuggestionsId}-input`}
              type="text"
              value={widgetNodeSlug}
              onChange={(event) => onWidgetNodeSlugChange(nodeId, event.target.value)}
              placeholder="Ex. mon-widget-personnalise"
              list={widgets.length > 0 ? `${widgetNodeSlugSuggestionsId}-list` : undefined}
            />
          </label>

          <label style={inlineFieldStyle} htmlFor={`${widgetNodeSlugSuggestionsId}-select`}>
            <span style={labelContentStyle}>
              Widget enregistré
              <HelpTooltip label="La liste provient automatiquement de la bibliothèque des widgets partageables. Le widget sélectionné est diffusé immédiatement dans ChatKit lorsqu'on atteint ce bloc." />
            </span>
            <select
              id={`${widgetNodeSlugSuggestionsId}-select`}
              value={widgetNodeSelectValue}
              onChange={(event) => onWidgetNodeSlugChange(nodeId, event.target.value)}
              disabled={widgetsLoading || !!widgetsError || widgets.length === 0}
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
            <p style={{ color: "var(--text-muted)", margin: 0 }}>
              Chargement de la bibliothèque de widgets…
            </p>
          ) : widgetsError ? (
            <p style={{ color: "#b91c1c", margin: 0 }}>
              {widgetsError}
              <br />
              Vous pouvez saisir le slug du widget manuellement ci-dessus.
            </p>
          ) : widgets.length === 0 ? (
            <p style={{ color: "var(--text-muted)", margin: 0 }}>
              Créez un widget dans la bibliothèque dédiée ou saisissez son slug manuellement ci-dessus.
            </p>
          ) : null}

          {widgetNodeValidationMessage ? (
            <p style={{ color: "#b91c1c", margin: 0 }}>{widgetNodeValidationMessage}</p>
          ) : null}

          {widgets.length > 0 && (
            <datalist id={`${widgetNodeSlugSuggestionsId}-list`}>
              {widgets.map((widget) => (
                <option key={widget.slug} value={widget.slug}>
                  {widget.title?.trim() ? widget.title : widget.slug}
                </option>
              ))}
            </datalist>
          )}

          {!isTestEnvironment && (
            <WidgetNodeContentEditor
              slug={trimmedWidgetNodeSlug}
              definition={widgetDefinition}
              loading={widgetDefinitionLoading}
              error={widgetDefinitionError}
              assignments={widgetNodeVariables}
              onChange={(next) => onWidgetNodeVariablesChange(nodeId, next)}
            />
          )}

          <div style={{ marginTop: "0.75rem" }}>
            <WidgetVariablesPanel
              assignments={widgetNodeVariables}
              onChange={(next) => onWidgetNodeVariablesChange(nodeId, next)}
            />
          </div>
        </>
      ) : (
        <>
          <label style={fieldStyle}>
            <span style={labelContentStyle}>
              Expression JSON du widget
              <HelpTooltip label="Saisissez une expression (ex. state.widget_output) qui renvoie la définition JSON complète du widget." />
            </span>
            <input
              type="text"
              value={widgetNodeDefinitionExpression}
              onChange={(event) =>
                onWidgetNodeDefinitionExpressionChange(nodeId, event.target.value)
              }
              placeholder="Ex. state.widget_output"
            />
          </label>
          <p style={{ color: "var(--text-muted)", margin: "-0.35rem 0 0.35rem" }}>
            Le JSON fourni est transmis tel quel au widget ChatKit. Vérifiez qu'il respecte le schéma attendu.
          </p>
          {widgetNodeValidationMessage ? (
            <p style={{ color: "#b91c1c", margin: 0 }}>{widgetNodeValidationMessage}</p>
          ) : null}
        </>
      )}

      <label style={{ ...fieldStyle, marginTop: "0.75rem" }}>
        <span style={labelContentStyle}>Progression du workflow</span>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
          <input
            type="checkbox"
            checked={widgetNodeAwaitAction}
            onChange={(event) => onWidgetNodeAwaitActionChange(nodeId, event.target.checked)}
          />
          <div style={{ lineHeight: 1.4 }}>
            <strong>Attendre une action utilisateur avant de continuer</strong>
            <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
              Lorsque cette option est activée, le workflow reste sur ce bloc tant que l'utilisateur n'a pas interagi avec le
              widget. Désactivez-la pour enchaîner automatiquement avec l'étape suivante.
            </p>
          </div>
        </div>
      </label>
    </>
  );
};

type WidgetNodeContentEditorProps = {
  slug: string;
  definition: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
  assignments: WidgetVariableAssignment[];
  onChange: (assignments: WidgetVariableAssignment[]) => void;
};

const WidgetNodeContentEditor = ({
  slug,
  definition,
  loading,
  error,
  assignments,
  onChange,
}: WidgetNodeContentEditorProps) => {
  const trimmedSlug = slug.trim();

  const bindings = useMemo(() => (definition ? collectWidgetBindings(definition) : {}), [definition]);
  const bindingEntries = useMemo(
    () => Object.entries(bindings).sort(([a], [b]) => a.localeCompare(b)),
    [bindings],
  );

  const assignmentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const assignment of assignments) {
      map.set(assignment.identifier, assignment.expression);
    }
    return map;
  }, [assignments]);

  const sampleValues = useMemo(() => {
    if (!definition) {
      return {} as Record<string, string | string[]>;
    }
    return buildWidgetInputSample(definition, bindings);
  }, [bindings, definition]);

  const previewValues = useMemo(() => {
    const values: Record<string, string | string[]> = { ...sampleValues };
    assignmentMap.forEach((expression, identifier) => {
      const parsed = parsePreviewValue(expression);
      if (parsed === null) {
        delete values[identifier];
      } else {
        values[identifier] = parsed;
      }
    });
    return values;
  }, [assignmentMap, sampleValues]);

  const previewDefinition = useMemo(() => {
    if (!definition) {
      return null;
    }
    return applyWidgetInputValues(definition, previewValues, bindings);
  }, [bindings, definition, previewValues]);

  const handleBindingChange = (identifier: string, value: string) => {
    const existingIndex = assignments.findIndex((assignment) => assignment.identifier === identifier);
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      if (existingIndex === -1) {
        return;
      }
      const next = assignments.filter((_, index) => index !== existingIndex);
      onChange(next);
      return;
    }
    if (existingIndex === -1) {
      onChange([...assignments, { identifier, expression: normalizedValue }]);
      return;
    }
    const next = assignments.map((assignment, index) =>
      index === existingIndex ? { ...assignment, expression: normalizedValue } : assignment,
    );
    onChange(next);
  };

  if (!trimmedSlug) {
    return null;
  }

  return (
    <section
      aria-label="Contenu du widget"
      style={{
        marginTop: "0.75rem",
        border: "1px solid rgba(15, 23, 42, 0.12)",
        borderRadius: "0.75rem",
        padding: "0.75rem",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <header>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Contenu du widget</h3>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.95rem" }}>
          Modifiez les textes diffusés par ce bloc. Les valeurs sont enregistrées dans les propriétés du workflow.
        </p>
      </header>
      {loading ? (
        <p style={{ margin: 0, color: "var(--text-muted)" }}>Chargement de la prévisualisation…</p>
      ) : error ? (
        <p style={{ margin: 0, color: "#b91c1c" }}>
          Impossible de récupérer le widget « {trimmedSlug} ». {error}
        </p>
      ) : !definition ? (
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          Sélectionnez un widget dans la bibliothèque pour personnaliser son contenu.
        </p>
      ) : (
        <>
          <div
            style={{
              border: "1px solid rgba(15, 23, 42, 0.12)",
              borderRadius: "0.65rem",
              padding: "0.75rem",
              background: "#f8fafc",
            }}
          >
            <WidgetPreview definition={previewDefinition ?? definition} />
          </div>
          {bindingEntries.length > 0 ? (
            bindingEntries.map(([identifier, binding]) => {
              const label = binding.componentType
                ? `${identifier} (${binding.componentType})`
                : identifier;
              const placeholder = formatSampleValue(binding.sample);
              return (
                <label key={identifier} style={fieldStyle}>
                  <span style={labelContentStyle}>{label}</span>
                  <input
                    type="text"
                    value={assignmentMap.get(identifier) ?? ""}
                    onChange={(event) => handleBindingChange(identifier, event.target.value)}
                    placeholder={placeholder ? `Ex. ${placeholder}` : undefined}
                  />
                </label>
              );
            })
          ) : (
            <p style={{ margin: 0, color: "var(--text-muted)" }}>
              Ce widget n'expose aucun texte modifiable. Il sera diffusé tel que défini dans la bibliothèque.
            </p>
          )}
        </>
      )}
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
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.95rem" }}>
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
              <span style={labelContentStyle}>
                Identifiant du widget
                <HelpTooltip label="Correspond aux attributs id, name ou aux zones éditables du widget." />
              </span>
              <input
                type="text"
                value={assignment.identifier}
                placeholder="Ex. title"
                onChange={(event) => handleAssignmentChange(index, "identifier", event.target.value)}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelContentStyle}>
                Expression associée
                <HelpTooltip label="Utilisez state. ou input. pour référencer les données du workflow." />
              </span>
              <input
                type="text"
                value={assignment.expression}
                placeholder="Ex. input.output_parsed.titre"
                onChange={(event) => handleAssignmentChange(index, "expression", event.target.value)}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn danger" onClick={() => handleRemoveAssignment(index)}>
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

const parsePreviewValue = (expression: string): string | string[] | null => {
  const trimmed = expression.trim();
  if (!trimmed) {
    return null;
  }
  try {
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? (parsed as string[]).map(String) : null;
    }
    if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
      return JSON.parse(trimmed);
    }
    return trimmed;
  } catch (error) {
    return trimmed;
  }
};

const formatSampleValue = (sample: string | string[] | null): string => {
  if (Array.isArray(sample)) {
    return sample.join(", ");
  }
  if (typeof sample === "string") {
    return sample;
  }
  return "";
};
