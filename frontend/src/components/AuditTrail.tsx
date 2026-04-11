/**
 * AuditTrail
 *
 * Project-level list of all risk overrides.
 * Shows who changed what, from which priority to which, when, and why.
 * Supports filtering by application and by override direction (escalated / de-escalated).
 */

import { useState, useEffect } from 'react';
import { ShieldAlert, ArrowRight, Filter, Clock, Loader2, Inbox } from 'lucide-react';
import { uatApi } from '../services/api';
import type { AuditOverride } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1, Unknown: 0 };

const PRIORITY_LABEL: Record<string, string> = {
  Critical: 'text-red-700 bg-red-50 border-red-200',
  High: 'text-orange-700 bg-orange-50 border-orange-200',
  Medium: 'text-amber-700 bg-amber-50 border-amber-200',
  Low: 'text-green-700 bg-green-50 border-green-200',
};

function direction(row: AuditOverride): 'escalated' | 'de-escalated' | 'same' {
  const from = PRIORITY_ORDER[row.original_priority] ?? 0;
  const to   = PRIORITY_ORDER[row.overridden_priority] ?? 0;
  if (to > from) return 'escalated';
  if (to < from) return 'de-escalated';
  return 'same';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Single override row ──────────────────────────────────────────────────────

function OverrideRow({ row }: { row: AuditOverride }) {
  const dir = direction(row);
  const dirLabel = dir === 'escalated'
    ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200 uppercase">↑ escalated</span>
    : dir === 'de-escalated'
      ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200 uppercase">↓ de-escalated</span>
      : null;

  return (
    <div className="flex gap-3 p-3.5 border-b border-surface-border last:border-0 hover:bg-surface-muted/30 transition-colors">
      {/* Direction indicator stripe */}
      <div className={`w-0.5 self-stretch rounded-full shrink-0 ${dir === 'escalated' ? 'bg-red-400' : dir === 'de-escalated' ? 'bg-green-400' : 'bg-slate-300'}`} />

      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Defect identity */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-text-muted shrink-0">{row.external_id}</span>
          <span className="text-xs font-semibold text-text-primary truncate">{row.title}</span>
          {row.application && (
            <span className="text-[10px] px-1.5 py-0.5 bg-surface-muted rounded text-text-muted shrink-0">{row.application}</span>
          )}
        </div>

        {/* Priority change */}
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border line-through opacity-70 ${PRIORITY_LABEL[row.original_priority] ?? ''}`}>
            {row.original_priority}
          </span>
          <ArrowRight size={11} className="text-text-muted shrink-0" />
          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${PRIORITY_LABEL[row.overridden_priority] ?? ''}`}>
            {row.overridden_priority}
          </span>
          {dirLabel}
        </div>

        {/* Reason */}
        <p className="text-[11px] text-text-secondary italic">"{row.reason}"</p>

        {/* Timestamp */}
        <p className="text-[10px] text-text-muted flex items-center gap-1">
          <Clock size={9} /> {formatDate(row.updated_at)}
        </p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface AuditTrailProps {
  projectId: string;
}

type DirectionFilter = 'all' | 'escalated' | 'de-escalated';

export default function AuditTrail({ projectId }: AuditTrailProps) {
  const [overrides, setOverrides] = useState<AuditOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirFilter, setDirFilter] = useState<DirectionFilter>('all');
  const [appFilter, setAppFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    uatApi.listOverrides(projectId)
      .then(setOverrides)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const apps = [...new Set(overrides.map(o => o.application).filter(Boolean))].sort();

  const filtered = overrides.filter(o => {
    const dir = direction(o);
    if (dirFilter !== 'all' && dir !== dirFilter) return false;
    if (appFilter !== 'all' && o.application !== appFilter) return false;
    return true;
  });

  const escalated    = overrides.filter(o => direction(o) === 'escalated').length;
  const deEscalated  = overrides.filter(o => direction(o) === 'de-escalated').length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-border bg-surface-muted/30 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <ShieldAlert size={15} className="text-amber-500" /> Risk Override Audit Trail
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              All analyst overrides to computed priorities — tracked immutably.
            </p>
          </div>
          {!loading && overrides.length > 0 && (
            <div className="flex gap-3 text-xs text-text-muted shrink-0">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />{escalated} escalated</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />{deEscalated} de-escalated</span>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      {!loading && overrides.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-border shrink-0 flex-wrap">
          <Filter size={11} className="text-text-muted shrink-0" />

          {/* Direction */}
          {(['all', 'escalated', 'de-escalated'] as DirectionFilter[]).map(d => (
            <button
              key={d}
              onClick={() => setDirFilter(d)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize ${
                dirFilter === d
                  ? 'bg-purple-deep border-purple-deep text-white'
                  : 'border-surface-border text-text-muted hover:border-purple-deep/50'
              }`}
            >
              {d === 'all' ? 'All directions' : d}
            </button>
          ))}

          {/* Application */}
          {apps.length > 1 && (
            <select
              value={appFilter}
              onChange={e => setAppFilter(e.target.value)}
              className="ml-auto text-[10px] border border-surface-border rounded-lg px-2 py-1 bg-white text-text-secondary focus:outline-none focus:ring-1 focus:ring-purple-deep/40"
            >
              <option value="all">All applications</option>
              {apps.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-text-muted text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading audit trail…
          </div>
        ) : overrides.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="w-12 h-12 rounded-xl bg-surface-muted flex items-center justify-center mb-3">
              <Inbox size={22} className="text-text-muted" />
            </div>
            <p className="font-medium text-text-primary text-sm">No overrides yet</p>
            <p className="text-xs text-text-muted mt-1 max-w-xs">
              Overrides are created in the Defects tab when an analyst adjusts a computed priority.
              They will appear here automatically.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-text-muted text-sm">
            No overrides match the current filter.
          </div>
        ) : (
          <div>
            {filtered.map(row => <OverrideRow key={row.id} row={row} />)}
          </div>
        )}
      </div>

      {/* Footer count */}
      {!loading && filtered.length > 0 && (
        <div className="px-4 py-2 border-t border-surface-border shrink-0 text-[10px] text-text-muted">
          Showing {filtered.length} of {overrides.length} override{overrides.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
