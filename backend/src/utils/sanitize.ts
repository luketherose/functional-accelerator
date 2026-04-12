/**
 * Input Sanitization Utilities
 *
 * Centralized sanitization for user-provided text that will be interpolated
 * into LLM prompts. Prevents prompt injection attacks.
 */

// Max lengths for user-provided context fields
const MAX_CONTEXT_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 10_000;
const MAX_HISTORY_ENTRIES = 50;
const MAX_HISTORY_ENTRY_LENGTH = 30_000;

/**
 * Strips known prompt injection patterns from user text.
 * Removes markdown fences, system/instruction overrides, and control sequences.
 */
function stripInjectionPatterns(text: string): string {
  return text
    // Remove markdown code fences that could wrap "system" instructions
    .replace(/```[\s\S]*?```/g, '')
    // Remove attempts to override system prompts
    .replace(/\b(system|instruction|prompt|ignore previous|disregard|forget|override|you are now|act as|pretend)\s*[:=]/gi, '')
    // Remove XML-like tags often used in injection
    .replace(/<\/?(?:system|prompt|instruction|role|context|message)[^>]*>/gi, '')
    // Remove excessive whitespace
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/**
 * Sanitize a context string (sourceContext, targetContext) for safe interpolation
 * into Claude prompts. Enforces length limits and strips injection patterns.
 */
export function sanitizeContext(input: string | undefined | null, fallback: string): string {
  if (!input || typeof input !== 'string') return fallback;
  const trimmed = input.trim().slice(0, MAX_CONTEXT_LENGTH);
  if (!trimmed) return fallback;
  return stripInjectionPatterns(trimmed);
}

/**
 * Sanitize a user message for the AI chat endpoint.
 */
export function sanitizeMessage(message: string | undefined | null): { valid: boolean; value: string; error?: string } {
  if (!message || typeof message !== 'string' || !message.trim()) {
    return { valid: false, value: '', error: 'message is required' };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, value: '', error: `message too long (max ${MAX_MESSAGE_LENGTH} chars)` };
  }
  return { valid: true, value: stripInjectionPatterns(message.trim()) };
}

/**
 * Validate and sanitize conversation history array for the AI chat endpoint.
 * Ensures each entry has valid role and content, and enforces size limits.
 */
export function sanitizeHistory(
  history: unknown
): { valid: boolean; value: Array<{ role: 'user' | 'assistant'; content: string }>; error?: string } {
  if (!Array.isArray(history)) {
    return { valid: false, value: [], error: 'history must be an array' };
  }
  if (history.length > MAX_HISTORY_ENTRIES) {
    return { valid: false, value: [], error: `history too long (max ${MAX_HISTORY_ENTRIES} entries)` };
  }

  const validRoles = new Set(['user', 'assistant']);
  const sanitized: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const entry of history) {
    if (typeof entry !== 'object' || entry === null) {
      return { valid: false, value: [], error: 'each history entry must be an object with role and content' };
    }
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (typeof role !== 'string' || !validRoles.has(role)) {
      return { valid: false, value: [], error: `invalid role in history entry: ${String(role)}` };
    }
    if (typeof content !== 'string') {
      return { valid: false, value: [], error: 'content must be a string in each history entry' };
    }
    if (content.length > MAX_HISTORY_ENTRY_LENGTH) {
      return { valid: false, value: [], error: `history entry too long (max ${MAX_HISTORY_ENTRY_LENGTH} chars)` };
    }
    sanitized.push({
      role: role as 'user' | 'assistant',
      content: stripInjectionPatterns(content),
    });
  }

  return { valid: true, value: sanitized };
}

/**
 * Strip dangerous HTML tags/attributes to prevent SSRF and local file access
 * when rendering HTML with Puppeteer.
 *
 * Removes: <script>, <iframe>, <object>, <embed>, <link>, <meta>,
 * event handlers (onclick, onerror, etc.), javascript: URIs, file: URIs.
 */
export function sanitizeHtml(html: string): string {
  return html
    // Remove script tags and their content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // Remove iframe, object, embed, link, meta tags
    .replace(/<\s*\/?\s*(iframe|object|embed|link|meta|base|applet|form|input|button|textarea)\b[^>]*\/?>/gi, '')
    // Remove event handler attributes
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '')
    // Remove javascript: and data: URIs in href/src/action
    .replace(/(href|src|action)\s*=\s*["']\s*(javascript|data|vbscript|file):[^"']*["']/gi, '$1=""')
    .replace(/(href|src|action)\s*=\s*(javascript|data|vbscript|file):[^\s>]*/gi, '$1=""')
    // Remove @import in style to prevent CSS-based exfiltration
    .replace(/@import\s+(?:url\()?[^;)]+\)?;?/gi, '');
}
