import puppeteer from 'puppeteer';
import { sanitizeHtml } from '../utils/sanitize';

/**
 * Renders an HTML string to a PNG image using a headless browser.
 * Returns the image as a base64-encoded string.
 *
 * H4 Security Fix:
 * - HTML is sanitized before rendering (removes script, iframe, object, embed,
 *   event handlers, javascript:/file:/data: URIs)
 * - Puppeteer launched with hardened flags: no sandbox is still needed for
 *   containerized environments, but we disable GPU, disable file access from
 *   files, and block all external network requests to prevent SSRF.
 */
export async function renderHtmlToPng(html: string, width = 1280, height = 800): Promise<string> {
  // H4 fix: sanitize HTML to remove dangerous tags/attributes
  const safeHtml = sanitizeHtml(html);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // H4 hardening: prevent access to local files from file:// URIs
      '--disable-local-file-accesses',
      '--allow-file-access-from-files=false',
      // H4 hardening: disable GPU and extensions
      '--disable-gpu',
      '--disable-extensions',
      // H4 hardening: disable web security features that could be abused
      '--disable-background-networking',
      '--disable-default-apps',
    ],
  });

  try {
    const page = await browser.newPage();

    // H4 hardening: block all external network requests (prevents SSRF)
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      // Only allow data: URIs and about:blank (used internally by setContent)
      if (url.startsWith('data:') || url === 'about:blank') {
        request.continue();
      } else {
        request.abort('blockedbyclient');
      }
    });

    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(safeHtml, { waitUntil: 'networkidle0', timeout: 30_000 });

    // Let any CSS animations settle
    await new Promise(r => setTimeout(r, 300));

    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    return Buffer.from(screenshot).toString('base64');
  } finally {
    await browser.close();
  }
}
