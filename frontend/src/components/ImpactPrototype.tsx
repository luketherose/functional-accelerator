import { useState, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { Upload, Loader2, Eye, Download, AlertCircle, Image, X } from 'lucide-react';
import type { Impact } from '../types';
import { analysisApi } from '../services/api';

interface ImpactPrototypeProps {
  impact: Impact;
  projectId: string;
  analysisId: string;
}

export default function ImpactPrototype({ impact, projectId, analysisId }: ImpactPrototypeProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Load existing prototype on mount
  useEffect(() => {
    let cancelled = false;
    analysisApi.getImpactPrototype(projectId, analysisId, impact.id)
      .then(data => { if (!cancelled) setHtml(data.html); })
      .catch(() => { /* 404 = no prototype yet, that's fine */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, analysisId, impact.id]);

  const handleGenerate = async () => {
    if (!file) return;
    setGenerating(true);
    setError('');
    try {
      const data = await analysisApi.generateImpactPrototype(
        projectId, analysisId, impact.id, impact.area, impact.description, file
      );
      setHtml(data.html);
      setFile(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.type.startsWith('image/')) setFile(dropped);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (picked) setFile(picked);
    e.target.value = '';
  };

  const handleDownload = () => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prototype-${impact.id}-${impact.area.replace(/\s+/g, '-').toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sanitized = html ? DOMPurify.sanitize(html, {
    FORCE_BODY: false,
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style', 'meta', 'link'],
    ADD_ATTR: ['charset', 'name', 'content', 'http-equiv', 'rel', 'href', 'type'],
  }) : '';

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-text-muted text-xs">
        <Loader2 size={12} className="animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4 border-t border-surface-border pt-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Generate UI Prototype</p>

      {/* Upload zone */}
      {!generating && (
        <div className="space-y-2">
          {!file ? (
            <label
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                isDragging ? 'border-purple-deep bg-brand-50' : 'border-slate-200 bg-slate-50/50 hover:border-purple-deep/50'
              }`}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input type="file" className="hidden" accept="image/*" onChange={handleFileInput} />
              <Upload size={16} className="text-text-muted" />
              <p className="text-xs text-text-secondary text-center">
                Drop the <strong>current (as-is)</strong> screenshot here<br />
                <span className="text-text-muted">PNG, JPG, WEBP</span>
              </p>
            </label>
          ) : (
            <div className="flex items-center gap-3 px-3 py-2.5 bg-white rounded-lg border border-surface-border text-sm">
              <Image size={14} className="text-slate-400 shrink-0" />
              <span className="flex-1 truncate text-text-secondary font-medium">{file.name}</span>
              <button onClick={() => setFile(null)} className="text-text-muted hover:text-red-500 transition-colors">
                <X size={13} />
              </button>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={!file}
            className="btn-primary w-full justify-center text-xs py-2"
          >
            <Eye size={13} /> Generate Prototype
          </button>
        </div>
      )}

      {generating && (
        <div className="flex items-center gap-3 py-4 text-text-muted text-sm">
          <Loader2 size={16} className="animate-spin text-purple-deep" />
          <span>Generating prototype… this may take up to a minute.</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-500 text-xs">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {/* Preview */}
      {html && !generating && (
        <div className="space-y-2">
          <div className="rounded-xl overflow-hidden border border-surface-border shadow-card bg-white">
            <iframe
              srcDoc={sanitized}
              className="w-full"
              style={{ height: '400px' }}
              sandbox="allow-same-origin"
              title={`Prototype — ${impact.area}`}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleDownload} className="btn-secondary text-xs py-1.5 px-3">
              <Download size={13} /> Download HTML
            </button>
            <label className="btn-secondary text-xs py-1.5 px-3 cursor-pointer">
              <input type="file" className="hidden" accept="image/*" onChange={handleFileInput} />
              <Upload size={13} /> Re-generate
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
