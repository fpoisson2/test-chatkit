/**
 * Component to display and download file attachments
 */
import React, { useCallback } from 'react';
import { getFileTypeIcon } from '../utils';

export interface FileAttachmentDisplayProps {
  attachmentId: string;
  attachment?: { id: string; name: string; mime_type: string; type: string };
  authToken?: string;
}

/**
 * Renders a file attachment with download capability
 */
export function FileAttachmentDisplay({
  attachmentId,
  attachment,
  authToken,
}: FileAttachmentDisplayProps): JSX.Element {
  const displayName = attachment?.name || attachmentId;
  const mimeType = attachment?.mime_type || 'application/octet-stream';
  const downloadUrl = `/api/chatkit/attachments/${attachmentId}`;

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();

    try {
      const headers: Record<string, string> = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(downloadUrl, { headers });
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      // Trigger download
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = displayName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Cleanup blob URL
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
    } catch (error) {
      console.error('[FileAttachmentDisplay] Download error:', error);
    }
  }, [downloadUrl, displayName, authToken]);

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="chatkit-file chatkit-file-download"
      title={`Télécharger ${displayName}`}
    >
      <span className="chatkit-file-icon">
        {getFileTypeIcon(mimeType, displayName)}
      </span>
      <span className="chatkit-file-name">{displayName}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="chatkit-file-download-icon">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
    </button>
  );
}

export default FileAttachmentDisplay;
