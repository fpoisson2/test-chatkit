import { useState, useEffect, FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

interface WorkflowOption {
  id: number;
  slug: string;
  display_name: string;
  description: string | null;
  resource_type: "workflow" | "lab";
}

export default function LTIDeepLinkPage() {
  const [searchParams] = useSearchParams();
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [selectedResourceKeys, setSelectedResourceKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const state = searchParams.get("state");
  const idToken = searchParams.get("id_token");

  useEffect(() => {
    async function loadWorkflows() {
      try {
        if (!state) throw new Error("Session LTI manquante");
        const response = await fetch(`/api/lti/deep-link/resources?state=${encodeURIComponent(state)}`);
        if (!response.ok) {
          throw new Error("Impossible de charger les workflows");
        }
        const data = await response.json();
        setWorkflows(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    }

    loadWorkflows();
  }, [state]);

  const handleToggleResource = (resource: WorkflowOption) => {
    const key = `${resource.resource_type}:${resource.id}`;
    setSelectedResourceKeys((prev) =>
      prev.includes(key)
        ? prev.filter((item) => item !== key)
        : [...prev, key]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (selectedResourceKeys.length === 0) {
      alert("Veuillez sélectionner au moins une ressource");
      return;
    }

    if (!state || !idToken) {
      alert("Paramètres LTI manquants");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/lti/deep-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          state,
          id_token: idToken,
          workflow_ids: selectedResourceKeys.filter((key) => key.startsWith("workflow:")).map((key) => Number(key.split(":")[1])),
          lab_ids: selectedResourceKeys.filter((key) => key.startsWith("lab:")).map((key) => Number(key.split(":")[1])),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Erreur lors de la soumission");
      }

      const result = await response.json();

      // Créer un formulaire invisible pour POST le JWT vers Moodle
      const form = document.createElement("form");
      form.method = "POST";
      form.action = result.return_url;

      const jwtInput = document.createElement("input");
      jwtInput.type = "hidden";
      jwtInput.name = "JWT";
      jwtInput.value = result.deep_link_jwt || result.jwt;

      form.appendChild(jwtInput);
      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="lti-deep-link-page">
        <div className="container">
          <h1>Sélection de ressource LTI</h1>
          <p>Chargement des ressources disponibles...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="lti-deep-link-page">
        <div className="container">
          <h1>Sélection de ressource LTI</h1>
          <div className="error-message">
            <p>Erreur: {error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="lti-deep-link-page">
        <div className="container">
          <h1>Sélection de ressource LTI</h1>
          <p>Aucune ressource n'est disponible pour LTI.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lti-deep-link-page">
      <div className="container">
        <h1>Sélection de ressource LTI</h1>
        <p>Sélectionnez un laboratoire ou un workflow à ajouter au cours Moodle.</p>

        <form onSubmit={handleSubmit}>
          <div className="workflow-list">
            {workflows.map((workflow) => (
              <label key={`${workflow.resource_type}:${workflow.id}`} className="workflow-item">
                <input
                  type="checkbox"
                  checked={selectedResourceKeys.includes(`${workflow.resource_type}:${workflow.id}`)}
                  onChange={() => handleToggleResource(workflow)}
                  disabled={submitting}
                />
                <div className="workflow-info">
                  <h3>{workflow.display_name}</h3>
                  <small>{workflow.resource_type === "lab" ? "Laboratoire" : "Workflow"}</small>
                  {workflow.description && <p>{workflow.description}</p>}
                </div>
              </label>
            ))}
          </div>

          {error && (
            <div className="error-message">
              <p>{error}</p>
            </div>
          )}

          <div className="actions">
            <button type="submit" disabled={submitting || selectedResourceKeys.length === 0}>
              {submitting ? "Envoi en cours..." : "Ajouter au cours"}
            </button>
          </div>
        </form>

        <style>{`
          .lti-deep-link-page {
            min-height: 100vh;
            padding: 2rem;
            background: #f5f5f5;
          }

          .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          }

          h1 {
            margin-top: 0;
            color: #333;
          }

          .workflow-list {
            margin: 2rem 0;
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }

          .workflow-item {
            display: flex;
            gap: 1rem;
            padding: 1rem;
            border: 2px solid #e0e0e0;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
          }

          .workflow-item:hover {
            border-color: #007bff;
            background: #f8f9fa;
          }

          .workflow-item input[type="checkbox"] {
            flex-shrink: 0;
            width: 20px;
            height: 20px;
            cursor: pointer;
          }

          .workflow-info {
            flex: 1;
          }

          .workflow-info h3 {
            margin: 0 0 0.5rem 0;
            color: #333;
            font-size: 1.1rem;
          }

          .workflow-info p {
            margin: 0;
            color: #666;
            font-size: 0.9rem;
          }

          .error-message {
            padding: 1rem;
            background: #fee;
            border: 1px solid #fcc;
            border-radius: 4px;
            color: #c00;
            margin: 1rem 0;
          }

          .actions {
            margin-top: 2rem;
            display: flex;
            justify-content: flex-end;
          }

          .actions button {
            padding: 0.75rem 2rem;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 1rem;
            cursor: pointer;
            transition: background 0.2s;
          }

          .actions button:hover:not(:disabled) {
            background: #0056b3;
          }

          .actions button:disabled {
            background: #ccc;
            cursor: not-allowed;
          }
        `}</style>
      </div>
    </div>
  );
}
