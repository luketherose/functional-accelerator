/**
 * ALM Defect Export Parser
 *
 * Parses Excel files exported from HP ALM / Micro Focus ALM (Quality Center).
 * Handles the typical column name variations across different ALM configurations
 * and project setups.
 *
 * Normalizes the raw rows into a structured Defect array ready for Claude analysis.
 *
 * H3 Security Fix: Replaced vulnerable `xlsx` (SheetJS) package with `exceljs`
 * to address known CVEs in xlsx.
 */

import ExcelJS from 'exceljs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Defect {
  id: string;
  title: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low' | 'Unknown';
  severity: string;
  status: string;
  application: string;   // which app/asset is responsible (AOO, KFC, Oracle, ESI, etc.)
  module: string;        // functional area / subject / module
  description: string;
  resolution: string;
  detectedBy: string;
  assignedTo: string;
  detectedDate: string;
  closedDate: string;
  environment: string;
  rawRow: Record<string, string>; // original row for reference
}

export interface ParseResult {
  defects: Defect[];
  totalRows: number;
  skippedRows: number;
  detectedColumns: string[];
}

// ─── Column name aliases (ALM varies a lot across installations) ──────────────

const COL_ALIASES: Record<keyof Omit<Defect, 'rawRow'>, string[]> = {
  id: ['Work Item ID', 'Defect ID', 'ID', 'Bug ID', 'Issue ID', 'Req ID', 'Number', '#', 'BG_BUG_ID', 'WorkItemID'],
  title: ['Summary', 'Title', 'Name', 'Subject', 'Defect Name', 'BG_SUMMARY', 'Description Short'],
  priority: ['Priority', 'BG_PRIORITY', 'Priorità', 'Importance'],
  severity: ['Severity', 'BG_SEVERITY', 'Severità'],
  status: ['Status', 'State', 'BG_STATUS', 'Stato'],
  application: ['Application', 'Asset', 'System', 'Component', 'Applicativo', 'Subsystem', 'BG_USER_TEMPLATE_01', 'Applicazione', 'App', 'Country'],
  module: ['Module', 'Subject', 'Category', 'Area', 'Functional Area', 'BG_SUBJECT', 'Tema', 'Theme', 'Topic', 'Detected in Cycle', 'Cycle'],
  description: ['Description', 'Details', 'BG_DESCRIPTION', 'Descrizione', 'Steps to Reproduce', 'Steps'],
  resolution: ['Resolution', 'Fix Description', 'BG_DEV_COMMENTS', 'Risoluzione', 'Developer Comments', 'Closing Comments', 'Comments'],
  detectedBy: ['Detected By (full name)', 'Detected By', 'Found By', 'Reporter', 'Created By', 'BG_DETECTED_BY', 'Rilevato Da'],
  assignedTo: ['Assigned To (full name)', 'Assigned To', 'Owner', 'BG_RESPONSIBLE', 'Assegnato A', 'Responsible'],
  detectedDate: ['Detected on Date', 'Creation Date', 'BG_DETECTION_DATE', 'Data Apertura', 'Open Date', 'Date Created'],
  closedDate: ['Closed on Date', 'Closing Date', 'BG_CLOSING_DATE', 'Data Chiusura', 'Close Date', 'Fixed Date', 'Detected in Release'],
  environment: ['Environment', 'Test Environment', 'BG_USER_TEMPLATE_02', 'Ambiente', 'Env'],
};

// ─── Priority normalization ───────────────────────────────────────────────────

function normalizePriority(raw: string): Defect['priority'] {
  // Guard against excessively long input before applying regex (ReDoS protection)
  const trimmed = (raw ?? '').slice(0, 100);
  const v = trimmed.toLowerCase().trim();
  if (!v) return 'Unknown';
  // Numeric prefixes common in ALM severity: "1-Critical", "2-High", etc.
  if (/^1[^0-9]|critica|critical|blocker|highest|urgente|urgent/.test(v)) return 'Critical';
  if (/^2[^0-9]|high|alta|alto|major/.test(v)) return 'High';
  if (/^3[^0-9]|medium|media|medio|normal|moderate/.test(v)) return 'Medium';
  if (/^4[^0-9]|low|bassa|basso|minor|lowest/.test(v)) return 'Low';
  return 'Unknown';
}

// ─── Column matching ──────────────────────────────────────────────────────────

function findColumn(headers: string[], field: keyof typeof COL_ALIASES): string | null {
  const aliases = COL_ALIASES[field];
  for (const alias of aliases) {
    const match = headers.find(h => h.trim().toLowerCase() === alias.toLowerCase());
    if (match) return match;
  }
  // Fuzzy: partial match
  for (const alias of aliases) {
    const match = headers.find(h => h.toLowerCase().includes(alias.toLowerCase().split(' ')[0]));
    if (match) return match;
  }
  return null;
}

function getCell(row: Record<string, unknown>, col: string | null): string {
  if (!col || row[col] === undefined || row[col] === null) return '';
  return String(row[col]).trim();
}

// ─── ExcelJS row-to-object helper ─────────────────────────────────────────────

function worksheetToObjects(worksheet: ExcelJS.Worksheet): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];

  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = cell.text?.trim() || `Column${colNumber}`;
  });

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip header row
    const obj: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) {
        // Handle dates and rich text
        if (cell.type === ExcelJS.ValueType.Date) {
          obj[header] = (cell.value as Date).toISOString().split('T')[0];
        } else if (cell.type === ExcelJS.ValueType.RichText) {
          obj[header] = (cell.value as ExcelJS.CellRichTextValue).richText
            ?.map(rt => rt.text)
            .join('') ?? '';
        } else {
          obj[header] = cell.text ?? '';
        }
      }
    });
    // Only add non-empty rows
    if (Object.values(obj).some(v => v !== '' && v !== null && v !== undefined)) {
      rows.push(obj);
    }
  });

  return rows;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseALMExcel(buffer: Buffer): ParseResult {
  // ExcelJS read from buffer is async, but we need sync for the existing API
  // So we use a sync wrapper via the streaming reader workaround
  // Note: We actually convert this to async and handle at call sites
  throw new Error('Use parseALMExcelAsync instead');
}

export async function parseALMExcelAsync(buffer: Buffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  // Use the first sheet (ALM exports are usually single-sheet)
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { defects: [], totalRows: 0, skippedRows: 0, detectedColumns: [] };
  }

  const rawRows = worksheetToObjects(worksheet);

  if (rawRows.length === 0) {
    return { defects: [], totalRows: 0, skippedRows: 0, detectedColumns: [] };
  }

  const headers = Object.keys(rawRows[0]);

  // Map each field to its detected column header
  const colMap = {} as Record<keyof typeof COL_ALIASES, string | null>;
  for (const field of Object.keys(COL_ALIASES) as (keyof typeof COL_ALIASES)[]) {
    colMap[field] = findColumn(headers, field);
  }

  const defects: Defect[] = [];
  let skippedRows = 0;

  for (const raw of rawRows) {
    const row = raw as Record<string, unknown>;
    const title = getCell(row, colMap.title);
    if (!title) { skippedRows++; continue; } // skip empty rows

    const severityRaw = getCell(row, colMap.severity);
    const priorityRaw = getCell(row, colMap.priority);
    // If no explicit Priority column, derive from Severity (common in ALM exports
    // that only expose Severity, e.g. the standard "Work Item" export format)
    const priority = normalizePriority(priorityRaw) !== 'Unknown'
      ? normalizePriority(priorityRaw)
      : normalizePriority(severityRaw);

    defects.push({
      id: getCell(row, colMap.id) || String(defects.length + 1),
      title,
      priority,
      severity: severityRaw,
      status: getCell(row, colMap.status),
      application: getCell(row, colMap.application) || 'Unknown',
      module: getCell(row, colMap.module),
      description: getCell(row, colMap.description),
      resolution: getCell(row, colMap.resolution),
      detectedBy: getCell(row, colMap.detectedBy),
      assignedTo: getCell(row, colMap.assignedTo),
      detectedDate: getCell(row, colMap.detectedDate),
      closedDate: getCell(row, colMap.closedDate),
      environment: getCell(row, colMap.environment),
      rawRow: Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)])),
    });
  }

  return {
    defects,
    totalRows: rawRows.length,
    skippedRows,
    detectedColumns: Object.entries(colMap)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}→${v}`),
  };
}

/**
 * Serialize defects to a compact string for use in a Claude prompt.
 * Caps at maxDefects to stay within token limits.
 */
export function defectsToPromptText(defects: Defect[], maxDefects = 300): string {
  const sample = defects.slice(0, maxDefects);
  const lines = sample.map(d =>
    `[${d.id}] ${d.priority} | ${d.application} | ${d.module || 'N/A'} | ${d.status}\n` +
    `  Title: ${d.title}\n` +
    (d.description ? `  Desc: ${d.description.slice(0, 200)}\n` : '') +
    (d.resolution ? `  Fix: ${d.resolution.slice(0, 150)}\n` : '')
  );
  return lines.join('\n');
}
