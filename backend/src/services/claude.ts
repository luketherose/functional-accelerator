import Anthropic from '@anthropic-ai/sdk';
import { AnalysisResult } from '../types';
import { ImageBlock } from './promptBuilder';
import { getMockAnalysis } from './mockAnalysis';

const MOCK_MODE = process.env.CLAUDE_MOCK === 'true';
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
const TIMEOUT_MS = 120_000; // 2 minute timeout

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set. Set CLAUDE_MOCK=true for mock mode.');
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Calls Claude with the analysis prompt and optional image blocks.
 * Falls back to mock mode if CLAUDE_MOCK=true.
 */
export async function callClaude(prompt: string, imageBlocks: ImageBlock[]): Promise<AnalysisResult> {
  if (MOCK_MODE) {
    console.log('[claude] Mock mode enabled — returning fixture data');
    await new Promise(r => setTimeout(r, 1500)); // simulate latency
    return getMockAnalysis();
  }

  const anthropic = getClient();

  // Build message content: images first (if any), then text prompt
  const content: Anthropic.MessageParam['content'] = [
    ...imageBlocks.map((img): Anthropic.ImageBlockParam => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.source.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: img.source.data,
      },
    })),
    { type: 'text', text: prompt },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
 * Parses Claude's JSON response with graceful error handling.
 */
function parseClaudeResponse(raw: string): AnalysisResult {
  // Strip any accidental markdown fences
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    return normalizeResult(parsed);
  } catch (err) {
    console.error('[claude] Failed to parse JSON response:', cleaned.slice(0, 500));
    throw new Error('Claude returned an invalid JSON response. Try again.');
  }
}

/**
 * Normalizes and fills defaults for the analysis result.
 */
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
