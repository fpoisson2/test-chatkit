import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatKitOptions } from '../types';
import type { Attachment } from '../api/attachments';
import {
  createAttachment,
  createFilePreview,
  generateAttachmentId,
  uploadAttachment,
  validateFile,
} from '../api/attachments';

export interface UseAttachmentsOptions {
  /** Attachment configuration from composer options */
  attachmentsConfig?: ChatKitOptions['composer']['attachments'];
  /** API configuration for uploading */
  apiConfig?: {
    url: string;
    headers?: Record<string, string>;
  };
}

export interface UseAttachmentsReturn {
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  handleFilesSelected: (files: FileList | null) => Promise<void>;
  clearAttachments: () => void;
}

/**
 * Hook to manage file attachments including validation, preview generation, and upload.
 */
export function useAttachments({
  attachmentsConfig,
  apiConfig,
}: UseAttachmentsOptions): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<Attachment[]>([]);

  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const handleFilesSelected = useCallback(
    async (files: FileList | null) => {
      if (!attachmentsConfig?.enabled || !files || files.length === 0) {
        return;
      }

      const filesArray = Array.from(files);
      const newAttachments: Attachment[] = [];

      for (const file of filesArray) {
        if (
          attachmentsConfig.maxCount &&
          attachmentsRef.current.length + newAttachments.length >= attachmentsConfig.maxCount
        ) {
          break;
        }

        const validation = validateFile(file, attachmentsConfig);
        if (!validation.valid) {
          console.error(`[ChatKit] File validation failed: ${validation.error}`);
          continue;
        }

        const localId = generateAttachmentId();
        const preview = await createFilePreview(file);
        const type = file.type.startsWith('image/') ? 'image' : 'file';

        newAttachments.push({
          id: localId,
          file,
          type,
          preview: preview || undefined,
          status: 'pending',
          progress: 0,
        });
      }

      if (newAttachments.length === 0) {
        return;
      }

      // Add attachments immediately with pending status
      const updatedAttachments = [...attachmentsRef.current, ...newAttachments];
      setAttachments(updatedAttachments);

      // Start uploading each file immediately if API is configured
      if (apiConfig?.url) {
        for (const att of newAttachments) {
          // Update status to uploading
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === att.id ? { ...a, status: 'uploading' as const, progress: 0 } : a
            )
          );

          try {
            // Phase 1: Create attachment to get backend ID and upload URL
            const createResponse = await createAttachment({
              url: apiConfig.url,
              headers: apiConfig.headers,
              name: att.file.name,
              size: att.file.size,
              mimeType: att.file.type || 'application/octet-stream',
            });

            const backendId = createResponse.id;
            const uploadUrl = createResponse.upload_url;

            // Phase 2: Upload the file with progress tracking
            await uploadAttachment({
              url: apiConfig.url,
              headers: apiConfig.headers,
              attachmentId: backendId,
              file: att.file,
              uploadUrl: uploadUrl,
              onProgress: (progress) => {
                setAttachments((prev) =>
                  prev.map((a) => (a.id === att.id ? { ...a, progress: Math.round(progress) } : a))
                );
              },
            });

            // Update with backend ID and mark as uploaded
            setAttachments((prev) =>
              prev.map((a) =>
                a.id === att.id
                  ? {
                      ...a,
                      id: backendId,
                      status: 'uploaded' as const,
                      progress: 100,
                      uploadUrl: uploadUrl,
                    }
                  : a
              )
            );
          } catch (err) {
            console.error('[ChatKit] Failed to upload attachment:', err);
            // Parse error message for user-friendly display
            let errorMessage = 'Échec de l\'upload';
            const errString = String(err);
            if (errString.includes('413') || errString.includes('Request Entity Too Large')) {
              errorMessage = 'Fichier trop volumineux (limite serveur dépassée)';
            } else if (errString.includes('Network error') || errString.includes('Failed to fetch')) {
              errorMessage = 'Erreur réseau';
            } else if (errString.includes('401') || errString.includes('403')) {
              errorMessage = 'Non autorisé';
            }
            setAttachments((prev) =>
              prev.map((a) =>
                a.id === att.id ? { ...a, status: 'error' as const, error: errorMessage } : a
              )
            );
          }
        }
      }
    },
    [attachmentsConfig, apiConfig]
  );

  return {
    attachments,
    setAttachments,
    handleFilesSelected,
    clearAttachments,
  };
}
