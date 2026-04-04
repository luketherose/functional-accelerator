import puppeteer from 'puppeteer';

/**
 * Renders an HTML string to a PNG image using a headless browser.
 * Returns the image as a base64-encoded string.
 */
export async function renderHtmlToPng(html: string, width = 1280, height = 800): Promise<string> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });

    // Let any CSS animations settle
    await new Promise(r => setTimeout(r, 300));

    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    return Buffer.from(screenshot).toString('base64');
  } finally {
    await browser.close();
  }
}
