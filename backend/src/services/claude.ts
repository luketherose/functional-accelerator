import Anthropic from '@anthropic-ai/sdk';
import type { AnalysisResult } from '../types';
import type { ImageBlock } from './promptBuilder';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
const TIMEOUT_MS = 240_000; // 4 minutes

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in environment.');
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Calls Claude with the full analysis prompt (text only).
 */
export async function callClaude(prompt: string): Promise<AnalysisResult> {
  const anthropic = getClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const rawText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    return parseClaudeResponse(rawText);
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Claude API request timed out after 2 minutes');
    }
    throw err;
  }
}

/**
 * Calls Claude with a focused prompt + a single image, returning only the generated HTML string.
 * Used for per-impact prototype generation (HTML is then rendered to PNG via Puppeteer).
 */
/**
 * Calls Claude with a focused prompt + a single image, returning raw HTML.
 * Claude is instructed to return HTML directly (no JSON wrapper) to avoid truncation.
 * Used for per-impact prototype generation (HTML is then rendered to PNG via Puppeteer).
 */
export async function callClaudeForHtml(prompt: string, imageBlock: ImageBlock): Promise<string> {
  const anthropic = getClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const content: Anthropic.MessageParam['content'] = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageBlock.source.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: imageBlock.source.data,
      },
    },
    { type: 'text', text: prompt },
  ];

  try {
    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        messages: [
          { role: 'user', content },
          // Prefill to force Claude to start directly with the HTML
          { role: 'assistant', content: '<!DOCTYPE html>' },
        ],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const rawText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Claude continues from the prefill, so prepend it back
    let html = '<!DOCTYPE html>' + rawText;

    // Strip any accidental markdown fences
    if (html.includes('```')) {
      html = html.replace(/```[a-z]*\n?/g, '').replace(/```/g, '');
    }

    // If truncated (no closing </html>), close it gracefully
    if (!html.includes('</html>')) {
      html += '\n</body></html>';
    }

    return html.trim();
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Claude API request timed out');
    }
    throw err;
  }
}

/**
 * Generic Claude call that returns a parsed JSON object of type T.
 * Used for risk assessment and other structured JSON responses.
 */
export async function callClaudeJson<T = Record<string, unknown>>(prompt: string): Promise<T> {
  const anthropic = getClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    const rawText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    return JSON.parse(cleaned) as T;
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Claude API request timed out');
    }
    throw err;
  }
}

/**
 * Multi-turn chat with a system prompt. Used for per-impact deep-dive conversations.
 */
export async function callClaudeChat(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  if (process.env.CLAUDE_MOCK === 'true') {
    return 'This is a mock deep-dive response. In production, Claude will answer based on all project documents. Enable real mode by setting CLAUDE_MOCK=false and providing a valid ANTHROPIC_API_KEY.';
  }

  const anthropic = getClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      },
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Claude API request timed out');
    }
    throw err;
  }
}

function parseClaudeResponse(raw: string): AnalysisResult {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    return normalizeResult(parsed);
  } catch {
    console.error('[claude] Failed to parse JSON response:', cleaned.slice(0, 500));
    throw new Error('Claude returned an invalid JSON response. Try again.');
  }
}

function normalizeResult(raw: Record<string, unknown>): AnalysisResult {
  return {
    executiveSummary: String(raw.executiveSummary || 'No summary provided.'),
    functionalImpacts: Array.isArray(raw.functionalImpacts) ? raw.functionalImpacts : [],
    uiUxImpacts: Array.isArray(raw.uiUxImpacts) ? raw.uiUxImpacts : [],
    affectedScreens: Array.isArray(raw.affectedScreens) ? raw.affectedScreens : [],
    businessRulesExtracted: Array.isArray(raw.businessRulesExtracted) ? raw.businessRulesExtracted : [],
    proposedChanges: Array.isArray(raw.proposedChanges) ? raw.proposedChanges : [],
    prototypeInstructions: String(raw.prototypeInstructions || ''),
    prototypeHtml: String(raw.prototypeHtml || ''),
    assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : [],
    openQuestions: Array.isArray(raw.openQuestions) ? raw.openQuestions.map(String) : [],
  };
}
