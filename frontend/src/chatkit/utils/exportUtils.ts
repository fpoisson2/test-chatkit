/**
 * Utility functions for exporting assistant messages to PDF and DOCX
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
  TableCell,
  TableRow,
  WidthType,
} from 'docx';
import { saveAs } from 'file-saver';

// Simple markdown parser for DOCX export
interface ParsedBlock {
  type: 'paragraph' | 'heading' | 'code' | 'list' | 'blockquote' | 'table';
  level?: number;
  content: string;
  items?: string[];
  ordered?: boolean;
  rows?: string[][];
}

function parseMarkdown(markdown: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', content: codeLines.join('\n') });
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Blockquotes
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', content: quoteLines.join('\n') });
      continue;
    }

    // Unordered lists
    if (line.match(/^[-*+]\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*+]\s+/)) {
        items.push(lines[i].replace(/^[-*+]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', content: '', items, ordered: false });
      continue;
    }

    // Ordered lists
    if (line.match(/^\d+\.\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', content: '', items, ordered: true });
      continue;
    }

    // Tables
    if (line.includes('|') && lines[i + 1]?.match(/^\|?[\s-:|]+\|?$/)) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) {
        if (!lines[i].match(/^\|?[\s-:|]+\|?$/)) {
          const cells = lines[i]
            .split('|')
            .map((cell) => cell.trim())
            .filter((cell) => cell !== '');
          rows.push(cells);
        }
        i++;
      }
      blocks.push({ type: 'table', content: '', rows });
      continue;
    }

    // Regular paragraphs
    if (line.trim()) {
      const paragraphLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].startsWith('#') &&
        !lines[i].startsWith('```') &&
        !lines[i].startsWith('>') &&
        !lines[i].match(/^[-*+]\s+/) &&
        !lines[i].match(/^\d+\.\s+/)
      ) {
        paragraphLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'paragraph', content: paragraphLines.join(' ') });
      continue;
    }

    i++;
  }

  return blocks;
}

function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Simple regex-based parsing for bold, italic, code, and links
  const regex = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\([^)]+\))|([^*`[\]]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      // Bold
      runs.push(new TextRun({ text: match[2], bold: true }));
    } else if (match[4]) {
      // Italic
      runs.push(new TextRun({ text: match[4], italics: true }));
    } else if (match[6]) {
      // Inline code
      runs.push(
        new TextRun({
          text: match[6],
          font: 'Courier New',
          shading: { fill: 'E8E8E8' },
        })
      );
    } else if (match[8]) {
      // Link (just show text)
      runs.push(new TextRun({ text: match[8], color: '0066CC', underline: {} }));
    } else if (match[9]) {
      // Regular text
      runs.push(new TextRun({ text: match[9] }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text })];
}

function getHeadingLevel(level: number): HeadingLevel {
  switch (level) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    default:
      return HeadingLevel.HEADING_6;
  }
}

/**
 * Export markdown content to DOCX format
 */
export async function exportToDocx(markdownContent: string, filename?: string): Promise<void> {
  const blocks = parseMarkdown(markdownContent);
  const children: (Paragraph | Table)[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        children.push(
          new Paragraph({
            children: parseInlineFormatting(block.content),
            heading: getHeadingLevel(block.level || 1),
            spacing: { before: 240, after: 120 },
          })
        );
        break;

      case 'paragraph':
        children.push(
          new Paragraph({
            children: parseInlineFormatting(block.content),
            spacing: { after: 200 },
          })
        );
        break;

      case 'code':
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: block.content,
                font: 'Courier New',
                size: 20,
              }),
            ],
            shading: { fill: 'F5F5F5' },
            border: {
              top: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
              left: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
              right: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
            },
            spacing: { before: 200, after: 200 },
          })
        );
        break;

      case 'blockquote':
        children.push(
          new Paragraph({
            children: parseInlineFormatting(block.content),
            indent: { left: 720 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 24, color: '3B82F6' },
            },
            spacing: { before: 200, after: 200 },
          })
        );
        break;

      case 'list':
        if (block.items) {
          block.items.forEach((item, index) => {
            const bullet = block.ordered ? `${index + 1}. ` : '• ';
            children.push(
              new Paragraph({
                children: [new TextRun({ text: bullet }), ...parseInlineFormatting(item)],
                indent: { left: 720 },
                spacing: { after: 80 },
              })
            );
          });
        }
        break;

      case 'table':
        if (block.rows && block.rows.length > 0) {
          const tableRows = block.rows.map(
            (row, rowIndex) =>
              new TableRow({
                children: row.map(
                  (cell) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: parseInlineFormatting(cell),
                          alignment: AlignmentType.LEFT,
                        }),
                      ],
                      shading: rowIndex === 0 ? { fill: 'F0F0F0' } : undefined,
                    })
                ),
              })
          );

          children.push(
            new Table({
              rows: tableRows,
              width: { size: 100, type: WidthType.PERCENTAGE },
            })
          );
        }
        break;
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const name = filename || `message-${Date.now()}`;
  saveAs(blob, `${name}.docx`);
}

/**
 * Export content to PDF format using html2pdf.js
 * Captures the rendered HTML element to preserve styling
 */
export async function exportToPdf(
  markdownContent: string,
  filename?: string,
  theme?: 'light' | 'dark'
): Promise<void> {
  // Dynamically import html2pdf to avoid SSR issues
  const html2pdf = (await import('html2pdf.js')).default;

  // Create a temporary container with the markdown content rendered as HTML
  const container = document.createElement('div');
  container.style.cssText = `
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
    background: ${theme === 'dark' ? '#1a1a1a' : '#ffffff'};
    padding: 40px;
    max-width: 800px;
  `;

  // Convert markdown to HTML with inline styles
  container.innerHTML = markdownToStyledHtml(markdownContent, theme);

  // Temporarily add to DOM for rendering
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  const name = filename || `message-${Date.now()}`;

  try {
    await html2pdf()
      .set({
        margin: [15, 15, 15, 15],
        filename: `${name}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
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
    document.body.removeChild(container);
  }
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
