import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useI18n } from "../../i18n";
import type {
  AppearanceSettings,
  AppearanceSettingsUpdatePayload,
} from "../../utils/backend";
import { appearanceFormSchema, type AppearanceFormData } from "../../schemas/appearance";

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
  const formRef = useRef<HTMLFormElement | null>(null);

  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors: formErrors },
    watch,
    reset,
    setValue,
  } = useForm<AppearanceFormData>({
    resolver: zodResolver(appearanceFormSchema),
    defaultValues: buildFormStateFromSettings(initialSettings),
  });

  useEffect(() => {
    reset(buildFormStateFromSettings(initialSettings));
  }, [initialSettings, reset]);

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
  }, [autoFocus, isLoading]);

  const handleSubmit = useCallback(
    (data: AppearanceFormData) => {
      onSubmit(buildAppearanceUpdatePayload(data));
    },
    [onSubmit],
  );

  const accentColor = watch("accentColor");
  const useCustomSurfaceColors = watch("useCustomSurfaceColors");

  const accentPreviewStyle = useMemo(
    () => ({
      backgroundColor: accentColor,
    }),
    [accentColor],
  );

  const actions = footer?.({ isBusy }) ?? null;

  if (isLoading) {
    return (
      <p className="admin-form__hint">{t("admin.appearance.loading")}</p>
    );
  }

  return (
    <form id={id} ref={formRef} className="admin-form" onSubmit={handleFormSubmit(handleSubmit)}>
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
                  value={option}
                  {...register("colorScheme")}
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
                {...register("accentColor", {
                  onChange: (event) => {
                    setValue("accentColor", ensureColorValue(event.target.value));
                  },
                })}
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
            {...register("useCustomSurfaceColors")}
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
              {...register("surfaceHue", {
                valueAsNumber: true,
              })}
              disabled={isBusy || !useCustomSurfaceColors}
            />
            <span className="admin-form__slider-value">
              {watch("surfaceHue")}°
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
              {...register("surfaceTint", {
                valueAsNumber: true,
              })}
              disabled={isBusy || !useCustomSurfaceColors}
            />
            <span className="admin-form__slider-value">
              {watch("surfaceTint")}%
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
              {...register("surfaceShade", {
                valueAsNumber: true,
              })}
              disabled={isBusy || !useCustomSurfaceColors}
            />
            <span className="admin-form__slider-value">
              {watch("surfaceShade")}%
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
              {...register("bodyFont")}
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
              {...register("headingFont")}
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
              {...register("startGreeting")}
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
              {...register("startPrompt")}
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
              {...register("inputPlaceholder")}
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
              {...register("disclaimer")}
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
