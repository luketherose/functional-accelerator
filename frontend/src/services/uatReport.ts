import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { UATAnalysisResult, UATAnalysis } from '../types';

// ─── Palette ──────────────────────────────────────────────────────────────────

const C = {
  purple:      [59,   7, 100] as [number, number, number],
  purpleLight: [107,  55, 168] as [number, number, number],
  white:       [255, 255, 255] as [number, number, number],
  black:       [ 17,  24,  39] as [number, number, number],
  muted:       [107, 114, 128] as [number, number, number],
  surface:     [249, 250, 251] as [number, number, number],
  border:      [229, 231, 235] as [number, number, number],
  red:         [239,  68,  68] as [number, number, number],
  orange:      [249, 115,  22] as [number, number, number],
  amber:       [245, 158,  11] as [number, number, number],
  green:       [ 34, 197,  94] as [number, number, number],
  emerald:     [ 16, 185, 129] as [number, number, number],
};

function rgb(...c: [number, number, number]): { r: number; g: number; b: number } {
  return { r: c[0], g: c[1], b: c[2] };
}

const PRIORITY_COLOR: Record<string, [number, number, number]> = {
  Critical: C.red,
  High:     C.orange,
  Medium:   C.amber,
  Low:      C.green,
  high:     C.red,
  medium:   C.amber,
  low:      C.green,
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function riskLabel(level: string) {
  return level === 'high' ? 'HIGH' : level === 'medium' ? 'MEDIUM' : 'LOW';
}

function priorityDot(doc: jsPDF, x: number, y: number, priority: string) {
  const c = PRIORITY_COLOR[priority] ?? C.muted;
  doc.setFillColor(...c);
  doc.circle(x + 2.5, y + 1.5, 1.8, 'F');
}

// ─── Page counter ─────────────────────────────────────────────────────────────

function addPageNumbers(doc: jsPDF) {
  const total = doc.getNumberOfPages();
  for (let i = 2; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(`Pagina ${i - 1} di ${total - 1}`, 105, 289, { align: 'center' });
  }
}

// ─── Section header ───────────────────────────────────────────────────────────

function sectionHeader(doc: jsPDF, y: number, title: string): number {
  doc.setFillColor(...C.purple);
  doc.rect(14, y, 182, 7, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.white);
  doc.text(title.toUpperCase(), 18, y + 4.8);
  return y + 12;
}

// ─── Cover page ───────────────────────────────────────────────────────────────

function buildCoverPage(
  doc: jsPDF,
  projectName: string,
  analysis: UATAnalysis,
  result: UATAnalysisResult,
) {
  const W = 210, H = 297;

  // Gradient-ish background (two rects)
  doc.setFillColor(...C.purple);
  doc.rect(0, 0, W, H * 0.62, 'F');
  doc.setFillColor(...C.purpleLight);
  doc.rect(0, H * 0.62, W, H * 0.38, 'F');

  // Decorative strip
  doc.setFillColor(255, 255, 255);
  doc.setGState(doc.GState({ opacity: 0.08 }));
  doc.rect(0, H * 0.55, W, 4, 'F');
  doc.setGState(doc.GState({ opacity: 1 }));

  // Title block
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(200, 160, 255);
  doc.text('DEFECT INTELLIGENCE PLATFORM', W / 2, 68, { align: 'center' });

  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.white);
  const nameLines = doc.splitTextToSize(projectName.toUpperCase(), 170) as string[];
  doc.text(nameLines, W / 2, 88, { align: 'center' });

  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(220, 200, 255);
  doc.text('UAT Risk Analysis Report', W / 2, 88 + nameLines.length * 10 + 8, { align: 'center' });

  // Divider
  doc.setDrawColor(255, 255, 255);
  doc.setGState(doc.GState({ opacity: 0.3 }));
  doc.line(40, 130, 170, 130);
  doc.setGState(doc.GState({ opacity: 1 }));

  // Meta info
  const meta = [
    ['Run', analysis.version_name],
    ['Data', fmtDate(analysis.created_at)],
    ['File sorgente', analysis.file_name ?? '—'],
    ['Totale difetti', String(result.totalDefects)],
    ['Rischio complessivo', riskLabel(result.overallRiskLevel)],
  ];
  let my = 142;
  for (const [k, v] of meta) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(200, 160, 255);
    doc.text(k, 40, my);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.white);
    doc.text(v, 90, my);
    my += 9;
  }

  // KPI pills at bottom
  const crit = result.byPriority.find(p => p.priority === 'Critical')?.count ?? 0;
  const high = result.byPriority.find(p => p.priority === 'High')?.count ?? 0;
  const pills = [
    { label: 'CRITICAL', value: crit, color: C.red },
    { label: 'HIGH', value: high, color: C.orange },
    { label: 'APPLICAZIONI', value: result.byApplication.length, color: C.purpleLight },
    { label: 'CLUSTER', value: result.clusterSummaries.length, color: C.purple },
  ];

  const pillW = 38, pillH = 20, startX = (W - pills.length * pillW - (pills.length - 1) * 5) / 2;
  pills.forEach((p, i) => {
    const px = startX + i * (pillW + 5);
    const py = H * 0.62 + 18;
    doc.setFillColor(...C.white);
    doc.setGState(doc.GState({ opacity: 0.12 }));
    doc.roundedRect(px, py, pillW, pillH, 3, 3, 'F');
    doc.setGState(doc.GState({ opacity: 1 }));

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.white);
    doc.text(String(p.value), px + pillW / 2, py + 11, { align: 'center' });
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(220, 200, 255);
    doc.text(p.label, px + pillW / 2, py + 17, { align: 'center' });
  });

  // Footer
  doc.setFontSize(7.5);
  doc.setTextColor(180, 150, 220);
  doc.text('Generato dal Defect Intelligence Platform', W / 2, H - 10, { align: 'center' });
}

// ─── Executive summary page ───────────────────────────────────────────────────

function buildSummaryPage(doc: jsPDF, result: UATAnalysisResult, y: number): number {
  y = sectionHeader(doc, y, '1. Executive Summary');

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.black);
  const summaryLines = doc.splitTextToSize(result.executiveSummary, 178) as string[];
  doc.text(summaryLines, 16, y);
  y += summaryLines.length * 5 + 4;

  if (result.qualityTrend) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.purple);
    doc.text('Quality Trend', 16, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.black);
    const trendLines = doc.splitTextToSize(result.qualityTrend, 178) as string[];
    doc.text(trendLines, 16, y);
    y += trendLines.length * 5 + 4;
  }

  return y + 4;
}

// ─── Priority distribution table ─────────────────────────────────────────────

function buildPrioritySection(doc: jsPDF, result: UATAnalysisResult, y: number): number {
  y = sectionHeader(doc, y, '2. Distribuzione per Priorità');

  autoTable(doc, {
    startY: y,
    head: [['Priorità', 'Conteggio', '% sul totale']],
    body: result.byPriority.map(p => [p.priority, String(p.count), `${p.percentage}%`]),
    styles: { fontSize: 8.5, cellPadding: 3 },
    headStyles: { fillColor: C.purple, textColor: C.white, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: C.surface },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' }, 2: { halign: 'right' } },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 0) {
        const p = data.cell.text[0] as string;
        const c = PRIORITY_COLOR[p];
        if (c) data.cell.styles.textColor = c;
      }
    },
  });

  // @ts-expect-error jspdf-autotable adds lastAutoTable dynamically
  return doc.lastAutoTable.finalY + 8;
}

// ─── Cluster breakdown ────────────────────────────────────────────────────────

function buildClusterSection(doc: jsPDF, result: UATAnalysisResult, y: number): number {
  y = sectionHeader(doc, y, '3. Cluster Analysis');

  autoTable(doc, {
    startY: y,
    head: [['Cluster', 'Tot', 'Crit', 'High', 'Med', 'Low', 'Risk Score', 'Livello']],
    body: result.clusterSummaries.map(c => [
      c.clusterName,
      String(c.defectCount),
      String(c.criticalCount),
      String(c.highCount),
      String(c.mediumCount),
      String(c.lowCount),
      String(c.riskScore),
      riskLabel(c.riskLevel),
    ]),
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: C.purple, textColor: C.white, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: C.surface },
    columnStyles: {
      0: { cellWidth: 52, fontStyle: 'bold' },
      1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' },
      4: { halign: 'center' }, 5: { halign: 'center' }, 6: { halign: 'center' },
      7: { halign: 'center', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 7) {
        const level = (data.cell.text[0] as string).toLowerCase();
        if (level === 'high')   data.cell.styles.textColor = C.red;
        if (level === 'medium') data.cell.styles.textColor = C.amber;
        if (level === 'low')    data.cell.styles.textColor = C.green;
      }
    },
  });

  // @ts-expect-error
  return doc.lastAutoTable.finalY + 8;
}

// ─── Risk areas ───────────────────────────────────────────────────────────────

function buildRiskAreasSection(doc: jsPDF, result: UATAnalysisResult, y: number): number {
  if (result.riskAreas.length === 0) return y;

  y = sectionHeader(doc, y, '4. Risk Areas');

  autoTable(doc, {
    startY: y,
    head: [['Area', 'Livello', 'Razionale', 'Raccomandazione']],
    body: result.riskAreas.map(a => [
      a.area,
      riskLabel(a.riskLevel),
      a.rationale,
      a.recommendation,
    ]),
    styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: C.purple, textColor: C.white, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: C.surface },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: 'bold' },
      1: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
      2: { cellWidth: 64 },
      3: { cellWidth: 64 },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const level = (data.cell.text[0] as string).toLowerCase();
        if (level === 'high')   data.cell.styles.textColor = C.red;
        if (level === 'medium') data.cell.styles.textColor = C.amber;
        if (level === 'low')    data.cell.styles.textColor = C.green;
      }
    },
  });

  // @ts-expect-error
  return doc.lastAutoTable.finalY + 8;
}

// ─── Prevention actions ───────────────────────────────────────────────────────

function buildPreventionSection(doc: jsPDF, result: UATAnalysisResult, y: number): number {
  if (result.preventionActions.length === 0) return y;

  y = sectionHeader(doc, y, '5. Prevention Actions');

  const effortLabel: Record<string, string> = { low: 'Quick win', medium: 'Medio', high: 'Alto' };

  autoTable(doc, {
    startY: y,
    head: [['Azione', 'Priorità', 'Applicazione', 'Effort']],
    body: result.preventionActions.map(a => [
      a.action,
      a.priority.toUpperCase(),
      a.targetApplication,
      effortLabel[a.effort] ?? a.effort,
    ]),
    styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: C.purple, textColor: C.white, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: C.surface },
    columnStyles: {
      0: { cellWidth: 82 },
      1: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
      2: { cellWidth: 50 },
      3: { cellWidth: 30, halign: 'center' },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const level = (data.cell.text[0] as string).toLowerCase();
        if (level === 'high')   data.cell.styles.textColor = C.red;
        if (level === 'medium') data.cell.styles.textColor = C.amber;
        if (level === 'low')    data.cell.styles.textColor = C.green;
      }
    },
  });

  // @ts-expect-error
  return doc.lastAutoTable.finalY + 8;
}

// ─── Top defects ──────────────────────────────────────────────────────────────

function buildTopDefectsSection(doc: jsPDF, result: UATAnalysisResult, y: number): number {
  if (result.topDefects.length === 0) return y;

  y = sectionHeader(doc, y, '6. Top Critical & High Defects');

  autoTable(doc, {
    startY: y,
    head: [['ID', 'Titolo', 'Priorità', 'Applicazione', 'Modulo']],
    body: result.topDefects.map(d => [d.id, d.title, d.priority, d.application, d.module]),
    styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: C.purple, textColor: C.white, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: C.surface },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 82 },
      2: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 36 },
      4: { cellWidth: 36 },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 2) {
        const p = data.cell.text[0] as string;
        const c = PRIORITY_COLOR[p];
        if (c) data.cell.styles.textColor = c;
      }
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 2) {
        priorityDot(doc, data.cell.x + 1, data.cell.y + (data.cell.height - 3) / 2, data.cell.text[0] as string);
      }
    },
  });

  // @ts-expect-error
  return doc.lastAutoTable.finalY + 8;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generateUATReport(
  result: UATAnalysisResult,
  analysis: UATAnalysis,
  projectName: string,
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // ── Cover page ──
  buildCoverPage(doc, projectName, analysis, result);

  // ── Content pages ──
  doc.addPage();
  let y = 20;

  y = buildSummaryPage(doc, result, y);
  if (y > 220) { doc.addPage(); y = 20; }
  y = buildPrioritySection(doc, result, y);
  if (y > 220) { doc.addPage(); y = 20; }
  y = buildClusterSection(doc, result, y);
  if (y > 220) { doc.addPage(); y = 20; }
  y = buildRiskAreasSection(doc, result, y);
  if (y > 220) { doc.addPage(); y = 20; }
  y = buildPreventionSection(doc, result, y);
  if (y > 220) { doc.addPage(); y = 20; }
  buildTopDefectsSection(doc, result, y);

  // Page numbers on all content pages
  addPageNumbers(doc);

  const safeName = projectName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const runName  = analysis.version_name.replace(/\s+/g, '-').toLowerCase();
  doc.save(`${safeName}-${runName}-uat-report.pdf`);
}
