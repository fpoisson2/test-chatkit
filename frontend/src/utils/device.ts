const DEVICE_ID_STORAGE_KEY = "chatkit-device-id";

/**
 * Génère un UUID v4
 */
const generateUUID = (): string => {
  // Essayer d'utiliser l'API crypto native si disponible
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  // Fallback: générer un UUID v4 manuellement
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const getOrCreateDeviceId = () => {
  if (typeof window === "undefined") {
    return generateUUID();
  }

  let existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!existing) {
    existing = generateUUID();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, existing);
  }
  return existing;
};
