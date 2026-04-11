import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Zap, Plus, Folder, Loader2, X, Check } from 'lucide-react';
import type { Project } from '../../types';
import { projectsApi } from '../../services/api';

const STATUS_DOT: Record<string, string> = {
  draft:     'bg-slate-400',
  ready:     'bg-blue-500',
  analyzing: 'bg-amber-400',
  done:      'bg-emerald-500',
  error:     'bg-red-500',
};

function NewProjectModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Il nome è obbligatorio'); return; }
    setLoading(true);
    setError('');
    try {
      await onCreate(name.trim(), description.trim());
      onClose();
    } catch {
      setError('Creazione fallita');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card p-6 w-full max-w-md shadow-dropdown animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-text-primary">Nuovo Progetto</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Nome *</label>
            <input
              className="input"
              placeholder="es. Customer Portal Revamp"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Descrizione</label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="Breve descrizione dell'ambito dell'analisi…"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button type="button" className="btn-secondary" onClick={onClose}>Annulla</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Crea Progetto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Parse current project id from URL
  const activeProjectId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;

  useEffect(() => {
    projectsApi.list()
      .then(list => setProjects(list.sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      )))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [location.pathname]); // re-fetch when navigating (new project created etc.)

  async function handleCreate(name: string, description: string) {
    const project = await projectsApi.create(name, description);
    navigate(`/projects/${project.id}`);
  }

  return (
    <>
      <aside className="w-56 bg-purple-deep flex flex-col shrink-0 h-screen sticky top-0">
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10 shrink-0">
          <div className="w-8 h-8 bg-purple-mid rounded-lg flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <div className="text-white font-semibold text-sm leading-tight">Functional</div>
            <div className="text-purple-light text-xs leading-tight">Accelerator</div>
          </div>
        </div>

        {/* Projects header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
          <p className="text-white/40 text-[10px] font-semibold uppercase tracking-widest">Progetti</p>
          <button
            onClick={() => setShowModal(true)}
            title="Nuovo progetto"
            className="w-5 h-5 rounded flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-all"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Project list */}
        <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={14} className="animate-spin text-white/40" />
            </div>
          )}

          {!loading && projects.length === 0 && (
            <p className="text-white/30 text-xs px-2 py-3 text-center leading-relaxed">
              Nessun progetto ancora.{' '}
              <button
                onClick={() => setShowModal(true)}
                className="underline hover:text-white/60 transition-colors"
              >
                Crea il primo
              </button>
            </p>
          )}

          {projects.map(project => {
            const isActive = project.id === activeProjectId;
            const dot = STATUS_DOT[project.status] ?? STATUS_DOT.draft;
            return (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                <Folder size={12} className="shrink-0 opacity-60" />
                <span className="truncate flex-1">{project.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10 shrink-0">
          <p className="text-white/25 text-[10px]">MVP v1.0</p>
        </div>
      </aside>

      {showModal && (
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}
    </>
  );
}
