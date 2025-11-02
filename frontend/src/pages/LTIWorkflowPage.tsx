import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import MyChat from '../MyChat';

interface LTISession {
  id: number;
  session_id: string;
  user_id: number;
  workflow_id: number | null;
  score: number | null;
  score_maximum: number;
  score_submitted: boolean;
  context_title: string | null;
}

export default function LTIWorkflowPage() {
  const { workflowSlug } = useParams<{ workflowSlug: string }>();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const token = searchParams.get('token');
  const { setToken } = useAuth();

  const [ltiSession, setLTISession] = useState<LTISession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Set the LTI token for authentication
    if (token) {
      setToken(token);
      localStorage.setItem('chatkit:auth:token', token);
    }

    // Fetch LTI session info
    const fetchSession = async () => {
      if (!sessionId) {
        setError('No session ID provided');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/api/lti/sessions/${sessionId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch LTI session');
        }

        const data = await response.json();
        setLTISession(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [sessionId, token, setToken]);

  const handleWorkflowComplete = async (score: number) => {
    if (!sessionId || !ltiSession) return;

    try {
      // Submit grade to LMS
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/api/lti/grades/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            session_id: sessionId,
            score: score,
            score_maximum: ltiSession.score_maximum,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to submit grade');
      }

      // Update local session state
      setLTISession({
        ...ltiSession,
        score,
        score_submitted: true,
      });
    } catch (err) {
      console.error('Failed to submit grade:', err);
      // Don't show error to user, just log it
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading workflow...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white shadow rounded-lg p-8 max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-4">Error</h2>
          <p className="text-gray-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {ltiSession?.context_title && (
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-7xl mx-auto">
            <p className="text-sm text-gray-600">
              Course: <span className="font-medium">{ltiSession.context_title}</span>
            </p>
            {ltiSession.score_submitted && (
              <p className="text-sm text-green-600 mt-1">
                ✓ Grade submitted: {ltiSession.score}/{ltiSession.score_maximum}
              </p>
            )}
          </div>
        </div>
      )}

      <MyChat
        hostedWorkflowSlug={workflowSlug}
        onWorkflowComplete={handleWorkflowComplete}
        ltiMode={true}
        ltiSessionId={sessionId || undefined}
      />
    </div>
  );
}
