import { useEffect, useState } from 'react';
import { useAuth } from '../auth';

interface LTIPlatform {
  id: number;
  name: string;
  issuer: string;
  client_id: string;
  auth_login_url: string;
  auth_token_url: string;
  key_set_url: string;
  is_active: boolean;
  created_at: string;
}

interface LTIDeployment {
  id: number;
  platform_id: number;
  deployment_id: string;
  name: string | null;
}

export default function AdminLTIPlatformsPage() {
  const { token } = useAuth();
  const [platforms, setPlatforms] = useState<LTIPlatform[]>([]);
  const [deployments, setDeployments] = useState<Record<number, LTIDeployment[]>>({});
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<number | null>(null);
  const [showAddDeployment, setShowAddDeployment] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    issuer: '',
    client_id: '',
    auth_login_url: '',
    auth_token_url: '',
    key_set_url: '',
    auth_audience: '',
    ags_lineitems_url: '',
    primary_deployment_id: '',
    additional_deployment_ids: '',
  });

  const [deploymentFormData, setDeploymentFormData] = useState({
    deployment_id: '',
    name: '',
  });

  useEffect(() => {
    fetchPlatforms();
  }, []);

  const fetchPlatforms = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/api/admin/lti/platforms`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) throw new Error('Failed to fetch platforms');

      const data = await response.json();
      setPlatforms(data);

      // Fetch deployments for each platform
      for (const platform of data) {
        fetchDeployments(platform.id);
      }
    } catch (error) {
      console.error('Error fetching platforms:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDeployments = async (platformId: number) => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/api/admin/lti/platforms/${platformId}/deployments`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) throw new Error('Failed to fetch deployments');

      const data = await response.json();
      setDeployments((prev) => ({ ...prev, [platformId]: data }));
    } catch (error) {
      console.error('Error fetching deployments:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      // Parse additional deployment IDs from textarea (one per line)
      const additionalDeployments = formData.additional_deployment_ids
        .split('\n')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      const payload = {
        ...formData,
        additional_deployment_ids: additionalDeployments,
      };

      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/api/admin/lti/platforms`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) throw new Error('Failed to create platform');

      setShowAddForm(false);
      setFormData({
        name: '',
        issuer: '',
        client_id: '',
        auth_login_url: '',
        auth_token_url: '',
        key_set_url: '',
        auth_audience: '',
        ags_lineitems_url: '',
        primary_deployment_id: '',
        additional_deployment_ids: '',
      });
      fetchPlatforms();
    } catch (error) {
      console.error('Error creating platform:', error);
      alert('Failed to create platform');
    }
  };

  const handleDeletePlatform = async (platformId: number) => {
    if (!confirm('Are you sure you want to delete this platform?')) return;

    try {
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/api/admin/lti/platforms/${platformId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) throw new Error('Failed to delete platform');

      fetchPlatforms();
    } catch (error) {
      console.error('Error deleting platform:', error);
      alert('Failed to delete platform');
    }
  };

  const handleAddDeployment = async (e: React.FormEvent, platformId: number) => {
    e.preventDefault();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/api/admin/lti/platforms/${platformId}/deployments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            platform_id: platformId,
            ...deploymentFormData,
          }),
        }
      );

      if (!response.ok) throw new Error('Failed to create deployment');

      setShowAddDeployment(null);
      setDeploymentFormData({ deployment_id: '', name: '' });
      fetchDeployments(platformId);
    } catch (error) {
      console.error('Error creating deployment:', error);
      alert('Failed to create deployment');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">LTI 1.3 Platforms</h1>
        <button
          onClick={() => setShowAddForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Add Platform
        </button>
      </div>

      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">Enregistre les informations fournies par ton fournisseur LTI</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nom de la plateforme</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="Moodle Production"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Nom descriptif pour identifier cette plateforme
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Issuer</label>
                <input
                  type="text"
                  required
                  value={formData.issuer}
                  onChange={(e) => setFormData({ ...formData, issuer: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="https://lti.example"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Client ID</label>
                <input
                  type="text"
                  required
                  value={formData.client_id}
                  onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="Identifiant fourni"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">URL d'autorisation</label>
                <input
                  type="url"
                  required
                  value={formData.auth_login_url}
                  onChange={(e) => setFormData({ ...formData, auth_login_url: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="https://platform.example/auth"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Token endpoint</label>
                <input
                  type="url"
                  required
                  value={formData.auth_token_url}
                  onChange={(e) => setFormData({ ...formData, auth_token_url: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="https://platform.example/token"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">JWKS URI</label>
                <input
                  type="url"
                  required
                  value={formData.key_set_url}
                  onChange={(e) => setFormData({ ...formData, key_set_url: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="https://platform.example/jwks"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Audience</label>
                <input
                  type="text"
                  value={formData.auth_audience}
                  onChange={(e) => setFormData({ ...formData, auth_audience: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="Audience optionnelle"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Deployment ID principal</label>
                <input
                  type="text"
                  required
                  value={formData.primary_deployment_id}
                  onChange={(e) => setFormData({ ...formData, primary_deployment_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="ex: deployment-123"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Autres deployment IDs (un par ligne)
                </label>
                <textarea
                  value={formData.additional_deployment_ids}
                  onChange={(e) =>
                    setFormData({ ...formData, additional_deployment_ids: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-md"
                  rows={3}
                  placeholder="deployment-456&#10;deployment-789"
                />
                <p className="text-xs text-gray-500 mt-1">Optionnel : un deployment ID par ligne</p>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 border rounded-md hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {platforms.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <p className="text-gray-500">No LTI platforms configured</p>
            <p className="text-sm text-gray-400 mt-2">Click "Add Platform" to get started</p>
          </div>
        ) : (
          platforms.map((platform) => (
            <div key={platform.id} className="bg-white border rounded-lg p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-semibold">{platform.name}</h3>
                  <p className="text-sm text-gray-500">{platform.issuer}</p>
                </div>
                <div className="flex space-x-2">
                  <span
                    className={`px-3 py-1 rounded-full text-sm ${
                      platform.is_active
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {platform.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    onClick={() => handleDeletePlatform(platform.id)}
                    className="px-3 py-1 text-red-600 hover:bg-red-50 rounded-md"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <span className="text-gray-600">Client ID:</span>
                  <p className="font-mono">{platform.client_id}</p>
                </div>
                <div>
                  <span className="text-gray-600">Created:</span>
                  <p>{new Date(platform.created_at).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-semibold">Deployments</h4>
                  <button
                    onClick={() => setShowAddDeployment(platform.id)}
                    className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md"
                  >
                    Add Deployment
                  </button>
                </div>

                {showAddDeployment === platform.id && (
                  <form
                    onSubmit={(e) => handleAddDeployment(e, platform.id)}
                    className="bg-gray-50 p-4 rounded-md mb-3 space-y-3"
                  >
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Deployment ID
                      </label>
                      <input
                        type="text"
                        required
                        value={deploymentFormData.deployment_id}
                        onChange={(e) =>
                          setDeploymentFormData({
                            ...deploymentFormData,
                            deployment_id: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border rounded-md"
                        placeholder="1"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Name (optional)
                      </label>
                      <input
                        type="text"
                        value={deploymentFormData.name}
                        onChange={(e) =>
                          setDeploymentFormData({
                            ...deploymentFormData,
                            name: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border rounded-md"
                        placeholder="Production Deployment"
                      />
                    </div>
                    <div className="flex justify-end space-x-2">
                      <button
                        type="button"
                        onClick={() => setShowAddDeployment(null)}
                        className="px-3 py-1 border rounded-md text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-1 bg-blue-600 text-white rounded-md text-sm"
                      >
                        Add
                      </button>
                    </div>
                  </form>
                )}

                {deployments[platform.id]?.length > 0 ? (
                  <div className="space-y-2">
                    {deployments[platform.id].map((deployment) => (
                      <div
                        key={deployment.id}
                        className="flex justify-between items-center p-3 bg-gray-50 rounded-md"
                      >
                        <div>
                          <span className="font-medium">{deployment.deployment_id}</span>
                          {deployment.name && (
                            <span className="text-sm text-gray-500 ml-2">
                              ({deployment.name})
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">No deployments</p>
                )}
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="font-semibold mb-2">Configuration URLs</h4>
                <div className="bg-gray-50 p-3 rounded-md space-y-2 text-sm">
                  <div>
                    <span className="text-gray-600">Login Initiation URL:</span>
                    <p className="font-mono text-xs break-all">
                      {`${window.location.origin}/api/lti/login`}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-600">Redirect/Launch URL:</span>
                    <p className="font-mono text-xs break-all">
                      {`${window.location.origin}/api/lti/launch`}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-600">Public JWK URL:</span>
                    <p className="font-mono text-xs break-all">
                      {`${window.location.origin}/api/lti/jwks/${platform.id}`}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
