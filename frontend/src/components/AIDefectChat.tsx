import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Sparkles, Bot, User, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import type { UATAnalysis, AIChatMessage } from '../types';
import { uatApi } from '../services/api';

interface Props {
  analysis: UATAnalysis;
  projectId: string;
}

// QUICK_PROMPTS are now derived from translation keys inside each component

// ─── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: AIChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isUser ? 'bg-purple-deep' : 'bg-brand-100 border border-brand-200'}`}>
        {isUser
          ? <User size={13} className="text-white" />
          : <Bot size={13} className="text-purple-deep" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${isUser
        ? 'bg-purple-deep text-white rounded-tr-sm'
        : 'bg-white border border-surface-border text-text-primary rounded-tl-sm shadow-sm'
      }`}>
        {msg.content.split('\n').map((line, i) => {
          const trimmed = line.trimStart();
          if (trimmed.startsWith('## ')) {
            return <p key={i} className={`font-semibold mt-3 mb-1 first:mt-0 text-[13px] ${isUser ? 'text-white/90' : 'text-text-primary'}`}>{trimmed.slice(3)}</p>;
          }
          if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
            return (
              <div key={i} className="flex gap-1.5 my-0.5">
                <span className={`mt-1.5 w-1 h-1 rounded-full shrink-0 ${isUser ? 'bg-white/60' : 'bg-purple-deep'}`} />
                <span>{trimmed.slice(2)}</span>
              </div>
            );
          }
          if (trimmed === '') return <br key={i} />;
          return <p key={i} className="my-0.5">{line}</p>;
        })}
      </div>
    </div>
  );
}

// ─── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-2.5 flex-row">
      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-brand-100 border border-brand-200">
        <Bot size={13} className="text-purple-deep" />
      </div>
      <div className="bg-white border border-surface-border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-4">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-brand-300 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onQuickPrompt }: { onQuickPrompt: (p: string) => void }) {
  const { t } = useTranslation();
  const quickPrompts = t('ai.quickPrompts', { returnObjects: true }) as string[];
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-10">
      <div className="w-14 h-14 rounded-2xl bg-brand-100 border border-brand-200 flex items-center justify-center">
        <Sparkles size={22} className="text-purple-deep" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-text-primary">{t('ai.title')}</p>
        <p className="text-xs text-text-muted mt-1 max-w-sm">
          {t('ai.subtitle')}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        {quickPrompts.map(p => (
          <button
            key={p}
            onClick={() => onQuickPrompt(p)}
            className="text-left px-3 py-2.5 rounded-xl border border-surface-border bg-white hover:border-brand-300 hover:bg-brand-50 text-xs text-text-secondary transition-all"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AIDefectChat({ analysis, projectId }: Props) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: AIChatMessage = { role: 'user', content: trimmed };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const { response } = await uatApi.aiChat(projectId, analysis.id, trimmed, messages);
      setMessages([...nextHistory, { role: 'assistant', content: response }]);
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e)
        ? (e.response?.data?.error ?? t('ai.errorDefault'))
        : (e instanceof Error ? e.message : t('ai.errorDefault'));
      setError(msg);
      // Remove the optimistically added user message so the user can retry
      setMessages(messages);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-5 py-3 border-b border-surface-border bg-white flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-brand-100 border border-brand-200 flex items-center justify-center">
          <Sparkles size={14} className="text-purple-deep" />
        </div>
        <div>
          <p className="text-xs font-semibold text-text-primary">{t('ai.title')}</p>
          <p className="text-[10px] text-text-muted">{analysis.version_name} · {analysis.defect_count} defects</p>
        </div>
        {hasMessages && (
          <button
            onClick={() => { setMessages([]); setError(''); }}
            className="ml-auto text-[10px] text-text-muted hover:text-red-500 transition-colors px-2 py-1 rounded-lg hover:bg-red-50"
          >
            {t('ai.newChat')}
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto bg-surface/30">
        {!hasMessages
          ? <EmptyState onQuickPrompt={p => send(p)} />
          : (
            <div className="p-5 space-y-4">
              {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
              {loading && <TypingIndicator />}
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertCircle size={13} className="shrink-0" />
                  {error}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 p-4 border-t border-surface-border bg-white">
        {/* Quick prompt chips (shown when chat is active) */}
        {hasMessages && !loading && (
          <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-none">
            {(t('ai.quickPrompts', { returnObjects: true }) as string[]).slice(0, 4).map(p => (
              <button
                key={p}
                onClick={() => send(p)}
                className="shrink-0 text-[10px] px-2.5 py-1 rounded-full border border-surface-border bg-surface hover:border-brand-300 hover:bg-brand-50 text-text-muted hover:text-purple-deep transition-all"
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder={t('ai.placeholder')}
            rows={1}
            className="flex-1 input resize-none text-sm leading-relaxed min-h-[38px] max-h-32 py-2"
            style={{ height: 'auto' }}
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = 'auto';
              t.style.height = `${Math.min(t.scrollHeight, 128)}px`;
            }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="btn-primary px-3 py-2 shrink-0 disabled:opacity-40"
          >
            {loading
              ? <Loader2 size={15} className="animate-spin" />
              : <Send size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}
