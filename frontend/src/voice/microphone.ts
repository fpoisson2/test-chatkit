export type MicrophonePermissionState = "unknown" | "granted" | "denied";

export type MicrophoneAccessResult =
  | { status: "granted" }
  | { status: "denied"; reason: "permission_denied" }
  | { status: "unsupported" }
  | { status: "error"; message: string };

const formatMicrophoneError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "An unknown microphone error occurred.";
  }
};

export const requestMicrophoneAccess = async (): Promise<MicrophoneAccessResult> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { status: "unsupported" };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore errors stopping individual tracks.
      }
    });
    return { status: "granted" };
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "SecurityError")
    ) {
      return { status: "denied", reason: "permission_denied" };
    }

    return { status: "error", message: formatMicrophoneError(error) };
  }
};
