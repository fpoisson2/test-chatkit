export type SettingsSectionId = "users";

export type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  description: string;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "users",
    label: "Gestion des utilisateurs",
    description: "Organisez les comptes membres et attribuez les bons niveaux d'accès.",
  },
];
