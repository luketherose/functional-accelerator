import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Send, MessageSquare, AlertCircle, Copy, Check, Search, BookOpen, ChevronRight, FileDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Impact, ChatMessage } from '../types';
import { analysisApi } from '../services/api';
import { openDeepDiveReport } from '../services/deepDiveReport';

interface ImpactDeepDiveProps {
  impact: Impact;
  projectId: string;
  analysisId: string;
}

type Mode = 'idle' | 'selecting' | 'chatting';
type StartMode = 'full' | 'clarification' | null;

const FULL_RETRIEVAL_QUESTION = (impact: Impact) =>
  `Retrieve and summarise everything available in the project documentation about **${impact.area}**. Include: the current AS-IS behaviour, all TO-BE changes, any business rules, affected fields or screens, and any open questions or assumptions. Cite each passage with its section title.`;

function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      title={t('deepDive.copyAnswer')}
      className="shrink-0 p-1 rounded text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors"
    >
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
    </button>
  );
}

export default function ImpactDeepDive({ impact, projectId, analysisId }: ImpactDeepDiveProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('idle');
  const [startMode, setStartMode] = useState<StartMode>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text: string, history: ChatMessage[]) => {
    const userMsg: ChatMessage = { role: 'user', content: text };
    const updated = [...history, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);
    setError('');
    try {
      const { response } = await analysisApi.impactDeepDive(
        projectId, analysisId, impact.area, impact.description, updated
      );
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.error ?? err.message)
        : (err instanceof Error ? err.message : 'Request failed');
      setError(msg);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [projectId, analysisId, impact.area, impact.description]);

  function handleSelectFullRetrieval() {
    setMode('chatting');
    setStartMode('full');
    sendMessage(FULL_RETRIEVAL_QUESTION(impact), []);
  }

  function handleSelectClarification() {
    setMode('chatting');
    setStartMode('clarification');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    sendMessage(text, messages);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-surface-border space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare size={13} className="text-purple-deep" />
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">{t('deepDive.title')}</span>
        </div>
        {mode === 'idle' && (
          <button
            onClick={() => setMode('selecting')}
            className="btn-secondary text-xs py-1 px-3 flex items-center gap-1.5"
          >
            <Search size={12} />
            {t('deepDive.open')}
          </button>
        )}
        {mode !== 'idle' && (
          <div className="flex items-center gap-2">
            {messages.some(m => m.role === 'assistant') && (
              <button
                onClick={() => openDeepDiveReport(impact, messages)}
                className="btn-secondary text-xs py-1 px-3 flex items-center gap-1.5"
                title="Esporta come documento PDF"
              >
                <FileDown size={12} />
                Esporta report
              </button>
            )}
            <button
              onClick={() => { setMode('idle'); setStartMode(null); setMessages([]); setError(''); setInput(''); }}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              {t('common.close')}
            </button>
          </div>
        )}
      </div>

      {/* Idle hint */}
      {mode === 'idle' && (
        <p className="text-xs text-text-muted">{t('deepDive.subtitle')}</p>
      )}

      {/* Intent selection */}
      {mode === 'selecting' && (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary font-medium">{t('deepDive.howToProceed')}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              onClick={handleSelectFullRetrieval}
              className="group text-left rounded-lg border border-surface-border bg-surface p-3.5 hover:border-purple-deep hover:bg-purple-50/30 transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-purple-100 text-purple-deep group-hover:bg-purple-200 transition-colors">
                  <BookOpen size={14} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-text-primary flex items-center gap-1">
                    {t('deepDive.fullAnalysis')}
                    <ChevronRight size={12} className="text-text-muted" />
                  </div>
                  <div className="mt-0.5 text-xs text-text-muted leading-relaxed">
                    {t('deepDive.fullAnalysisHint')}
                  </div>
                </div>
              </div>
            </button>

            <button
              onClick={handleSelectClarification}
              className="group text-left rounded-lg border border-surface-border bg-surface p-3.5 hover:border-purple-deep hover:bg-purple-50/30 transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-600 group-hover:bg-blue-200 transition-colors">
                  <Search size={14} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-text-primary flex items-center gap-1">
                    {t('deepDive.targetedClarification')}
                    <ChevronRight size={12} className="text-text-muted" />
                  </div>
                  <div className="mt-0.5 text-xs text-text-muted leading-relaxed">
                    {t('deepDive.targetedClarificationHint')}
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Chat */}
      {mode === 'chatting' && (
        <>
          <div className="space-y-4 max-h-[32rem] overflow-y-auto pr-1">
            {messages.map((msg, i) => {
              if (startMode === 'full' && i === 0 && msg.role === 'user') return null;
              return (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5 ${
                  msg.role === 'user' ? 'bg-purple-deep text-white' : 'bg-surface border border-surface-border text-text-muted'
                }`}>
                  {msg.role === 'user' ? 'U' : 'AI'}
                </div>
                <div className={`flex-1 min-w-0 ${msg.role === 'user' ? 'flex justify-end' : ''}`}>
                  {msg.role === 'user' ? (
                    <div className="bg-purple-deep text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-xl whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="group flex items-start gap-2">
                      <div
                        className="flex-1 prose prose-sm max-w-none text-text-secondary
                          prose-headings:text-text-primary prose-headings:font-semibold prose-headings:mt-5 prose-headings:mb-2
                          prose-h2:text-base prose-h3:text-sm
                          prose-p:leading-relaxed prose-p:my-2
                          prose-table:text-xs prose-table:border-collapse prose-table:w-full prose-table:my-3
                          prose-td:border prose-td:border-surface-border prose-td:px-3 prose-td:py-2
                          prose-th:border prose-th:border-surface-border prose-th:px-3 prose-th:py-2
                          prose-th:bg-surface prose-th:font-semibold prose-th:text-text-primary
                          prose-strong:text-text-primary
                          prose-code:text-xs prose-code:bg-surface prose-code:px-1 prose-code:rounded
                          prose-ul:my-2 prose-ol:my-2 prose-li:my-1
                          prose-blockquote:border-l-2 prose-blockquote:border-l-purple-deep prose-blockquote:text-text-muted prose-blockquote:bg-surface prose-blockquote:rounded-r prose-blockquote:py-0.5 prose-blockquote:not-italic"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                      />
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
                        <CopyButton text={msg.content} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              );
            })}

            {loading && (
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full shrink-0 bg-surface border border-surface-border flex items-center justify-center text-[10px] font-bold text-text-muted">AI</div>
                <div className="flex items-center gap-2 text-text-muted text-sm py-1">
                  <Loader2 size={13} className="animate-spin text-purple-deep" />
                  <span>{t('deepDive.retrieving')}</span>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-500 text-xs">
                <AlertCircle size={13} /> {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              className="input text-sm resize-none flex-1"
              rows={2}
              placeholder={t('deepDive.questionPlaceholder')}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="btn-primary text-sm py-2.5 px-3 shrink-0 self-end"
            >
              <Send size={14} />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
