import { useState } from 'react';
import { FileText, Image, Trash2, ExternalLink, FileSpreadsheet } from 'lucide-react';
import type { ProjectFile, FileBucket } from '../types';
import { filesApi } from '../services/api';

interface FileListProps {
  files: ProjectFile[];
  projectId: string;
  onDeleted: () => void;
}

const BUCKET_CONFIG: Record<FileBucket, { label: string; badgeClass: string; emptyText: string }> = {
  'as-is': { label: 'As-Is Documents', badgeClass: 'badge-asis', emptyText: 'No as-is documents uploaded yet.' },
  'to-be': { label: 'To-Be Documents', badgeClass: 'badge-tobe', emptyText: 'No to-be documents uploaded yet.' },
  'business-rules': { label: 'Business Rules', badgeClass: 'badge-br', emptyText: 'No business rules uploaded yet.' },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return <Image size={14} className="text-slate-400" />;
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return <FileSpreadsheet size={14} className="text-emerald-500" />;
  return <FileText size={14} className="text-blue-400" />;
}

function BucketSection({ bucket, files, projectId, onDeleted }: { bucket: FileBucket; files: ProjectFile[]; projectId: string; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const config = BUCKET_CONFIG[bucket];

  const handleDelete = async (fileId: string) => {
    if (!confirm('Delete this file?')) return;
    setDeleting(fileId);
    try {
      await filesApi.delete(projectId, fileId);
      onDeleted();
    } catch (err) {
      alert('Failed to delete file');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-primary">{config.label}</h3>
        <span className={`badge ${config.badgeClass}`}>{files.length}</span>
      </div>

      {files.length === 0 ? (
        <p className="text-xs text-text-muted py-2">{config.emptyText}</p>
      ) : (
        <div className="space-y-1.5">
          {files.map(file => (
            <div key={file.id} className="flex items-center gap-3 px-3 py-2.5 bg-white rounded-lg border border-surface-border hover:border-brand-200 hover:shadow-card transition-all group">
              <div className="shrink-0">{getFileIcon(file.mime_type)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{file.original_name}</p>
                <p className="text-xs text-text-muted">{formatBytes(file.size)} · {formatDate(file.created_at)}</p>
              </div>
              {file.mime_type.startsWith('image/') && (
                <a
                  href={filesApi.previewUrl(projectId, file.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-muted hover:text-purple-deep transition-colors opacity-0 group-hover:opacity-100"
                  title="Preview"
                >
                  <ExternalLink size={13} />
                </a>
              )}
              <button
                onClick={() => handleDelete(file.id)}
                disabled={deleting === file.id}
                className="text-text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileList({ files, projectId, onDeleted }: FileListProps) {
  const buckets: FileBucket[] = ['as-is', 'to-be', 'business-rules'];

  return (
    <div className="space-y-6">
      {buckets.map(bucket => (
        <BucketSection
          key={bucket}
          bucket={bucket}
          files={files.filter(f => f.bucket === bucket)}
          projectId={projectId}
          onDeleted={onDeleted}
        />
      ))}
    </div>
  );
}
