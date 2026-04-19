import { useState } from 'react';
import { CheckCircle2, XCircle, GitMerge, ChevronDown, ChevronUp, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';
import type { GraphSuggestion, KGEntity, GraphDomain, EntityTypeConfig } from '../../types';
import { graphApi } from '../../services/api';

interface Props {
  domain: GraphDomain;
  projectId: string;
  suggestions: GraphSuggestion[];
  entities: KGEntity[];
  entityTypes: EntityTypeConfig[];
  onRefresh: () => void;
}

function confidenceBadge(c: number) {
  if (c >= 0.85) return 'bg-green-100 text-green-700';
  if (c >= 0.65) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

export default function SuggestedDiscoveriesSection({ domain, projectId, suggestions, entities, entityTypes, onRefresh }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const [overrideName, setOverrideName] = useState('');
  const [overrideType, setOverrideType] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [showMerge, setShowMerge] = useState<string | null>(null);

  async function approve(id: string) {
    setWorking(id);
    try {
      const overrides: { name?: string; entity_type?: string } = {};
      if (overrideName.trim()) overrides.name = overrideName.trim();
      if (overrideType.trim()) overrides.entity_type = overrideType.trim();
      await graphApi.approveSuggestion(domain, projectId, id, Object.keys(overrides).length ? overrides : undefined);
      setExpanded(null);
      setOverrideName(''); setOverrideType('');
      onRefresh();
    } finally {
      setWorking(null);
    }
  }

  async function reject(id: string, alwaysIgnore = false) {
    setWorking(id);
    try {
      await graphApi.rejectSuggestion(domain, projectId, id, alwaysIgnore);
      setExpanded(null);
      onRefresh();
    } finally {
      setWorking(null);
    }
  }

  async function merge(id: string) {
    if (!mergeTargetId) return;
    setWorking(id);
    try {
      await graphApi.mergeSuggestion(domain, projectId, id, mergeTargetId);
      setShowMerge(null);
      setMergeTargetId('');
      setExpanded(null);
      onRefresh();
    } finally {
      setWorking(null);
    }
  }

  if (suggestions.length === 0) {
    return (
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Suggested Discoveries</h3>
          <p className="text-xs text-gray-500 mt-0.5">Entities proposed by automatic extraction</p>
        </div>
        <div className="flex flex-col items-center py-10 text-gray-400 gap-2">
          <Sparkles className="w-8 h-8 opacity-40" />
          <p className="text-sm">No pending suggestions</p>
          <p className="text-xs">Run an analysis to discover entities automatically</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Suggested Discoveries</h3>
          <p className="text-xs text-gray-500 mt-0.5">{suggestions.length} pending suggestion{suggestions.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={onRefresh}
          className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        {suggestions.map(s => {
          const isExpanded = expanded === s.id;
          const isWorking = working === s.id;
          const typeCfg = entityTypes.find(t => t.type_key === s.entity_type);

          return (
            <div key={s.id} className="border border-gray-200 rounded-xl overflow-hidden">
              {/* Row header */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 select-none"
                onClick={() => setExpanded(isExpanded ? null : s.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900 truncate">{s.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 shrink-0">
                      {typeCfg?.display_label ?? s.entity_type}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${confidenceBadge(s.confidence)}`}>
                      {Math.round(s.confidence * 100)}%
                    </span>
                    {s.occurrence_count > 1 && (
                      <span className="text-xs text-gray-400">{s.occurrence_count}× found</span>
                    )}
                  </div>
                  {s.why_suggested && !isExpanded && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{s.why_suggested}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => approve(s.id)}
                    disabled={isWorking}
                    className="p-1.5 text-green-600 hover:text-green-700 disabled:opacity-40"
                    title="Approve"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => reject(s.id, false)}
                    disabled={isWorking}
                    className="p-1.5 text-red-500 hover:text-red-600 disabled:opacity-40"
                    title="Reject"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setShowMerge(showMerge === s.id ? null : s.id); setExpanded(s.id); }}
                    disabled={isWorking}
                    className="p-1.5 text-blue-500 hover:text-blue-700 disabled:opacity-40"
                    title="Merge into existing entity"
                  >
                    <GitMerge className="w-4 h-4" />
                  </button>
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t border-gray-100 bg-gray-50 space-y-3">
                  {s.description && (
                    <p className="text-xs text-gray-600">{s.description}</p>
                  )}
                  {s.source_quote && (
                    <blockquote className="text-xs italic text-gray-500 border-l-2 border-gray-300 pl-3">
                      "{s.source_quote}"
                    </blockquote>
                  )}
                  {s.why_suggested && (
                    <p className="text-xs text-gray-400">{s.why_suggested}</p>
                  )}
                  {s.source_docs.length > 0 && (
                    <p className="text-xs text-gray-400">Source: {s.source_docs.join(', ')}</p>
                  )}

                  {/* Approve with overrides */}
                  <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
                    <p className="text-xs font-medium text-gray-700">Approve with changes (optional)</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500">Rename to</label>
                        <input
                          value={overrideName}
                          onChange={e => setOverrideName(e.target.value)}
                          placeholder={s.name}
                          className="w-full text-xs border border-gray-300 rounded px-2 py-1 mt-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">Change type to</label>
                        <select
                          value={overrideType}
                          onChange={e => setOverrideType(e.target.value)}
                          className="w-full text-xs border border-gray-300 rounded px-2 py-1 mt-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        >
                          <option value="">— keep {s.entity_type} —</option>
                          {entityTypes.filter(t => t.enabled).map(t => (
                            <option key={t.type_key} value={t.type_key}>{t.display_label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={() => approve(s.id)}
                      disabled={isWorking}
                      className="w-full text-xs py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      {isWorking ? 'Approving…' : 'Approve'}
                    </button>
                  </div>

                  {/* Merge panel */}
                  {showMerge === s.id && (
                    <div className="bg-white rounded-lg border border-blue-200 p-3 space-y-2">
                      <p className="text-xs font-medium text-blue-700">Merge into existing entity</p>
                      <select
                        value={mergeTargetId}
                        onChange={e => setMergeTargetId(e.target.value)}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="">Select target entity…</option>
                        {entities.map(e => (
                          <option key={e.id} value={e.id}>{e.name} ({e.entity_type})</option>
                        ))}
                      </select>
                      <button
                        onClick={() => merge(s.id)}
                        disabled={!mergeTargetId || isWorking}
                        className="w-full text-xs py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isWorking ? 'Merging…' : 'Merge'}
                      </button>
                    </div>
                  )}

                  {/* Ignore options */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => reject(s.id, false)}
                      disabled={isWorking}
                      className="flex-1 text-xs py-1.5 border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                    >
                      Reject once
                    </button>
                    <button
                      onClick={() => reject(s.id, true)}
                      disabled={isWorking}
                      className="flex-1 text-xs py-1.5 border border-gray-200 text-gray-500 rounded hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      <AlertCircle className="w-3 h-3" />
                      Always ignore
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
