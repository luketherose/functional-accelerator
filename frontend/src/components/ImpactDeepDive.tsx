import { useState, useEffect, useRef } from 'react';
import { Loader2, Send, MessageSquare, AlertCircle } from 'lucide-react';
import axios from 'axios';
import type { Impact, ChatMessage } from '../types';
import { analysisApi } from '../services/api';

interface ImpactDeepDiveProps {
  impact: Impact;
  projectId: string;
  analysisId: string;
}

const INITIAL_QUESTION = (impact: Impact) =>
  `Explain this impact in detail: what specifically changes between AS-IS and TO-BE for **${impact.area}**? Please cite relevant passages from the documentation where possible.`;

export default function ImpactDeepDive({ impact, projectId, analysisId }: ImpactDeepDiveProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initialized = useRef(false);

  // Auto-send the first question on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    sendMessage(INITIAL_QUESTION(impact));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage(text: string) {
    const userMsg: ChatMessage = { role: 'user', content: text };
    const updated = [...messages, userMsg];
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
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    sendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="mt-4 border-t border-surface-border pt-4 space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare size={13} className="text-purple-deep" />
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Deep Dive</p>
      </div>

      {/* Chat history */}
      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`rounded-xl px-3 py-2 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-purple-deep text-white'
                  : 'bg-surface border border-surface-border text-text-secondary'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-xl px-3 py-2 bg-surface border border-surface-border flex items-center gap-2 text-text-muted text-sm">
              <Loader2 size={13} className="animate-spin text-purple-deep" />
              <span>Analysing documentation…</span>
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
          className="input text-xs resize-none flex-1"
          rows={2}
          placeholder="Ask a follow-up question… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="btn-primary text-xs py-2 px-3 shrink-0 self-end"
        >
          <Send size={13} />
        </button>
      </form>
    </div>
  );
}
