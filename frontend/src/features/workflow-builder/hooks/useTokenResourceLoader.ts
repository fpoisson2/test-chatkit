import { useEffect, type Dispatch, type SetStateAction } from "react";

export type TokenResourceLoaderOptions<T> = {
  token: string | null;
  setData: Dispatch<SetStateAction<T>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  loadResource: () => Promise<T>;
  fallbackErrorMessage: string;
  resetData: () => void;
};

export function useTokenResourceLoader<T>({
  token,
  setData,
  setLoading,
  setError,
  loadResource,
  fallbackErrorMessage,
  resetData,
}: TokenResourceLoaderOptions<T>) {
  useEffect(() => {
    let isMounted = true;

    if (!token) {
      resetData();
      setLoading(false);
      setError(null);
      return () => {
        isMounted = false;
      };
    }

    setLoading(true);
    setError(null);

    loadResource()
      .then((result) => {
        if (isMounted) {
          setData(result);
        }
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : fallbackErrorMessage;
        setError(message);
        resetData();
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [fallbackErrorMessage, loadResource, resetData, setData, setError, setLoading, token]);
}
