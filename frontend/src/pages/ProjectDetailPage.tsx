import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Play, Loader2, RefreshCw, Trash2,
  Clock, CheckCircle2, AlertCircle, FileText, History,
  Pencil, X, Check, ShieldAlert
} from 'lucide-react';
import type { ProjectDetail, Analysis, FileBucket } from '../types';
import { projectsApi, analysisApi, parseAnalysisResult } from '../services/api';
import FileUploader from '../components/FileUploader';
import FileList from '../components/FileList';
import AnalysisTabs from '../components/AnalysisTabs';
import PageHeader from '../components/Layout/PageHeader';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

type ActiveSection = 'documents' | 'analysis';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState<ActiveSection>('documents');
  const [selectedAnalysis, setSelectedAnalysis] = useState<Analysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [, setPollingId] = useState<ReturnType<typeof setInterval> | null>(null);

  // Edit project state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await projectsApi.get(id);
      setProject(data);
      const latestDone = data.analyses.find((a: Analysis) => a.status === 'done');
      if (latestDone && !selectedAnalysis) {
        setSelectedAnalysis(latestDone);
        setActiveSection('analysis');
      }
    } catch {
      setError('Project not found or backend unavailable.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Poll while analyzing
  useEffect(() => {
    if (isAnalyzing && id) {
      const interval = setInterval(async () => {
        try {
          const data = await projectsApi.get(id);
          setProject(data);
          const running = data.analyses.find((a: Analysis) => a.status === 'running');
          if (!running) {
            setIsAnalyzing(false);
            clearInterval(interval);
            const done = data.analyses.find((a: Analysis) => a.status === 'done');
            if (done) {
              setSelectedAnalysis(done);
              setActiveSection('analysis');
            }
          }
        } catch { /* keep polling */ }
      }, 2000);
      setPollingId(interval);
      return () => clearInterval(interval);
    }
  }, [isAnalyzing, id]);

  const handleAnalyze = async () => {
    if (!id) return;
    setIsAnalyzing(true);
    try {
      await analysisApi.run(id);
      setActiveSection('analysis');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start analysis';
      alert(msg);
      setIsAnalyzing(false);
    }
  };

  const handleDeleteAnalysis = async (analysisId: string) => {
    if (!id || !confirm('Delete this analysis?')) return;
    await analysisApi.delete(id, analysisId);
    if (selectedAnalysis?.id === analysisId) setSelectedAnalysis(null);
    load();
  };

  const startEditing = () => {
    if (!project) return;
    setEditName(project.name);
    setEditDescription(project.description || '');
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!id || !editName.trim()) return;
    setSaving(true);
    try {
      await projectsApi.update(id, { name: editName.trim(), description: editDescription.trim() });
      await load();
      setEditing(false);
    } catch {
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading project...
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-8">
        <div className="card p-8 text-center max-w-sm mx-auto">
          <p className="text-sm text-red-500 mb-3">{error || 'Project not found'}</p>
          <button className="btn-secondary" onClick={() => navigate('/')}>Back to Projects</button>
        </div>
      </div>
    );
  }

  const fileCount = project.files.length;
  const analysisResult = selectedAnalysis ? parseAnalysisResult(selectedAnalysis) : null;
  const hasRunningAnalysis = project.analyses.some((a: Analysis) => a.status === 'running') || isAnalyzing;

  return (
    <div className="flex flex-col h-full">
      {/* Header — normal or edit mode */}
      {editing ? (
        <div className="border-b border-surface-border bg-white px-8 py-5">
          <div className="flex items-center gap-1.5 text-xs text-text-muted mb-2">
            <a href="/" className="hover:text-text-primary transition-colors">Projects</a>
            <span>/</span>
            <span className="text-text-secondary">{project.name}</span>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex-1 space-y-2">
              <input
                className="input text-base font-semibold"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="Project name"
                autoFocus
              />
              <input
                className="input text-sm"
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                placeholder="Description (optional)"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button className="btn-secondary text-sm py-1.5" onClick={() => setEditing(false)}>
                <X size={14} /> Cancel
              </button>
              <button className="btn-primary text-sm py-1.5" onClick={handleSaveEdit} disabled={saving || !editName.trim()}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <PageHeader
          title={project.name}
          subtitle={project.description || 'No description'}
          breadcrumbs={[{ label: 'Projects', href: '/' }, { label: project.name }]}
          actions={
            <div className="flex items-center gap-2">
              <button
                className="btn-secondary text-sm"
                onClick={startEditing}
                title="Edit project details"
              >
                <Pencil size={14} /> Edit
              </button>
              <Link
                to={`/projects/${id}/risk-assessment`}
                className="btn-secondary text-sm"
                title="Risk Assessment"
              >
                <ShieldAlert size={14} /> Risk Assessment
              </Link>
              <button
                className="btn-primary"
                onClick={handleAnalyze}
                disabled={hasRunningAnalysis || fileCount === 0}
                title={fileCount === 0 ? 'Upload documents first' : ''}
              >
                {hasRunningAnalysis ? (
                  <><Loader2 size={14} className="animate-spin" /> Analyzing…</>
                ) : (
                  <><Play size={14} /> Analyze Impacts</>
                )}
              </button>
            </div>
          }
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — Documents */}
        <div className="w-80 xl:w-96 shrink-0 border-r border-surface-border overflow-y-auto bg-white">
          <div className="p-5 border-b border-surface-border">
            <div className="flex gap-1 bg-surface border border-surface-border rounded-lg p-0.5">
              <button
                onClick={() => setActiveSection('documents')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${activeSection === 'documents' ? 'bg-white shadow-sm text-text-primary' : 'text-text-muted'}`}
              >
                <FileText size={12} /> Documents
                {fileCount > 0 && <span className="bg-brand-100 text-purple-deep px-1.5 rounded-full text-[10px] font-semibold">{fileCount}</span>}
              </button>
              <button
                onClick={() => setActiveSection('analysis')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${activeSection === 'analysis' ? 'bg-white shadow-sm text-text-primary' : 'text-text-muted'}`}
              >
                <History size={12} /> Analyses
                {project.analyses.length > 0 && <span className="bg-brand-100 text-purple-deep px-1.5 rounded-full text-[10px] font-semibold">{project.analyses.length}</span>}
              </button>
            </div>
          </div>

          {activeSection === 'documents' && (
            <div className="p-5 space-y-6">
              {(['as-is', 'to-be', 'business-rules'] as FileBucket[]).map(bucket => (
                <div key={bucket}>
                  <div className="mb-2">
                    <span className={`badge ${bucket === 'as-is' ? 'badge-asis' : bucket === 'to-be' ? 'badge-tobe' : 'badge-br'} mb-2`}>
                      {bucket === 'as-is' ? 'As-Is' : bucket === 'to-be' ? 'To-Be' : 'Business Rules'}
                    </span>
                  </div>
                  <FileUploader projectId={project.id} bucket={bucket} onUploadComplete={load} />
                </div>
              ))}
              <div className="pt-2">
                <FileList files={project.files} projectId={project.id} onDeleted={load} />
              </div>
            </div>
          )}

          {activeSection === 'analysis' && (
            <div className="p-5 space-y-3">
              {project.analyses.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-text-muted mb-3">No analyses yet.</p>
                  <button
                    onClick={handleAnalyze}
                    className="btn-primary text-xs"
                    disabled={fileCount === 0}
                  >
                    <Play size={12} /> Run first analysis
                  </button>
                </div>
              ) : (
                project.analyses.map((analysis: Analysis) => {
                  const isSelected = selectedAnalysis?.id === analysis.id;
                  return (
                    <div
                      key={analysis.id}
                      onClick={() => { setSelectedAnalysis(analysis); }}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'border-purple-deep bg-brand-50'
                          : 'border-surface-border bg-white hover:border-brand-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-text-primary">{analysis.version_name}</span>
                        <div className="flex items-center gap-1">
                          {analysis.status === 'done' && <CheckCircle2 size={13} className="text-emerald-500" />}
                          {analysis.status === 'running' && <Loader2 size={13} className="animate-spin text-amber-500" />}
                          {analysis.status === 'error' && <AlertCircle size={13} className="text-red-500" />}
                          <button
                            onClick={e => { e.stopPropagation(); handleDeleteAnalysis(analysis.id); }}
                            className="text-text-muted hover:text-red-500 transition-colors ml-1"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-text-muted">
                        <Clock size={9} />
                        {formatDate(analysis.created_at)}
                      </div>
                      {analysis.status === 'error' && analysis.error_message && (
                        <p className="text-[10px] text-red-500 mt-1 truncate">{analysis.error_message}</p>
                      )}
                      {analysis.input_summary && (
                        <p className="text-[10px] text-text-muted mt-1 truncate">{analysis.input_summary}</p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Right panel — Analysis result */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {hasRunningAnalysis && !analysisResult && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted animate-fade-in">
              <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center">
                <Loader2 size={26} className="animate-spin text-purple-deep" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-text-primary">Analyzing your documentation…</p>
                <p className="text-xs text-text-muted mt-1">Claude is processing your files. This may take up to 2 minutes.</p>
              </div>
            </div>
          )}

          {!hasRunningAnalysis && !selectedAnalysis && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
              <div className="w-16 h-16 rounded-2xl bg-surface border-2 border-dashed border-surface-border flex items-center justify-center">
                <Play size={22} className="text-text-muted" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-text-primary">Ready to analyze</p>
                <p className="text-xs text-text-muted mt-1 max-w-xs">
                  Upload your as-is and to-be documents, then click <strong>Analyze Impacts</strong> to get started.
                </p>
              </div>
            </div>
          )}

          {selectedAnalysis?.status === 'error' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <AlertCircle size={28} className="text-red-400" />
              <p className="text-sm font-medium text-text-primary">Analysis failed</p>
              <p className="text-xs text-text-muted max-w-sm text-center">{selectedAnalysis.error_message}</p>
              <button className="btn-secondary text-xs mt-2" onClick={handleAnalyze}>
                <RefreshCw size={12} /> Retry Analysis
              </button>
            </div>
          )}

          {analysisResult && (
            <AnalysisTabs result={analysisResult} projectId={id!} analysisId={selectedAnalysis!.id} />
          )}
        </div>
      </div>
    </div>
  );
}
