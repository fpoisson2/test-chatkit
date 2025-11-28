/**
 * Utility functions for exporting assistant messages to PDF and DOCX
 */
import { saveAs } from 'file-saver';
import { convertMarkdownToDocx } from '@mohtasham/md-to-docx';

/**
 * Export markdown content to DOCX format using md-to-docx library
 * This provides much better formatting than manual parsing
 */
export async function exportToDocx(markdownContent: string, filename?: string): Promise<void> {
  const blob = await convertMarkdownToDocx(markdownContent, {
    documentType: 'document',
    style: {
      // Font sizes (in half-points, so 24 = 12pt)
      heading1Size: 32,
      heading2Size: 28,
      heading3Size: 24,
      heading4Size: 22,
      heading5Size: 20,
      paragraphSize: 24,
      listItemSize: 24,
      codeBlockSize: 20,
      blockquoteSize: 24,
      // Spacing
      headingSpacing: 240,
      paragraphSpacing: 200,
      lineSpacing: 1.15,
      // Alignment
      paragraphAlignment: 'LEFT',
      blockquoteAlignment: 'LEFT',
    },
  });

  const name = filename || `message-${Date.now()}`;
  saveAs(blob, `${name}.docx`);
}

/**
 * Export content to PDF format using html2pdf.js
 * Can capture either a DOM element directly or convert markdown to HTML
 */
export async function exportToPdf(
  contentOrElement: string | HTMLElement,
  filename?: string,
  theme?: 'light' | 'dark'
): Promise<void> {
  // Dynamically import html2pdf to avoid SSR issues
  const html2pdf = (await import('html2pdf.js')).default;

  let container: HTMLElement;
  let shouldRemove = false;

  if (typeof contentOrElement === 'string') {
    // Legacy: create from markdown
    container = document.createElement('div');
    container.style.cssText = `
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
      background: ${theme === 'dark' ? '#1a1a1a' : '#ffffff'};
      padding: 40px;
      max-width: 800px;
    `;
    container.innerHTML = markdownToStyledHtml(contentOrElement, theme);
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    document.body.appendChild(container);
    shouldRemove = true;
  } else {
    // New: clone the DOM element and prepare it for PDF export
    container = prepareElementForPdfExport(contentOrElement, theme);
    document.body.appendChild(container);
    shouldRemove = true;
  }

  const name = filename || `message-${Date.now()}`;

  try {
    // Wait for fonts and images to load
    await new Promise(resolve => setTimeout(resolve, 100));

    await html2pdf()
      .set({
        margin: [15, 15, 15, 15],
        filename: `${name}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: theme === 'dark' ? '#1a1a1a' : '#ffffff',
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait',
        },
      })
      .from(container)
      .save();
  } finally {
    if (shouldRemove) {
      document.body.removeChild(container);
    }
  }
}

/**
 * Prepare a DOM element for PDF export by cloning and applying inline styles
 */
function prepareElementForPdfExport(element: HTMLElement, theme?: 'light' | 'dark'): HTMLElement {
  const isDark = theme === 'dark';
  const textColor = isDark ? '#e0e0e0' : '#1a1a1a';
  const bgColor = isDark ? '#1a1a1a' : '#ffffff';
  const codeBg = isDark ? '#2d2d2d' : '#f5f5f5';
  const borderColor = isDark ? '#444' : '#ddd';
  const linkColor = isDark ? '#60a5fa' : '#2563eb';

  // Create a wrapper with proper styling
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    color: ${textColor};
    background: ${bgColor};
    padding: 40px;
    max-width: 800px;
    position: fixed;
    left: -9999px;
    top: 0;
  `;

  // Clone the element
  const clone = element.cloneNode(true) as HTMLElement;

  // Remove copy buttons and other UI elements
  clone.querySelectorAll('.chatkit-copy-code-button, .chatkit-action-button').forEach(el => el.remove());

  // Apply inline styles to all elements for PDF rendering
  applyInlineStylesForPdf(clone, { textColor, bgColor, codeBg, borderColor, linkColor, isDark });

  wrapper.appendChild(clone);
  return wrapper;
}

/**
 * Recursively apply inline styles to elements for PDF export
 */
function applyInlineStylesForPdf(
  element: HTMLElement,
  colors: { textColor: string; bgColor: string; codeBg: string; borderColor: string; linkColor: string; isDark: boolean }
): void {
  const { textColor, codeBg, borderColor, linkColor } = colors;

  // Apply styles based on class names
  if (element.classList.contains('chatkit-markdown-paragraph')) {
    element.style.cssText += `margin: 0 0 1em 0; color: ${textColor};`;
  }

  if (element.classList.contains('chatkit-markdown-heading')) {
    element.style.cssText += `font-weight: 600; color: ${textColor}; margin: 1.5em 0 0.75em 0;`;
  }
  if (element.classList.contains('chatkit-markdown-h1')) {
    element.style.cssText += `font-size: 24px; border-bottom: 2px solid ${borderColor}; padding-bottom: 10px;`;
  }
  if (element.classList.contains('chatkit-markdown-h2')) {
    element.style.cssText += `font-size: 20px; border-bottom: 1px solid ${borderColor}; padding-bottom: 8px;`;
  }
  if (element.classList.contains('chatkit-markdown-h3')) {
    element.style.cssText += `font-size: 18px;`;
  }

  if (element.classList.contains('chatkit-markdown-code-inline')) {
    element.style.cssText += `background: ${codeBg}; padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 0.9em; border: 1px solid ${borderColor};`;
  }

  if (element.classList.contains('chatkit-code-block-wrapper') || element.classList.contains('chatkit-markdown-code-block')) {
    element.style.cssText += `background: ${codeBg}; padding: 16px; border-radius: 8px; font-family: 'Courier New', monospace; font-size: 14px; margin: 16px 0; border: 1px solid ${borderColor}; overflow-x: auto;`;
  }

  if (element.classList.contains('chatkit-markdown-blockquote')) {
    element.style.cssText += `border-left: 4px solid #3b82f6; padding: 12px 16px; margin: 16px 0; background: ${codeBg}; border-radius: 0 8px 8px 0;`;
  }

  if (element.classList.contains('chatkit-markdown-list')) {
    element.style.cssText += `padding-left: 24px; margin: 12px 0;`;
  }
  if (element.classList.contains('chatkit-markdown-list-item')) {
    element.style.cssText += `margin: 4px 0;`;
  }

  if (element.classList.contains('chatkit-markdown-link')) {
    element.style.cssText += `color: ${linkColor}; text-decoration: none;`;
  }

  if (element.classList.contains('chatkit-markdown-strong')) {
    element.style.cssText += `font-weight: 600;`;
  }

  if (element.classList.contains('chatkit-markdown-table')) {
    element.style.cssText += `width: 100%; border-collapse: collapse; margin: 16px 0;`;
  }
  if (element.classList.contains('chatkit-markdown-th')) {
    element.style.cssText += `padding: 12px; text-align: left; font-weight: 600; border: 1px solid ${borderColor}; background: ${codeBg};`;
  }
  if (element.classList.contains('chatkit-markdown-td')) {
    element.style.cssText += `padding: 12px; border: 1px solid ${borderColor};`;
  }

  // Handle pre and code elements inside code blocks
  if (element.tagName === 'PRE' && element.closest('.chatkit-code-block-wrapper')) {
    element.style.cssText += `margin: 0; white-space: pre-wrap; word-wrap: break-word;`;
  }
  if (element.tagName === 'CODE' && !element.classList.contains('chatkit-markdown-code-inline')) {
    const parent = element.closest('.chatkit-code-block-wrapper');
    if (parent) {
      element.style.cssText += `font-family: 'Courier New', monospace; font-size: 14px; white-space: pre-wrap;`;
    }
  }

  // Recursively process children
  Array.from(element.children).forEach(child => {
    if (child instanceof HTMLElement) {
      applyInlineStylesForPdf(child, colors);
    }
  });
}

/**
 * Convert markdown to styled HTML for PDF export
 */
function markdownToStyledHtml(markdown: string, theme?: 'light' | 'dark'): string {
  const isDark = theme === 'dark';
  const textColor = isDark ? '#e0e0e0' : '#1a1a1a';
  const bgColor = isDark ? '#1a1a1a' : '#ffffff';
  const codeBg = isDark ? '#2d2d2d' : '#f5f5f5';
  const borderColor = isDark ? '#444' : '#ddd';
  const linkColor = isDark ? '#60a5fa' : '#2563eb';
  const blockquoteBorder = '#3b82f6';

  let html = markdown;

  // Code blocks (must be processed before inline code)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    return `<pre style="background: ${codeBg}; padding: 16px; border-radius: 8px; overflow-x: auto; font-family: 'Courier New', monospace; font-size: 13px; border: 1px solid ${borderColor}; margin: 16px 0;"><code>${escapeHtml(code.trim())}</code></pre>`;
  });

  // Headings
  html = html.replace(
    /^######\s+(.+)$/gm,
    `<h6 style="font-size: 14px; font-weight: 600; margin: 20px 0 10px 0; color: ${textColor};">$1</h6>`
  );
  html = html.replace(
    /^#####\s+(.+)$/gm,
    `<h5 style="font-size: 15px; font-weight: 600; margin: 20px 0 10px 0; color: ${textColor};">$1</h5>`
  );
  html = html.replace(
    /^####\s+(.+)$/gm,
    `<h4 style="font-size: 16px; font-weight: 600; margin: 24px 0 12px 0; color: ${textColor};">$1</h4>`
  );
  html = html.replace(
    /^###\s+(.+)$/gm,
    `<h3 style="font-size: 18px; font-weight: 600; margin: 24px 0 12px 0; color: ${textColor};">$1</h3>`
  );
  html = html.replace(
    /^##\s+(.+)$/gm,
    `<h2 style="font-size: 20px; font-weight: 600; margin: 28px 0 14px 0; color: ${textColor}; border-bottom: 1px solid ${borderColor}; padding-bottom: 8px;">$1</h2>`
  );
  html = html.replace(
    /^#\s+(.+)$/gm,
    `<h1 style="font-size: 24px; font-weight: 700; margin: 32px 0 16px 0; color: ${textColor}; border-bottom: 2px solid ${borderColor}; padding-bottom: 10px;">$1</h1>`
  );

  // Blockquotes
  html = html.replace(
    /^>\s*(.+)$/gm,
    `<blockquote style="border-left: 4px solid ${blockquoteBorder}; padding: 12px 16px; margin: 16px 0; background: ${codeBg}; border-radius: 0 8px 8px 0; color: ${isDark ? '#b0b0b0' : '#555'};">$1</blockquote>`
  );

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight: 600;">$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Inline code
  html = html.replace(
    /`([^`]+)`/g,
    `<code style="background: ${codeBg}; padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 0.9em; border: 1px solid ${borderColor};">$1</code>`
  );

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    `<a href="$2" style="color: ${linkColor}; text-decoration: none;">$1</a>`
  );

  // Unordered lists
  html = html.replace(/^[-*+]\s+(.+)$/gm, `<li style="margin: 4px 0;">$1</li>`);
  html = html.replace(
    /(<li[^>]*>.*<\/li>\n?)+/g,
    `<ul style="padding-left: 24px; margin: 12px 0;">$&</ul>`
  );

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, `<li style="margin: 4px 0;">$1</li>`);

  // Horizontal rule
  html = html.replace(
    /^---+$/gm,
    `<hr style="border: none; border-top: 1px solid ${borderColor}; margin: 24px 0;" />`
  );

  // Paragraphs (lines that aren't already wrapped)
  html = html
    .split('\n\n')
    .map((block) => {
      if (
        !block.startsWith('<') &&
        block.trim() &&
        !block.match(/^[-*+]\s/) &&
        !block.match(/^\d+\./)
      ) {
        return `<p style="margin: 12px 0; color: ${textColor};">${block.replace(/\n/g, '<br>')}</p>`;
      }
      return block;
    })
    .join('\n');

  return html;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
