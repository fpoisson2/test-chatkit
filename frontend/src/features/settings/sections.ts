export type SettingsSectionId = "users";

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
    id: "users",
    labelKey: "settings.sections.users.label",
    descriptionKey: "settings.sections.users.description",
  },
];

export const buildSettingsSections = (
  t: (key: string, params?: Record<string, unknown>) => string,
): SettingsSection[] =>
  SETTINGS_SECTIONS.map((section) => ({
    id: section.id,
    label: t(section.labelKey),
    description: t(section.descriptionKey),
  }));
