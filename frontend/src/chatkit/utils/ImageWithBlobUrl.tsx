/**
 * Composant partagé pour afficher des images avec conversion d'URL data vers Blob
 * Évite les erreurs 414 (Request-URI Too Long) avec les URLs base64 très longues
 * Supporte le chargement authentifié des images via API
 */
import React, { useState, useEffect } from 'react';

export interface ImageWithBlobUrlProps {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Token d'authentification pour charger les images via API */
  authToken?: string;
}

/**
 * Convertit une URL data en Blob URL pour éviter les erreurs 414
 * avec les images encodées en base64 très longues
 */
function convertDataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const bstr = atob(parts[1]);
    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], { type: mime });
  } catch {
    return null;
  }
}

/**
 * Convertit une chaîne base64 brute en Blob
 */
function convertRawBase64ToBlob(base64: string, mimeType = 'image/png'): Blob | null {
  try {
    const bstr = atob(base64);
    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], { type: mimeType });
  } catch {
    return null;
  }
}

/**
 * Charge une image via fetch avec authentification et retourne un Blob URL
 */
async function fetchImageAsBlob(url: string, authToken: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });
    if (!response.ok) {
      console.warn(`[ImageWithBlobUrl] Failed to fetch image: ${response.status}`);
      return null;
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.warn('[ImageWithBlobUrl] Error fetching image:', error);
    return null;
  }
}

/**
 * Composant pour afficher des images avec conversion automatique
 * des URLs data/base64 en Blob URLs
 * Supporte le chargement authentifié des images via API
 */
export function ImageWithBlobUrl({
  src,
  alt = '',
  className = '',
  style = {},
  authToken,
}: ImageWithBlobUrlProps): JSX.Element | null {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const processSource = async () => {
      if (src.startsWith('data:')) {
        // Convertir l'URL data en blob pour éviter les erreurs 414
        const blob = convertDataUrlToBlob(src);
        if (blob && !cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        }
      } else if (src.startsWith('/api/') && authToken) {
        // URL d'API relative nécessitant authentification
        setLoading(true);
        const fetchedUrl = await fetchImageAsBlob(src, authToken);
        if (!cancelled) {
          if (fetchedUrl) {
            objectUrl = fetchedUrl;
            setBlobUrl(fetchedUrl);
          } else {
            // Fallback: essayer sans authentification (au cas où)
            setBlobUrl(src);
          }
          setLoading(false);
        }
      } else if (src.startsWith('http') || src.startsWith('/')) {
        // URL normale ou relative, utiliser telle quelle
        setBlobUrl(src);
      } else if (src.startsWith('blob:')) {
        // Déjà une Blob URL
        setBlobUrl(src);
      } else {
        // Supposer que c'est une chaîne base64 brute
        const blob = convertRawBase64ToBlob(src);
        if (blob && !cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        } else if (!cancelled) {
          // Fallback: utiliser la source telle quelle
          setBlobUrl(src);
        }
      }
    };

    processSource();

    return () => {
      cancelled = true;
      if (objectUrl && objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src, authToken]);

  if (loading) {
    return <div className={className} style={{ ...style, background: '#f0f0f0' }} />;
  }

  if (!blobUrl) return null;

  return <img src={blobUrl} alt={alt} className={className} style={style} />;
}

export default ImageWithBlobUrl;
