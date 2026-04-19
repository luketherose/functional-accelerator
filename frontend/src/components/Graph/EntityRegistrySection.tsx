import { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2, GitMerge, Check, X, Search, ChevronLeft, ChevronRight, Database } from 'lucide-react';
import type { KGEntity, GraphDomain, EntityTypeConfig } from '../../types';
import { graphApi } from '../../services/api';

interface Props {
  domain: GraphDomain;
  projectId: string;
  entityTypes: EntityTypeConfig[];
  onEntitySelect?: (entity: KGEntity) => void;
}

export default function EntityRegistrySection({ domain, projectId, entityTypes, onEntitySelect }: Props) {
  const [entities, setEntities] = useState<KGEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const [mergingId, setMergingId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [merging, setMerging] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await graphApi.getEntities(domain, projectId, {
        type: typeFilter || undefined,
        search: search || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setEntities(result.entities);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, [domain, projectId, typeFilter, search, page]);

  useEffect(() => { load(); }, [load]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setPage(0); load(); }, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeFilter]);

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      await graphApi.updateEntity(domain, projectId, id, {
        name: editName.trim() || undefined,
        entity_type: editType || undefined,
        description: editDesc.trim() || undefined,
      });
      setEditingId(null);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntity(id: string) {
    await graphApi.deleteEntity(domain, projectId, id);
    setDeletingId(null);
    load();
  }

  async function mergeEntities(sourceId: string) {
    if (!mergeTargetId) return;
    setMerging(true);
    try {
      await graphApi.mergeEntities(domain, projectId, sourceId, mergeTargetId);
      setMergingId(null);
      setMergeTargetId('');
      load();
    } finally {
      setMerging(false);
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Entity Registry</h3>
        <p className="text-xs text-gray-500 mt-0.5">{total} approved entities in this domain</p>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search entities…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(0); }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">All types</option>
          {entityTypes.map(t => <option key={t.type_key} value={t.type_key}>{t.display_label}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400 text-sm">Loading…</div>
      ) : entities.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-gray-400 gap-2">
          <Database className="w-8 h-8 opacity-40" />
          <p className="text-sm">No entities yet</p>
          <p className="text-xs">Approve suggestions or run an analysis to populate the graph</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 border-b border-gray-200">
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-right px-4 py-2 font-medium">Conf</th>
                <th className="text-right px-4 py-2 font-medium">Relations</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entities.map(e => {
                const typeCfg = entityTypes.find(t => t.type_key === e.entity_type);
                return (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      {editingId === e.id ? (
                        <input
                          value={editName}
                          onChange={ev => setEditName(ev.target.value)}
                          className="text-sm border border-indigo-400 rounded px-2 py-0.5 w-full focus:outline-none"
                          autoFocus
                        />
                      ) : (
                        <button
                          onClick={() => onEntitySelect?.(e)}
                          className="font-medium text-gray-900 hover:text-indigo-600 text-left"
                        >
                          {e.name}
                        </button>
                      )}
                      {editingId === e.id && (
                        <div className="mt-1.5 space-y-1">
                          <select
                            value={editType}
                            onChange={ev => setEditType(ev.target.value)}
                            className="text-xs border border-gray-300 rounded px-2 py-0.5 w-full focus:outline-none"
                          >
                            {entityTypes.map(t => <option key={t.type_key} value={t.type_key}>{t.display_label}</option>)}
                          </select>
                          <input
                            value={editDesc}
                            onChange={ev => setEditDesc(ev.target.value)}
                            placeholder="Description…"
                            className="text-xs border border-gray-300 rounded px-2 py-0.5 w-full focus:outline-none"
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {editingId !== e.id && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                          {typeCfg?.display_label ?? e.entity_type}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-xs font-mono ${e.confidence >= 0.85 ? 'text-green-600' : e.confidence >= 0.65 ? 'text-yellow-600' : 'text-red-500'}`}>
                        {Math.round(e.confidence * 100)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-gray-400">{e.relation_count}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {editingId === e.id ? (
                          <>
                            <button onClick={() => saveEdit(e.id)} disabled={saving} className="p-1 text-green-600 hover:text-green-700">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setEditingId(null)} className="p-1 text-gray-400 hover:text-gray-600">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => { setEditingId(e.id); setEditName(e.name); setEditType(e.entity_type); setEditDesc(e.description ?? ''); }}
                              className="p-1 text-gray-400 hover:text-indigo-600"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => { setMergingId(mergingId === e.id ? null : e.id); setMergeTargetId(''); }}
                              className="p-1 text-gray-400 hover:text-blue-600"
                              title="Merge duplicates"
                            >
                              <GitMerge className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeletingId(e.id)}
                              className="p-1 text-gray-400 hover:text-red-500"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>

                      {/* Merge row */}
                      {mergingId === e.id && (
                        <div className="mt-2 flex gap-1">
                          <select
                            value={mergeTargetId}
                            onChange={ev => setMergeTargetId(ev.target.value)}
                            className="flex-1 text-xs border border-blue-300 rounded px-2 py-0.5 focus:outline-none"
                          >
                            <option value="">Merge into…</option>
                            {entities.filter(ent => ent.id !== e.id).map(ent => (
                              <option key={ent.id} value={ent.id}>{ent.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => mergeEntities(e.id)}
                            disabled={!mergeTargetId || merging}
                            className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded disabled:opacity-50"
                          >
                            OK
                          </button>
                        </div>
                      )}

                      {/* Delete confirm */}
                      {deletingId === e.id && (
                        <div className="mt-2 flex gap-1 items-center">
                          <span className="text-xs text-red-600">Delete?</span>
                          <button onClick={() => deleteEntity(e.id)} className="text-xs px-2 py-0.5 bg-red-600 text-white rounded">Yes</button>
                          <button onClick={() => setDeletingId(null)} className="text-xs px-2 py-0.5 bg-gray-200 text-gray-700 rounded">No</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => p - 1)} disabled={page === 0} className="p-1 disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="p-1 disabled:opacity-40">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
