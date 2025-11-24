import type { ChatKitOptions } from "@openai/chatkit";

export const COMPOSER_MODELS_STORAGE_KEY = "chatkit:composer-models";

const isComposerModelArray = (
  value: unknown,
): value is NonNullable<ChatKitOptions["composer"]>["models"] =>
  Array.isArray(value);

const isComposerModelConfigObject = (
  value: unknown,
): value is { enabled: boolean; options: NonNullable<ChatKitOptions["composer"]>["models"] } =>
  typeof value === "object" &&
  value !== null &&
  "enabled" in value &&
  "options" in value;

export const loadComposerModelsConfig = (): NonNullable<ChatKitOptions["composer"]>["models"] | null => {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  const raw = window.localStorage.getItem(COMPOSER_MODELS_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (isComposerModelArray(parsed)) {
      return parsed;
    }

    if (isComposerModelConfigObject(parsed) && parsed.enabled) {
      return parsed.options;
    }

    return null;
  } catch (error) {
    console.warn("[ChatKit] Impossible de parser chatkit:composer-models depuis le localStorage.", error);
    return null;
  }
};
