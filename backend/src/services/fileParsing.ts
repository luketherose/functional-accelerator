import fs from 'fs';
import path from 'path';

/**
 * Extracts plain text from various file types.
 * Returns null if the file type is not extractable (e.g., images).
 */
export async function parseFile(filePath: string, mimeType: string): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();

  // --- Plain text and Markdown ---
  if (mimeType === 'text/plain' || mimeType === 'text/markdown' || ext === '.md' || ext === '.txt') {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.slice(0, 100_000); // cap at 100k chars
  }

  // --- PDF ---
  if (mimeType === 'application/pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return (data.text as string).slice(0, 100_000);
    } catch (err) {
      console.warn('[fileParsing] PDF parse failed:', err);
      return '[PDF content could not be extracted]';
    }
  }

  // --- DOCX ---
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return (result.value as string).slice(0, 100_000);
    } catch (err) {
      console.warn('[fileParsing] DOCX parse failed:', err);
      return '[DOCX content could not be extracted]';
    }
  }

  // --- XLSX ---
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  ) {
    try {
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(filePath);
      const lines: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        lines.push(`## Sheet: ${sheetName}\n${csv}`);
      }
      return lines.join('\n\n').slice(0, 50_000);
    } catch (err) {
      console.warn('[fileParsing] XLSX parse failed:', err);
      return '[Excel content could not be extracted]';
    }
  }

  // --- Images (PNG, JPEG, GIF, WEBP) — no text extraction, handled separately as vision ---
  if (mimeType.startsWith('image/')) {
    return null;
  }

  return null;
}

/**
 * Reads an image file and returns it as a base64-encoded string with media type.
 */
export function readImageAsBase64(filePath: string, mimeType: string): { data: string; mediaType: string } {
  const data = fs.readFileSync(filePath).toString('base64');
  // Claude supports: image/jpeg, image/png, image/gif, image/webp
  const supported = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const mediaType = supported.includes(mimeType) ? mimeType : 'image/png';
  return { data, mediaType };
}
