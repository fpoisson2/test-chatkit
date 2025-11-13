import { useEffect, useMemo, useState, type ChangeEvent } from "react";

import {
  applyWidgetInputValues,
  buildWidgetInputSample,
  collectWidgetBindings,
  sanitizeWidgetInputValues,
  type WidgetBindingMap,
} from "../utils/widgetPreview";
import { WidgetPreview } from "./WidgetPreview";

const toJson = (value: Record<string, string | string[]>): string =>
  JSON.stringify(value, null, 2);

const formatBindingList = (bindings: WidgetBindingMap): string => {
  const identifiers = Object.keys(bindings);
  if (identifiers.length === 0) {
    return "";
  }
  return identifiers
    .sort((a, b) => a.localeCompare(b))
    .map((identifier) => {
      const binding = bindings[identifier];
      const parts = [identifier];
      if (binding.componentType) {
        parts.push(`(${binding.componentType})`);
      }
      return parts.join(" ");
    })
    .join(", ");
};

const normalizeInput = (text: string): { values: Record<string, string | string[]>; error: string | null } => {
  if (!text.trim()) {
    return { values: {}, error: null };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    const sanitized = sanitizeWidgetInputValues(parsed);
    if (Object.keys(sanitized).length === 0 && Object.keys(parsed as object).length > 0) {
      return {
        values: sanitized,
        error: "Aucune clé valide détectée. Utilisez des paires clé/valeur simples.",
      };
    }
    return { values: sanitized, error: null };
  } catch (error) {
    return {
      values: {},
      error: "JSON invalide. Vérifiez la syntaxe et réessayez.",
    };
  }
};

const useWidgetPreviewInput = (definition: Record<string, unknown>) => {
  const bindings = useMemo(() => collectWidgetBindings(definition), [definition]);
  const [inputValues, setInputValues] = useState<Record<string, string | string[]>>(() =>
    buildWidgetInputSample(definition, bindings),
  );
  const [inputText, setInputText] = useState<string>(() =>
    toJson(buildWidgetInputSample(definition, bindings)),
  );
  const [inputError, setInputError] = useState<string | null>(null);

  useEffect(() => {
    const sample = buildWidgetInputSample(definition, bindings);
    setInputValues(sample);
    setInputText(toJson(sample));
    setInputError(null);
  }, [bindings, definition]);

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;
    setInputText(text);
    const { values, error } = normalizeInput(text);
    if (!error) {
      setInputValues(values);
      setInputError(null);
    } else {
      setInputError(error);
    }
  };

  const handleReset = () => {
    const sample = buildWidgetInputSample(definition, bindings);
    setInputValues(sample);
    setInputText(toJson(sample));
    setInputError(null);
  };

  const appliedDefinition = useMemo(
    () => applyWidgetInputValues(definition, inputValues, bindings),
    [bindings, definition, inputValues],
  );

  return {
    bindings,
    inputText,
    inputError,
    handleInputChange,
    handleReset,
    appliedDefinition,
  };
};

type WidgetPreviewPlaygroundProps = {
  definition: Record<string, unknown>;
};

export const WidgetPreviewPlayground = ({ definition }: WidgetPreviewPlaygroundProps) => {
  const { bindings, inputText, inputError, handleInputChange, handleReset, appliedDefinition } =
    useWidgetPreviewInput(definition);

  const availableBindings = useMemo(() => formatBindingList(bindings), [bindings]);
  const hasBindings = Object.keys(bindings).length > 0;
  const detailsKey = useMemo(
    () =>
      Object.keys(bindings)
        .sort()
        .join("|"),
    [bindings],
  );

  return (
    <div className="flex flex-col gap-3">
      <WidgetPreview definition={appliedDefinition} />
      <details className="accordion-item" key={detailsKey} open={hasBindings}>
        <summary className="accordion-trigger cursor-pointer">Paramètres de test du widget</summary>
        <div className="accordion-content flex flex-col gap-3">
          <p className="text-secondary m-0">
            Ces valeurs simulent le JSON transmis au widget lors de l'exécution du workflow. Modifiez-les pour
            vérifier le rendu en temps réel.
          </p>
          {hasBindings ? (
            <p className="m-0">
              <strong>Champs dynamiques disponibles :</strong> {availableBindings}
            </p>
          ) : (
            <p className="text-secondary m-0">
              Ce widget n'expose aucun champ dynamique. Le JSON d'entrée peut rester vide.
            </p>
          )}
          <div className="form-group">
            <label className="form-label">JSON d'entrée du widget</label>
            <textarea
              className="textarea"
              rows={hasBindings ? 8 : 5}
              value={inputText}
              onChange={handleInputChange}
              spellCheck={false}
              aria-label="JSON d'entrée du widget"
            />
          </div>
          {inputError ? (
            <p className="form-error m-0">{inputError}</p>
          ) : (
            <p className="form-hint text-sm m-0">
              Utilisez des chaînes ou des listes de chaînes. Les autres types seront ignorés.
            </p>
          )}
          <div className="flex gap-3">
            <button className="btn btn-sm btn-ghost" type="button" onClick={handleReset}>
              Réinitialiser les valeurs
            </button>
          </div>
        </div>
      </details>
    </div>
  );
};
