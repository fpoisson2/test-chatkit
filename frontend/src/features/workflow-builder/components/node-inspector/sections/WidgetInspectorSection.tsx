import { useId, useMemo, useState } from "react";

import { WidgetPreview } from "../../../../../components/WidgetPreview";
import {
  applyWidgetInputValues,
  buildWidgetInputSample,
  collectWidgetBindings,
  type WidgetBinding,
} from "../../../../../utils/widgetPreview";
import type {
  FlowNode,
  WidgetVariableAssignment,
} from "../../../types";
import type { WidgetTemplateSummary } from "../../../../../utils/backend";
import { isTestEnvironment } from "../constants";
import { useWidgetInspectorState } from "../hooks/useWidgetInspectorState";
import { HelpTooltip } from "../components/HelpTooltip";
import styles from "../NodeInspector.module.css";

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
      <p className={styles.nodeInspectorMutedTextSpacedTop}>
        Affichez un widget existant ou fournissez une expression qui renvoie sa définition JSON.
      </p>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
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
          <label className={styles.nodeInspectorField} htmlFor={`${widgetNodeSlugSuggestionsId}-input`}>
            <span className={styles.nodeInspectorLabel}>
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

          <label className={styles.nodeInspectorInlineField} htmlFor={`${widgetNodeSlugSuggestionsId}-select`}>
            <span className={styles.nodeInspectorLabel}>
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
            <p className={styles.nodeInspectorMutedText}>
              Chargement de la bibliothèque de widgets…
            </p>
          ) : widgetsError ? (
            <p className={styles.nodeInspectorErrorText}>
              {widgetsError}
              <br />
              Vous pouvez saisir le slug du widget manuellement ci-dessus.
            </p>
          ) : widgets.length === 0 ? (
            <p className={styles.nodeInspectorMutedText}>
              Créez un widget dans la bibliothèque dédiée ou saisissez son slug manuellement ci-dessus.
            </p>
          ) : null}

          {widgetNodeValidationMessage ? (
            <p className={styles.nodeInspectorErrorText}>{widgetNodeValidationMessage}</p>
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

          <div className={styles.nodeInspectorSectionSpacer}>
            <WidgetVariablesPanel
              assignments={widgetNodeVariables}
              onChange={(next) => onWidgetNodeVariablesChange(nodeId, next)}
            />
          </div>
        </>
      ) : (
        <>
          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
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
          <p className={styles.nodeInspectorHintText}>
            Le JSON fourni est transmis tel quel au widget ChatKit. Vérifiez qu'il respecte le schéma attendu.
          </p>
          {widgetNodeValidationMessage ? (
            <p className={styles.nodeInspectorErrorText}>{widgetNodeValidationMessage}</p>
          ) : null}
        </>
      )}

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>Progression du workflow</span>
        <div className={styles.nodeInspectorInlineStack}>
          <input
            type="checkbox"
            checked={widgetNodeAwaitAction}
            onChange={(event) => onWidgetNodeAwaitActionChange(nodeId, event.target.checked)}
          />
          <div className={styles.nodeInspectorStackText}>
            <strong>Attendre une action utilisateur avant de continuer</strong>
            <p className={styles.nodeInspectorHintTextTight}>
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

type MediaUploadPreview = {
  fileName: string;
  previewUrl: string;
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

  const [mediaUploads, setMediaUploads] = useState<Record<string, MediaUploadPreview>>({});

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

  const handleBindingChange = (
    identifier: string,
    value: string,
    options?: { mediaPreview?: MediaUploadPreview | null },
  ) => {
    const existingIndex = assignments.findIndex((assignment) => assignment.identifier === identifier);
    const normalizedValue = value.trim();

    setMediaUploads((previous) => {
      const next = { ...previous };
      if (options?.mediaPreview) {
        next[identifier] = options.mediaPreview;
      } else if (options && options.mediaPreview === null) {
        delete next[identifier];
      } else if (!normalizedValue) {
        delete next[identifier];
      }
      return next;
    });

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

  const handleMediaFileChange = async (identifier: string, fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) {
      return;
    }
    try {
      const previewUrl = await readFileAsDataUrl(file);
      const serializedValue = JSON.stringify(previewUrl);
      handleBindingChange(identifier, serializedValue, {
        mediaPreview: { fileName: file.name, previewUrl },
      });
    } catch (uploadError) {
      console.error(uploadError);
    }
  };

  if (!trimmedSlug) {
    return null;
  }

  return (
    <section aria-label="Contenu du widget" className={styles.nodeInspectorPanel}>
      {loading ? (
        <p className={styles.nodeInspectorMutedText}>Chargement de la prévisualisation…</p>
      ) : error ? (
        <p className={styles.nodeInspectorErrorText}>
          Impossible de récupérer le widget « {trimmedSlug} ». {error}
        </p>
      ) : !definition ? (
        <p className={styles.nodeInspectorMutedText}>
          Sélectionnez un widget dans la bibliothèque pour personnaliser son contenu.
        </p>
      ) : (
        <>
          <div className={styles.nodeInspectorPreviewCard}>
            <WidgetPreview definition={previewDefinition ?? definition} />
          </div>
          {bindingEntries.length > 0 ? (
            bindingEntries.map(([identifier, binding]) => {
              const label = binding.componentType
                ? `${identifier} (${binding.componentType})`
                : identifier;
              const placeholder = formatSampleValue(binding.sample);
              const currentExpression = assignmentMap.get(identifier) ?? "";
              const mediaPreview = resolveMediaPreview(
                currentExpression,
                mediaUploads[identifier],
              );
              const isMedia = isMediaBinding(binding);
              return (
                <label key={identifier} className={styles.nodeInspectorField}>
                  <span className={styles.nodeInspectorLabel}>{label}</span>
                  {isMedia ? (
                    <div className={styles.nodeInspectorInputGroup}>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          void handleMediaFileChange(identifier, event.target.files);
                          event.target.value = "";
                        }}
                      />
                      {mediaPreview.previewUrl || mediaPreview.fileName ? (
                        <div className={styles.nodeInspectorMediaPreview}>
                          {mediaPreview.previewUrl && isLikelyImageSource(mediaPreview.previewUrl) ? (
                            <img
                              src={mediaPreview.previewUrl}
                              alt={`Prévisualisation pour ${identifier}`}
                              className={styles.nodeInspectorMediaThumbnail}
                            />
                          ) : null}
                          <div className={styles.nodeInspectorMediaDetails}>
                            <strong>
                              {mediaPreview.fileName ?? "Image sélectionnée"}
                            </strong>
                            {mediaPreview.previewUrl ? (
                              <p className={styles.nodeInspectorMutedText}>
                                Aperçu mis à jour pour la prévisualisation du widget
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      <input
                        type="text"
                        value={currentExpression}
                        onChange={(event) =>
                          handleBindingChange(identifier, event.target.value, { mediaPreview: null })
                        }
                        placeholder={placeholder ? `Ex. ${placeholder}` : undefined}
                      />
                      <p className={styles.nodeInspectorHintTextTight}>
                        Importez une image ou saisissez une URL/expression existante. En l'absence de
                        fichier, le texte est utilisé tel quel.
                      </p>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={currentExpression}
                      onChange={(event) => handleBindingChange(identifier, event.target.value)}
                      placeholder={placeholder ? `Ex. ${placeholder}` : undefined}
                    />
                  )}
                </label>
              );
            })
          ) : (
            <p className={styles.nodeInspectorMutedText}>
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
    <section aria-label="Variables de widget" className={styles.nodeInspectorPanel}>
      <header>
        <h3 className={styles.nodeInspectorSectionHeading}>Variables de widget</h3>
        <p className={styles.nodeInspectorSectionDescription}>
          Associez les identifiants du widget aux expressions évaluées lors de l'exécution.
        </p>
      </header>

      {assignments.length === 0 ? (
        <p className={styles.nodeInspectorMutedNote}>
          Aucune variable dynamique n'est configurée pour ce widget.
        </p>
      ) : (
        assignments.map((assignment, index) => (
          <div key={`widget-variable-${index}`} className={styles.nodeInspectorPanelInner}>
            <label className={styles.nodeInspectorField}>
              <span className={styles.nodeInspectorLabel}>
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
            <label className={styles.nodeInspectorField}>
              <span className={styles.nodeInspectorLabel}>
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
            <div className={styles.nodeInspectorSectionFooter}>
              <button type="button" className="btn btn-danger" onClick={() => handleRemoveAssignment(index)}>
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

const mediaComponentKeywords = ["image", "img", "avatar", "icon", "picture", "photo", "logo", "thumbnail"];
const mediaValueKeywords = [
  "src",
  "icon",
  "iconstart",
  "iconend",
  "image",
  "avatar",
  "url",
  "picture",
  "photo",
  "logo",
  "thumbnail",
];

const isMediaBinding = (binding: WidgetBinding): boolean => {
  const componentType = binding.componentType?.toLowerCase() ?? "";
  const valueKey = binding.valueKey?.toLowerCase() ?? "";
  return (
    mediaComponentKeywords.some((keyword) => componentType.includes(keyword)) ||
    mediaValueKeywords.some((keyword) => valueKey.includes(keyword))
  );
};

const isLikelyImageSource = (value: string): boolean => {
  const lower = value.toLowerCase();
  return (
    lower.startsWith("data:image/") ||
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(lower)
  );
};

const resolveMediaPreview = (
  expression: string,
  uploadPreview?: MediaUploadPreview,
): { previewUrl: string | null; fileName: string | null } => {
  const parsed = parsePreviewValue(expression);
  const normalized = Array.isArray(parsed) ? parsed[0] : parsed;
  const previewUrl = uploadPreview?.previewUrl ?? (typeof normalized === "string" ? normalized : null);
  const fileName = uploadPreview?.fileName ?? null;
  return { previewUrl, fileName };
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

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
