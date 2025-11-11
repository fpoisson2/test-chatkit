import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appSettingsApi, type AppSettings, type AppSettingsUpdatePayload } from "../utils/backend";

// Query keys for cache management
export const appSettingsKeys = {
  all: ["appSettings"] as const,
  detail: () => [...appSettingsKeys.all, "detail"] as const,
};

/**
 * Hook to fetch app settings
 */
export const useAppSettings = (token: string | null) => {
  return useQuery({
    queryKey: appSettingsKeys.detail(),
    queryFn: () => appSettingsApi.get(token),
    enabled: !!token,
  });
};

/**
 * Hook to update app settings
 */
export const useUpdateAppSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, payload }: { token: string | null; payload: AppSettingsUpdatePayload }) =>
      appSettingsApi.update(token, payload),
    onSuccess: (data) => {
      // Update the cache with the new data
      queryClient.setQueryData<AppSettings>(appSettingsKeys.detail(), data);
    },
  });
};
