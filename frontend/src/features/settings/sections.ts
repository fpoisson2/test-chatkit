export type SettingsSectionId = "preferences";

export type SettingsSectionDefinition = {
  id: SettingsSectionId;
  labelKey: string;
  descriptionKey: string;
};

export type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  description: string;
};

export const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  {
    id: "preferences",
    labelKey: "settings.sections.preferences.label",
    descriptionKey: "settings.sections.preferences.description",
  },
];

export const DEFAULT_SETTINGS_SECTION_ID: SettingsSectionId =
  SETTINGS_SECTIONS[0]?.id ?? "preferences";

export const buildSettingsSections = (
  t: (key: string, params?: Record<string, unknown>) => string,
): SettingsSection[] =>
  SETTINGS_SECTIONS.map((section) => ({
    id: section.id,
    label: t(section.labelKey),
    description: t(section.descriptionKey),
  }));
