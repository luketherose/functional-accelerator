import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Folder, Trash2, Clock, ChevronRight, Search, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Project } from '../types';
import { projectsApi } from '../services/api';
import PageHeader from '../components/Layout/PageHeader';

const STATUS_DOT: Record<string, string> = {
  draft:     'bg-slate-400',
  ready:     'bg-blue-500',
  analyzing: 'bg-amber-400',
  done:      'bg-emerald-500',
  error:     'bg-red-500',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, description: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError(t('projects.nameRequired')); return; }
    setLoading(true);
    setError('');
    try {
      await onCreate(name, description);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('projects.nameRequired'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="card p-6 w-full max-w-md shadow-dropdown animate-fade-in" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-text-primary mb-5">{t('projects.newProject')}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">{t('projects.nameLabel')}</label>
            <input
              className="input"
              placeholder={t('projects.namePlaceholder')}
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label">{t('projects.descriptionLabel')}</label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder={t('projects.descriptionPlaceholder')}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? t('projects.creating') : t('projects.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await projectsApi.list();
      setProjects(data);
    } catch {
      setError('Failed to load projects. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (name: string, description: string) => {
    const project = await projectsApi.create(name, description);
    navigate(`/projects/${project.id}`);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm(t('projects.deleteConfirm'))) return;
    setDeleting(id);
    try {
      await projectsApi.delete(id);
      setProjects(prev => prev.filter(p => p.id !== id));
    } catch {
      alert(t('projects.deleteFailed'));
    } finally {
      setDeleting(null);
    }
  };

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        actions={
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={15} /> {t('projects.newProject')}
          </button>
        }
      />

      <div className="p-8">
        {/* Search */}
        <div className="relative mb-6 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className="input pl-9"
            placeholder={t('projects.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* States */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="h-4 bg-surface rounded w-2/3 mb-3" />
                <div className="h-3 bg-surface rounded w-full mb-2" />
                <div className="h-3 bg-surface rounded w-1/2" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="card p-6 text-center max-w-sm mx-auto">
            <p className="text-sm text-red-500 mb-3">{error}</p>
            <button className="btn-secondary text-xs" onClick={load}>{t('common.retry')}</button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="card p-12 text-center max-w-md mx-auto">
            <div className="w-14 h-14 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Zap size={22} className="text-purple-deep" />
            </div>
            <h3 className="text-sm font-semibold text-text-primary mb-1">
              {search ? t('projects.noMatch') : t('projects.empty')}
            </h3>
            <p className="text-sm text-text-muted mb-5">
              {search ? t('projects.noMatchHint') : t('projects.emptyHint')}
            </p>
            {!search && (
              <button className="btn-primary" onClick={() => setShowModal(true)}>
                <Plus size={14} /> {t('projects.newProject')}
              </button>
            )}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(project => {
              const dot = STATUS_DOT[project.status] ?? STATUS_DOT.draft;
              return (
                <div
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="card p-5 cursor-pointer hover:shadow-card-hover transition-all group border-transparent hover:border-brand-200"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
                      <Folder size={18} className="text-purple-deep" />
                    </div>
                    <button
                      onClick={e => handleDelete(e, project.id)}
                      disabled={deleting === project.id}
                      className="text-text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <h3 className="text-sm font-semibold text-text-primary mb-1 truncate">{project.name}</h3>
                  <p className="text-xs text-text-muted line-clamp-2 mb-4 leading-relaxed">
                    {project.description || t('common.noDescription')}
                  </p>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                      <span className="text-xs text-text-muted">{t(`common.status.${project.status}` as Parameters<typeof t>[0])}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-text-muted">
                      <Clock size={11} />
                      {formatDate(project.updated_at)}
                      <ChevronRight size={12} className="ml-1 text-text-muted group-hover:text-purple-deep transition-colors" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && <NewProjectModal onClose={() => setShowModal(false)} onCreate={handleCreate} />}
    </div>
  );
}
