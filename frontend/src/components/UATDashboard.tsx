import { AlertTriangle, CheckCircle2, AlertCircle, TrendingUp, Shield, Zap, ChevronDown, ChevronUp, ChevronLeft, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UATAnalysisResult, UATAnalysis, UATApplicationStat } from '../types';
import { generateUATReport } from '../services/uatReport';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<string, string> = {
  Critical: 'bg-red-500',
  High:     'bg-orange-400',
  Medium:   'bg-amber-400',
  Low:      'bg-green-400',
  Unknown:  'bg-gray-300',
};
const PRIORITY_TEXT: Record<string, string> = {
  Critical: 'text-red-700 bg-red-50 border-red-200',
  High:     'text-orange-700 bg-orange-50 border-orange-200',
  Medium:   'text-amber-700 bg-amber-50 border-amber-200',
  Low:      'text-green-700 bg-green-50 border-green-200',
  Unknown:  'text-gray-600 bg-gray-50 border-gray-200',
};
const RISK_BADGE: Record<string, string> = {
  high:   'text-red-700 bg-red-50 border-red-200',
  medium: 'text-amber-700 bg-amber-50 border-amber-200',
  low:    'text-green-700 bg-green-50 border-green-200',
};
const EFFORT_LABEL: Record<string, string> = {
  low: 'Quick win', medium: 'Medium effort', high: 'High effort',
};

// ─── WAW Pie chart helpers ─────────────────────────────────────────────────────

const WAW_COLORS = ['#7c3aed','#2563eb','#dc2626','#d97706','#059669','#db2777','#0891b2','#65a30d','#9333ea','#ea580c'];
const PRIORITY_PIE: Record<string, string> = {
  Critical: '#ef4444', High: '#fb923c', Medium: '#fbbf24', Low: '#4ade80',
};

function polarXY(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function sectorPath(cx: number, cy: number, r: number, ir: number, startDeg: number, endDeg: number): string {
  const span = Math.min(endDeg - startDeg, 359.99);
  const end = startDeg + span;
  const s1 = polarXY(cx, cy, r, startDeg);
  const e1 = polarXY(cx, cy, r, end);
  const s2 = polarXY(cx, cy, ir, end);
  const e2 = polarXY(cx, cy, ir, startDeg);
  const lg = span > 180 ? 1 : 0;
  return `M ${s1.x} ${s1.y} A ${r} ${r} 0 ${lg} 1 ${e1.x} ${e1.y} L ${s2.x} ${s2.y} A ${ir} ${ir} 0 ${lg} 0 ${e2.x} ${e2.y} Z`;
}

interface WawSlice { label: string; value: number; color: string }

function WawDrillDown({ result }: { result: UATAnalysisResult }) {
  const { t } = useTranslation();
  const [drillApp, setDrillApp] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const CX = 110, CY = 110, R = 88, IR = 48;

  const topSlices: WawSlice[] = result.byApplication.map((s, i) => ({
    label: s.application,
    value: s.riskScore || s.total,
    color: WAW_COLORS[i % WAW_COLORS.length],
  })).filter(s => s.value > 0);

  const drillStat = drillApp ? result.byApplication.find(a => a.application === drillApp) : null;
  const drillSlices: WawSlice[] = drillStat
    ? ([
        { label: 'Critical', value: drillStat.critical, color: PRIORITY_PIE.Critical },
        { label: 'High',     value: drillStat.high,     color: PRIORITY_PIE.High },
        { label: 'Medium',   value: drillStat.medium,   color: PRIORITY_PIE.Medium },
        { label: 'Low',      value: drillStat.low,      color: PRIORITY_PIE.Low },
      ] as WawSlice[]).filter(s => s.value > 0)
    : [];

  const slices = drillApp ? drillSlices : topSlices;
  const total  = slices.reduce((s, x) => s + x.value, 0) || 1;

  let cursor = 0;
  const arcs = slices.map((s, i) => {
    const start = cursor;
    const end   = cursor + (s.value / total) * 360;
    cursor = end;
    const mid = (start + end) / 2;
    const explode = polarXY(0, 0, 7, mid);
    return { ...s, i, start, end, pct: s.value / total, explode };
  });

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            {t('dashboard.waw.title')}
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            {drillApp
              ? t('dashboard.waw.drillSubtitle', { app: drillApp })
              : t('dashboard.waw.mainSubtitle')}
          </p>
        </div>
        {drillApp && (
          <button
            onClick={() => { setDrillApp(null); setHovered(null); }}
            className="flex items-center gap-1 text-xs text-purple-deep hover:underline shrink-0"
          >
            <ChevronLeft size={12} /> {t('dashboard.waw.backToAll')}
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* SVG donut */}
        <svg width={220} height={220} viewBox="0 0 220 220" className="shrink-0">
          {arcs.map(arc => (
            <path
              key={arc.label}
              d={sectorPath(CX, CY, R, IR, arc.start, arc.end)}
              fill={arc.color}
              stroke="white"
              strokeWidth={2}
              opacity={hovered === null || hovered === arc.i ? 1 : 0.45}
              style={{ cursor: drillApp ? 'default' : 'pointer', transition: 'opacity 0.15s, transform 0.15s' }}
              transform={hovered === arc.i ? `translate(${arc.explode.x}, ${arc.explode.y})` : ''}
              onMouseEnter={() => setHovered(arc.i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => !drillApp && setDrillApp(arc.label)}
            />
          ))}
          {/* Centre labels */}
          <text x={CX} y={CY - 10} textAnchor="middle" fill="#6b7280" fontSize={10}>
            {drillApp ? drillApp : 'WAW Risk'}
          </text>
          <text x={CX} y={CY + 10} textAnchor="middle" fill="#111827" fontSize={20} fontWeight="700">
            {drillApp ? (drillStat?.total ?? 0) : total}
          </text>
          <text x={CX} y={CY + 26} textAnchor="middle" fill="#9ca3af" fontSize={10}>
            {drillApp ? 'defects' : 'risk score'}
          </text>
        </svg>

        {/* Legend */}
        <div className="flex-1 space-y-1 min-w-0 w-full">
          {arcs.map(arc => (
            <button
              key={arc.label}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                drillApp ? 'cursor-default' : 'hover:bg-surface cursor-pointer'
              } ${hovered === arc.i ? 'bg-surface' : ''}`}
              onMouseEnter={() => setHovered(arc.i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => !drillApp && setDrillApp(arc.label)}
              disabled={!!drillApp}
            >
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: arc.color }} />
              <span className="flex-1 text-xs text-text-primary truncate">{arc.label}</span>
              <span className="text-[10px] text-text-muted shrink-0 w-8 text-right">{Math.round(arc.pct * 100)}%</span>
              <span className="text-[10px] font-semibold text-text-secondary shrink-0 w-8 text-right">{arc.value}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Filter chips ─────────────────────────────────────────────────────────────

function FilterChips<T extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-text-muted shrink-0">{label}:</span>
      <button
        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${value === null ? 'border-purple-deep bg-purple-deep text-white' : 'border-surface-border text-text-muted hover:border-purple-deep hover:text-purple-deep'}`}
        onClick={() => onChange(null)}
      >{t('common.all')}</button>
      {options.map(o => (
        <button
          key={o.value}
          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${value === o.value ? 'border-purple-deep bg-purple-deep text-white' : 'border-surface-border text-text-muted hover:border-purple-deep hover:text-purple-deep'}`}
          onClick={() => onChange(value === o.value ? null : o.value)}
        >{o.label}</button>
      ))}
    </div>
  );
}

function RiskBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const icon = level === 'high' ? <AlertTriangle size={11} /> : level === 'medium' ? <AlertCircle size={11} /> : <CheckCircle2 size={11} />;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold capitalize ${RISK_BADGE[level]}`}>
      {icon} {level}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold ${PRIORITY_TEXT[priority] ?? PRIORITY_TEXT.Unknown}`}>
      {priority}
    </span>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
    </div>
  );
}

/** Horizontal stacked bar showing Critical/High/Medium/Low */
function ApplicationBar({ stat, maxScore }: { stat: UATApplicationStat; maxScore: number }) {
  const total = stat.total || 1;
  const pCrit  = (stat.critical / total) * 100;
  const pHigh  = (stat.high / total) * 100;
  const pMed   = (stat.medium / total) * 100;
  const pLow   = Math.max(0, 100 - pCrit - pHigh - pMed);
  const widthPct = Math.max(8, Math.round((stat.riskScore / Math.max(maxScore, 1)) * 100));

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-28 shrink-0 text-xs font-medium text-text-primary truncate" title={stat.application}>
        {stat.application}
      </div>
      <div className="flex-1">
        <div className="flex h-4 rounded-md overflow-hidden gap-px" style={{ width: `${widthPct}%` }}>
          {pCrit  > 0 && <div className="bg-red-500"    style={{ width: `${pCrit}%` }} title={`Critical: ${stat.critical}`} />}
          {pHigh  > 0 && <div className="bg-orange-400" style={{ width: `${pHigh}%` }} title={`High: ${stat.high}`} />}
          {pMed   > 0 && <div className="bg-amber-400"  style={{ width: `${pMed}%` }}  title={`Medium: ${stat.medium}`} />}
          {pLow   > 0 && <div className="bg-green-400"  style={{ width: `${pLow}%` }}  title={`Low: ${stat.low}`} />}
        </div>
      </div>
      <div className="w-16 text-right text-[10px] text-text-muted shrink-0">
        {stat.total} defects
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  result: UATAnalysisResult;
  analysis: UATAnalysis;
  projectName: string;
  fileName: string | null;
}

export default function UATDashboard({ result, analysis, projectName, fileName }: Props) {
  const { t } = useTranslation();
  const [expandedDefect, setExpandedDefect] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // ── Filter states ────────────────────────────────────────────────────────────
  const [raRisk,    setRaRisk]    = useState<'high'|'medium'|'low'|null>(null);
  const [raApp,     setRaApp]     = useState<string|null>(null);
  const [paApp,     setPaApp]     = useState<string|null>(null);
  const [paPrio,    setPaPrio]    = useState<'high'|'medium'|'low'|null>(null);
  const [paEffort,  setPaEffort]  = useState<'low'|'medium'|'high'|null>(null);
  const [rpPrio,    setRpPrio]    = useState<'high'|'medium'|'low'|null>(null);
  const [rpApp,     setRpApp]     = useState<string|null>(null);

  const maxRiskScore = Math.max(...result.byApplication.map(a => a.riskScore), 1);

  // ── Derived unique options ───────────────────────────────────────────────────
  const raApps  = [...new Set(result.riskAreas.flatMap(a => a.relatedApplications))].slice(0, 6);
  const paApps  = [...new Set(result.preventionActions.map(a => a.targetApplication))].slice(0, 6);
  const rpApps  = [...new Set(result.recurringPatterns.flatMap(p => p.applications))].slice(0, 6);

  // ── Filtered data ────────────────────────────────────────────────────────────
  const filteredRiskAreas = result.riskAreas.filter(a =>
    (!raRisk || a.riskLevel === raRisk) &&
    (!raApp  || a.relatedApplications.includes(raApp))
  );
  const filteredPrevActions = result.preventionActions.filter(a =>
    (!paPrio   || a.priority === paPrio) &&
    (!paApp    || a.targetApplication === paApp) &&
    (!paEffort || a.effort === paEffort)
  );
  const filteredPatterns = result.recurringPatterns.filter(p =>
    (!rpPrio || p.priority === rpPrio) &&
    (!rpApp  || p.applications.includes(rpApp))
  );

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      generateUATReport(result, analysis, projectName);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-surface/30 p-6 space-y-6">

      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">{analysis.version_name} · {fileName}</p>
        <button
          onClick={handleExportPDF}
          disabled={exporting}
          className="btn-secondary text-xs flex items-center gap-1.5"
          title={t('dashboard.exportPDF')}
        >
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          {exporting ? t('dashboard.generating') : t('dashboard.exportPDF')}
        </button>
      </div>

      {/* ── KPI strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="card p-4">
          <p className="text-xs text-text-muted mb-1">{t('dashboard.totalDefects')}</p>
          <p className="text-2xl font-bold text-text-primary">{result.totalDefects}</p>
          {fileName && <p className="text-[10px] text-text-muted mt-1 truncate">{fileName}</p>}
        </div>
        <div className="card p-4">
          <p className="text-xs text-text-muted mb-1">{t('dashboard.overallRisk')}</p>
          <div className="mt-1"><RiskBadge level={result.overallRiskLevel} /></div>
        </div>
        <div className="card p-4">
          <p className="text-xs text-text-muted mb-1">{t('dashboard.criticalHigh')}</p>
          <p className="text-2xl font-bold text-red-600">
            {result.byPriority.filter(p => p.priority === 'Critical' || p.priority === 'High').reduce((s, p) => s + p.count, 0)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-text-muted mb-1">{t('dashboard.appsImpacted')}</p>
          <p className="text-2xl font-bold text-text-primary">{result.byApplication.length}</p>
        </div>
      </div>

      {/* ── WAW drill-down ───────────────────────────────────────── */}
      {result.byApplication.length > 0 && <WawDrillDown result={result} />}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* ── By application ────────────────────────────────────── */}
        <div className="card p-5">
          <SectionHeader
            title={t('dashboard.riskByApp')}
            subtitle={t('dashboard.riskByAppSub')}
          />
          {/* Legend */}
          <div className="flex gap-3 mb-3 flex-wrap">
            {[['bg-red-500','Critical'],['bg-orange-400','High'],['bg-amber-400','Medium'],['bg-green-400','Low']].map(([cls,lbl]) => (
              <span key={lbl} className="flex items-center gap-1 text-[10px] text-text-muted">
                <span className={`w-2.5 h-2.5 rounded-sm ${cls}`} />{lbl}
              </span>
            ))}
          </div>
          <div className="space-y-0.5">
            {result.byApplication.map(stat => (
              <ApplicationBar key={stat.application} stat={stat} maxScore={maxRiskScore} />
            ))}
          </div>
        </div>

        {/* ── Priority distribution ─────────────────────────────── */}
        <div className="card p-5">
          <SectionHeader title={t('dashboard.priorityDist')} />
          <div className="space-y-3">
            {result.byPriority.map(p => (
              <div key={p.priority}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium text-text-primary">{p.priority}</span>
                  <span className="text-text-muted">{p.count} ({p.percentage}%)</span>
                </div>
                <div className="h-3 bg-surface rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${PRIORITY_COLOR[p.priority] ?? 'bg-gray-300'}`}
                    style={{ width: `${p.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* By module */}
          <div className="mt-5 pt-4 border-t border-surface-border">
            <p className="text-xs font-semibold text-text-primary mb-3">{t('dashboard.topModules')}</p>
            <div className="space-y-1.5">
              {result.byModule.slice(0, 8).map(m => (
                <div key={m.module} className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-text-secondary truncate">{m.module}</span>
                  <span className="text-[10px] text-red-600 font-medium w-16 text-right">{m.criticalCount} crit/high</span>
                  <span className="text-[10px] text-text-muted w-12 text-right">{m.count} total</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Executive summary ─────────────────────────────────────── */}
      <div className="card p-5">
        <SectionHeader title={t('dashboard.executiveSummary')} />
        <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">{result.executiveSummary}</p>
        {result.qualityTrend && (
          <div className="mt-3 pt-3 border-t border-surface-border">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp size={13} className="text-purple-deep" />
              <p className="text-xs font-semibold text-text-primary">{t('dashboard.qualityTrend')}</p>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">{result.qualityTrend}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* ── Risk areas ────────────────────────────────────────────── */}
        {result.riskAreas.length > 0 && (
          <div className="card p-5">
            <SectionHeader title={t('dashboard.riskAreas')} subtitle={t('dashboard.riskAreasSub')} />
            {/* Filters */}
            <div className="space-y-1.5 mb-4">
              <FilterChips<'high'|'medium'|'low'>
                label={t('dashboard.filterRisk')}
                options={[{value:'high',label:'High'},{value:'medium',label:'Medium'},{value:'low',label:'Low'}]}
                value={raRisk} onChange={setRaRisk}
              />
              {raApps.length > 0 && (
                <FilterChips<string>
                  label="App"
                  options={raApps.map(a => ({ value: a, label: a }))}
                  value={raApp} onChange={setRaApp}
                />
              )}
            </div>
            <div className="space-y-3">
              {filteredRiskAreas.length === 0 && (
                <p className="text-xs text-text-muted py-2 text-center">{t('dashboard.noResults')}</p>
              )}
              {filteredRiskAreas.map((area, i) => (
                <div key={i} className="rounded-xl border border-surface-border p-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-text-primary flex-1">{area.area}</p>
                    <RiskBadge level={area.riskLevel} />
                  </div>
                  <p className="text-xs text-text-secondary leading-snug">{area.rationale}</p>
                  <div className="flex items-start gap-1.5 bg-surface rounded-lg p-2">
                    <Shield size={11} className="text-purple-deep mt-0.5 shrink-0" />
                    <p className="text-[11px] text-purple-deep leading-snug">{area.recommendation}</p>
                  </div>
                  {area.relatedApplications.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {area.relatedApplications.map(app => (
                        <span key={app} className="text-[10px] bg-brand-50 text-purple-deep px-1.5 py-0.5 rounded-full border border-brand-200">{app}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Prevention actions ────────────────────────────────────── */}
        {result.preventionActions.length > 0 && (
          <div className="card p-5">
            <SectionHeader title={t('dashboard.preventionActions')} subtitle={t('dashboard.preventionActionsSub')} />
            {/* Filters */}
            <div className="space-y-1.5 mb-4">
              <FilterChips<'high'|'medium'|'low'>
                label={t('dashboard.filterPriority')}
                options={[{value:'high',label:'High'},{value:'medium',label:'Medium'},{value:'low',label:'Low'}]}
                value={paPrio} onChange={setPaPrio}
              />
              <FilterChips<'low'|'medium'|'high'>
                label={t('dashboard.filterEffort')}
                options={[{value:'low',label:t('common.effort.low')},{value:'medium',label:t('common.effort.medium')},{value:'high',label:t('common.effort.high')}]}
                value={paEffort} onChange={setPaEffort}
              />
              {paApps.length > 0 && (
                <FilterChips<string>
                  label="App"
                  options={paApps.map(a => ({ value: a, label: a }))}
                  value={paApp} onChange={setPaApp}
                />
              )}
            </div>
            <div className="space-y-2.5">
              {filteredPrevActions.length === 0 && (
                <p className="text-xs text-text-muted py-2 text-center">{t('dashboard.noResults')}</p>
              )}
              {filteredPrevActions.map((action, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-surface-border">
                  <div className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center ${
                    action.priority === 'high' ? 'bg-red-500' : action.priority === 'medium' ? 'bg-amber-400' : 'bg-green-400'
                  }`}>
                    <Zap size={13} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary leading-snug">{action.action}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-[10px] text-purple-deep font-medium">{action.targetApplication}</span>
                      <span className="text-[10px] text-text-muted">·</span>
                      <span className={`text-[10px] font-medium ${
                        action.effort === 'low' ? 'text-green-600' : action.effort === 'medium' ? 'text-amber-600' : 'text-red-600'
                      }`}>{EFFORT_LABEL[action.effort]}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Recurring patterns ───────────────────────────────────────── */}
      {result.recurringPatterns.length > 0 && (
        <div className="card p-5">
          <div className="flex flex-col sm:flex-row sm:items-start gap-3 mb-4">
            <div className="flex-1">
              <SectionHeader title={t('dashboard.recurringPatterns')} subtitle={t('dashboard.recurringPatternsSub')} />
            </div>
            {/* Filters */}
            <div className="space-y-1.5 shrink-0">
              <FilterChips<'high'|'medium'|'low'>
                label={t('dashboard.filterPriority')}
                options={[{value:'high',label:'High'},{value:'medium',label:'Medium'},{value:'low',label:'Low'}]}
                value={rpPrio} onChange={setRpPrio}
              />
              {rpApps.length > 0 && (
                <FilterChips<string>
                  label="App"
                  options={rpApps.map(a => ({ value: a, label: a }))}
                  value={rpApp} onChange={setRpApp}
                />
              )}
            </div>
          </div>
          <div className="space-y-2">
            {filteredPatterns.length === 0 && (
              <p className="text-xs text-text-muted py-2 text-center">{t('dashboard.noResults')}</p>
            )}
            {filteredPatterns.map((p, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-surface-border">
                <div className={`text-sm font-bold w-8 text-center shrink-0 ${
                  p.priority === 'high' ? 'text-red-600' : p.priority === 'medium' ? 'text-amber-600' : 'text-green-600'
                }`}>
                  ×{p.occurrences}
                </div>
                <p className="flex-1 text-xs text-text-primary">{p.pattern}</p>
                <div className="flex flex-wrap gap-1 shrink-0">
                  {p.applications.map(app => (
                    <span key={app} className="text-[10px] bg-surface text-text-muted px-1.5 py-0.5 rounded border border-surface-border">{app}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Top defects (bottom) ──────────────────────────────────────── */}
      {result.topDefects.length > 0 && (
        <div className="card p-5">
          <SectionHeader
            title={t('dashboard.topDefects')}
            subtitle={t('dashboard.topDefectsSub', { count: result.topDefects.length })}
          />
          <div className="space-y-2">
            {result.topDefects.map(d => {
              const isOpen = expandedDefect === d.id;
              return (
                <div key={d.id} className="border border-surface-border rounded-xl overflow-hidden">
                  <button
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-surface/60 transition-colors"
                    onClick={() => setExpandedDefect(isOpen ? null : d.id)}
                  >
                    <PriorityBadge priority={d.priority} />
                    <span className="text-xs font-medium text-text-primary flex-1 truncate">{d.title}</span>
                    <span className="text-[10px] text-text-muted shrink-0 hidden sm:block">{d.application}</span>
                    <span className="text-[10px] text-text-muted shrink-0 hidden md:block ml-2">{d.module}</span>
                    {isOpen ? <ChevronUp size={13} className="text-text-muted shrink-0" /> : <ChevronDown size={13} className="text-text-muted shrink-0" />}
                  </button>
                  {isOpen && d.impact && (
                    <div className="px-3 pb-3 bg-surface/40 border-t border-surface-border">
                      <p className="text-xs text-text-secondary mt-2 leading-relaxed">{d.impact}</p>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <span className="text-[10px] text-text-muted">#{d.id}</span>
                        <span className="text-[10px] text-text-muted">·</span>
                        <span className="text-[10px] text-purple-deep font-medium">{d.application}</span>
                        <span className="text-[10px] text-text-muted">·</span>
                        <span className="text-[10px] text-text-muted">{d.module}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
