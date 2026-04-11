import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus, Loader2, GitCompare, AlertCircle } from 'lucide-react';
import type { UATAnalysis, RunComparisonData, ClusterDelta } from '../types';
import { uatApi } from '../services/api';

interface Props {
  analyses: UATAnalysis[];
  projectId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function DeltaBadge({ value, lowerIsBetter = true, suffix = '' }: { value: number; lowerIsBetter?: boolean; suffix?: string }) {
  if (value === 0) return <span className="text-text-muted text-xs">—</span>;
  const improved = lowerIsBetter ? value < 0 : value > 0;
  const cls = improved ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-red-600 bg-red-50 border-red-200';
  const icon = improved
    ? <TrendingDown size={11} className="shrink-0" />
    : <TrendingUp size={11} className="shrink-0" />;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${cls}`}>
      {icon}{value > 0 ? '+' : ''}{value}{suffix}
    </span>
  );
}

function PriorityBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-text-muted w-14 shrink-0">{label}</span>
      <div className="flex-1 h-2.5 bg-surface rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] font-semibold text-text-secondary w-6 text-right shrink-0">{count}</span>
    </div>
  );
}

const PRIORITY_COLOR: Record<string, string> = {
  Critical: '#ef4444', High: '#fb923c', Medium: '#fbbf24', Low: '#4ade80',
};

// ─── Cluster delta table ───────────────────────────────────────────────────────

function ClusterDeltaTable({ deltas }: { deltas: ClusterDelta[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-surface-border">
            <th className="text-left py-2 pr-3 text-text-muted font-medium">Cluster</th>
            <th className="text-right py-2 px-2 text-text-muted font-medium">Run 1</th>
            <th className="text-right py-2 px-2 text-text-muted font-medium">Run 2</th>
            <th className="text-right py-2 px-2 text-text-muted font-medium">Δ Defects</th>
            <th className="text-right py-2 pl-2 text-text-muted font-medium">Δ Risk</th>
          </tr>
        </thead>
        <tbody>
          {deltas.map(d => (
            <tr key={d.clusterKey} className="border-b border-surface-border/50 hover:bg-surface/40 transition-colors">
              <td className="py-2 pr-3 font-medium text-text-primary">{d.clusterName}</td>
              <td className="py-2 px-2 text-right text-text-secondary">
                <span>{d.run1Count}</span>
                {d.run1Critical > 0 && <span className="ml-1 text-[9px] text-red-500 font-semibold">({d.run1Critical}C)</span>}
              </td>
              <td className="py-2 px-2 text-right text-text-secondary">
                <span>{d.run2Count}</span>
                {d.run2Critical > 0 && <span className="ml-1 text-[9px] text-red-500 font-semibold">({d.run2Critical}C)</span>}
              </td>
              <td className="py-2 px-2 text-right">
                <DeltaBadge value={d.delta} lowerIsBetter />
              </td>
              <td className="py-2 pl-2 text-right">
                <DeltaBadge value={d.riskDelta} lowerIsBetter />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── KPI comparison card ───────────────────────────────────────────────────────

function KpiCard({ label, v1, v2, delta, lowerIsBetter = true }: {
  label: string; v1: number; v2: number; delta: number; lowerIsBetter?: boolean;
}) {
  return (
    <div className="card p-4 space-y-2">
      <p className="text-[10px] text-text-muted font-medium uppercase tracking-wide">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <div>
          <span className="text-xl font-bold text-text-primary">{v2}</span>
          <span className="text-xs text-text-muted ml-1.5">← {v1}</span>
        </div>
        <DeltaBadge value={delta} lowerIsBetter={lowerIsBetter} />
      </div>
    </div>
  );
}

// ─── Run selector ─────────────────────────────────────────────────────────────

function RunSelector({
  label, analyses, selectedId, onChange,
}: { label: string; analyses: UATAnalysis[]; selectedId: string; onChange: (id: string) => void }) {
  return (
    <div className="flex-1">
      <label className="block text-[10px] text-text-muted font-semibold mb-1.5 uppercase tracking-wide">{label}</label>
      <select
        value={selectedId}
        onChange={e => onChange(e.target.value)}
        className="input text-xs w-full"
      >
        {analyses.map(a => (
          <option key={a.id} value={a.id}>
            {a.version_name} — {fmtDate(a.created_at)} ({a.defect_count} defects)
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RunComparison({ analyses, projectId }: Props) {
  const done = analyses.filter(a => a.status === 'done');

  const [run1Id, setRun1Id] = useState<string>(done[done.length - 2]?.id ?? done[0]?.id ?? '');
  const [run2Id, setRun2Id] = useState<string>(done[0]?.id ?? '');
  const [data, setData] = useState<RunComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canCompare = run1Id && run2Id && run1Id !== run2Id;

  useEffect(() => {
    if (!canCompare) return;
    setLoading(true);
    setError('');
    uatApi.compareRuns(projectId, run1Id, run2Id)
      .then(setData)
      .catch(e => setError(e?.response?.data?.error ?? 'Failed to load comparison'))
      .finally(() => setLoading(false));
  }, [projectId, run1Id, run2Id, canCompare]);

  if (done.length < 2) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted p-8">
        <div className="w-16 h-16 rounded-2xl bg-surface border-2 border-dashed border-surface-border flex items-center justify-center">
          <GitCompare size={22} className="text-text-muted" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-text-primary">Serve almeno 2 run completati</p>
          <p className="text-xs text-text-muted mt-1 max-w-xs">Carica un altro export ALM per confrontare l'evoluzione del rischio nel tempo.</p>
        </div>
      </div>
    );
  }

  const priorities = ['Critical', 'High', 'Medium', 'Low'];
  const maxPriority = data
    ? Math.max(...priorities.map(p => Math.max(data.run1.byPriority[p] ?? 0, data.run2.byPriority[p] ?? 0)), 1)
    : 1;

  return (
    <div className="flex-1 overflow-y-auto bg-surface/30 p-6 space-y-6">
      {/* Run selectors */}
      <div className="card p-4">
        <p className="text-xs font-semibold text-text-primary mb-3">Seleziona i due run da confrontare</p>
        <div className="flex items-end gap-4">
          <RunSelector label="Run base (A)" analyses={done} selectedId={run1Id} onChange={setRun1Id} />
          <div className="pb-2 shrink-0 text-text-muted">
            <GitCompare size={16} />
          </div>
          <RunSelector label="Run target (B)" analyses={done} selectedId={run2Id} onChange={setRun2Id} />
        </div>
        {run1Id === run2Id && (
          <p className="text-[10px] text-amber-600 mt-2">Seleziona due run diversi.</p>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-text-muted">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Confronto in corso…</span>
        </div>
      )}

      {error && (
        <div className="card p-4 flex items-center gap-2 text-red-600 border-red-200 bg-red-50">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {data && !loading && (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <KpiCard label="Total Defects" v1={data.run1.defectCount} v2={data.run2.defectCount} delta={data.delta.defectCount} />
            {priorities.map(p => (
              <KpiCard
                key={p}
                label={p}
                v1={data.run1.byPriority[p] ?? 0}
                v2={data.run2.byPriority[p] ?? 0}
                delta={data.delta.byPriority[p] ?? 0}
                lowerIsBetter
              />
            ))}
          </div>

          {/* Priority distribution comparison */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="card p-5">
              <p className="text-sm font-semibold text-text-primary mb-1">{data.run1.versionName}</p>
              <p className="text-[10px] text-text-muted mb-4">{fmtDate(data.run1.date)} · {data.run1.defectCount} defects</p>
              <div className="space-y-2">
                {priorities.map(p => (
                  <PriorityBar key={p} label={p} count={data.run1.byPriority[p] ?? 0} max={maxPriority} color={PRIORITY_COLOR[p]} />
                ))}
              </div>
            </div>
            <div className="card p-5">
              <p className="text-sm font-semibold text-text-primary mb-1">{data.run2.versionName}</p>
              <p className="text-[10px] text-text-muted mb-4">{fmtDate(data.run2.date)} · {data.run2.defectCount} defects</p>
              <div className="space-y-2">
                {priorities.map(p => (
                  <PriorityBar key={p} label={p} count={data.run2.byPriority[p] ?? 0} max={maxPriority} color={PRIORITY_COLOR[p]} />
                ))}
              </div>
            </div>
          </div>

          {/* Overall verdict */}
          {(() => {
            const improved = data.delta.defectCount < 0;
            const stable   = data.delta.defectCount === 0;
            return (
              <div className={`card p-4 flex items-center gap-3 ${improved ? 'border-emerald-200 bg-emerald-50/60' : stable ? 'border-surface-border' : 'border-red-200 bg-red-50/60'}`}>
                {improved
                  ? <TrendingDown size={20} className="text-emerald-600 shrink-0" />
                  : stable
                  ? <Minus size={20} className="text-text-muted shrink-0" />
                  : <TrendingUp size={20} className="text-red-600 shrink-0" />}
                <div>
                  <p className={`text-sm font-semibold ${improved ? 'text-emerald-700' : stable ? 'text-text-primary' : 'text-red-700'}`}>
                    {improved
                      ? `Miglioramento: ${Math.abs(data.delta.defectCount)} difetti in meno rispetto al run precedente`
                      : stable
                      ? 'Nessuna variazione nel totale dei difetti'
                      : `Regressione: ${data.delta.defectCount > 0 ? '+' : ''}${data.delta.defectCount} difetti rispetto al run precedente`}
                  </p>
                  {data.delta.byPriority['Critical'] !== 0 && (
                    <p className="text-xs text-text-secondary mt-0.5">
                      Critici: {data.delta.byPriority['Critical'] > 0 ? '+' : ''}{data.delta.byPriority['Critical']} ·{' '}
                      High: {data.delta.byPriority['High'] > 0 ? '+' : ''}{data.delta.byPriority['High'] ?? 0}
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Cluster delta table */}
          <div className="card p-5">
            <p className="text-sm font-semibold text-text-primary mb-1">Variazioni per Cluster</p>
            <p className="text-xs text-text-muted mb-4">Delta ordinati per impatto assoluto · C = Critical · Δ Risk = variazione risk score</p>
            <ClusterDeltaTable deltas={data.delta.clusterDeltas} />
          </div>
        </>
      )}
    </div>
  );
}
