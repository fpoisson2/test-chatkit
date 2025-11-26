/**
 * Gestion des attachments (pièces jointes)
 */
import type { ChatKitOptions } from '../types';

export interface Attachment {
  id: string;
  file: File;
  type: 'image' | 'file';
  preview?: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'error';
  error?: string;
  uploadUrl?: string;
}

export interface CreateAttachmentResponse {
  id: string;
  name: string;
  mime_type: string;
  type: 'file' | 'image';
  upload_url?: string;
}

/**
 * Crée un attachment via le protocole ChatKit (Phase 1 du two-phase upload)
 * Retourne l'ID et l'URL d'upload du backend
 */
export async function createAttachment(options: {
  url: string;
  headers?: Record<string, string>;
  name: string;
  size: number;
  mimeType: string;
}): Promise<CreateAttachmentResponse> {
  const { url, headers = {}, name, size, mimeType } = options;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      type: 'attachments.create',
      params: {
        name,
        size,
        mime_type: mimeType,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create attachment: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.attachment || data;
}

/**
 * Upload un attachment vers le serveur (Phase 2 du two-phase upload)
 */
export async function uploadAttachment(options: {
  url: string;
  headers?: Record<string, string>;
  attachmentId: string;
  file: File;
  uploadUrl?: string;
  onProgress?: (progress: number) => void;
}): Promise<void> {
  const { url, headers = {}, attachmentId, file, uploadUrl, onProgress } = options;

  const formData = new FormData();
  formData.append('file', file);

  // Use the backend-provided upload URL if available, otherwise fallback to default
  const finalUploadUrl = uploadUrl || `${url}/attachments/${attachmentId}/upload`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Enable credentials for cross-origin requests (cookies, auth headers)
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        const progress = (e.loaded / e.total) * 100;
        onProgress(progress);
      }
    });

    xhr.addEventListener('load', () => {
      console.log('[uploadAttachment] Response:', xhr.status, xhr.statusText, xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText} - ${xhr.responseText}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed: Network error'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload aborted'));
    });

    xhr.open('POST', finalUploadUrl);

    // Ajouter les headers SAUF Content-Type (le navigateur le définit automatiquement pour FormData)
    console.log('[uploadAttachment] Headers to send:', Object.keys(headers).filter(k => k.toLowerCase() !== 'content-type'));
    Object.entries(headers).forEach(([key, value]) => {
      // Ne pas définir Content-Type pour les uploads FormData - le navigateur le fait automatiquement
      // avec la bonne boundary pour multipart/form-data
      if (key.toLowerCase() !== 'content-type') {
        xhr.setRequestHeader(key, value);
      }
    });

    console.log('[uploadAttachment] Sending FormData with file:', file.name, file.size, file.type);
    xhr.send(formData);
  });
}

/**
 * Crée une preview pour un fichier
 */
export function createFilePreview(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve(e.target?.result as string || null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    } else {
      resolve(null);
    }
  });
}

/**
 * Génère un ID unique pour un attachment
 */
export function generateAttachmentId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Valide un fichier selon les contraintes d'attachments
 */
export function validateFile(
  file: File,
  config: NonNullable<ChatKitOptions['composer']>['attachments']
): { valid: boolean; error?: string } {
  if (!config || !config.enabled) {
    return { valid: false, error: 'Attachments are disabled' };
  }

  // Vérifier la taille
  if (config.maxSize && file.size > config.maxSize) {
    const maxSizeMB = (config.maxSize / (1024 * 1024)).toFixed(1);
    return { valid: false, error: `File too large (max ${maxSizeMB}MB)` };
  }

  // Vérifier le type de fichier
  if (config.accept) {
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    const mimeType = file.type;

    let accepted = false;
    for (const [acceptedMime, extensions] of Object.entries(config.accept)) {
      // Vérifier le MIME type avec wildcard
      if (acceptedMime.endsWith('/*')) {
        const mimePrefix = acceptedMime.slice(0, -2);
        if (mimeType.startsWith(mimePrefix)) {
          accepted = true;
          break;
        }
      } else if (acceptedMime === mimeType) {
        accepted = true;
        break;
      }

      // Vérifier l'extension
      if (extensions && extensions.includes(fileExtension)) {
        accepted = true;
        break;
      }
    }

    if (!accepted) {
      return { valid: false, error: 'File type not accepted' };
    }
  }

  return { valid: true };
}
