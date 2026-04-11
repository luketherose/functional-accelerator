import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Play, Loader2, RefreshCw, Trash2,
  Clock, CheckCircle2, AlertCircle, FileText, History,
  Pencil, X, Check, Database, ShieldAlert, Upload, BarChart2, Settings2, GitCompare, Sparkles
} from 'lucide-react';
import type { ProjectDetail, Analysis, FileBucket, UATAnalysis } from '../types';
import { projectsApi, analysisApi, filesApi, uatApi, parseAnalysisResult, parseUATResult } from '../services/api';
import FileUploader from '../components/FileUploader';
import FileList from '../components/FileList';
import AnalysisTabs from '../components/AnalysisTabs';
import AnalysisProgress from '../components/AnalysisProgress';
import UATDashboard from '../components/UATDashboard';
import UATTrend from '../components/UATTrend';
import ClusterDrillDown from '../components/ClusterDrillDown';
import TaxonomyEditor from '../components/TaxonomyEditor';
import AuditTrail from '../components/AuditTrail';
import RunComparison from '../components/RunComparison';
import AIDefectChat from '../components/AIDefectChat';
import PageHeader from '../components/Layout/PageHeader';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

type ActiveView = 'analysis' | 'uat';
type AnalysisPanel = 'documents' | 'history';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState<ActiveView>('analysis');
  const [analysisPanel, setAnalysisPanel] = useState<AnalysisPanel>('documents');
  const [selectedAnalysis, setSelectedAnalysis] = useState<Analysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [, setPollingId] = useState<ReturnType<typeof setInterval> | null>(null);

  // Edit project state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // RAG index status
  const [indexStatus, setIndexStatus] = useState<{ total: number; indexed: number; pending: number } | null>(null);
  const [reindexing, setReindexing] = useState(false);

  // UAT state
  const [uatAnalyses, setUatAnalyses] = useState<UATAnalysis[]>([]);
  const [selectedUAT, setSelectedUAT] = useState<UATAnalysis | null>(null);
  const [uatUploading, setUatUploading] = useState(false);
  const [isUATRunning, setIsUATRunning] = useState(false);
  const [uatTab, setUatTab] = useState<'overview' | 'trend' | 'compare' | 'defects' | 'audit' | 'ai'>('overview');
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await projectsApi.get(id);
      setProject(data);
      const latestDone = data.analyses.find((a: Analysis) => a.status === 'done');
      if (latestDone && !selectedAnalysis) {
        setSelectedAnalysis(latestDone);
      }
    } catch {
      setError('Project not found or backend unavailable.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!id) return;
    filesApi.indexStatus(id).then(setIndexStatus).catch(() => {});
  }, [id]);

  const handleReindex = async () => {
    if (!id) return;
    setReindexing(true);
    try {
      await filesApi.reindex(id);
      const poll = setInterval(async () => {
        const status = await filesApi.indexStatus(id).catch(() => null);
        if (status) {
          setIndexStatus(status);
          if (status.pending === 0) { clearInterval(poll); setReindexing(false); }
        }
      }, 3000);
    } catch {
      setReindexing(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    uatApi.list(id).then(list => {
      setUatAnalyses(list);
      const latestDone = list.find((a: UATAnalysis) => a.status === 'done');
      if (latestDone) setSelectedUAT(latestDone);
    }).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!isUATRunning || !id) return;
    const interval = setInterval(async () => {
      try {
        const list = await uatApi.list(id);
        setUatAnalyses(list);
        const running = list.find((a: UATAnalysis) => a.status === 'running');
        if (!running) {
          setIsUATRunning(false);
          clearInterval(interval);
          const done = list.find((a: UATAnalysis) => a.status === 'done');
          if (done) setSelectedUAT(done);
        }
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [isUATRunning, id]);

  const handleUATUpload = async (files: File[]) => {
    if (!id || files.length === 0) return;
    setUatUploading(true);
    try {
      const result = await uatApi.run(id, files);
      setIsUATRunning(true);
      setPendingFiles([]);
      const list = await uatApi.list(id);
      setUatAnalyses(list);
      if (result.warnings?.length) {
        console.warn('[UAT] Upload warnings:', result.warnings);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to start UAT analysis';
      alert(msg);
    } finally {
      setUatUploading(false);
    }
  };

  const handleDeleteUAT = async (analysisId: string) => {
    if (!id || !confirm(t('projectDetail.deleteUATConfirm'))) return;
    await uatApi.delete(id, analysisId);
    if (selectedUAT?.id === analysisId) setSelectedUAT(null);
    setUatAnalyses(await uatApi.list(id));
  };

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
            if (done) setSelectedAnalysis(done);
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
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { error?: string } }; message?: string };
      alert(axErr?.response?.data?.error ?? axErr?.message ?? 'Failed to start analysis');
      setIsAnalyzing(false);
    }
  };

  const handleDeleteAnalysis = async (analysisId: string) => {
    if (!id || !confirm(t('projectDetail.deleteAnalysisConfirm'))) return;
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
        <Loader2 size={20} className="animate-spin mr-2" /> {t('common.loading')}
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-8">
        <div className="card p-8 text-center max-w-sm mx-auto">
          <p className="text-sm text-red-500 mb-3">{error || t('projectDetail.notFound')}</p>
          <button className="btn-secondary" onClick={() => navigate('/')}>{t('nav.backToProjects')}</button>
        </div>
      </div>
    );
  }

  const fileCount = project.files.length;
  const analysisResult = selectedAnalysis ? parseAnalysisResult(selectedAnalysis) : null;
  const hasRunningAnalysis = project.analyses.some((a: Analysis) => a.status === 'running') || isAnalyzing;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {editing ? (
        <div className="border-b border-surface-border bg-white px-8 py-5 shrink-0">
          <div className="flex items-start gap-4">
            <div className="flex-1 space-y-2">
              <input className="input text-base font-semibold" value={editName} onChange={e => setEditName(e.target.value)} placeholder={t('projectDetail.nameLabel')} autoFocus />
              <input className="input text-sm" value={editDescription} onChange={e => setEditDescription(e.target.value)} placeholder={t('projectDetail.descriptionLabel')} />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button className="btn-secondary text-sm py-1.5" onClick={() => setEditing(false)}><X size={14} /> {t('common.cancel')}</button>
              <button className="btn-primary text-sm py-1.5" onClick={handleSaveEdit} disabled={saving || !editName.trim()}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <PageHeader
          title={project.name}
          subtitle={project.description || t('common.noDescription')}
          breadcrumbs={[{ label: t('projects.title'), href: '/' }, { label: project.name }]}
          actions={
            <button className="btn-secondary text-sm" onClick={startEditing} title={t('common.edit')}>
              <Pencil size={14} /> {t('common.edit')}
            </button>
          }
        />
      )}

      {/* Top-level view switcher */}
      <div className="flex shrink-0 border-b border-surface-border bg-white px-6 gap-1 pt-2">
        <button
          onClick={() => setActiveView('analysis')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px ${
            activeView === 'analysis'
              ? 'border-purple-deep text-purple-deep'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <FileText size={14} />
          {t('projectDetail.tabAnalysis')}
        </button>
        <button
          onClick={() => setActiveView('uat')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px ${
            activeView === 'uat'
              ? 'border-purple-deep text-purple-deep'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <BarChart2 size={14} />
          Risk Analysis
          {uatAnalyses.length > 0 && (
            <span className="bg-brand-100 text-purple-deep px-1.5 rounded-full text-[10px] font-semibold">{uatAnalyses.length}</span>
          )}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── ANALISI VIEW ── */}
        {activeView === 'analysis' && (
          <>
            {/* Left panel */}
            <div className="w-80 xl:w-96 shrink-0 border-r border-surface-border overflow-y-auto bg-white flex flex-col">
              {/* Sub-tabs + run button */}
              <div className="p-4 border-b border-surface-border space-y-3 shrink-0">
                <div className="flex gap-1 bg-surface border border-surface-border rounded-lg p-0.5">
                  <button
                    onClick={() => setAnalysisPanel('documents')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${analysisPanel === 'documents' ? 'bg-white shadow-sm text-text-primary' : 'text-text-muted'}`}
                  >
                    <FileText size={12} /> {t('projectDetail.panelDocuments')}
                    {fileCount > 0 && <span className="bg-brand-100 text-purple-deep px-1.5 rounded-full text-[10px] font-semibold">{fileCount}</span>}
                  </button>
                  <button
                    onClick={() => setAnalysisPanel('history')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${analysisPanel === 'history' ? 'bg-white shadow-sm text-text-primary' : 'text-text-muted'}`}
                  >
                    <History size={12} /> {t('projectDetail.panelHistory')}
                    {project.analyses.length > 0 && <span className="bg-brand-100 text-purple-deep px-1.5 rounded-full text-[10px] font-semibold">{project.analyses.length}</span>}
                  </button>
                </div>
                <button
                  className="btn-primary w-full text-sm"
                  onClick={handleAnalyze}
                  disabled={hasRunningAnalysis || fileCount === 0}
                  title={fileCount === 0 ? t('projectDetail.uploadFirst') : ''}
                >
                  {hasRunningAnalysis
                    ? <><Loader2 size={14} className="animate-spin" /> {t('projectDetail.analyzing')}</>
                    : <><Play size={14} /> {t('projectDetail.analyzeButton')}</>}
                </button>
              </div>

              {/* Documents panel */}
              {analysisPanel === 'documents' && (
                <div className="p-5 space-y-6 flex-1 overflow-y-auto">
                  {(['as-is', 'to-be', 'business-rules'] as FileBucket[]).map(bucket => (
                    <div key={bucket}>
                      <div className="mb-2">
                        <span className={`badge ${bucket === 'as-is' ? 'badge-asis' : bucket === 'to-be' ? 'badge-tobe' : 'badge-br'} mb-2`}>
                          {bucket === 'as-is' ? 'As-Is' : bucket === 'to-be' ? 'To-Be' : 'Business Rules'}
                        </span>
                      </div>
                      <FileUploader
                        projectId={project.id}
                        bucket={bucket}
                        onUploadComplete={() => { load(); filesApi.indexStatus(project.id).then(setIndexStatus).catch(() => {}); }}
                      />
                    </div>
                  ))}
                  <div className="pt-2">
                    <FileList files={project.files} projectId={project.id} onDeleted={load} />
                  </div>

                  {/* RAG index status */}
                  {indexStatus && indexStatus.total > 0 && (
                    <div className={`rounded-xl border p-3 flex items-center gap-3 text-xs ${indexStatus.pending === 0 ? 'border-emerald-100 bg-emerald-50/60' : 'border-amber-100 bg-amber-50/60'}`}>
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${indexStatus.pending === 0 ? 'bg-emerald-500' : 'bg-amber-500'}`}>
                        {reindexing
                          ? <Loader2 size={13} className="animate-spin text-white" />
                          : indexStatus.pending === 0
                          ? <CheckCircle2 size={13} className="text-white" />
                          : <Database size={13} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        {indexStatus.pending === 0 ? (
                          <p className="text-emerald-700 font-medium">{t('projectDetail.indexed', { indexed: indexStatus.indexed, total: indexStatus.total })}</p>
                        ) : (
                          <>
                            <p className="text-amber-700 font-medium">{reindexing ? t('projectDetail.indexing') : t('projectDetail.pendingIndex', { pending: indexStatus.pending })}</p>
                            <p className="text-amber-600 mt-0.5">{t('projectDetail.pendingIndexSub', { indexed: indexStatus.indexed, total: indexStatus.total })}</p>
                          </>
                        )}
                      </div>
                      {indexStatus.pending > 0 && !reindexing && (
                        <button onClick={handleReindex} className="btn-secondary text-xs py-1 px-2 shrink-0">
                          <RefreshCw size={11} /> {t('projectDetail.indexButton')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Analysis history panel */}
              {analysisPanel === 'history' && (
                <div className="p-5 space-y-3 flex-1 overflow-y-auto">
                  {project.analyses.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-xs text-text-muted mb-3">{t('projectDetail.noAnalysisYet')}</p>
                      <button onClick={handleAnalyze} className="btn-primary text-xs" disabled={fileCount === 0}>
                        <Play size={12} /> {t('projectDetail.firstAnalysis')}
                      </button>
                    </div>
                  ) : (
                    project.analyses.map((analysis: Analysis) => {
                      const isSelected = selectedAnalysis?.id === analysis.id;
                      return (
                        <div
                          key={analysis.id}
                          onClick={() => setSelectedAnalysis(analysis)}
                          className={`p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? 'border-purple-deep bg-brand-50' : 'border-surface-border bg-white hover:border-brand-200'}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-text-primary">{analysis.version_name}</span>
                            <div className="flex items-center gap-1">
                              {analysis.status === 'done' && <CheckCircle2 size={13} className="text-emerald-500" />}
                              {analysis.status === 'running' && <Loader2 size={13} className="animate-spin text-amber-500" />}
                              {analysis.status === 'error' && <AlertCircle size={13} className="text-red-500" />}
                              <button onClick={e => { e.stopPropagation(); handleDeleteAnalysis(analysis.id); }} className="text-text-muted hover:text-red-500 transition-colors ml-1">
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-text-muted">
                            <Clock size={9} /> {formatDate(analysis.created_at)}
                          </div>
                          {analysis.status === 'running' && analysis.progress_step && (
                            <p className="text-[10px] text-amber-600 mt-1 truncate">{analysis.progress_step}</p>
                          )}
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

            {/* Right panel — analysis result */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {hasRunningAnalysis && !analysisResult && (() => {
                const running = project.analyses.find((a: Analysis) => a.status === 'running');
                return <AnalysisProgress progressStep={running?.progress_step ?? null} />;
              })()}

              {!hasRunningAnalysis && !selectedAnalysis && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
                  <div className="w-16 h-16 rounded-2xl bg-surface border-2 border-dashed border-surface-border flex items-center justify-center">
                    <Play size={22} className="text-text-muted" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-text-primary">{t('projectDetail.readyTitle')}</p>
                    <p className="text-xs text-text-muted mt-1 max-w-xs">{t('projectDetail.readyHint')}</p>
                  </div>
                </div>
              )}

              {selectedAnalysis?.status === 'error' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <AlertCircle size={28} className="text-red-400" />
                  <p className="text-sm font-medium text-text-primary">{t('projectDetail.analysisFailed')}</p>
                  <p className="text-xs text-text-muted max-w-sm text-center">{selectedAnalysis.error_message}</p>
                  <button className="btn-secondary text-xs mt-2" onClick={handleAnalyze}><RefreshCw size={12} /> {t('common.retry')}</button>
                </div>
              )}

              {analysisResult && (
                <AnalysisTabs result={analysisResult} projectId={id!} analysisId={selectedAnalysis!.id} />
              )}
            </div>
          </>
        )}

        {/* ── RISK ANALYSIS VIEW ── */}
        {activeView === 'uat' && (
          <>
            {/* Left panel */}
            <div className="w-80 xl:w-96 shrink-0 border-r border-surface-border overflow-y-auto bg-white">
              <div className="p-5 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-text-primary mb-2">{t('projectDetail.uploadALMTitle')}</p>
                  <label className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed transition-colors cursor-pointer ${uatUploading || isUATRunning ? 'border-brand-200 bg-brand-50 cursor-default' : pendingFiles.length > 0 ? 'border-brand-300 bg-brand-50' : 'border-surface-border hover:border-brand-200 hover:bg-surface'}`}>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      multiple
                      className="hidden"
                      disabled={uatUploading || isUATRunning}
                      onChange={e => {
                        const files = Array.from(e.target.files ?? []);
                        if (files.length > 0) setPendingFiles(files);
                        e.target.value = '';
                      }}
                    />
                    {uatUploading || isUATRunning
                      ? <Loader2 size={18} className="animate-spin text-purple-deep" />
                      : <Upload size={18} className={pendingFiles.length > 0 ? 'text-purple-deep' : 'text-text-muted'} />}
                    <span className="text-xs text-text-muted text-center">
                      {uatUploading
                        ? t('projectDetail.uploadingLabel')
                        : isUATRunning
                        ? t('projectDetail.analysisRunning')
                        : pendingFiles.length > 0
                        ? t('projectDetail.filesSelected', { count: pendingFiles.length })
                        : t('projectDetail.uploadDropzone')}
                    </span>
                  </label>

                  {/* Selected file chips */}
                  {pendingFiles.length > 0 && !uatUploading && !isUATRunning && (
                    <div className="mt-2 space-y-1">
                      {pendingFiles.map((f, i) => (
                        <div key={i} className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface border border-surface-border text-[11px]">
                          <span className="truncate text-text-secondary flex-1">{f.name}</span>
                          <button
                            onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                            className="shrink-0 text-text-muted hover:text-red-500 transition-colors"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => handleUATUpload(pendingFiles)}
                        className="btn-primary w-full text-xs mt-1"
                      >
                        <Play size={12} /> {t('projectDetail.startAnalysis', { count: pendingFiles.length })}
                      </button>
                    </div>
                  )}
                </div>

                {uatAnalyses.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-text-primary">{t('projectDetail.historyTitle')}</p>
                    {uatAnalyses.map((ua: UATAnalysis) => {
                      const isSelected = selectedUAT?.id === ua.id;
                      return (
                        <div
                          key={ua.id}
                          onClick={() => setSelectedUAT(ua)}
                          className={`p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? 'border-purple-deep bg-brand-50' : 'border-surface-border bg-white hover:border-brand-200'}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-text-primary">{ua.version_name}</span>
                            <div className="flex items-center gap-1">
                              {ua.status === 'done' && <CheckCircle2 size={13} className="text-emerald-500" />}
                              {ua.status === 'running' && <Loader2 size={13} className="animate-spin text-amber-500" />}
                              {ua.status === 'error' && <AlertCircle size={13} className="text-red-500" />}
                              <button onClick={e => { e.stopPropagation(); handleDeleteUAT(ua.id); }} className="text-text-muted hover:text-red-500 transition-colors ml-1">
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-text-muted">
                            <Clock size={9} /> {formatDate(ua.created_at)}
                          </div>
                          {ua.defect_count != null && (
                            <p className="text-[10px] text-text-muted mt-0.5">{ua.defect_count} defect · {ua.file_name}</p>
                          )}
                          {ua.status === 'running' && ua.progress_step && (
                            <p className="text-[10px] text-amber-600 mt-1 truncate">{ua.progress_step}</p>
                          )}
                          {ua.status === 'error' && ua.error_message && (
                            <p className="text-[10px] text-red-500 mt-1 truncate">{ua.error_message}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right panel — UAT dashboard */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* UAT tab bar */}
              <div className="flex shrink-0 border-b border-surface-border bg-white px-4 gap-1 pt-1.5">
                <button
                  onClick={() => setUatTab('overview')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all -mb-px ${uatTab === 'overview' ? 'border-purple-deep text-purple-deep' : 'border-transparent text-text-muted hover:text-text-primary'}`}
                >
                  <BarChart2 size={12} /> {t('projectDetail.tabOverview')}
                </button>
                <button
                  onClick={() => setUatTab('trend')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all -mb-px ${uatTab === 'trend' ? 'border-purple-deep text-purple-deep' : 'border-transparent text-text-muted hover:text-text-primary'}`}
                >
                  <History size={12} /> {t('projectDetail.tabTrend')}
                  {uatAnalyses.filter(a => a.status === 'done').length > 1 && (
                    <span className="bg-brand-100 text-purple-deep px-1.5 rounded-full text-[10px] font-semibold">{uatAnalyses.filter(a => a.status === 'done').length}</span>
                  )}
                </button>
                <button
                  onClick={() => setUatTab('defects')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all -mb-px ${uatTab === 'defects' ? 'border-purple-deep text-purple-deep' : 'border-transparent text-text-muted hover:text-text-primary'}`}
                >
                  <Database size={12} /> {t('projectDetail.tabDefects')}
                  {selectedUAT?.defect_count != null && (
                    <span className="bg-brand-100 text-purple-deep px-1.5 rounded-full text-[10px] font-semibold">{selectedUAT.defect_count}</span>
                  )}
                </button>
                <button
                  onClick={() => setUatTab('audit')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all -mb-px ${uatTab === 'audit' ? 'border-purple-deep text-purple-deep' : 'border-transparent text-text-muted hover:text-text-primary'}`}
                >
                  <ShieldAlert size={12} /> {t('projectDetail.tabAudit')}
                </button>
                <button
                  onClick={() => setUatTab('compare')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all -mb-px ${uatTab === 'compare' ? 'border-purple-deep text-purple-deep' : 'border-transparent text-text-muted hover:text-text-primary'}`}
                >
                  <GitCompare size={12} /> {t('projectDetail.tabCompare')}
                  {uatAnalyses.filter(a => a.status === 'done').length >= 2 && (
                    <span className="bg-brand-100 text-purple-deep px-1.5 rounded-full text-[10px] font-semibold">
                      {uatAnalyses.filter(a => a.status === 'done').length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setUatTab('ai')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all -mb-px ${uatTab === 'ai' ? 'border-purple-deep text-purple-deep' : 'border-transparent text-text-muted hover:text-text-primary'}`}
                >
                  <Sparkles size={12} /> {t('projectDetail.tabAI')}
                </button>
                <button
                  onClick={() => setTaxonomyOpen(true)}
                  className="ml-auto flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-text-muted hover:text-purple-deep hover:bg-surface-muted rounded-lg transition-colors my-auto"
                  title={t('projectDetail.taxonomyTitle')}
                >
                  <Settings2 size={12} /> {t('projectDetail.taxonomyButton')}
                </button>
              </div>

              {/* Taxonomy editor modal */}
              {taxonomyOpen && id && (
                <TaxonomyEditor projectId={id} onClose={() => setTaxonomyOpen(false)} />
              )}

              {/* Trend tab */}
              {uatTab === 'trend' && id && (
                <UATTrend analyses={uatAnalyses} projectId={id} />
              )}

              {/* Overview tab */}
              {uatTab === 'overview' && isUATRunning && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-brand-50 border border-brand-200 flex items-center justify-center">
                    <Loader2 size={26} className="animate-spin text-purple-deep" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-text-primary">{t('projectDetail.uatRunning')}</p>
                    {(() => {
                      const running = uatAnalyses.find((a: UATAnalysis) => a.status === 'running');
                      return running?.progress_step
                        ? <p className="text-xs text-amber-600 mt-1">{running.progress_step}</p>
                        : <p className="text-xs text-text-muted mt-1">{t('projectDetail.uatStarting')}</p>;
                    })()}
                  </div>
                </div>
              )}

              {uatTab === 'overview' && !isUATRunning && !selectedUAT && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
                  <div className="w-16 h-16 rounded-2xl bg-surface border-2 border-dashed border-surface-border flex items-center justify-center">
                    <ShieldAlert size={22} className="text-text-muted" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-text-primary">{t('projectDetail.uatEmpty')}</p>
                    <p className="text-xs text-text-muted mt-1 max-w-xs">{t('projectDetail.uatEmptyHint')}</p>
                  </div>
                </div>
              )}

              {uatTab === 'overview' && !isUATRunning && selectedUAT?.status === 'error' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <AlertCircle size={28} className="text-red-400" />
                  <p className="text-sm font-medium text-text-primary">{t('projectDetail.analysisFailed')}</p>
                  <p className="text-xs text-text-muted max-w-sm text-center">{selectedUAT.error_message}</p>
                </div>
              )}

              {uatTab === 'overview' && !isUATRunning && selectedUAT && (() => {
                const result = parseUATResult(selectedUAT);
                return result ? (
                  <UATDashboard
                    result={result}
                    analysis={selectedUAT}
                    projectName={project.name}
                    fileName={selectedUAT.file_name}
                  />
                ) : null;
              })()}

              {/* Defects / Cluster drill-down tab */}
              {uatTab === 'defects' && selectedUAT && id && (
                <ClusterDrillDown analysis={selectedUAT} projectId={id} />
              )}
              {uatTab === 'defects' && !selectedUAT && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
                  <div className="w-16 h-16 rounded-2xl bg-surface border-2 border-dashed border-surface-border flex items-center justify-center">
                    <Database size={22} className="text-text-muted" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-text-primary">{t('projectDetail.defectsEmpty')}</p>
                    <p className="text-xs text-text-muted mt-1 max-w-xs">{t('projectDetail.defectsEmptyHint')}</p>
                  </div>
                </div>
              )}

              {/* Audit Trail tab */}
              {uatTab === 'audit' && id && (
                <AuditTrail projectId={id} />
              )}

              {/* Compare tab */}
              {uatTab === 'compare' && id && (
                <RunComparison analyses={uatAnalyses} projectId={id} />
              )}

              {/* AI Copilot tab */}
              {uatTab === 'ai' && selectedUAT?.status === 'done' && id && (
                <AIDefectChat analysis={selectedUAT} projectId={id} />
              )}
              {uatTab === 'ai' && selectedUAT?.status !== 'done' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
                  <div className="w-16 h-16 rounded-2xl bg-surface border-2 border-dashed border-surface-border flex items-center justify-center">
                    <Sparkles size={22} className="text-text-muted" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-text-primary">{t('projectDetail.aiEmpty')}</p>
                    <p className="text-xs text-text-muted mt-1 max-w-xs">{t('projectDetail.aiEmptyHint')}</p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
