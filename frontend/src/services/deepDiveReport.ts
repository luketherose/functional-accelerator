import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Impact, ChatMessage } from '../types';

function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

function formatDate(): string {
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit', month: 'long', year: 'numeric',
  }).format(new Date());
}

export function openDeepDiveReport(impact: Impact, messages: ChatMessage[]) {
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  if (assistantMessages.length === 0) return;

  const sectionsHtml = assistantMessages
    .map((m, i) => {
      const userQ = messages[messages.findIndex((_, idx) =>
        messages[idx].role === 'assistant' && messages.slice(0, idx).filter(x => x.role === 'assistant').length === i
      ) - 1];

      const questionHtml = userQ
        ? `<div class="question-block"><span class="question-label">Domanda</span><p>${userQ.content}</p></div>`
        : '';

      return `
        ${questionHtml}
        <div class="answer-block">${renderMarkdown(m.content)}</div>
        ${i < assistantMessages.length - 1 ? '<hr class="section-divider">' : ''}
      `;
    })
    .join('\n');

  const severityColor: Record<string, string> = {
    high: '#dc2626', medium: '#d97706', low: '#16a34a',
  };
  const sev = impact.severity?.toLowerCase() ?? '';
  const sevColor = severityColor[sev] ?? '#6b7280';

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Deep-Dive — ${impact.area}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.7;
      color: #1a1a2e;
      background: #f8f7f4;
    }

    /* ── Print bar (hidden on print) ── */
    .print-bar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100;
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 24px;
      background: #1e1b4b;
      color: #e0e7ff;
      font-family: 'Inter', 'Helvetica Neue', sans-serif;
      font-size: 13px;
      gap: 12px;
    }
    .print-bar span { opacity: 0.7; }
    .print-bar-actions { display: flex; gap: 8px; }
    .btn-print {
      background: #7c3aed; color: #fff; border: none;
      padding: 7px 18px; border-radius: 6px; cursor: pointer;
      font-size: 13px; font-family: inherit; font-weight: 600;
      transition: background 0.15s;
    }
    .btn-print:hover { background: #6d28d9; }
    .btn-close {
      background: transparent; color: #a5b4fc; border: 1px solid #4338ca;
      padding: 7px 14px; border-radius: 6px; cursor: pointer;
      font-size: 13px; font-family: inherit;
    }
    .btn-close:hover { background: #312e81; color: #fff; }

    /* ── Page wrapper ── */
    .page {
      max-width: 820px;
      margin: 0 auto;
      margin-top: 60px;
      padding: 56px 64px 80px;
      background: #fff;
      min-height: 100vh;
      box-shadow: 0 0 0 1px #e5e7eb, 0 4px 24px rgba(0,0,0,0.06);
    }

    /* ── Document header ── */
    .doc-header {
      border-bottom: 3px solid #1e1b4b;
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    .doc-kicker {
      font-family: 'Inter', 'Helvetica Neue', sans-serif;
      font-size: 10pt;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #7c3aed;
      margin-bottom: 10px;
    }
    .doc-title {
      font-size: 26pt;
      font-weight: 700;
      color: #0f0e2a;
      line-height: 1.2;
      margin-bottom: 16px;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 18px;
      font-family: 'Inter', 'Helvetica Neue', sans-serif;
      font-size: 9.5pt;
      color: #6b7280;
    }
    .meta-chip {
      display: inline-flex; align-items: center; gap: 5px;
      background: #f3f4f6; border: 1px solid #e5e7eb;
      padding: 3px 10px; border-radius: 20px;
    }
    .meta-chip.severity {
      background: ${sevColor}18;
      border-color: ${sevColor}40;
      color: ${sevColor};
      font-weight: 600;
    }

    /* ── Impact summary box ── */
    .impact-summary {
      background: #faf9ff;
      border-left: 4px solid #7c3aed;
      border-radius: 0 8px 8px 0;
      padding: 18px 22px;
      margin-bottom: 36px;
    }
    .impact-summary .label {
      font-family: 'Inter', 'Helvetica Neue', sans-serif;
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #7c3aed;
      margin-bottom: 6px;
    }
    .impact-summary p {
      color: #374151;
      font-size: 10.5pt;
      line-height: 1.6;
    }

    /* ── Screens affected ── */
    .screens-section {
      margin-bottom: 36px;
    }
    .screens-section .label {
      font-family: 'Inter', 'Helvetica Neue', sans-serif;
      font-size: 9pt; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: #374151; margin-bottom: 10px;
    }
    .screens-list {
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .screen-tag {
      background: #eff6ff; color: #1d4ed8;
      border: 1px solid #bfdbfe;
      padding: 3px 10px; border-radius: 4px;
      font-family: 'Inter', 'Helvetica Neue', sans-serif;
      font-size: 9pt;
    }

    /* ── Section divider ── */
    .section-divider {
      border: none; border-top: 1px dashed #d1d5db;
      margin: 36px 0;
    }

    /* ── Question block ── */
    .question-block {
      background: #f9fafb; border: 1px solid #e5e7eb;
      border-radius: 8px; padding: 14px 18px;
      margin-bottom: 16px;
    }
    .question-label {
      display: block;
      font-family: 'Inter', 'Helvetica Neue', sans-serif;
      font-size: 8.5pt; font-weight: 700;
      letter-spacing: 0.1em; text-transform: uppercase;
      color: #9ca3af; margin-bottom: 4px;
    }
    .question-block p {
      color: #374151; font-size: 10pt;
    }

    /* ── Answer block (prose) ── */
    .answer-block { color: #1f2937; }

    .answer-block h1, .answer-block h2 {
      font-size: 14pt; font-weight: 700;
      color: #0f0e2a; margin: 28px 0 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e5e7eb;
    }
    .answer-block h3 {
      font-size: 12pt; font-weight: 700;
      color: #1e1b4b; margin: 22px 0 8px;
    }
    .answer-block h4 {
      font-size: 11pt; font-weight: 600;
      color: #374151; margin: 16px 0 6px;
    }
    .answer-block p { margin: 8px 0; font-size: 10.5pt; }

    .answer-block ul, .answer-block ol {
      margin: 10px 0 10px 24px;
      padding: 0;
    }
    .answer-block li { margin: 4px 0; font-size: 10.5pt; }
    .answer-block li::marker { color: #7c3aed; }

    .answer-block table {
      width: 100%; border-collapse: collapse;
      margin: 18px 0; font-size: 10pt;
      font-family: 'Inter', 'Helvetica Neue', sans-serif;
    }
    .answer-block thead tr {
      background: #1e1b4b; color: #e0e7ff;
    }
    .answer-block th {
      padding: 9px 12px; text-align: left;
      font-weight: 600; font-size: 9.5pt;
      letter-spacing: 0.04em;
    }
    .answer-block td {
      padding: 8px 12px;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: top;
    }
    .answer-block tr:nth-child(even) td { background: #f9fafb; }
    .answer-block tr:last-child td { border-bottom: none; }
    .answer-block table { border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }

    .answer-block blockquote {
      border-left: 3px solid #7c3aed;
      background: #faf9ff;
      margin: 16px 0;
      padding: 10px 16px;
      color: #4b5563;
      font-style: italic;
      border-radius: 0 6px 6px 0;
    }
    .answer-block code {
      font-family: 'Courier New', monospace;
      background: #f3f4f6; color: #1f2937;
      padding: 1px 5px; border-radius: 3px;
      font-size: 9.5pt;
    }
    .answer-block pre {
      background: #1e1b4b; color: #e0e7ff;
      padding: 16px; border-radius: 8px;
      overflow-x: auto; margin: 16px 0;
    }
    .answer-block pre code { background: none; color: inherit; padding: 0; }

    .answer-block strong { color: #111827; }

    /* ── Footer ── */
    .doc-footer {
      margin-top: 56px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      display: flex; justify-content: space-between; align-items: center;
      font-family: 'Inter', 'Helvetica Neue', sans-serif;
      font-size: 8.5pt; color: #9ca3af;
    }

    /* ── Print styles ── */
    @media print {
      .print-bar { display: none !important; }
      body { background: #fff; }
      .page {
        max-width: 100%; margin: 0;
        padding: 20mm 22mm;
        box-shadow: none;
      }
      .answer-block table { page-break-inside: avoid; }
      .question-block { page-break-inside: avoid; }
    }

    @page {
      size: A4;
      margin: 18mm 20mm;
    }
  </style>
</head>
<body>

  <!-- Print bar -->
  <div class="print-bar">
    <span>Functional Accelerator — Impact Deep-Dive Report</span>
    <div class="print-bar-actions">
      <button class="btn-print" onclick="window.print()">⬇ Salva / Stampa PDF</button>
      <button class="btn-close" onclick="window.close()">Chiudi</button>
    </div>
  </div>

  <div class="page">

    <!-- Document header -->
    <div class="doc-header">
      <div class="doc-kicker">Impact Deep-Dive Report</div>
      <div class="doc-title">${impact.area}</div>
      <div class="meta-row">
        <span class="meta-chip">📅 ${formatDate()}</span>
        ${impact.severity ? `<span class="meta-chip severity">Severità: ${impact.severity.toUpperCase()}</span>` : ''}
        ${impact.id ? `<span class="meta-chip">Ref: ${impact.id}</span>` : ''}
      </div>
    </div>

    <!-- Impact description box -->
    ${impact.description ? `
    <div class="impact-summary">
      <div class="label">Descrizione impatto</div>
      <p>${impact.description}</p>
    </div>
    ` : ''}


    <!-- Analysis sections -->
    ${sectionsHtml}

    <!-- Footer -->
    <div class="doc-footer">
      <span>Generato da Functional Accelerator</span>
      <span>${formatDate()}</span>
    </div>

  </div>

</body>
</html>`;

  const win = window.open('', '_blank', 'width=1000,height=800');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}
