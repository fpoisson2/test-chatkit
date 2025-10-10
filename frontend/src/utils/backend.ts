const sanitizeBackendUrl = (value: string): string => value.trim();

const ensureTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value : `${value}/`;

const toUniqueList = (values: string[]): string[] => Array.from(new Set(values));

export const makeApiEndpointCandidates = (
  rawBackendUrl: string,
  path: string,
): string[] => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const candidates = [normalizedPath];
  const backendUrl = sanitizeBackendUrl(rawBackendUrl);

  if (!backendUrl) {
    return candidates;
  }

  try {
    const base = ensureTrailingSlash(backendUrl);
    const resolved = new URL(normalizedPath, base).toString();
    candidates.push(resolved);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(
        "URL backend invalide ignorée pour VITE_BACKEND_URL:",
        backendUrl,
        error,
      );
    }
  }

  return toUniqueList(candidates);
};
