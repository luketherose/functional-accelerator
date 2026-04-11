/**
 * ClusterDrillDown
 *
 * Three-level UI:
 *   Level 1 — Cluster grid: one card per taxonomy cluster
 *   Level 2 — Defect table: all defects in the selected cluster
 *   Level 3 — Defect drawer: full detail for a selected defect
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight, ChevronLeft, X, AlertTriangle, Info,
  Layers, FileSearch, Tag, User, Calendar, CheckCircle2,
} from 'lucide-react';
import { uatApi } from '../services/api';
import type { ClusterSummary, DefectRow, UATAnalysis } from '../types';
import { parseUATResult } from '../services/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  high: 'text-red-700 bg-red-50 border-red-200',
  medium: 'text-amber-700 bg-amber-50 border-amber-200',
  low: 'text-green-700 bg-green-50 border-green-200',
};

const PRIORITY_DOT: Record<string, string> = {
  Critical: 'bg-red-500',
  High: 'bg-orange-400',
  Medium: 'bg-amber-400',
  Low: 'bg-green-400',
  Unknown: 'bg-slate-300',
};

const PRIORITY_LABEL: Record<string, string> = {
  Critical: 'text-red-700 bg-red-50 border border-red-200',
  High: 'text-orange-700 bg-orange-50 border border-orange-200',
  Medium: 'text-amber-700 bg-amber-50 border border-amber-200',
  Low: 'text-green-700 bg-green-50 border border-green-200',
  Unknown: 'text-slate-500 bg-slate-50 border border-slate-200',
};

function riskScore(c: ClusterSummary) {
  return c.criticalCount * 4 + c.highCount * 2 + c.mediumCount;
}

function riskLevel(score: number): 'high' | 'medium' | 'low' {
  return score > 20 ? 'high' : score > 8 ? 'medium' : 'low';
}

// ─── Cluster grid card ────────────────────────────────────────────────────────

function ClusterCard({ cluster, onClick }: { cluster: ClusterSummary; onClick: () => void }) {
  const score = riskScore(cluster);
  const level = cluster.riskLevel || riskLevel(score);
  const total = cluster.defectCount;

  const critPct = total > 0 ? (cluster.criticalCount / total) * 100 : 0;
  const highPct = total > 0 ? (cluster.highCount / total) * 100 : 0;
  const medPct  = total > 0 ? (cluster.mediumCount / total) * 100 : 0;
  const lowPct  = total > 0 ? (cluster.lowCount / total) * 100 : 0;

  return (
    <button
      onClick={onClick}
      className="card p-4 text-left hover:shadow-md hover:border-purple-200 transition-all group flex flex-col gap-3"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-text-primary text-sm leading-tight">{cluster.clusterName}</p>
          <p className="text-xs text-text-muted mt-0.5">{total} defect{total !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${RISK_COLORS[level]}`}>
            {level.toUpperCase()}
          </span>
          <ChevronRight size={14} className="text-text-muted group-hover:text-purple-deep transition-colors" />
        </div>
      </div>

      {/* Priority stacked bar */}
      <div className="flex h-1.5 rounded-full overflow-hidden gap-px bg-surface-border">
        {critPct > 0 && <div className="bg-red-500 rounded-full" style={{ width: `${critPct}%` }} />}
        {highPct > 0 && <div className="bg-orange-400 rounded-full" style={{ width: `${highPct}%` }} />}
        {medPct  > 0 && <div className="bg-amber-400 rounded-full" style={{ width: `${medPct}%` }} />}
        {lowPct  > 0 && <div className="bg-green-400 rounded-full" style={{ width: `${lowPct}%` }} />}
      </div>

      {/* Priority counts */}
      <div className="flex gap-3 text-[11px] text-text-muted">
        {cluster.criticalCount > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{cluster.criticalCount} Crit</span>}
        {cluster.highCount     > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />{cluster.highCount} High</span>}
        {cluster.mediumCount   > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />{cluster.mediumCount} Med</span>}
        {cluster.lowCount      > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />{cluster.lowCount} Low</span>}
      </div>

      {/* Claude summary preview */}
      {cluster.claudeSummary && (
        <p className="text-xs text-text-secondary line-clamp-2 border-t border-surface-border pt-2">
          {cluster.claudeSummary}
        </p>
      )}

      {/* Top apps */}
      {cluster.topApplications?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {cluster.topApplications.map(app => (
            <span key={app} className="text-[10px] px-1.5 py-0.5 bg-surface-muted text-text-muted rounded">
              {app}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

// ─── Defect table row ─────────────────────────────────────────────────────────

function DefectTableRow({ defect, onClick }: { defect: DefectRow; onClick: () => void }) {
  return (
    <tr
      onClick={onClick}
      className="border-b border-surface-border hover:bg-surface-muted/50 cursor-pointer group"
    >
      <td className="py-2.5 px-3 text-xs text-text-muted font-mono">{defect.external_id}</td>
      <td className="py-2.5 px-3">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-1.5 py-0.5 rounded ${PRIORITY_LABEL[defect.priority]}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[defect.priority]}`} />
          {defect.priority}
        </span>
      </td>
      <td className="py-2.5 px-3 text-sm text-text-primary max-w-[360px]">
        <span className="line-clamp-1 group-hover:text-purple-deep transition-colors">{defect.title}</span>
      </td>
      <td className="py-2.5 px-3 text-xs text-text-secondary">{defect.application}</td>
      <td className="py-2.5 px-3 text-xs text-text-muted">{defect.module || '—'}</td>
      <td className="py-2.5 px-3 text-xs text-text-muted">{defect.status || '—'}</td>
      <td className="py-2.5 px-3 text-xs text-text-muted">
        {defect.classification_method === 'rule' ? (
          <span title={`Keywords: ${defect.matched_keywords}`} className="flex items-center gap-1 text-green-600">
            <CheckCircle2 size={11} /> Rule
          </span>
        ) : (
          <span className="text-slate-400">Other</span>
        )}
      </td>
      <td className="py-2.5 px-3">
        <ChevronRight size={13} className="text-text-muted group-hover:text-purple-deep transition-colors" />
      </td>
    </tr>
  );
}

// ─── Defect detail drawer ─────────────────────────────────────────────────────

function DefectDrawer({ defect, onClose }: { defect: DefectRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-[520px] max-w-full h-full bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-surface-border bg-surface-muted/30 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_LABEL[defect.priority]}`}>
                {defect.priority}
              </span>
              <span className="text-xs text-text-muted font-mono">{defect.external_id}</span>
            </div>
            <p className="text-sm font-semibold text-text-primary leading-snug">{defect.title}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface-border rounded shrink-0">
            <X size={16} className="text-text-muted" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3">
            <MetaField icon={<Tag size={12} />} label="Application" value={defect.application} />
            <MetaField icon={<Layers size={12} />} label="Module" value={defect.module || '—'} />
            <MetaField icon={<Info size={12} />} label="Status" value={defect.status || '—'} />
            <MetaField icon={<AlertTriangle size={12} />} label="Environment" value={defect.environment || '—'} />
            <MetaField icon={<User size={12} />} label="Detected by" value={defect.detected_by || '—'} />
            <MetaField icon={<User size={12} />} label="Assigned to" value={defect.assigned_to || '—'} />
            <MetaField icon={<Calendar size={12} />} label="Detected on" value={defect.detected_date || '—'} />
            <MetaField icon={<Calendar size={12} />} label="Closed on" value={defect.closed_date || '—'} />
          </div>

          {/* Classification */}
          {defect.matched_keywords && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3">
              <p className="text-xs font-semibold text-green-800 mb-1 flex items-center gap-1">
                <CheckCircle2 size={11} /> Why this cluster?
              </p>
              <p className="text-xs text-green-700">
                Matched keywords: <span className="font-mono">{defect.matched_keywords}</span>
              </p>
            </div>
          )}

          {/* Description */}
          {defect.description && (
            <div>
              <p className="text-xs font-semibold text-text-primary mb-1.5 flex items-center gap-1.5">
                <FileSearch size={12} className="text-text-muted" /> Description
              </p>
              <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed bg-surface-muted/50 rounded-lg p-3 border border-surface-border">
                {defect.description}
              </p>
            </div>
          )}

          {/* Resolution */}
          {defect.resolution && (
            <div>
              <p className="text-xs font-semibold text-text-primary mb-1.5 flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-text-muted" /> Resolution / Comments
              </p>
              <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed bg-surface-muted/50 rounded-lg p-3 border border-surface-border">
                {defect.resolution}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-text-muted flex items-center gap-1 mb-0.5">
        {icon} {label}
      </p>
      <p className="text-xs text-text-primary font-medium">{value}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ClusterDrillDownProps {
  analysis: UATAnalysis;
  projectId: string;
}

export default function ClusterDrillDown({ analysis, projectId }: ClusterDrillDownProps) {
  const [selectedCluster, setSelectedCluster] = useState<ClusterSummary | null>(null);
  const [defects, setDefects] = useState<DefectRow[]>([]);
  const [loadingDefects, setLoadingDefects] = useState(false);
  const [selectedDefect, setSelectedDefect] = useState<DefectRow | null>(null);
  const [filterPriority, setFilterPriority] = useState<string | null>(null);

  // Derive cluster summaries from result_json
  const result = parseUATResult(analysis);
  const clusters: ClusterSummary[] = result?.clusterSummaries ?? [];

  // Load defects when a cluster is selected
  const loadClusterDefects = useCallback(async (clusterKey: string) => {
    setLoadingDefects(true);
    setDefects([]);
    try {
      const rows = await uatApi.listClusterDefects(projectId, analysis.id, clusterKey);
      setDefects(rows);
    } catch {
      setDefects([]);
    } finally {
      setLoadingDefects(false);
    }
  }, [projectId, analysis.id]);

  useEffect(() => {
    if (selectedCluster) {
      loadClusterDefects(selectedCluster.clusterKey);
      setFilterPriority(null);
    }
  }, [selectedCluster, loadClusterDefects]);

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (clusters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6">
        <div className="w-12 h-12 rounded-xl bg-surface-muted flex items-center justify-center mb-3">
          <Layers size={22} className="text-text-muted" />
        </div>
        <p className="font-medium text-text-primary text-sm">No cluster data available</p>
        <p className="text-xs text-text-muted mt-1 max-w-xs">
          Cluster analysis is generated when you run a new UAT analysis. Run one to see defect clusters.
        </p>
      </div>
    );
  }

  // ── Level 2: defect table ────────────────────────────────────────────────────
  if (selectedCluster) {
    const filteredDefects = filterPriority
      ? defects.filter(d => d.priority === filterPriority)
      : defects;

    const priorityCounts = defects.reduce<Record<string, number>>((acc, d) => {
      acc[d.priority] = (acc[d.priority] || 0) + 1;
      return acc;
    }, {});

    return (
      <>
        <div className="flex flex-col h-full">
          {/* Breadcrumb + back */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-border bg-surface-muted/30 shrink-0">
            <button
              onClick={() => setSelectedCluster(null)}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-purple-deep transition-colors"
            >
              <ChevronLeft size={14} /> All clusters
            </button>
            <span className="text-text-muted text-xs">/</span>
            <span className="text-xs font-medium text-text-primary">{selectedCluster.clusterName}</span>
            <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded border ${RISK_COLORS[selectedCluster.riskLevel]}`}>
              {selectedCluster.riskLevel.toUpperCase()}
            </span>
          </div>

          {/* Cluster insight banner */}
          {(selectedCluster.claudeSummary || selectedCluster.businessImpact || selectedCluster.recommendation) && (
            <div className="px-4 py-3 border-b border-surface-border bg-purple-50/40 shrink-0 space-y-1">
              {selectedCluster.claudeSummary && (
                <p className="text-xs text-text-secondary">{selectedCluster.claudeSummary}</p>
              )}
              {selectedCluster.businessImpact && (
                <p className="text-xs text-amber-700 flex items-start gap-1.5">
                  <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                  {selectedCluster.businessImpact}
                </p>
              )}
              {selectedCluster.recommendation && (
                <p className="text-xs text-green-700 flex items-start gap-1.5">
                  <CheckCircle2 size={11} className="shrink-0 mt-0.5" />
                  {selectedCluster.recommendation}
                </p>
              )}
            </div>
          )}

          {/* Priority filter chips */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-surface-border shrink-0 flex-wrap">
            <span className="text-[10px] text-text-muted shrink-0">Filter:</span>
            {[null, 'Critical', 'High', 'Medium', 'Low'].map(p => {
              const count = p ? (priorityCounts[p] ?? 0) : defects.length;
              if (count === 0) return null;
              return (
                <button
                  key={p ?? 'all'}
                  onClick={() => setFilterPriority(p)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    filterPriority === p
                      ? 'bg-purple-deep border-purple-deep text-white'
                      : 'border-surface-border text-text-muted hover:border-purple-deep/50'
                  }`}
                >
                  {p ?? 'All'} {count > 0 && `(${count})`}
                </button>
              );
            })}
          </div>

          {/* Defect table */}
          <div className="flex-1 overflow-y-auto">
            {loadingDefects ? (
              <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                Loading defects…
              </div>
            ) : filteredDefects.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                No defects match the current filter.
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-surface-muted/80 backdrop-blur-sm">
                  <tr className="border-b border-surface-border">
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">ID</th>
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">Priority</th>
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">Title</th>
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">App</th>
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">Module</th>
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">Status</th>
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">Why</th>
                    <th className="py-2 px-3 w-6" />
                  </tr>
                </thead>
                <tbody>
                  {filteredDefects.map(d => (
                    <DefectTableRow key={d.id} defect={d} onClick={() => setSelectedDefect(d)} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Detail drawer */}
        {selectedDefect && (
          <DefectDrawer defect={selectedDefect} onClose={() => setSelectedDefect(null)} />
        )}
      </>
    );
  }

  // ── Level 1: cluster grid ────────────────────────────────────────────────────
  return (
    <div className="overflow-y-auto h-full">
      <div className="p-4">
        {/* Summary bar */}
        <div className="flex items-center gap-4 mb-4 p-3 rounded-lg bg-surface-muted/50 border border-surface-border text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <Layers size={12} className="text-purple-deep" />
            <strong className="text-text-primary">{clusters.length}</strong> clusters
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {clusters.reduce((s, c) => s + c.criticalCount, 0)} Critical
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-orange-400" />
            {clusters.reduce((s, c) => s + c.highCount, 0)} High
          </span>
          <span className="ml-auto text-text-muted">Click a cluster to drill down</span>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {clusters.map(cluster => (
            <ClusterCard
              key={cluster.clusterKey}
              cluster={cluster}
              onClick={() => setSelectedCluster(cluster)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
