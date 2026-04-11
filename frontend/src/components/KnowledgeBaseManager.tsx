import { useState, useEffect, useCallback } from 'react';
import { FileText, Loader2, CheckCircle2, AlertCircle, Clock, Eye, RefreshCw, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProjectFile, DocumentVersion } from '../types';
import { functionalApi } from '../services/api';
import FunctionalMapView from './FunctionalMapView';

interface KnowledgeBaseManagerProps {
  projectId: string;
  files: ProjectFile[];
  onVersionCreated?: () => void;
}

const BUCKET_LABEL: Record<string, string> = {
  'as-is': 'knowledgeBase.asIsTitle',
  'to-be': 'knowledgeBase.toBeTitle',
};

const BUCKET_COLOR: Record<string, string> = {
  'as-is': 'border-blue-200 bg-blue-50/40',
  'to-be': 'border-violet-200 bg-violet-50/40',
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (status === 'ready') {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
        <CheckCircle2 size={12} />
        {t('knowledgeBase.ready')}
      </span>
    );
  }
  if (status === 'extracting') {
    return (
      <span className="flex items-center gap-1 text-xs text-purple-deep font-medium animate-pulse">
        <Loader2 size={12} className="animate-spin" />
        {t('knowledgeBase.extracting')}
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
        <AlertCircle size={12} />
        {t('knowledgeBase.error')}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-text-muted font-medium">
      <Clock size={12} />
      {t('knowledgeBase.pending')}
    </span>
  );
}

function VersionCard({
  version,
  onViewMap,
}: {
  version: DocumentVersion;
  onViewMap: (v: DocumentVersion) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-white rounded-lg border border-surface-border hover:border-brand-200 transition-all text-sm">
      <FileText size={14} className="text-text-muted shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-text-primary truncate">
          {version.original_name ?? `File ${version.file_id.slice(0, 6)}`}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-text-muted">
            {version.version_label ?? `v${version.version_number}`}
          </span>
          {version.status === 'ready' && version.component_count !== undefined && (
            <span className="text-xs text-text-muted">
              ·{' '}
              {t('knowledgeBase.componentCount', { count: version.component_count })}
            </span>
          )}
        </div>
      </div>
      <StatusBadge status={version.status} />
      {version.status === 'ready' && (
        <button
          onClick={() => onViewMap(version)}
          className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 shrink-0"
          title={t('knowledgeBase.viewMap')}
        >
          <Eye size={11} />
          {t('knowledgeBase.viewMap')}
        </button>
      )}
    </div>
  );
}

function BucketPanel({
  bucket,
  files,
  versions,
  extractingFileId,
  onExtract,
  onViewMap,
}: {
  bucket: string;
  files: ProjectFile[];
  versions: DocumentVersion[];
  extractingFileId: string | null;
  onExtract: (fileId: string) => void;
  onViewMap: (v: DocumentVersion) => void;
}) {
  const { t } = useTranslation();
  const labelKey = BUCKET_LABEL[bucket] ?? 'knowledgeBase.asIsTitle';
  const color = BUCKET_COLOR[bucket] ?? 'border-surface-border bg-white';

  const bucketFiles = files.filter(f => f.bucket === bucket);
  const extractedFileIds = new Set(versions.map(v => v.file_id));

  return (
    <div className={`rounded-xl border-2 p-4 ${color}`}>
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
        {t(labelKey as Parameters<typeof t>[0])}
      </h3>

      {bucketFiles.length === 0 ? (
        <p className="text-xs text-text-muted py-2">{t('knowledgeBase.noDocuments')}</p>
      ) : (
        <div className="space-y-2">
          {bucketFiles.map(file => {
            const fileVersions = versions.filter(v => v.file_id === file.id);
            const isExtracting =
              fileVersions.some(v => v.status === 'extracting') ||
              extractingFileId === file.id;
            return (
              <div key={file.id} className="space-y-1.5">
                {fileVersions.map(v => (
                  <VersionCard
                    key={v.id}
                    version={v}
                    onViewMap={onViewMap}
                  />
                ))}
                <button
                  onClick={() => onExtract(file.id)}
                  disabled={isExtracting}
                  className="w-full btn-secondary text-xs py-1.5 flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {extractedFileIds.has(file.id) ? (
                    <>
                      <RefreshCw size={11} />
                      {t('knowledgeBase.reExtractButton')}
                    </>
                  ) : (
                    <>
                      <ChevronRight size={11} />
                      {t('knowledgeBase.extractButton')}: {file.original_name}
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function KnowledgeBaseManager({
  projectId,
  files,
  onVersionCreated,
}: KnowledgeBaseManagerProps) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [mapVersion, setMapVersion] = useState<DocumentVersion | null>(null);
  const [extracting, setExtracting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await functionalApi.listVersions(projectId);
      setVersions(prev => {
        // Avoid re-render if data is structurally identical
        if (JSON.stringify(prev) === JSON.stringify(data)) return prev;
        return data;
      });
    } catch {
      // Ignore — backend may not have this route yet
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const hasActive = versions.some(
      v => v.status === 'extracting' || v.status === 'pending',
    );
    if (!hasActive) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [versions, load]);

  const handleExtract = async (fileId: string) => {
    setExtracting(fileId);
    try {
      await functionalApi.createVersion(projectId, fileId);
      await load();
      onVersionCreated?.();
    } catch (err) {
      console.error('[KnowledgeBaseManager] Extract error:', err);
    } finally {
      setExtracting(null);
    }
  };

  if (mapVersion) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">
            {t('gapAnalysis.map.title')} — {mapVersion.original_name} (
            {mapVersion.version_label})
          </h3>
          <button
            onClick={() => setMapVersion(null)}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            ← {t('knowledgeBase.title')}
          </button>
        </div>
        <FunctionalMapView projectId={projectId} versionId={mapVersion.id} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">
          {t('knowledgeBase.title')}
        </h2>
        <p className="text-xs text-text-muted mt-0.5">{t('knowledgeBase.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BucketPanel
          bucket="as-is"
          files={files}
          versions={versions}
          extractingFileId={extracting}
          onExtract={handleExtract}
          onViewMap={setMapVersion}
        />
        <BucketPanel
          bucket="to-be"
          files={files}
          versions={versions}
          extractingFileId={extracting}
          onExtract={handleExtract}
          onViewMap={setMapVersion}
        />
      </div>
    </div>
  );
}
