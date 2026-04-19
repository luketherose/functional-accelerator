import { useState } from 'react';
import { Plus, Pencil, Check, X, Eye, EyeOff, Search } from 'lucide-react';
import type { EntityTypeConfig, GraphDomain } from '../../types';
import { graphApi } from '../../services/api';

interface Props {
  domain: GraphDomain;
  projectId: string;
  types: EntityTypeConfig[];
  onRefresh: () => void;
}

export default function EntityModelSection({ domain, projectId, types, onRefresh }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [adding, setAdding] = useState(false);

  const [search, setSearch] = useState('');

  const filtered = types.filter(t =>
    !search || t.display_label.toLowerCase().includes(search.toLowerCase()) || t.type_key.toLowerCase().includes(search.toLowerCase())
  );

  async function startEdit(t: EntityTypeConfig) {
    setEditingId(t.id);
    setEditLabel(t.display_label);
    setEditDesc(t.description ?? '');
  }

  async function saveEdit(t: EntityTypeConfig) {
    setSaving(true);
    try {
      await graphApi.updateEntityType(domain, projectId, t.type_key, {
        display_label: editLabel.trim(),
        description: editDesc.trim() || undefined,
      });
      setEditingId(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(t: EntityTypeConfig) {
    await graphApi.updateEntityType(domain, projectId, t.type_key, { enabled: !t.enabled });
    onRefresh();
  }

  async function toggleDiscoverable(t: EntityTypeConfig) {
    await graphApi.updateEntityType(domain, projectId, t.type_key, { discoverable: !t.discoverable });
    onRefresh();
  }

  async function addType() {
    if (!newKey.trim() || !newLabel.trim()) return;
    setAdding(true);
    try {
      await graphApi.addEntityType(domain, projectId, newKey.trim().toLowerCase().replace(/\s+/g, '_'), newLabel.trim(), newDesc.trim() || undefined);
      setNewKey(''); setNewLabel(''); setNewDesc('');
      setShowAddForm(false);
      onRefresh();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Entity Model</h3>
          <p className="text-xs text-gray-500 mt-0.5">Configure the entity types that can be discovered in this domain</p>
        </div>
        <button
          onClick={() => setShowAddForm(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add type
        </button>
      </div>

      {showAddForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-medium text-gray-700">New entity type</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">Key (snake_case)</label>
              <input
                value={newKey}
                onChange={e => setNewKey(e.target.value)}
                placeholder="e.g. validation_rule"
                className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Display label</label>
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="e.g. Validation Rule"
                className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500">Description (optional)</label>
            <input
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Brief description of this entity type"
              className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAddForm(false)} className="text-xs px-3 py-1.5 text-gray-600 hover:text-gray-800">Cancel</button>
            <button
              onClick={addType}
              disabled={adding || !newKey.trim() || !newLabel.trim()}
              className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter types…"
          className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>

      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
        {filtered.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-gray-400">No entity types match your filter</div>
        )}
        {filtered.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-4 py-3 ${t.enabled ? 'bg-white' : 'bg-gray-50 opacity-60'}`}
          >
            <div className="flex-1 min-w-0">
              {editingId === t.id ? (
                <div className="space-y-2">
                  <input
                    value={editLabel}
                    onChange={e => setEditLabel(e.target.value)}
                    className="text-sm font-medium border border-indigo-400 rounded px-2 py-0.5 w-full focus:outline-none"
                    autoFocus
                  />
                  <input
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    placeholder="Description…"
                    className="text-xs text-gray-500 border border-gray-300 rounded px-2 py-0.5 w-full focus:outline-none"
                  />
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{t.display_label}</span>
                    {t.is_base && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">base</span>
                    )}
                  </div>
                  {t.description && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{t.description}</p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-0.5 font-mono">{t.type_key}</p>
                </>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {editingId === t.id ? (
                <>
                  <button
                    onClick={() => saveEdit(t)}
                    disabled={saving}
                    className="p-1 text-green-600 hover:text-green-700"
                    title="Save"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="p-1 text-gray-400 hover:text-gray-600"
                    title="Cancel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => startEdit(t)}
                    className="p-1 text-gray-400 hover:text-indigo-600"
                    title="Edit label"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => toggleDiscoverable(t)}
                    className={`p-1 rounded ${t.discoverable ? 'text-blue-500 hover:text-blue-700' : 'text-gray-300 hover:text-gray-500'}`}
                    title={t.discoverable ? 'Auto-discoverable (click to disable)' : 'Not auto-discoverable (click to enable)'}
                  >
                    <Search className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => toggleEnabled(t)}
                    className={`p-1 rounded ${t.enabled ? 'text-gray-500 hover:text-gray-700' : 'text-gray-300 hover:text-gray-500'}`}
                    title={t.enabled ? 'Enabled (click to disable)' : 'Disabled (click to enable)'}
                  >
                    {t.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        <Search className="inline w-3 h-3 mr-1" />
        = auto-discoverable &nbsp;|&nbsp;
        <Eye className="inline w-3 h-3 mr-1" />
        = visible in registry
      </p>
    </div>
  );
}
