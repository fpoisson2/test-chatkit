import { useCallback, useState } from "react";

type MicrophonePermissionState = "unknown" | "granted" | "denied";

type UseMicrophoneAccessResult = {
  permission: MicrophonePermissionState;
  error: string | null;
  isRequesting: boolean;
  requestPermission: () => Promise<boolean>;
  resetError: () => void;
};

const UNSUPPORTED_MESSAGE = "Accès au microphone non supporté sur ce navigateur.";
const PERMISSION_DENIED_MESSAGE = "Permission microphone refusée.";
const GENERIC_ERROR_MESSAGE = "Impossible d'activer le microphone.";

export const useMicrophoneAccess = (): UseMicrophoneAccessResult => {
  const [permission, setPermission] = useState<MicrophonePermissionState>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  const requestPermission = useCallback(async () => {
    resetError();

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(UNSUPPORTED_MESSAGE);
      return false;
    }

    setIsRequesting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignorer les erreurs d'arrêt de piste.
        }
      });
      setPermission("granted");
      return true;
    } catch (err) {
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        setPermission("denied");
        setError(PERMISSION_DENIED_MESSAGE);
        return false;
      }
      const message = err instanceof Error ? err.message : GENERIC_ERROR_MESSAGE;
      setError(message || GENERIC_ERROR_MESSAGE);
      return false;
    } finally {
      setIsRequesting(false);
    }
  }, [resetError]);

  return {
    permission,
    error,
    isRequesting,
    requestPermission,
    resetError,
  };
};

export type { MicrophonePermissionState, UseMicrophoneAccessResult };
export { PERMISSION_DENIED_MESSAGE, UNSUPPORTED_MESSAGE };
