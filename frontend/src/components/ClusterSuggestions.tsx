/**
 * ClusterSuggestions — Phase 2D
 *
 * Shows a "Discover hidden clusters" banner when there are unclassified
 * defects. On trigger, calls the suggest-clusters endpoint and presents
 * Claude's thematic groupings. Each suggestion can be adopted — which
 * appends keywords to the taxonomy and re-clusters, converting the
 * discovered pattern into a permanent, deterministic rule.
 */

import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, Plus, RefreshCw, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { uatApi } from '../services/api';
import type { SuggestedCluster, SuggestClustersResult } from '../types';

// ─── Keyword chip ─────────────────────────────────────────────────────────────

function KeywordChip({
  keyword,
  onRemove,
}: {
  keyword: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-[11px] text-violet-800 font-medium">
      {keyword}
      <button onClick={onRemove} className="hover:text-red-500 transition-colors">
        <X size={9} />
      </button>
    </span>
  );
}

// ─── Single suggestion card ───────────────────────────────────────────────────

interface SuggestionCardProps {
  suggestion: SuggestedCluster;
  index: number;
  projectId: string;
  onAdopted: () => void;
}

function SuggestionCard({ suggestion, index, projectId, onAdopted }: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(index === 0);
  const [keywords, setKeywords] = useState<string[]>(suggestion.suggestedKeywords);
  const [adopting, setAdopting] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const [error, setError] = useState('');

  const removeKeyword = (kw: string) =>
    setKeywords(prev => prev.filter(k => k !== kw));

  const handleAdopt = async () => {
    if (keywords.length === 0) {
      setError('Add at least one keyword before adopting.');
      return;
    }
    setAdopting(true);
    setError('');
    try {
      // 1. Load existing taxonomy
      const current = await uatApi.getTaxonomy(projectId);

      // 2. Build the cluster key from the name (slugify)
      const newKey = suggestion.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      // 3. Check if a cluster with this key already exists; if so, merge keywords
      const exists = current.find(c => c.cluster_key === newKey);
      const updated = exists
        ? current.map(c =>
            c.cluster_key === newKey
              ? { ...c, keywords: [...new Set([...c.keywords, ...keywords])] }
              : c
          )
        : [
            ...current,
            {
              id: null,
              cluster_key: newKey,
              cluster_name: suggestion.name,
              keywords,
              sort_order: current.length,
            },
          ];

      // 4. Save updated taxonomy
      await uatApi.saveTaxonomy(projectId, updated.map(c => ({
        cluster_key: c.cluster_key,
        cluster_name: c.cluster_name,
        keywords: c.keywords,
      })));

      // 5. Trigger re-cluster
      await uatApi.recluster(projectId);

      setAdopted(true);
      setTimeout(onAdopted, 1500);
    } catch {
      setError('Failed to adopt cluster. Try again.');
    } finally {
      setAdopting(false);
    }
  };

  return (
    <div className={`rounded-xl border transition-all ${adopted ? 'border-green-300 bg-green-50/60' : 'border-surface-border bg-white'}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-3 p-3.5 text-left"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold flex items-center justify-center">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{suggestion.name}</p>
            <p className="text-[10px] text-text-muted">{suggestion.defectIds.length} defect{suggestion.defectIds.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {adopted && <CheckCircle2 size={14} className="text-green-500" />}
          {expanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
        </div>
      </button>

      {/* Body */}
      {expanded && !adopted && (
        <div className="px-3.5 pb-3.5 space-y-3 border-t border-surface-border pt-3">
          {/* Rationale */}
          <p className="text-xs text-text-secondary italic">"{suggestion.rationale}"</p>

          {/* Defect IDs preview */}
          <div>
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">
              Defects in this group
            </p>
            <div className="flex flex-wrap gap-1">
              {suggestion.defectIds.slice(0, 12).map(id => (
                <span key={id} className="text-[10px] px-1.5 py-0.5 bg-surface-muted rounded font-mono text-text-muted">
                  {id}
                </span>
              ))}
              {suggestion.defectIds.length > 12 && (
                <span className="text-[10px] text-text-muted px-1">
                  +{suggestion.defectIds.length - 12} more
                </span>
              )}
            </div>
          </div>

          {/* Editable keywords */}
          <div>
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1.5">
              Keywords to add <span className="normal-case font-normal">(edit before adopting)</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {keywords.map(kw => (
                <KeywordChip key={kw} keyword={kw} onRemove={() => removeKeyword(kw)} />
              ))}
              {keywords.length === 0 && (
                <span className="text-[11px] text-text-muted italic">No keywords — add at least one</span>
              )}
            </div>
          </div>

          {error && (
            <p className="text-[11px] text-red-500 flex items-center gap-1">
              <AlertCircle size={11} /> {error}
            </p>
          )}

          {/* Adopt button */}
          <button
            onClick={handleAdopt}
            disabled={adopting || keywords.length === 0}
            className="flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg bg-violet-700 text-white font-medium disabled:opacity-40 hover:bg-violet-800 transition-colors w-full justify-center"
          >
            {adopting
              ? <><Loader2 size={12} className="animate-spin" /> Adopting &amp; re-clustering…</>
              : <><Plus size={12} /> Add to taxonomy &amp; re-cluster</>
            }
          </button>
        </div>
      )}

      {adopted && (
        <div className="px-3.5 pb-3.5 text-xs text-green-700 flex items-center gap-1.5">
          <CheckCircle2 size={12} /> Cluster adopted — re-clustering in background.
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ClusterSuggestionsProps {
  projectId: string;
  otherDefectCount: number;
  onAdopted: () => void;
}

export default function ClusterSuggestions({ projectId, otherDefectCount, onAdopted }: ClusterSuggestionsProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SuggestClustersResult | null>(null);
  const [error, setError] = useState('');

  const handleDiscover = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await uatApi.suggestClusters(projectId);
      setResult(data);
      setOpen(true);
    } catch {
      setError('Failed to analyse unclassified defects. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 overflow-hidden">
      {/* Banner */}
      <div className="flex items-center gap-3 p-3.5">
        <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
          <Sparkles size={15} className="text-violet-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-violet-900">
            {otherDefectCount} unclassified defect{otherDefectCount !== 1 ? 's' : ''} in "Other"
          </p>
          <p className="text-[11px] text-violet-700 mt-0.5">
            Claude can discover hidden patterns and suggest new taxonomy clusters.
          </p>
        </div>
        <button
          onClick={open ? () => setOpen(false) : handleDiscover}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-700 text-white font-medium hover:bg-violet-800 transition-colors shrink-0 disabled:opacity-50"
        >
          {loading
            ? <><Loader2 size={11} className="animate-spin" /> Analysing…</>
            : open
              ? <><ChevronUp size={11} /> Hide</>
              : <><Sparkles size={11} /> Discover clusters</>
          }
        </button>
      </div>

      {error && (
        <div className="px-3.5 pb-3 text-xs text-red-500 flex items-center gap-1.5">
          <AlertCircle size={11} /> {error}
        </div>
      )}

      {/* Results */}
      {open && result && (
        <div className="border-t border-violet-200 p-3.5 space-y-3 bg-white/70">
          {result.suggestions.length === 0 ? (
            <p className="text-xs text-text-muted text-center py-4">
              No clear themes found among the unclassified defects — they may be too heterogeneous to cluster meaningfully.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between text-[10px] text-text-muted">
                <span>
                  {result.suggestions.length} theme{result.suggestions.length !== 1 ? 's' : ''} found
                  · covers {result.coveredCount} of {result.otherCount} unclassified defects
                </span>
                <button
                  onClick={handleDiscover}
                  className="flex items-center gap-1 hover:text-purple-deep transition-colors"
                  title="Re-run analysis"
                >
                  <RefreshCw size={10} /> Refresh
                </button>
              </div>

              {result.suggestions.map((s, i) => (
                <SuggestionCard
                  key={i}
                  suggestion={s}
                  index={i}
                  projectId={projectId}
                  onAdopted={onAdopted}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
