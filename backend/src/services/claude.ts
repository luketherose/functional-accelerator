import Anthropic from '@anthropic-ai/sdk';
import type { AnalysisResult } from '../types';
import type { ImageBlock } from './promptBuilder';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
const TIMEOUT_MS = 120_000;

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
        max_tokens: 8192,
        messages: [{ role: 'user', content }],
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

    const parsed = JSON.parse(cleaned) as { prototypeHtml?: string };
    if (!parsed.prototypeHtml) throw new Error('Claude did not return prototypeHtml');
    return parsed.prototypeHtml;
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Claude API request timed out after 2 minutes');
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
