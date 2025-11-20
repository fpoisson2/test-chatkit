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
}

/**
 * Upload un attachment vers le serveur
 */
export async function uploadAttachment(options: {
  url: string;
  headers?: Record<string, string>;
  attachmentId: string;
  file: File;
  onProgress?: (progress: number) => void;
}): Promise<void> {
  const { url, headers = {}, attachmentId, file, onProgress } = options;

  const formData = new FormData();
  formData.append('file', file);

  const uploadUrl = `${url}/attachments/${attachmentId}/upload`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        const progress = (e.loaded / e.total) * 100;
        onProgress(progress);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed: Network error'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload aborted'));
    });

    xhr.open('POST', uploadUrl);

    // Ajouter les headers
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

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
