import { useMemo } from "react";
import type { AvailableModel } from "../../../../../utils/backend";
import { RichMessageField } from "../components/RichMessageField";
import styles from "../NodeInspector.module.css";

type ProviderOption = {
  value: string;
  id: string | null;
  slug: string | null;
  label: string;
};

type EvaluatedStepInspectorSectionProps = {
  nodeId: string;
  stepSlug: string;
  workflowId: number | null;
  isActiveVersion: boolean;
  instruction: string;
  evaluationPrompt: string;
  feedbackPrompt: string;
  teacherCode: string;
  maxAttempts: number;
  successMessage: string;
  escalationMessage: string;
  escalationBehavior: string;
  masked: boolean;
  model: string;
  modelProviderId: string;
  modelProviderSlug: string;
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  onFieldChange: (nodeId: string, field: string, value: string | number | boolean) => void;
};

export const EvaluatedStepInspectorSection = ({
  nodeId,
  stepSlug,
  workflowId,
  isActiveVersion,
  instruction,
  evaluationPrompt,
  feedbackPrompt,
  teacherCode,
  maxAttempts,
  successMessage,
  escalationMessage,
  escalationBehavior,
  masked,
  model,
  modelProviderId,
  modelProviderSlug,
  availableModels,
  availableModelsLoading,
  onFieldChange,
}: EvaluatedStepInspectorSectionProps) => {
  const providerOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: ProviderOption[] = [];
    for (const m of availableModels) {
      const slug = m.provider_slug?.trim().toLowerCase() ?? "";
      const id = m.provider_id?.trim() ?? "";
      if (!slug && !id) continue;
      const key = `${id}|${slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const baseLabel = slug || id || "fournisseur";
      const label = slug && id ? `${slug} (${id})` : baseLabel;
      options.push({ value: key, id: id || null, slug: slug || null, label });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [availableModels]);

  const selectedProviderValue = useMemo(() => {
    if (!modelProviderId && !modelProviderSlug) return "";
    const matchById = providerOptions.find(
      (o) => modelProviderId && o.id === modelProviderId,
    );
    if (matchById) return matchById.value;
    const matchBySlug = providerOptions.find(
      (o) => modelProviderSlug && o.slug === modelProviderSlug,
    );
    if (matchBySlug) return matchBySlug.value;
    return "";
  }, [providerOptions, modelProviderId, modelProviderSlug]);

  const modelsForProvider = useMemo(() => {
    if (!selectedProviderValue) return availableModels;
    const target = providerOptions.find((o) => o.value === selectedProviderValue);
    if (!target) return availableModels;
    const filtered = availableModels.filter((m) => {
      const normalizedSlug = m.provider_slug?.trim().toLowerCase() ?? "";
      const normalizedId = m.provider_id?.trim() ?? "";
      if (target.id && normalizedId) return normalizedId === target.id;
      if (target.slug && normalizedSlug) return normalizedSlug === target.slug;
      return false;
    });
    return filtered.length > 0 ? filtered : availableModels;
  }, [availableModels, selectedProviderValue, providerOptions]);

  const selectedModelOption = useMemo(() => {
    if (!model) return "";
    const match = modelsForProvider.find((m) => m.name === model);
    if (match) {
      return JSON.stringify({
        name: match.name,
        providerId: match.provider_id ?? null,
        providerSlug: match.provider_slug ?? null,
      });
    }
    return "";
  }, [model, modelsForProvider]);

  const handleProviderChange = (value: string) => {
    if (!value) {
      onFieldChange(nodeId, "model_provider_id", "");
      onFieldChange(nodeId, "model_provider_slug", "");
      return;
    }
    const option = providerOptions.find((o) => o.value === value);
    if (option) {
      onFieldChange(nodeId, "model_provider_id", option.id ?? "");
      onFieldChange(nodeId, "model_provider_slug", option.slug ?? "");
    }
  };

  const handleModelChange = (value: string) => {
    if (!value) {
      onFieldChange(nodeId, "model", "");
      return;
    }
    try {
      const parsed = JSON.parse(value) as {
        name: string;
        providerId: string | null;
        providerSlug: string | null;
      };
      onFieldChange(nodeId, "model", parsed.name);
      if (parsed.providerId != null) {
        onFieldChange(nodeId, "model_provider_id", parsed.providerId);
      }
      if (parsed.providerSlug != null) {
        onFieldChange(nodeId, "model_provider_slug", parsed.providerSlug);
      }
    } catch {
      onFieldChange(nodeId, "model", value);
    }
  };

  return (
    <section
      aria-label="Configuration de l'étape évaluée"
      className={styles.nodeInspectorPanelSpacious}
    >
      <RichMessageField
        value={instruction}
        onChange={(v) => onFieldChange(nodeId, "instruction", v)}
        label="Consigne"
        hint="Message envoyé à l'étudiant comme consigne. Supporte les variables de template."
        placeholder="Ex. Expliquez le concept de variable en programmation."
        rows={4}
        contentType="assistant_message"
        workflowId={workflowId}
        stepSlug={stepSlug}
        isActiveVersion={isActiveVersion}
      />

      <RichMessageField
        value={evaluationPrompt}
        onChange={(v) => onFieldChange(nodeId, "evaluation_prompt", v)}
        label="Critères d'évaluation"
        hint="Critères utilisés par l'IA pour évaluer la réponse (passe/échoue)."
        placeholder="Ex. La réponse doit mentionner qu'une variable est un espace mémoire nommé."
        rows={4}
        contentType="system_prompt"
      />

      <RichMessageField
        value={feedbackPrompt}
        onChange={(v) => onFieldChange(nodeId, "feedback_prompt", v)}
        label="Instructions de feedback"
        hint="Instructions pour générer un feedback constructif en cas d'échec. Laisser vide pour un feedback automatique."
        placeholder="Ex. Guidez l'étudiant vers la bonne réponse sans la donner directement."
        rows={3}
        contentType="system_prompt"
      />

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>Code enseignant (optionnel)</span>
        <input
          type="text"
          value={teacherCode}
          onChange={(e) => onFieldChange(nodeId, "teacher_code", e.target.value)}
          placeholder="Ex. BYPASS123"
          className={styles.nodeInspectorInput}
        />
        <p className={styles.nodeInspectorHintTextTight}>
          Code secret que l'enseignant peut entrer pour passer l'évaluation.
        </p>
      </label>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>Nombre max de tentatives</span>
        <input
          type="number"
          value={maxAttempts}
          min={1}
          max={20}
          onChange={(e) => onFieldChange(nodeId, "max_attempts", parseInt(e.target.value, 10) || 3)}
          className={styles.nodeInspectorInput}
        />
      </label>

      <RichMessageField
        value={successMessage}
        onChange={(v) => onFieldChange(nodeId, "success_message", v)}
        label="Message de succès"
        placeholder="Bravo, c'est correct!"
        rows={2}
        contentType="assistant_message"
        workflowId={workflowId}
        stepSlug={stepSlug}
        isActiveVersion={isActiveVersion}
      />

      <RichMessageField
        value={escalationMessage}
        onChange={(v) => onFieldChange(nodeId, "escalation_message", v)}
        label="Message d'escalade"
        hint="Message envoyé quand le nombre max de tentatives est atteint."
        placeholder="Demandez de l'aide à votre enseignant."
        rows={2}
        contentType="assistant_message"
        workflowId={workflowId}
        stepSlug={stepSlug}
        isActiveVersion={isActiveVersion}
      />

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>Après escalade</span>
        <select
          value={escalationBehavior}
          onChange={(e) => onFieldChange(nodeId, "escalation_behavior", e.target.value)}
          className={styles.nodeInspectorInput}
        >
          <option value="wait_for_teacher">Attendre le code enseignant</option>
          <option value="advance">Passer à l'étape suivante</option>
        </select>
        <p className={styles.nodeInspectorHintTextTight}>
          Comportement lorsque le nombre max de tentatives est atteint.
        </p>
      </label>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>Fournisseur</span>
        <select
          value={selectedProviderValue}
          onChange={(e) => handleProviderChange(e.target.value)}
          disabled={availableModelsLoading}
          className={styles.nodeInspectorInput}
        >
          <option value="">-- Fournisseur par défaut --</option>
          {providerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>Modèle IA</span>
        <select
          value={selectedModelOption}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={availableModelsLoading}
          className={styles.nodeInspectorInput}
        >
          <option value="">-- Sélectionner un modèle --</option>
          {modelsForProvider.map((m) => {
            const displayLabel = m.display_name?.trim()
              ? `${m.display_name.trim()} (${m.name})`
              : m.name;
            const providerSuffix = m.provider_slug?.trim()
              ? ` – ${m.provider_slug.trim()}`
              : m.provider_id?.trim()
                ? ` – ${m.provider_id.trim()}`
                : "";
            return (
              <option
                key={`${m.id}:${m.name}`}
                value={JSON.stringify({
                  name: m.name,
                  providerId: m.provider_id ?? null,
                  providerSlug: m.provider_slug ?? null,
                })}
              >
                {`${displayLabel}${providerSuffix}`}
              </option>
            );
          })}
        </select>
      </label>

      <label className={styles.nodeInspectorField} style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={masked}
          onChange={(e) => onFieldChange(nodeId, "masked", e.target.checked)}
        />
        <span className={styles.nodeInspectorLabel} style={{ marginBottom: 0 }}>
          Masquer la saisie (mot de passe / code)
        </span>
      </label>
    </section>
  );
};
