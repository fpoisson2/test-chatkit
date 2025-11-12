import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "../auth";
import { Modal } from "../components/Modal";
import { useI18n } from "../i18n";
import {
  type LtiRegistration,
  type LtiRegistrationCreatePayload,
  type LtiRegistrationUpdatePayload,
  type LtiToolSettings,
  type LtiToolSettingsUpdatePayload,
  isUnauthorizedError,
  ltiAdminApi,
} from "../utils/backend";
import {
  adminLtiToolSettingsSchema,
  adminLtiRegistrationSchema,
  type AdminLtiToolSettingsFormData,
  type AdminLtiRegistrationFormData,
} from "../schemas/admin";
import {
  FeedbackMessages,
  FormField,
  FormSection,
  ResponsiveTable,
  LoadingSpinner,
  type Column,
} from "../components";

const emptyRegistrationForm: AdminLtiRegistrationFormData = {
  issuer: "",
  clientId: "",
  keySetUrl: "",
  authorizationEndpoint: "",
  tokenEndpoint: "",
  deepLinkReturnUrl: "",
  audience: "",
};

const emptyToolSettingsForm: AdminLtiToolSettingsFormData = {
  clientId: "",
  keySetUrl: "",
  audience: "",
  keyId: "",
  privateKey: "",
};

const normalizeOptionalField = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const AdminLtiPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const [showCreateRegistrationModal, setShowCreateRegistrationModal] = useState(false);

  // Registration Form - React Hook Form
  const {
    register: registerReg,
    handleSubmit: handleRegSubmit,
    formState: { errors: regErrors },
    reset: resetRegForm,
  } = useForm<AdminLtiRegistrationFormData>({
    resolver: zodResolver(adminLtiRegistrationSchema),
    defaultValues: emptyRegistrationForm,
  });

  // Tool Settings Form - React Hook Form
  const {
    register: registerTool,
    handleSubmit: handleToolSubmit,
    formState: { errors: toolErrors },
    reset: resetToolForm,
    setValue: setToolValue,
  } = useForm<AdminLtiToolSettingsFormData>({
    resolver: zodResolver(adminLtiToolSettingsSchema),
    defaultValues: emptyToolSettingsForm,
  });

  const [registrations, setRegistrations] = useState<LtiRegistration[]>([]);
  const [registrationsLoading, setRegistrationsLoading] = useState(true);
  const [registrationsError, setRegistrationsError] = useState<string | null>(null);
  const [registrationsSuccess, setRegistrationsSuccess] = useState<string | null>(null);
  const [editingRegistrationId, setEditingRegistrationId] = useState<number | null>(null);
  const [isSavingRegistration, setSavingRegistration] = useState(false);

  const [toolSettings, setToolSettings] = useState<LtiToolSettings | null>(null);
  const [toolLoading, setToolLoading] = useState(true);
  const [toolError, setToolError] = useState<string | null>(null);
  const [toolSuccess, setToolSuccess] = useState<string | null>(null);
  const [toolSaving, setToolSaving] = useState(false);

  const formattedPublicKeyUpdatedAt = useMemo(() => {
    const raw = toolSettings?.public_key_last_updated_at;
    if (!raw) {
      return null;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return raw;
    }
    return parsed.toLocaleString();
  }, [toolSettings?.public_key_last_updated_at]);

  const fetchRegistrations = useCallback(async () => {
    if (!token) {
      setRegistrations([]);
      setRegistrationsLoading(false);
      return;
    }
    setRegistrationsLoading(true);
    setRegistrationsError(null);
    try {
      const data = await ltiAdminApi.listRegistrations(token);
      setRegistrations(data);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        logout();
        setRegistrationsError(t("admin.lti.registrations.errors.sessionExpired"));
      } else {
        setRegistrationsError(
          error instanceof Error
            ? error.message
            : t("admin.lti.registrations.errors.loadFailed"),
        );
      }
    } finally {
      setRegistrationsLoading(false);
    }
  }, [logout, t, token]);

  const fetchToolSettings = useCallback(async () => {
    if (!token) {
      setToolSettings(null);
      setToolLoading(false);
      return;
    }
    setToolLoading(true);
    setToolError(null);
    try {
      const data = await ltiAdminApi.getToolSettings(token);
      setToolSettings(data);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        logout();
        setToolError(t("admin.lti.toolSettings.errors.sessionExpired"));
      } else {
        setToolError(
          error instanceof Error
            ? error.message
            : t("admin.lti.toolSettings.errors.loadFailed"),
        );
      }
    } finally {
      setToolLoading(false);
    }
  }, [logout, t, token]);

  useEffect(() => {
    void fetchRegistrations();
  }, [fetchRegistrations]);

  useEffect(() => {
    void fetchToolSettings();
  }, [fetchToolSettings]);

  useEffect(() => {
    if (!toolSettings) {
      resetToolForm(emptyToolSettingsForm);
      return;
    }
    resetToolForm({
      clientId: toolSettings.client_id ?? "",
      keySetUrl: toolSettings.key_set_url ?? "",
      audience: toolSettings.audience ?? "",
      keyId: toolSettings.key_id ?? "",
      privateKey: "", // Don't populate private key for security
    });
  }, [toolSettings, resetToolForm]);

  const resetRegistrationForm = useCallback(() => {
    setEditingRegistrationId(null);
    setShowCreateRegistrationModal(false);
    resetRegForm(emptyRegistrationForm);
  }, [resetRegForm]);

  const handleEditRegistration = useCallback((entry: LtiRegistration) => {
    setEditingRegistrationId(entry.id);
    setRegistrationsSuccess(null);
    resetRegForm({
      issuer: entry.issuer,
      clientId: entry.client_id,
      keySetUrl: entry.key_set_url,
      authorizationEndpoint: entry.authorization_endpoint,
      tokenEndpoint: entry.token_endpoint,
      deepLinkReturnUrl: entry.deep_link_return_url ?? "",
      audience: entry.audience ?? "",
    });
  }, [resetRegForm]);

  const handleDeleteRegistration = async (entry: LtiRegistration) => {
    if (!token) {
      setRegistrationsError(t("admin.lti.registrations.errors.sessionExpired"));
      return;
    }
    if (!window.confirm(t("admin.lti.registrations.confirm.delete", { issuer: entry.issuer }))) {
      return;
    }
    setRegistrationsError(null);
    setRegistrationsSuccess(null);
    try {
      await ltiAdminApi.deleteRegistration(token, entry.id);
      setRegistrationsSuccess(
        t("admin.lti.registrations.feedback.deleted"),
      );
      await fetchRegistrations();
    } catch (error) {
      if (isUnauthorizedError(error)) {
        logout();
        setRegistrationsError(t("admin.lti.registrations.errors.sessionExpired"));
        return;
      }
      setRegistrationsError(
        error instanceof Error
          ? error.message
          : t("admin.lti.registrations.errors.deleteFailed"),
      );
    }
  };

  const handleRegistrationSubmit = useCallback(async (data: AdminLtiRegistrationFormData) => {
    if (!token) {
      setRegistrationsError(t("admin.lti.registrations.errors.sessionExpired"));
      return;
    }

    setSavingRegistration(true);
    setRegistrationsError(null);
    setRegistrationsSuccess(null);

    const basePayload: LtiRegistrationCreatePayload = {
      issuer: data.issuer,
      client_id: data.clientId,
      key_set_url: data.keySetUrl,
      authorization_endpoint: data.authorizationEndpoint,
      token_endpoint: data.tokenEndpoint,
      deep_link_return_url: normalizeOptionalField(data.deepLinkReturnUrl),
      audience: normalizeOptionalField(data.audience),
    };

    try {
      if (editingRegistrationId) {
        const updatePayload: LtiRegistrationUpdatePayload = {
          issuer: basePayload.issuer,
          client_id: basePayload.client_id,
          key_set_url: basePayload.key_set_url,
          authorization_endpoint: basePayload.authorization_endpoint,
          token_endpoint: basePayload.token_endpoint,
          deep_link_return_url: basePayload.deep_link_return_url,
          audience: basePayload.audience,
        };
        const updated = await ltiAdminApi.updateRegistration(
          token,
          editingRegistrationId,
          updatePayload,
        );
        setRegistrationsSuccess(
          t("admin.lti.registrations.feedback.updated", { issuer: updated.issuer }),
        );
      } else {
        const created = await ltiAdminApi.createRegistration(token, basePayload);
        setRegistrationsSuccess(
          t("admin.lti.registrations.feedback.created", { issuer: created.issuer }),
        );
        setShowCreateRegistrationModal(false);
      }
      await fetchRegistrations();
      if (editingRegistrationId) {
        resetRegistrationForm();
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        logout();
        setRegistrationsError(t("admin.lti.registrations.errors.sessionExpired"));
      } else {
        setRegistrationsError(
          error instanceof Error
            ? error.message
            : t("admin.lti.registrations.errors.saveFailed"),
        );
      }
    } finally {
      setSavingRegistration(false);
    }
  }, [token, editingRegistrationId, t, fetchRegistrations, resetRegistrationForm, logout]);

  const handleToolFormSubmit = useCallback(async (data: AdminLtiToolSettingsFormData) => {
    if (!token) {
      setToolError(t("admin.lti.toolSettings.errors.sessionExpired"));
      return;
    }

    const payload: LtiToolSettingsUpdatePayload = {
      client_id: data.clientId,
      key_set_url: data.keySetUrl,
      audience: normalizeOptionalField(data.audience),
      key_id: normalizeOptionalField(data.keyId),
    };
    if (data.privateKey?.trim()) {
      payload.private_key = data.privateKey;
    }

    setToolSaving(true);
    setToolError(null);
    setToolSuccess(null);
    try {
      const updated = await ltiAdminApi.updateToolSettings(token, payload);
      setToolSettings(updated);
      setToolSuccess(t("admin.lti.toolSettings.success"));
      // Clear private key field after successful save
      setToolValue("privateKey", "");
    } catch (error) {
      if (isUnauthorizedError(error)) {
        logout();
        setToolError(t("admin.lti.toolSettings.errors.sessionExpired"));
      } else {
        setToolError(
          error instanceof Error
            ? error.message
            : t("admin.lti.toolSettings.errors.saveFailed"),
        );
      }
    } finally {
      setToolSaving(false);
    }
  }, [token, t, logout, setToolValue]);


  const registrationColumns: Column<LtiRegistration>[] = useMemo(() => [
    {
      key: "issuer",
      label: t("admin.lti.registrations.table.issuer"),
      render: (entry) => entry.issuer,
    },
    {
      key: "clientId",
      label: t("admin.lti.registrations.table.clientId"),
      render: (entry) => entry.client_id,
    },
    {
      key: "keySetUrl",
      label: t("admin.lti.registrations.table.keySetUrl"),
      render: (entry) => entry.key_set_url,
    },
    {
      key: "authEndpoint",
      label: t("admin.lti.registrations.table.authorizationEndpoint"),
      render: (entry) => entry.authorization_endpoint,
    },
    {
      key: "tokenEndpoint",
      label: t("admin.lti.registrations.table.tokenEndpoint"),
      render: (entry) => entry.token_endpoint,
    },
    {
      key: "deepLink",
      label: t("admin.lti.registrations.table.deepLinkReturnUrl"),
      render: (entry) => entry.deep_link_return_url ?? "—",
    },
    {
      key: "audience",
      label: t("admin.lti.registrations.table.audience"),
      render: (entry) => entry.audience ?? "—",
    },
    {
      key: "updated",
      label: t("admin.lti.registrations.table.updatedAt"),
      render: (entry) => new Date(entry.updated_at).toLocaleString(),
    },
    {
      key: "actions",
      label: t("admin.lti.registrations.table.actions"),
      render: (entry) => (
        <div className="admin-table__actions">
          <button
            type="button"
            className="button button--subtle button--sm"
            onClick={() => handleEditRegistration(entry)}
          >
            {t("admin.lti.registrations.actions.edit")}
          </button>
          <button
            type="button"
            className="button button--danger button--sm"
            onClick={() => handleDeleteRegistration(entry)}
          >
            {t("admin.lti.registrations.actions.delete")}
          </button>
        </div>
      ),
    },
  ], [t, handleEditRegistration, handleDeleteRegistration]);

  return (
    <>
      <FeedbackMessages
        error={toolError || registrationsError}
        success={toolSuccess || registrationsSuccess}
        onDismissError={() => {
          setToolError(null);
          setRegistrationsError(null);
        }}
        onDismissSuccess={() => {
          setToolSuccess(null);
          setRegistrationsSuccess(null);
        }}
      />

      <div className="admin-grid">
        <FormSection
          title={t("admin.lti.toolSettings.keys.title")}
          subtitle={t("admin.lti.toolSettings.keys.subtitle")}
          className="admin-card--stretch"
        >
          {toolLoading ? (
            <LoadingSpinner text={t("admin.lti.registrations.table.loading")} />
          ) : (
            <>
              <div className="admin-key-details">
                <div className="admin-key-details__row">
                  <span className="admin-key-details__label">
                    {t("admin.lti.toolSettings.keys.privateKeyPath")}
                  </span>
                  <span className="admin-key-details__value">
                    {toolSettings?.private_key_path ??
                      t("admin.lti.toolSettings.keys.noData")}
                  </span>
                </div>
                <div className="admin-key-details__row">
                  <span className="admin-key-details__label">
                    {t("admin.lti.toolSettings.keys.publicKeyPath")}
                  </span>
                  <span className="admin-key-details__value">
                    {toolSettings?.public_key_path ??
                      t("admin.lti.toolSettings.keys.noData")}
                  </span>
                </div>
                <div className="admin-key-details__row">
                  <span className="admin-key-details__label">
                    {t("admin.lti.toolSettings.keys.lastUpdated")}
                  </span>
                  <span className="admin-key-details__value">
                    {toolSettings?.public_key_last_updated_at
                      ? formattedPublicKeyUpdatedAt ??
                        toolSettings.public_key_last_updated_at
                      : t("admin.lti.toolSettings.keys.noData")}
                  </span>
                </div>
              </div>
              {toolSettings?.public_key_pem && (
                <div className="admin-key-details__public-key">
                  <span className="admin-key-details__label admin-key-details__label--block">
                    {t("admin.lti.toolSettings.keys.publicKeyHeading")}
                  </span>
                  <pre className="code-block admin-key-details__code">
                    {toolSettings.public_key_pem}
                  </pre>
                </div>
              )}
              <p className="admin-form__hint">
                {t("admin.lti.toolSettings.keys.readOnlyNotice")}
              </p>
            </>
          )}
        </FormSection>

        <FormSection
          title={t("admin.lti.toolSettings.title")}
          subtitle={t("admin.lti.toolSettings.subtitle")}
        >
          {toolLoading ? (
            <LoadingSpinner text={t("admin.lti.registrations.table.loading")} />
          ) : (
            <form className="admin-form" onSubmit={handleToolSubmit(handleToolFormSubmit)}>
              <FormField
                label={t("admin.lti.toolSettings.clientIdLabel")}
                error={toolErrors.clientId?.message}
              >
                <input
                  className="input"
                  type="text"
                  {...registerTool("clientId")}
                  autoComplete="off"
                />
              </FormField>

              <FormField
                label={t("admin.lti.toolSettings.keySetUrlLabel")}
                error={toolErrors.keySetUrl?.message}
              >
                <input
                  className="input"
                  type="url"
                  {...registerTool("keySetUrl")}
                  autoComplete="off"
                />
              </FormField>

              <FormField label={t("admin.lti.toolSettings.audienceLabel")}>
                <input
                  className="input"
                  type="text"
                  {...registerTool("audience")}
                  autoComplete="off"
                />
              </FormField>

              <FormField label={t("admin.lti.toolSettings.keyIdLabel")}>
                <input
                  className="input"
                  type="text"
                  {...registerTool("keyId")}
                  autoComplete="off"
                />
              </FormField>

              <FormField
                label={t("admin.lti.toolSettings.privateKeyLabel")}
                hint={
                  toolSettings?.has_private_key
                    ? t("admin.lti.toolSettings.privateKeyHint", {
                        hint: toolSettings.private_key_hint ?? "••••",
                      })
                    : t("admin.lti.toolSettings.noPrivateKey")
                }
              >
                <textarea
                  className="textarea"
                  {...registerTool("privateKey")}
                  rows={5}
                />
              </FormField>

              <div className="admin-form__actions">
                <button className="button" type="submit" disabled={toolSaving}>
                  {toolSaving
                    ? t("admin.lti.toolSettings.saving")
                    : t("admin.lti.toolSettings.save")}
                </button>
              </div>
            </form>
          )}
        </FormSection>

        <FormSection
          title={t("admin.lti.registrations.title")}
          subtitle={t("admin.lti.registrations.subtitle")}
          className="admin-card--wide"
          headerAction={
            <button
              type="button"
              className="management-header__icon-button"
              aria-label="Ajouter une registration LTI"
              title="Ajouter une registration LTI"
              onClick={() => setShowCreateRegistrationModal(true)}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M10 4v12M4 10h12"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          }
        >
          {registrationsLoading ? (
            <LoadingSpinner text={t("admin.lti.registrations.table.loading")} />
          ) : registrations.length === 0 ? (
            <p>{t("admin.lti.registrations.table.empty")}</p>
          ) : (
            <ResponsiveTable
              columns={registrationColumns}
              data={registrations}
              keyExtractor={(entry) => entry.id.toString()}
              mobileCardView={true}
            />
          )}
        </FormSection>

        {editingRegistrationId && (
          <FormSection
            title={t("admin.lti.registrations.form.editTitle")}
          >
          <form className="admin-form" onSubmit={handleRegSubmit(handleRegistrationSubmit)}>
            <FormField
              label={t("admin.lti.registrations.form.issuerLabel")}
              error={regErrors.issuer?.message}
            >
              <input
                className="input"
                type="url"
                {...registerReg("issuer")}
                autoComplete="off"
              />
            </FormField>

            <FormField
              label={t("admin.lti.registrations.form.clientIdLabel")}
              error={regErrors.clientId?.message}
            >
              <input
                className="input"
                type="text"
                {...registerReg("clientId")}
                autoComplete="off"
              />
            </FormField>

            <FormField
              label={t("admin.lti.registrations.form.keySetUrlLabel")}
              error={regErrors.keySetUrl?.message}
            >
              <input
                className="input"
                type="url"
                {...registerReg("keySetUrl")}
                autoComplete="off"
              />
            </FormField>

            <FormField
              label={t("admin.lti.registrations.form.authorizationEndpointLabel")}
              error={regErrors.authorizationEndpoint?.message}
            >
              <input
                className="input"
                type="url"
                {...registerReg("authorizationEndpoint")}
                autoComplete="off"
              />
            </FormField>

            <FormField
              label={t("admin.lti.registrations.form.tokenEndpointLabel")}
              error={regErrors.tokenEndpoint?.message}
            >
              <input
                className="input"
                type="url"
                {...registerReg("tokenEndpoint")}
                autoComplete="off"
              />
            </FormField>

            <FormField label={t("admin.lti.registrations.form.deepLinkReturnUrlLabel")}>
              <input
                className="input"
                type="url"
                {...registerReg("deepLinkReturnUrl")}
                autoComplete="off"
              />
            </FormField>

            <FormField label={t("admin.lti.registrations.form.audienceLabel")}>
              <input
                className="input"
                type="text"
                {...registerReg("audience")}
                autoComplete="off"
              />
            </FormField>

            <div className="admin-form__actions">
              <button
                className="button"
                type="submit"
                disabled={isSavingRegistration}
              >
                {isSavingRegistration
                  ? t("admin.lti.registrations.form.saving")
                  : t("admin.lti.registrations.form.save")}
              </button>
              {editingRegistrationId && (
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={resetRegistrationForm}
                >
                  {t("admin.lti.registrations.form.cancel")}
                </button>
              )}
            </div>
          </form>
        </FormSection>
        )}
      </div>

      {showCreateRegistrationModal && (
        <Modal
          title={t("admin.lti.registrations.form.createTitle")}
          onClose={() => setShowCreateRegistrationModal(false)}
          footer={
            <>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setShowCreateRegistrationModal(false)}
              >
                Annuler
              </button>
              <button
                className="button"
                type="submit"
                form="create-lti-registration-form"
                disabled={isSavingRegistration}
              >
                {t("admin.lti.registrations.form.save")}
              </button>
            </>
          }
        >
          <form id="create-lti-registration-form" className="admin-form" onSubmit={handleRegSubmit(handleRegistrationSubmit)}>
            <FormField
              label={t("admin.lti.registrations.form.issuerLabel")}
              error={regErrors.issuer?.message}
            >
              <input
                className="input"
                type="url"
                {...registerReg("issuer")}
                autoComplete="off"
              />
            </FormField>

            <FormField
              label={t("admin.lti.registrations.form.clientIdLabel")}
              error={regErrors.clientId?.message}
            >
              <input
                className="input"
                type="text"
                {...registerReg("clientId")}
                autoComplete="off"
              />
            </FormField>

            <FormField
              label={t("admin.lti.registrations.form.keySetUrlLabel")}
              error={regErrors.keySetUrl?.message}
            >
              <input
                className="input"
                type="url"
                {...registerReg("keySetUrl")}
                autoComplete="off"
              />
            </FormField>

            <FormField
              label={t("admin.lti.registrations.form.authorizationEndpointLabel")}
              error={regErrors.authorizationEndpoint?.message}
            >
              <input
                className="input"
                type="url"
                {...registerReg("authorizationEndpoint")}
                autoComplete="off"
              />
            </FormField>

            <FormField
              label={t("admin.lti.registrations.form.tokenEndpointLabel")}
              error={regErrors.tokenEndpoint?.message}
            >
              <input
                className="input"
                type="url"
                {...registerReg("tokenEndpoint")}
                autoComplete="off"
              />
            </FormField>

            <FormField label={t("admin.lti.registrations.form.deepLinkReturnUrlLabel")}>
              <input
                className="input"
                type="url"
                {...registerReg("deepLinkReturnUrl")}
                autoComplete="off"
              />
            </FormField>

            <FormField label={t("admin.lti.registrations.form.audienceLabel")}>
              <input
                className="input"
                type="text"
                {...registerReg("audience")}
                autoComplete="off"
              />
            </FormField>
          </form>
        </Modal>
      )}
    </>
  );
};
