/**
 * ClusterDrillDown
 *
 * Three-level UI:
 *   Level 1 — Cluster grid: one card per taxonomy cluster
 *   Level 2 — Defect table: all defects in the selected cluster
 *   Level 3 — Defect drawer: full detail + risk override for a selected defect
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight, ChevronLeft, X, AlertTriangle, Info,
  Layers, FileSearch, Tag, User, Calendar, CheckCircle2,
  ShieldAlert, Pencil, Trash2, Save, Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { uatApi } from '../services/api';
import type { ClusterSummary, DefectRow, UATAnalysis } from '../types';
import { parseUATResult } from '../services/api';
import ClusterSuggestions from './ClusterSuggestions';

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

const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;

function effectivePriority(d: DefectRow): string {
  return d.overridden_priority ?? d.priority;
}

function riskScore(c: ClusterSummary) {
  return c.criticalCount * 4 + c.highCount * 2 + c.mediumCount;
}

function riskLevel(score: number): 'high' | 'medium' | 'low' {
  return score > 20 ? 'high' : score > 8 ? 'medium' : 'low';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
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

      <div className="flex h-1.5 rounded-full overflow-hidden gap-px bg-surface-border">
        {critPct > 0 && <div className="bg-red-500 rounded-full" style={{ width: `${critPct}%` }} />}
        {highPct > 0 && <div className="bg-orange-400 rounded-full" style={{ width: `${highPct}%` }} />}
        {medPct  > 0 && <div className="bg-amber-400 rounded-full" style={{ width: `${medPct}%` }} />}
        {lowPct  > 0 && <div className="bg-green-400 rounded-full" style={{ width: `${lowPct}%` }} />}
      </div>

      <div className="flex gap-3 text-[11px] text-text-muted">
        {cluster.criticalCount > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{cluster.criticalCount} Crit</span>}
        {cluster.highCount     > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />{cluster.highCount} High</span>}
        {cluster.mediumCount   > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />{cluster.mediumCount} Med</span>}
        {cluster.lowCount      > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />{cluster.lowCount} Low</span>}
      </div>

      {cluster.claudeSummary && (
        <p className="text-xs text-text-secondary line-clamp-2 border-t border-surface-border pt-2">
          {cluster.claudeSummary}
        </p>
      )}

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
  const { t } = useTranslation();
  const eff = effectivePriority(defect);
  const isOverridden = !!defect.override_id;

  return (
    <tr
      onClick={onClick}
      className="border-b border-surface-border hover:bg-surface-muted/50 cursor-pointer group"
    >
      <td className="py-2.5 px-3 text-xs text-text-muted font-mono">{defect.external_id}</td>
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-1.5 py-0.5 rounded ${PRIORITY_LABEL[eff]}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[eff]}`} />
            {eff}
          </span>
          {isOverridden && (
            <span
              title={t('clusters.overriddenFrom', { priority: defect.priority, reason: defect.override_reason })}
              className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 leading-none"
            >
              {t('clusters.editedBadge')}
            </span>
          )}
        </div>
      </td>
      <td className="py-2.5 px-3 text-sm text-text-primary max-w-[360px]">
        <span className="line-clamp-1 group-hover:text-purple-deep transition-colors">{defect.title}</span>
      </td>
      <td className="py-2.5 px-3 text-xs text-text-secondary">{defect.application}</td>
      <td className="py-2.5 px-3 text-xs text-text-muted">{defect.module || '—'}</td>
      <td className="py-2.5 px-3 text-xs text-text-muted">{defect.status || '—'}</td>
      <td className="py-2.5 px-3 text-xs text-text-muted">
        {defect.classification_method === 'rule' ? (
          <span title={t('clusters.matchedKeywords', { keywords: defect.matched_keywords })} className="flex items-center gap-1 text-green-600">
            <CheckCircle2 size={11} /> {t('clusters.methodRule')}
          </span>
        ) : (
          <span className="text-slate-400">{t('clusters.methodOther')}</span>
        )}
      </td>
      <td className="py-2.5 px-3">
        <ChevronRight size={13} className="text-text-muted group-hover:text-purple-deep transition-colors" />
      </td>
    </tr>
  );
}

// ─── Override section inside the drawer ──────────────────────────────────────

interface OverrideSectionProps {
  defect: DefectRow;
  projectId: string;
  onChanged: (updated: Partial<DefectRow>) => void;
}

function OverrideSection({ defect, projectId, onChanged }: OverrideSectionProps) {
  const { t } = useTranslation();
  const isOverridden = !!defect.override_id;
  const [editing, setEditing] = useState(false);
  const [newPriority, setNewPriority] = useState<string>(defect.overridden_priority ?? defect.priority);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!reason.trim() && !isOverridden) {
      setError('Please provide a reason for the override.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await uatApi.setOverride(projectId, defect.id, newPriority, reason.trim() || defect.override_reason || '');
      onChanged({
        override_id: (saved as { id: string }).id,
        overridden_priority: newPriority as DefectRow['overridden_priority'],
        override_reason: (saved as { reason: string }).reason,
        override_date: (saved as { updated_at: string }).updated_at,
      });
      setEditing(false);
      setReason('');
    } catch {
      setError('Failed to save override. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError('');
    try {
      await uatApi.deleteOverride(projectId, defect.id);
      onChanged({ override_id: null, overridden_priority: null, override_reason: null, override_date: null });
      setEditing(false);
    } catch {
      setError('Failed to remove override. Try again.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
          <ShieldAlert size={12} /> {t('clusters.overrideTitle')}
        </p>
        {!editing && (
          <button
            onClick={() => { setEditing(true); setNewPriority(defect.overridden_priority ?? defect.priority); setReason(''); }}
            className="flex items-center gap-1 text-[10px] text-amber-700 hover:text-amber-900 font-medium"
          >
            <Pencil size={10} /> {isOverridden ? t('clusters.overrideEdit') : t('clusters.overrideButton')}
          </button>
        )}
      </div>

      {/* Current override status */}
      {isOverridden && !editing && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border line-through opacity-60 ${PRIORITY_LABEL[defect.priority]}`}>
              {defect.priority}
            </span>
            <span className="text-amber-600">→</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${PRIORITY_LABEL[defect.overridden_priority!]}`}>
              {defect.overridden_priority}
            </span>
          </div>
          <p className="text-[11px] text-amber-700 italic">"{defect.override_reason}"</p>
          <p className="text-[10px] text-text-muted">
            {t('clusters.lastUpdated', { date: defect.override_date ? formatDate(defect.override_date) : '—' })}
          </p>
          <button
            onClick={handleRemove}
            disabled={removing}
            className="flex items-center gap-1 text-[10px] text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
          >
            {removing ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
            {t('clusters.removeOverride')}
          </button>
        </div>
      )}

      {!isOverridden && !editing && (
        <p className="text-[11px] text-amber-700">
          {t('clusters.overrideDescription', { priority: defect.priority })}
        </p>
      )}

      {/* Edit form */}
      {editing && (
        <div className="space-y-2 pt-1">
          <div>
            <label className="text-[10px] font-medium text-text-muted block mb-1">{t('clusters.overrideNewPriority')}</label>
            <div className="flex gap-1.5 flex-wrap">
              {PRIORITIES.map(p => (
                <button
                  key={p}
                  onClick={() => setNewPriority(p)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors ${
                    newPriority === p
                      ? PRIORITY_LABEL[p] + ' ring-1 ring-offset-1 ring-amber-400'
                      : 'border-surface-border text-text-muted hover:border-amber-300'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-medium text-text-muted block mb-1">
              {t('clusters.overrideReason')}
            </label>
            <textarea
              className="input text-xs resize-none w-full"
              rows={2}
              placeholder={t('clusters.overrideReasonPlaceholder')}
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>

          {error && <p className="text-[11px] text-red-500">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || (!reason.trim() && !isOverridden)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-purple-deep text-white font-medium disabled:opacity-40 hover:bg-purple-900 transition-colors"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              {saving ? t('common.saving') : t('clusters.overrideSave')}
            </button>
            <button
              onClick={() => { setEditing(false); setError(''); }}
              className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-muted transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Defect detail drawer ─────────────────────────────────────────────────────

interface DefectDrawerProps {
  defect: DefectRow;
  projectId: string;
  onClose: () => void;
  onOverrideChange: (defectId: string, patch: Partial<DefectRow>) => void;
}

function DefectDrawer({ defect, projectId, onClose, onOverrideChange }: DefectDrawerProps) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      <div className="relative z-10 w-[520px] max-w-full h-full bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-surface-border bg-surface-muted/30 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_LABEL[effectivePriority(defect)]}`}>
                {effectivePriority(defect)}
              </span>
              {defect.override_id && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                  {t('clusters.overridden')}
                </span>
              )}
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
            <MetaField icon={<Tag size={12} />} label={t('clusters.metaApplication')} value={defect.application} />
            <MetaField icon={<Layers size={12} />} label={t('clusters.metaModule')} value={defect.module || '—'} />
            <MetaField icon={<Info size={12} />} label={t('clusters.metaStatus')} value={defect.status || '—'} />
            <MetaField icon={<AlertTriangle size={12} />} label={t('clusters.metaEnvironment')} value={defect.environment || '—'} />
            <MetaField icon={<User size={12} />} label={t('clusters.metaDetectedBy')} value={defect.detected_by || '—'} />
            <MetaField icon={<User size={12} />} label={t('clusters.metaAssignedTo')} value={defect.assigned_to || '—'} />
            <MetaField icon={<Calendar size={12} />} label={t('clusters.metaDetectedOn')} value={defect.detected_date || '—'} />
            <MetaField icon={<Calendar size={12} />} label={t('clusters.metaClosedOn')} value={defect.closed_date || '—'} />
          </div>

          {/* Risk override */}
          <OverrideSection
            defect={defect}
            projectId={projectId}
            onChanged={patch => onOverrideChange(defect.id, patch)}
          />

          {/* Classification */}
          {defect.matched_keywords && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3">
              <p className="text-xs font-semibold text-green-800 mb-1 flex items-center gap-1">
                <CheckCircle2 size={11} /> {t('clusters.whyCluster')}
              </p>
              <p className="text-xs text-green-700">
                {t('clusters.matchedKeywords', { keywords: defect.matched_keywords })}
              </p>
            </div>
          )}

          {/* Description */}
          {defect.description && (
            <div>
              <p className="text-xs font-semibold text-text-primary mb-1.5 flex items-center gap-1.5">
                <FileSearch size={12} className="text-text-muted" /> {t('clusters.description')}
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
                <CheckCircle2 size={12} className="text-text-muted" /> {t('clusters.resolution')}
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
      <p className="text-[10px] text-text-muted flex items-center gap-1 mb-0.5">{icon} {label}</p>
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
  const { t } = useTranslation();
  const [selectedCluster, setSelectedCluster] = useState<ClusterSummary | null>(null);
  const [defects, setDefects] = useState<DefectRow[]>([]);
  const [loadingDefects, setLoadingDefects] = useState(false);
  const [selectedDefect, setSelectedDefect] = useState<DefectRow | null>(null);
  const [filterPriority, setFilterPriority] = useState<string | null>(null);

  const result = parseUATResult(analysis);
  const clusters: ClusterSummary[] = result?.clusterSummaries ?? [];

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

  // Patch a defect in local state after an override change
  const handleOverrideChange = useCallback((defectId: string, patch: Partial<DefectRow>) => {
    setDefects(prev => prev.map(d => d.id === defectId ? { ...d, ...patch } : d));
    setSelectedDefect(prev => prev?.id === defectId ? { ...prev, ...patch } : prev);
  }, []);

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (clusters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6">
        <div className="w-12 h-12 rounded-xl bg-surface-muted flex items-center justify-center mb-3">
          <Layers size={22} className="text-text-muted" />
        </div>
        <p className="font-medium text-text-primary text-sm">{t('clusters.noData')}</p>
        <p className="text-xs text-text-muted mt-1 max-w-xs">
          {t('clusters.noDataHint')}
        </p>
      </div>
    );
  }

  // ── Level 2: defect table ────────────────────────────────────────────────────
  if (selectedCluster) {
    const filteredDefects = filterPriority
      ? defects.filter(d => effectivePriority(d) === filterPriority)
      : defects;

    const priorityCounts = defects.reduce<Record<string, number>>((acc, d) => {
      const p = effectivePriority(d);
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    }, {});

    return (
      <>
        <div className="flex flex-col h-full">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-border bg-surface-muted/30 shrink-0">
            <button
              onClick={() => setSelectedCluster(null)}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-purple-deep transition-colors"
            >
              <ChevronLeft size={14} /> {t('clusters.allClusters')}
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
            <span className="text-[10px] text-text-muted shrink-0">{t('clusters.filterLabel')}</span>
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
                  {p ?? t('common.all')} {count > 0 && `(${count})`}
                </button>
              );
            })}
            {defects.some(d => d.override_id) && (
              <span className="ml-auto text-[10px] text-amber-600 flex items-center gap-1">
                <ShieldAlert size={10} /> {defects.filter(d => d.override_id).length} {t('clusters.overridden')}
              </span>
            )}
          </div>

          {/* Defect table */}
          <div className="flex-1 overflow-y-auto">
            {loadingDefects ? (
              <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                {t('clusters.loadingDefects')}
              </div>
            ) : filteredDefects.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                {t('clusters.noDefectsFilter')}
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-surface-muted/80 backdrop-blur-sm">
                  <tr className="border-b border-surface-border">
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">{t('clusters.colId')}</th>
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">{t('clusters.colPriority')}</th>
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">{t('clusters.colTitle')}</th>
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">{t('clusters.colApp')}</th>
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">{t('clusters.colModule')}</th>
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">{t('clusters.colStatus')}</th>
                    <th className="py-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wide">{t('clusters.colWhy')}</th>
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
          <DefectDrawer
            defect={selectedDefect}
            projectId={projectId}
            onClose={() => setSelectedDefect(null)}
            onOverrideChange={handleOverrideChange}
          />
        )}
      </>
    );
  }

  // ── Level 1: cluster grid ────────────────────────────────────────────────────
  const otherCluster = clusters.find(c => c.clusterKey === 'other');
  const visibleClusters = clusters.filter(c => c.clusterKey !== 'other');

  return (
    <div className="overflow-y-auto h-full">
      <div className="p-4 space-y-4">
        {/* Summary bar */}
        <div className="flex items-center gap-4 p-3 rounded-lg bg-surface-muted/50 border border-surface-border text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <Layers size={12} className="text-purple-deep" />
            <strong className="text-text-primary">{visibleClusters.length}</strong> {t('clusters.clusters')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {clusters.reduce((s, c) => s + c.criticalCount, 0)} Critical
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-orange-400" />
            {clusters.reduce((s, c) => s + c.highCount, 0)} High
          </span>
          <span className="ml-auto text-text-muted">{t('clusters.clickToDrillDown')}</span>
        </div>

        {/* Named cluster grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleClusters.map(cluster => (
            <ClusterCard
              key={cluster.clusterKey}
              cluster={cluster}
              onClick={() => setSelectedCluster(cluster)}
            />
          ))}
        </div>

        {/* "Other" cluster drill-through + suggestion banner */}
        {otherCluster && otherCluster.defectCount > 0 && (
          <div className="space-y-2.5">
            {/* Other cluster card (still clickable) */}
            <ClusterCard
              cluster={otherCluster}
              onClick={() => setSelectedCluster(otherCluster)}
            />
            {/* Phase 2D: discover hidden themes */}
            <ClusterSuggestions
              projectId={projectId}
              otherDefectCount={otherCluster.defectCount}
              onAdopted={() => {
                // Re-load cluster data after adopt — parent would need to refresh.
                // For now, show a note; user can navigate away and back.
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
