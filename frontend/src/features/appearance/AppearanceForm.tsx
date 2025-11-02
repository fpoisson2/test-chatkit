import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useI18n } from "../../i18n";
import type {
  AppearanceSettings,
  AppearanceSettingsUpdatePayload,
} from "../../utils/backend";

const DEFAULT_COLOR = "#2563eb";

export type AppearanceFormState = {
  colorScheme: "system" | "light" | "dark";
  accentColor: string;
  useCustomSurfaceColors: boolean;
  surfaceHue: number;
  surfaceTint: number;
  surfaceShade: number;
  headingFont: string;
  bodyFont: string;
  startGreeting: string;
  startPrompt: string;
  inputPlaceholder: string;
  disclaimer: string;
};

export const DEFAULT_FORM_STATE: AppearanceFormState = {
  colorScheme: "system",
  accentColor: DEFAULT_COLOR,
  useCustomSurfaceColors: false,
  surfaceHue: 222,
  surfaceTint: 92,
  surfaceShade: 16,
  headingFont:
    '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
  bodyFont:
    '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
  startGreeting: "",
  startPrompt: "",
  inputPlaceholder: "",
  disclaimer: "",
};

export const ensureColorValue = (value: string): string => {
  if (!value) {
    return DEFAULT_COLOR;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_COLOR;
  }
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
};

const normalizeTextField = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const buildFormStateFromSettings = (
  settings: AppearanceSettings | null,
): AppearanceFormState => {
  if (!settings) {
    return DEFAULT_FORM_STATE;
  }

  return {
    colorScheme: settings.color_scheme ?? "system",
    accentColor: ensureColorValue(settings.accent_color ?? DEFAULT_COLOR),
    useCustomSurfaceColors: Boolean(settings.use_custom_surface_colors),
    surfaceHue: settings.surface_hue ?? DEFAULT_FORM_STATE.surfaceHue,
    surfaceTint: settings.surface_tint ?? DEFAULT_FORM_STATE.surfaceTint,
    surfaceShade: settings.surface_shade ?? DEFAULT_FORM_STATE.surfaceShade,
    headingFont:
      settings.heading_font?.trim() || DEFAULT_FORM_STATE.headingFont,
    bodyFont: settings.body_font?.trim() || DEFAULT_FORM_STATE.bodyFont,
    startGreeting: settings.start_screen_greeting ?? "",
    startPrompt: settings.start_screen_prompt ?? "",
    inputPlaceholder: settings.start_screen_placeholder ?? "",
    disclaimer: settings.start_screen_disclaimer ?? "",
  };
};

export const buildAppearanceUpdatePayload = (
  state: AppearanceFormState,
): AppearanceSettingsUpdatePayload => ({
  color_scheme: state.colorScheme,
  accent_color: state.accentColor,
  use_custom_surface_colors: state.useCustomSurfaceColors,
  surface_hue: state.useCustomSurfaceColors ? state.surfaceHue : null,
  surface_tint: state.useCustomSurfaceColors ? state.surfaceTint : null,
  surface_shade: state.useCustomSurfaceColors ? state.surfaceShade : null,
  heading_font: normalizeTextField(state.headingFont),
  body_font: normalizeTextField(state.bodyFont),
  start_screen_greeting: normalizeTextField(state.startGreeting),
  start_screen_prompt: normalizeTextField(state.startPrompt),
  start_screen_placeholder: normalizeTextField(state.inputPlaceholder),
  start_screen_disclaimer: normalizeTextField(state.disclaimer),
});

type AppearanceFormProps = {
  id?: string;
  initialSettings: AppearanceSettings | null;
  isLoading?: boolean;
  isBusy?: boolean;
  autoFocus?: boolean;
  onSubmit: (payload: AppearanceSettingsUpdatePayload) => void | Promise<void>;
  footer?: ((context: { isBusy: boolean }) => React.ReactNode | null) | null;
};

export const AppearanceForm = ({
  id,
  initialSettings,
  isLoading = false,
  isBusy = false,
  autoFocus = false,
  onSubmit,
  footer,
}: AppearanceFormProps) => {
  const { t } = useI18n();
  const [formState, setFormState] = useState<AppearanceFormState>(
    DEFAULT_FORM_STATE,
  );
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    setFormState(buildFormStateFromSettings(initialSettings));
  }, [initialSettings]);

  useEffect(() => {
    if (!autoFocus || isLoading) {
      return;
    }
    const form = formRef.current;
    if (!form) {
      return;
    }
    const firstField = form.querySelector<HTMLElement>(
      "input, textarea, select, button",
    );
    firstField?.focus();
  }, [autoFocus, isLoading, formState]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      onSubmit(buildAppearanceUpdatePayload(formState));
    },
    [formState, onSubmit],
  );

  const handleSurfaceToggle = useCallback((checked: boolean) => {
    setFormState((current) => ({
      ...current,
      useCustomSurfaceColors: checked,
    }));
  }, []);

  const handleRangeChange = useCallback(
    (key: "surfaceHue" | "surfaceTint" | "surfaceShade", value: number) => {
      setFormState((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const accentPreviewStyle = useMemo(
    () => ({
      backgroundColor: formState.accentColor,
    }),
    [formState.accentColor],
  );

  const actions = footer?.({ isBusy }) ?? null;

  if (isLoading) {
    return (
      <p className="admin-form__hint">{t("admin.appearance.loading")}</p>
    );
  }

  return (
    <form id={id} ref={formRef} className="admin-form" onSubmit={handleSubmit}>
      <section className="admin-card" aria-labelledby="appearance-color-scheme">
        <div>
          <h2 id="appearance-color-scheme" className="admin-card__title">
            {t("admin.appearance.colorScheme.cardTitle")}
          </h2>
          <p className="admin-card__subtitle">
            {t("admin.appearance.colorScheme.cardDescription")}
          </p>
        </div>
        <div className="admin-form__row">
          {["system", "light", "dark"].map((option) => {
            const typedOption = option as AppearanceFormState["colorScheme"];
            return (
              <label key={option} className="radio-field">
                <input
                  type="radio"
                  name="appearance-color-scheme"
                  value={option}
                  checked={formState.colorScheme === typedOption}
                  onChange={() =>
                    setFormState((current) => ({
                      ...current,
                      colorScheme: typedOption,
                    }))
                  }
                  disabled={isBusy}
                />
                <span>
                  {t(`admin.appearance.colorScheme.option.${option}`)}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="admin-card" aria-labelledby="appearance-colors">
        <div>
          <h2 id="appearance-colors" className="admin-card__title">
            {t("admin.appearance.colors.cardTitle")}
          </h2>
          <p className="admin-card__subtitle">
            {t("admin.appearance.colors.cardDescription")}
          </p>
        </div>
        <div className="admin-form__row">
          <label className="input-field">
            <span className="input-label">
              {t("admin.appearance.colors.accentLabel")}
            </span>
            <div className="admin-form__color-picker">
              <input
                type="color"
                value={formState.accentColor}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    accentColor: ensureColorValue(event.target.value),
                  }))
                }
                disabled={isBusy}
                aria-label={t("admin.appearance.colors.accentAria")}
              />
              <div
                className="admin-form__color-preview"
                style={accentPreviewStyle}
                aria-hidden="true"
              />
            </div>
            <p className="admin-form__hint">
              {t("admin.appearance.colors.accentHint")}
            </p>
          </label>
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={formState.useCustomSurfaceColors}
            onChange={(event) => handleSurfaceToggle(event.target.checked)}
            disabled={isBusy}
          />
          {t("admin.appearance.colors.enableCustomSurfaces")}
        </label>
        <div className="admin-form__slider-group">
          <label className="input-field">
            <span className="input-label">
              {t("admin.appearance.colors.hueLabel")}
            </span>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={formState.surfaceHue}
              onChange={(event) =>
                handleRangeChange("surfaceHue", Number(event.target.value))
              }
              disabled={isBusy || !formState.useCustomSurfaceColors}
            />
            <span className="admin-form__slider-value">
              {formState.surfaceHue}°
            </span>
          </label>
          <label className="input-field">
            <span className="input-label">
              {t("admin.appearance.colors.tintLabel")}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={formState.surfaceTint}
              onChange={(event) =>
                handleRangeChange("surfaceTint", Number(event.target.value))
              }
              disabled={isBusy || !formState.useCustomSurfaceColors}
            />
            <span className="admin-form__slider-value">
              {formState.surfaceTint}%
            </span>
          </label>
          <label className="input-field">
            <span className="input-label">
              {t("admin.appearance.colors.shadeLabel")}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={formState.surfaceShade}
              onChange={(event) =>
                handleRangeChange("surfaceShade", Number(event.target.value))
              }
              disabled={isBusy || !formState.useCustomSurfaceColors}
            />
            <span className="admin-form__slider-value">
              {formState.surfaceShade}%
            </span>
          </label>
        </div>
      </section>

      <section className="admin-card" aria-labelledby="appearance-typography">
        <div>
          <h2 id="appearance-typography" className="admin-card__title">
            {t("admin.appearance.typography.cardTitle")}
          </h2>
          <p className="admin-card__subtitle">
            {t("admin.appearance.typography.cardDescription")}
          </p>
        </div>
        <div className="admin-form__row">
          <label className="input-field">
            <span className="input-label">
              {t("admin.appearance.typography.bodyLabel")}
            </span>
            <input
              className="input"
              type="text"
              value={formState.bodyFont}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  bodyFont: event.target.value,
                }))
              }
              disabled={isBusy}
            />
          </label>
          <label className="input-field">
            <span className="input-label">
              {t("admin.appearance.typography.headingLabel")}
            </span>
            <input
              className="input"
              type="text"
              value={formState.headingFont}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  headingFont: event.target.value,
                }))
              }
              disabled={isBusy}
            />
          </label>
        </div>
        <p className="admin-form__hint">
          {t("admin.appearance.typography.hint")}
        </p>
      </section>

      <section className="admin-card" aria-labelledby="appearance-start-screen">
        <div>
          <h2 id="appearance-start-screen" className="admin-card__title">
            {t("admin.appearance.start.cardTitle")}
          </h2>
          <p className="admin-card__subtitle">
            {t("admin.appearance.start.cardDescription")}
          </p>
        </div>
        <div className="admin-form__row">
          <label className="input-field">
            <span className="input-label">
              {t("admin.appearance.start.greetingLabel")}
            </span>
            <textarea
              className="textarea"
              rows={2}
              value={formState.startGreeting}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  startGreeting: event.target.value,
                }))
              }
              disabled={isBusy}
            />
          </label>
          <label className="input-field">
            <span className="input-label">
              {t("admin.appearance.start.promptLabel")}
            </span>
            <textarea
              className="textarea"
              rows={4}
              value={formState.startPrompt}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  startPrompt: event.target.value,
                }))
              }
              disabled={isBusy}
            />
          </label>
        </div>
        <p className="admin-form__hint">
          {t("admin.appearance.start.promptHint")}
        </p>
        <div className="admin-form__row">
          <label className="input-field">
            <span className="input-label">
              {t("admin.appearance.start.placeholderLabel")}
            </span>
            <input
              className="input"
              type="text"
              value={formState.inputPlaceholder}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  inputPlaceholder: event.target.value,
                }))
              }
              disabled={isBusy}
            />
          </label>
          <label className="input-field">
            <span className="input-label">
              {t("admin.appearance.start.disclaimerLabel")}
            </span>
            <input
              className="input"
              type="text"
              value={formState.disclaimer}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  disclaimer: event.target.value,
                }))
              }
              disabled={isBusy}
            />
          </label>
        </div>
      </section>

      {actions !== null ? (
        <div className="admin-form__actions">{actions}</div>
      ) : (
        <div className="admin-form__actions">
          <button type="submit" className="button" disabled={isBusy}>
            {t("admin.appearance.actions.save")}
          </button>
        </div>
      )}
    </form>
  );
};

export default AppearanceForm;
