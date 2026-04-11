import { useCallback, useState } from 'react';
import { Upload, FileText, Image, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FileBucket } from '../types';
import { filesApi } from '../services/api';

interface FileUploaderProps {
  projectId: string;
  bucket: FileBucket;
  onUploadComplete: () => void;
}

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

const BUCKET_COLOR: Record<FileBucket, string> = {
  'as-is': 'border-blue-300 bg-blue-50/50',
  'to-be': 'border-violet-300 bg-violet-50/50',
  'business-rules': 'border-emerald-300 bg-emerald-50/50',
};

const ACCEPTED = '.pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.gif,.webp,.xlsx,.xls';

export default function FileUploader({ projectId, bucket, onUploadComplete }: FileUploaderProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadingFile[]>([]);

  const color = BUCKET_COLOR[bucket];

  const processFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const newUploads: UploadingFile[] = Array.from(fileList).map(file => ({
      id: Math.random().toString(36).slice(2),
      file,
      progress: 0,
      status: 'uploading',
    }));

    setUploads(prev => [...newUploads, ...prev]);

    for (const upload of newUploads) {
      try {
        await filesApi.upload(projectId, upload.file, bucket, (pct) => {
          setUploads(prev => prev.map(u => u.id === upload.id ? { ...u, progress: pct } : u));
        });
        setUploads(prev => prev.map(u => u.id === upload.id ? { ...u, status: 'done', progress: 100 } : u));
        onUploadComplete();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setUploads(prev => prev.map(u => u.id === upload.id ? { ...u, status: 'error', error: msg } : u));
      }
    }
  }, [projectId, bucket, onUploadComplete]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
    e.target.value = '';
  };

  const removeUpload = (id: string) => setUploads(prev => prev.filter(u => u.id !== id));

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <label
        className={`flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
          isDragging ? 'border-purple-deep bg-brand-50 scale-[1.01]' : `${color} hover:border-purple-deep/50`
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          className="hidden"
          multiple
          accept={ACCEPTED}
          onChange={onInputChange}
        />
        <Upload size={20} className={isDragging ? 'text-purple-deep' : 'text-text-muted'} />
        <div className="text-center">
          <p className="text-sm font-medium text-text-secondary">
            Drop files here or <span className="text-purple-deep">browse</span>
          </p>
          <p className="text-xs text-text-muted mt-0.5">{t('fileUploader.formats')}</p>
        </div>
      </label>

      {/* Upload progress list */}
      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map(u => (
            <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 bg-white rounded-lg border border-surface-border text-sm">
              {u.file.type.startsWith('image/') ? <Image size={14} className="text-text-muted shrink-0" /> : <FileText size={14} className="text-text-muted shrink-0" />}
              <span className="flex-1 truncate text-text-secondary font-medium">{u.file.name}</span>

              {u.status === 'uploading' && (
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 bg-surface-border rounded-full overflow-hidden">
                    <div className="h-full bg-purple-deep rounded-full transition-all duration-200" style={{ width: `${u.progress}%` }} />
                  </div>
                  <Loader2 size={14} className="animate-spin text-purple-deep" />
                </div>
              )}
              {u.status === 'done' && <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />}
              {u.status === 'error' && (
                <div className="flex items-center gap-1 text-red-500 text-xs">
                  <AlertCircle size={13} />
                  <span className="truncate max-w-[120px]" title={u.error}>{u.error}</span>
                </div>
              )}
              <button onClick={() => removeUpload(u.id)} className="text-text-muted hover:text-text-primary transition-colors">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
