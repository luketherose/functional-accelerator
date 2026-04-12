import Anthropic from '@anthropic-ai/sdk';
import type { AnalysisResult } from '../types';
import type { ImageBlock } from './promptBuilder';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
const TIMEOUT_MS = 600_000; // 10 minutes — pipeline runs async in background, each step can take time

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
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) {
      throw new Error('Claude API request timed out after 10 minutes');
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
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) {
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
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) {
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
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) {
      throw new Error('Claude API request timed out');
    }
    throw err;
  }
}

/**
 * Generic pipeline step: calls Claude with streaming to avoid the SDK's 10-minute
 * non-streaming limit. Accumulates the full response then parses JSON.
 *
 * temperature: 0.1 for extraction/comparison (deterministic), 0.2 for synthesis.
 * Supports Anthropic prompt caching on the system prompt via cache_control.
 */
export async function callClaudeStep<T = Record<string, unknown>>(
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.1,
  maxTokens = 32000
): Promise<T> {
  if (process.env.CLAUDE_MOCK === 'true') {
    throw new Error('callClaudeStep called in mock mode — use pipeline mock path instead');
  }

  const anthropic = getClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let rawText = '';

    const stream = anthropic.messages.stream(
      {
        model: MODEL,
        max_tokens: maxTokens,
        temperature,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userPrompt }],
      },
      { signal: controller.signal }
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        rawText += event.delta.text;
      }
    }

    clearTimeout(timeout);

    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    // Sanitize: escape literal control characters inside JSON strings
    const sanitized = sanitizeJsonString(cleaned);

    try {
      return JSON.parse(sanitized) as T;
    } catch (parseErr) {
      // Last resort: try to recover a truncated JSON
      const recovered = recoverTruncatedJson(sanitized);
      if (recovered !== null) {
        console.warn('[claude] JSON truncated — recovered partial response');
        return recovered as T;
      }
      console.error('[claude] Failed to parse pipeline step response:', sanitized.slice(0, 500));
      throw parseErr;
    }
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) {
      throw new Error('Claude API request timed out (pipeline step)');
    }
    throw err;
  }
}

/**
 * Escapes unescaped literal control characters (newlines, tabs, etc.) that appear
 * inside JSON string values. Claude occasionally emits these instead of \n / \t.
 */
function sanitizeJsonString(text: string): string {
  // Replace literal CR/LF/tab only when they appear inside a JSON string value.
  // Strategy: walk char-by-char tracking whether we're inside a string.
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      result += ch;
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      result += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      // Escape bare control characters inside strings
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }

    result += ch;
  }

  return result;
}

/**
 * Attempts to recover a truncated JSON string by closing any open arrays/objects.
 * Returns the parsed value if recovery succeeds, null otherwise.
 */
function recoverTruncatedJson(text: string): unknown {
  // Walk the string tracking open brackets/braces, truncate at last complete value boundary
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let lastSafePos = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
    } else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
        if (stack.length === 0) lastSafePos = i + 1;
      }
    }
  }

  if (stack.length === 0) return null; // wasn't actually truncated

  // Close all open containers
  const closing = stack.reverse().join('');
  const repaired = text.slice(0, lastSafePos > 0 ? lastSafePos : text.length) + closing;
  try {
    return JSON.parse(repaired);
  } catch {
    return null;
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
