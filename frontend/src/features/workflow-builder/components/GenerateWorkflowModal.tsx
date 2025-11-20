/**
 * Modal pour générer un workflow par IA avec streaming de progression.
 */

import { useState } from "react";
import { Sparkles, X, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Modal } from "../../../components/Modal";
import { useWorkflowGeneration } from "../../../hooks/useWorkflowGeneration";
import "../../../styles/components/generate-workflow-modal.css";

interface GenerateWorkflowModalProps {
  open: boolean;
  onClose: () => void;
  onWorkflowGenerated?: (workflow: any) => void;
}

export const GenerateWorkflowModal = ({
  open,
  onClose,
  onWorkflowGenerated,
}: GenerateWorkflowModalProps) => {
  const [description, setDescription] = useState("");
  const [workflowName, setWorkflowName] = useState("");
  const [model, setModel] = useState("gpt-4o-2024-08-06");
  const [temperature, setTemperature] = useState(0.3);
  const [saveToDatabase, setSaveToDatabase] = useState(true);

  const {
    progress,
    isGenerating,
    generatedWorkflow,
    error,
    startGeneration,
    cancelGeneration,
    reset,
  } = useWorkflowGeneration();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!description.trim()) {
      return;
    }

    startGeneration({
      description: description.trim(),
      workflow_name: workflowName.trim() || undefined,
      model,
      temperature,
      save_to_database: saveToDatabase,
    });
  };

  const handleClose = () => {
    if (isGenerating) {
      if (confirm("Une génération est en cours. Voulez-vous vraiment annuler ?")) {
        cancelGeneration();
        reset();
        onClose();
      }
    } else {
      reset();
      onClose();
    }
  };

  const handleUseWorkflow = () => {
    if (generatedWorkflow && onWorkflowGenerated) {
      onWorkflowGenerated(generatedWorkflow);
    }
    reset();
    onClose();
  };

  // Calculer le pourcentage de progression
  const progressPercent = progress
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  const getStepIcon = (step: string) => {
    if (progress?.state === "FAILURE" || progress?.state === "ERROR") {
      return <AlertCircle className="step-icon error" />;
    }
    if (progress?.state === "SUCCESS") {
      return <CheckCircle2 className="step-icon success" />;
    }
    if (progress?.step === step) {
      return <Loader2 className="step-icon spinning" />;
    }
    return <div className="step-icon pending" />;
  };

  return (
    <Modal
      title={
        <div className="modal-title-with-icon">
          <Sparkles className="title-icon" />
          <span>Générer un Workflow par IA</span>
        </div>
      }
      open={open}
      onClose={handleClose}
      size="lg"
      footer={
        !generatedWorkflow ? (
          <div className="modal-footer">
            <button
              type="button"
              onClick={handleClose}
              className="btn btn-secondary"
              disabled={isGenerating}
            >
              {isGenerating ? "Annuler" : "Fermer"}
            </button>
            {!isGenerating && (
              <button
                type="submit"
                form="generate-workflow-form"
                className="btn btn-primary"
                disabled={!description.trim()}
              >
                <Sparkles size={16} />
                Générer
              </button>
            )}
          </div>
        ) : (
          <div className="modal-footer">
            <button
              type="button"
              onClick={handleClose}
              className="btn btn-secondary"
            >
              Fermer
            </button>
            <button
              type="button"
              onClick={handleUseWorkflow}
              className="btn btn-primary"
            >
              <CheckCircle2 size={16} />
              Utiliser ce workflow
            </button>
          </div>
        )
      }
    >
      <div className="generate-workflow-modal">
        {!isGenerating && !generatedWorkflow && (
          <form id="generate-workflow-form" onSubmit={handleSubmit}>
            <div className="form-section">
              <label htmlFor="description" className="form-label required">
                Description du workflow
                <span className="label-hint">
                  Décrivez en langage naturel le workflow que vous souhaitez créer
                </span>
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Exemple : Crée un agent de support client qui accueille l'utilisateur, identifie son problème, propose des solutions, et transfère vers un humain si nécessaire"
                rows={6}
                className="form-textarea"
                required
              />
            </div>

            <div className="form-section">
              <label htmlFor="workflowName" className="form-label">
                Nom du workflow
                <span className="label-hint">Optionnel - sera généré automatiquement si vide</span>
              </label>
              <input
                id="workflowName"
                type="text"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder="Ex: Support Client IA"
                className="form-input"
              />
            </div>

            <div className="form-row">
              <div className="form-section">
                <label htmlFor="model" className="form-label">
                  Modèle IA
                </label>
                <select
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="form-select"
                >
                  <option value="gpt-4o-2024-08-06">GPT-4o (Recommandé)</option>
                  <option value="gpt-4o-mini">GPT-4o Mini (Économique)</option>
                </select>
              </div>

              <div className="form-section">
                <label htmlFor="temperature" className="form-label">
                  Température: {temperature.toFixed(1)}
                  <span className="label-hint">0.0 = déterministe, 1.0 = créatif</span>
                </label>
                <input
                  id="temperature"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="form-range"
                />
              </div>
            </div>

            <div className="form-section">
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  checked={saveToDatabase}
                  onChange={(e) => setSaveToDatabase(e.target.checked)}
                  className="form-checkbox"
                />
                <span>Sauvegarder automatiquement en base de données</span>
              </label>
            </div>
          </form>
        )}

        {isGenerating && progress && (
          <div className="generation-progress">
            <div className="progress-header">
              <h3>{progress.status}</h3>
              <span className="progress-percent">{progressPercent}%</span>
            </div>

            <div className="progress-bar-container">
              <div
                className="progress-bar"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="progress-steps">
              <div className={`progress-step ${progress.step === "init" ? "active" : ""}`}>
                {getStepIcon("init")}
                <span>Initialisation</span>
              </div>
              <div className={`progress-step ${progress.step === "prepare" ? "active" : ""}`}>
                {getStepIcon("prepare")}
                <span>Préparation</span>
              </div>
              <div className={`progress-step ${progress.step === "generating" ? "active" : ""}`}>
                {getStepIcon("generating")}
                <span>Génération</span>
              </div>
              <div className={`progress-step ${progress.step === "validating" ? "active" : ""}`}>
                {getStepIcon("validating")}
                <span>Validation</span>
              </div>
              {saveToDatabase && (
                <div className={`progress-step ${progress.step === "saving" ? "active" : ""}`}>
                  {getStepIcon("saving")}
                  <span>Sauvegarde</span>
                </div>
              )}
              <div className={`progress-step ${progress.step === "completed" ? "active" : ""}`}>
                {getStepIcon("completed")}
                <span>Terminé</span>
              </div>
            </div>

            {progress.nodes_count && (
              <div className="progress-info">
                <p>
                  <strong>Nœuds:</strong> {progress.nodes_count} |{" "}
                  <strong>Connexions:</strong> {progress.edges_count}
                </p>
              </div>
            )}

            {(progress.state === "FAILURE" || progress.state === "ERROR") && (
              <div className="error-message">
                <AlertCircle size={20} />
                <div>
                  <strong>Erreur:</strong>
                  <p>{progress.error || "Une erreur est survenue"}</p>
                  {progress.errors && progress.errors.length > 0 && (
                    <ul>
                      {progress.errors.map((err, index) => (
                        <li key={index}>{err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {generatedWorkflow && (
          <div className="generation-success">
            <div className="success-header">
              <CheckCircle2 className="success-icon" />
              <h3>Workflow généré avec succès !</h3>
            </div>

            <div className="workflow-summary">
              <div className="summary-item">
                <span className="label">Nom:</span>
                <span className="value">{generatedWorkflow.workflow_name}</span>
              </div>
              <div className="summary-item">
                <span className="label">Slug:</span>
                <span className="value">{generatedWorkflow.workflow_slug}</span>
              </div>
              <div className="summary-item">
                <span className="label">Nœuds:</span>
                <span className="value">{generatedWorkflow.graph.nodes.length}</span>
              </div>
              <div className="summary-item">
                <span className="label">Connexions:</span>
                <span className="value">{generatedWorkflow.graph.edges.length}</span>
              </div>
              {generatedWorkflow.tokens_used && (
                <div className="summary-item">
                  <span className="label">Tokens utilisés:</span>
                  <span className="value">{generatedWorkflow.tokens_used}</span>
                </div>
              )}
            </div>

            {generatedWorkflow.validation_errors.length > 0 && (
              <div className="validation-warnings">
                <AlertCircle size={20} />
                <div>
                  <strong>Avertissements de validation:</strong>
                  <ul>
                    {generatedWorkflow.validation_errors.map((err, index) => (
                      <li key={index}>{err}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {error && !isGenerating && (
          <div className="error-message">
            <AlertCircle size={20} />
            <div>
              <strong>Erreur:</strong>
              <p>{error.message}</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
