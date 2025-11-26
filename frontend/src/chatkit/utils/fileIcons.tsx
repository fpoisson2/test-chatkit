/**
 * Returns an SVG icon based on file MIME type
 */
export function getFileTypeIcon(mimeType: string, fileName: string, size = 24): JSX.Element {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';

  // PDF
  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <text x="12" y="16" textAnchor="middle" fontSize="6" fill="#e53935" stroke="none" fontWeight="bold">PDF</text>
      </svg>
    );
  }

  // Word documents
  if (mimeType.includes('word') || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || extension === 'doc' || extension === 'docx') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1976d2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <text x="12" y="16" textAnchor="middle" fontSize="5" fill="#1976d2" stroke="none" fontWeight="bold">DOC</text>
      </svg>
    );
  }

  // Excel spreadsheets
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || extension === 'xls' || extension === 'xlsx' || extension === 'csv') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#388e3c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <text x="12" y="16" textAnchor="middle" fontSize="5" fill="#388e3c" stroke="none" fontWeight="bold">XLS</text>
      </svg>
    );
  }

  // PowerPoint presentations
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint') || extension === 'ppt' || extension === 'pptx') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#f57c00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <text x="12" y="16" textAnchor="middle" fontSize="5" fill="#f57c00" stroke="none" fontWeight="bold">PPT</text>
      </svg>
    );
  }

  // Archives (zip, rar, etc.)
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('archive') || mimeType.includes('compressed') ||
      extension === 'zip' || extension === 'rar' || extension === '7z' || extension === 'tar' || extension === 'gz') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#795548" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <rect x="9" y="11" width="6" height="2" fill="#795548" stroke="none"></rect>
        <rect x="9" y="14" width="6" height="2" fill="#795548" stroke="none"></rect>
      </svg>
    );
  }

  // Audio files
  if (mimeType.startsWith('audio/') || extension === 'mp3' || extension === 'wav' || extension === 'ogg' || extension === 'm4a') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#9c27b0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13"></path>
        <circle cx="6" cy="18" r="3"></circle>
        <circle cx="18" cy="16" r="3"></circle>
      </svg>
    );
  }

  // Video files
  if (mimeType.startsWith('video/') || extension === 'mp4' || extension === 'avi' || extension === 'mov' || extension === 'mkv') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#673ab7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" ry="2"></rect>
        <polygon points="10 9 15 12 10 15 10 9" fill="#673ab7"></polygon>
      </svg>
    );
  }

  // Code files
  if (mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('html') || mimeType.includes('css') ||
      extension === 'js' || extension === 'ts' || extension === 'jsx' || extension === 'tsx' || extension === 'json' ||
      extension === 'html' || extension === 'css' || extension === 'py' || extension === 'java' || extension === 'cpp') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#607d8b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>
    );
  }

  // Text files
  if (mimeType.startsWith('text/') || extension === 'txt' || extension === 'md' || extension === 'rtf') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#455a64" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    );
  }

  // Default file icon
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
    </svg>
  );
}
