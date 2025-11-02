import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';

interface Workflow {
  id: number;
  slug: string;
  display_name: string;
  lti_title: string | null;
  lti_description: string | null;
}

export default function LTIDeepLinkPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const token = searchParams.get('token');
  const { setToken } = useAuth();

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Set the LTI token for authentication
    if (token) {
      setToken(token);
    }

    // Fetch LTI-enabled workflows
    const fetchWorkflows = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/api/admin/lti/workflows/lti-enabled`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch workflows');
        }

        const data = await response.json();
        setWorkflows(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchWorkflows();
  }, [token, setToken]);

  const handleSubmit = async () => {
    if (!selectedWorkflow || !sessionId) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/api/lti/deep-link/submit?session_id=${sessionId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            workflow_id: selectedWorkflow,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to submit deep link');
      }

      const data = await response.json();

      // Create a form to submit the deep link JWT back to the LMS
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = data.return_url;

      const jwtInput = document.createElement('input');
      jwtInput.type = 'hidden';
      jwtInput.name = 'JWT';
      jwtInput.value = data.jwt;
      form.appendChild(jwtInput);

      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading workflows...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white shadow rounded-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Select a Workflow
          </h1>
          <p className="text-gray-600 mb-8">
            Choose a workflow to add to your course
          </p>

          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {workflows.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">
                No workflows available for LTI integration.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {workflows.map((workflow) => (
                <div
                  key={workflow.id}
                  className={`border rounded-lg p-4 cursor-pointer transition-all ${
                    selectedWorkflow === workflow.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSelectedWorkflow(workflow.id)}
                >
                  <div className="flex items-start">
                    <input
                      type="radio"
                      checked={selectedWorkflow === workflow.id}
                      onChange={() => setSelectedWorkflow(workflow.id)}
                      className="mt-1 mr-3"
                    />
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {workflow.lti_title || workflow.display_name}
                      </h3>
                      {workflow.lti_description && (
                        <p className="mt-1 text-gray-600">
                          {workflow.lti_description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-8 flex justify-end space-x-4">
            <button
              onClick={handleSubmit}
              disabled={!selectedWorkflow || submitting}
              className={`px-6 py-2 rounded-md font-medium ${
                !selectedWorkflow || submitting
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {submitting ? 'Adding...' : 'Add to Course'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
