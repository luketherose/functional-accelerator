import { useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Maximize2, Minimize2, Code, Eye, Info } from 'lucide-react';

interface PrototypePreviewProps {
  html: string;
  instructions: string;
}

export default function PrototypePreview({ html, instructions }: PrototypePreviewProps) {
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [fullscreen, setFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const hasHtml = html && html.trim().length > 50;

  // Sanitize before injecting into iframe srcdoc
  const sanitized = hasHtml
    ? DOMPurify.sanitize(html, {
        FORCE_BODY: true,
        WHOLE_DOCUMENT: true,
        ADD_TAGS: ['style', 'meta', 'link'],
        ADD_ATTR: ['charset', 'name', 'content', 'http-equiv', 'rel', 'href', 'type'],
        // Explicitly block all inline event handler attributes
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur',
                      'onkeydown', 'onkeyup', 'onkeypress', 'onsubmit', 'onreset',
                      'onchange', 'oninput', 'ondblclick', 'oncontextmenu'],
      })
    : '';

  if (!hasHtml) {
    return (
      <div className="card p-8 text-center max-w-2xl">
        <div className="w-12 h-12 bg-surface rounded-xl flex items-center justify-center mx-auto mb-4">
          <Eye size={20} className="text-text-muted" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary mb-2">No Prototype Generated</h3>
        <p className="text-sm text-text-muted">
          The analysis did not produce a visual prototype. This can happen when input documentation is minimal.
        </p>
        {instructions && (
          <div className="mt-4 text-left p-4 bg-surface rounded-lg border border-surface-border">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2 flex items-center gap-1">
              <Info size={11} /> Layout Instructions
            </p>
            <p className="text-sm text-text-secondary leading-relaxed">{instructions}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-4 ${fullscreen ? 'fixed inset-0 z-50 bg-white p-6' : 'h-full'}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 bg-surface border border-surface-border rounded-lg p-0.5">
          <button
            onClick={() => setView('preview')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              view === 'preview' ? 'bg-white shadow-sm text-text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Eye size={12} /> Preview
          </button>
          <button
            onClick={() => setView('code')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              view === 'code' ? 'bg-white shadow-sm text-text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Code size={12} /> HTML Source
          </button>
        </div>

        <div className="flex items-center gap-2">
          {instructions && (
            <div className="text-xs text-text-muted bg-amber-50 border border-amber-100 px-3 py-1.5 rounded-lg max-w-xs truncate" title={instructions}>
              <Info size={11} className="inline mr-1 text-amber-500" />
              {instructions.slice(0, 80)}{instructions.length > 80 ? '…' : ''}
            </div>
          )}
          <button
            onClick={() => setFullscreen(f => !f)}
            className="btn-secondary py-1.5 px-3 text-xs"
          >
            {fullscreen ? <><Minimize2 size={13} /> Exit Fullscreen</> : <><Maximize2 size={13} /> Fullscreen</>}
          </button>
        </div>
      </div>

      {/* Content */}
      {view === 'preview' ? (
        <div className="flex-1 rounded-xl overflow-hidden border border-surface-border shadow-card bg-white min-h-[500px]">
          <iframe
            ref={iframeRef}
            srcDoc={sanitized}
            className="w-full h-full"
            style={{ minHeight: fullscreen ? 'calc(100vh - 120px)' : '600px' }}
            sandbox="allow-same-origin"
            title="Prototype Preview"
          />
        </div>
      ) : (
        <div className="flex-1 rounded-xl overflow-auto border border-surface-border bg-slate-900 p-4" style={{ minHeight: '500px' }}>
          <pre className="text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap">{html}</pre>
        </div>
      )}
    </div>
  );
}
