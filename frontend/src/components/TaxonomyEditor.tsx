/**
 * TaxonomyEditor
 *
 * Lets analysts customise the defect keyword taxonomy per-project.
 * - Load current taxonomy (DB config or defaults)
 * - Edit keyword lists inline (add/remove chips)
 * - Save → PUT /api/uat/:projectId/taxonomy
 * - Re-cluster → POST /api/uat/:projectId/recluster
 *   (re-classifies all existing defects using the new taxonomy)
 */

import { useState, useEffect, useRef } from 'react';
import { X, Plus, Save, RefreshCw, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { uatApi } from '../services/api';
import type { ClusterConfig } from '../types';

interface Props {
  projectId: string;
  onClose: () => void;
}

// ─── Keyword chip ─────────────────────────────────────────────────────────────

function KeywordChip({ keyword, onRemove }: { keyword: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 border border-brand-200 text-[11px] text-purple-deep font-medium">
      {keyword}
      <button
        onClick={onRemove}
        className="hover:text-red-500 transition-colors ml-0.5"
        title="Remove keyword"
      >
        <X size={9} />
      </button>
    </span>
  );
}

// ─── Single cluster row ───────────────────────────────────────────────────────

interface ClusterRowProps {
  cluster: ClusterConfig;
  onChange: (updated: ClusterConfig) => void;
}

function ClusterRow({ cluster, onChange }: ClusterRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [newKw, setNewKw] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addKeyword = (raw: string) => {
    const kw = raw.trim().toLowerCase();
    if (!kw || cluster.keywords.includes(kw)) return;
    onChange({ ...cluster, keywords: [...cluster.keywords, kw] });
    setNewKw('');
  };

  const removeKeyword = (kw: string) => {
    onChange({ ...cluster, keywords: cluster.keywords.filter(k => k !== kw) });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addKeyword(newKw);
    }
  };

  return (
    <div className="border border-surface-border rounded-xl overflow-hidden">
      {/* Cluster header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-3 p-3.5 bg-surface-muted/30 hover:bg-surface-muted/60 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-text-primary text-sm truncate">{cluster.cluster_name}</span>
          <span className="text-[10px] text-text-muted shrink-0">
            {cluster.keywords.length} keyword{cluster.keywords.length !== 1 ? 's' : ''}
          </span>
        </div>
        {expanded ? <ChevronUp size={14} className="text-text-muted shrink-0" /> : <ChevronDown size={14} className="text-text-muted shrink-0" />}
      </button>

      {/* Editable keyword area */}
      {expanded && (
        <div className="p-3.5 space-y-3 border-t border-surface-border bg-white">
          {/* Keyword chips */}
          <div className="flex flex-wrap gap-1.5">
            {cluster.keywords.map(kw => (
              <KeywordChip key={kw} keyword={kw} onRemove={() => removeKeyword(kw)} />
            ))}
            {cluster.keywords.length === 0 && (
              <span className="text-[11px] text-text-muted italic">No keywords — add some below</span>
            )}
          </div>

          {/* Add keyword input */}
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={newKw}
              onChange={e => setNewKw(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add keyword (Enter or comma to confirm)"
              className="flex-1 text-xs border border-surface-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-deep/40 bg-surface-muted/30"
            />
            <button
              onClick={() => addKeyword(newKw)}
              disabled={!newKw.trim()}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-purple-deep text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-purple-900 transition-colors"
            >
              <Plus size={11} /> Add
            </button>
          </div>

          {/* Cluster name edit */}
          <div>
            <label className="text-[10px] text-text-muted font-medium block mb-1">Cluster name</label>
            <input
              type="text"
              value={cluster.cluster_name}
              onChange={e => onChange({ ...cluster, cluster_name: e.target.value })}
              className="text-xs border border-surface-border rounded-lg px-3 py-1.5 w-full focus:outline-none focus:ring-1 focus:ring-purple-deep/40"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TaxonomyEditor({ projectId, onClose }: Props) {
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reclustering, setReclustering] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [reclusterMsg, setReclusterMsg] = useState('');

  useEffect(() => {
    uatApi.getTaxonomy(projectId)
      .then(data => { setClusters(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);

  const updateCluster = (index: number, updated: ClusterConfig) => {
    setClusters(prev => prev.map((c, i) => i === index ? updated : c));
    setDirty(true);
    setSavedMsg('');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await uatApi.saveTaxonomy(projectId, clusters.map(c => ({
        cluster_key: c.cluster_key,
        cluster_name: c.cluster_name,
        keywords: c.keywords,
      })));
      setDirty(false);
      setSavedMsg('Saved successfully.');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch {
      setSavedMsg('Save failed — please retry.');
    } finally {
      setSaving(false);
    }
  };

  const handleRecluster = async () => {
    setReclustering(true);
    setReclusterMsg('');
    try {
      const res = await uatApi.recluster(projectId);
      setReclusterMsg(`Re-clustering started for ${res.runs} run${res.runs !== 1 ? 's' : ''}. Refresh the Defects tab to see updated clusters.`);
    } catch {
      setReclusterMsg('Re-cluster failed — please retry.');
    } finally {
      setReclustering(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border shrink-0">
          <div>
            <h2 className="text-sm font-bold text-text-primary">Taxonomy Editor</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Edit the keyword clusters used to classify defects. Changes apply on re-cluster.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-muted rounded-lg">
            <X size={16} className="text-text-muted" />
          </button>
        </div>

        {/* Info banner */}
        <div className="px-5 py-2.5 bg-blue-50 border-b border-blue-100 flex items-start gap-2 shrink-0">
          <Info size={12} className="text-blue-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-blue-700">
            Defects are classified by matching keywords against their title, description, and module.
            The cluster with the most keyword matches wins. After saving, click <strong>Re-cluster</strong> to re-classify all existing defects.
          </p>
        </div>

        {/* Scrollable cluster list */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-text-muted text-sm">
              Loading taxonomy…
            </div>
          ) : (
            clusters.map((cluster, i) => (
              <ClusterRow
                key={cluster.cluster_key}
                cluster={cluster}
                onChange={updated => updateCluster(i, updated)}
              />
            ))
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3.5 border-t border-surface-border bg-surface-muted/30 shrink-0 flex items-center gap-3">
          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-purple-deep text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-purple-900 transition-colors"
          >
            {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
            {saving ? 'Saving…' : 'Save Taxonomy'}
          </button>

          {/* Re-cluster */}
          <button
            onClick={handleRecluster}
            disabled={reclustering || dirty}
            className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg border border-surface-border text-text-secondary font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-muted transition-colors"
            title={dirty ? 'Save taxonomy first before re-clustering' : 'Re-classify all defects with current taxonomy'}
          >
            {reclustering ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {reclustering ? 'Re-clustering…' : 'Re-cluster Defects'}
          </button>

          {/* Status messages */}
          {savedMsg && (
            <span className={`text-xs ml-auto ${savedMsg.includes('failed') ? 'text-red-600' : 'text-green-600'}`}>
              {savedMsg}
            </span>
          )}
          {reclusterMsg && !savedMsg && (
            <span className={`text-xs ml-auto max-w-xs text-right leading-snug ${reclusterMsg.includes('failed') ? 'text-red-600' : 'text-blue-600'}`}>
              {reclusterMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
