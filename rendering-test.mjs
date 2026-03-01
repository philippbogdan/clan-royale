import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-web-security',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
    permissions: ['microphone'],
  });

  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('Browser error:', msg.text());
    }
  });

  console.log('Navigating to http://localhost:1234 ...');
  await page.goto('http://localhost:1234', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  console.log('Taking landing page screenshot...');
  await page.screenshot({
    path: '/Users/MOPOLLIKA/coding/hackathons/clan-royale/test-rendering-landing.png',
    fullPage: false,
  });
  console.log('Landing page screenshot saved.');

  // Click the actual DOM button by ID
  console.log('Clicking #enter-btn...');
  await page.click('#enter-btn');

  // Wait 3 seconds for game to load (mic permission fallback takes 1.5s)
  console.log('Waiting 3 seconds for game to load...');
  await page.waitForTimeout(3000);

  console.log('Taking gameplay screenshot...');
  await page.screenshot({
    path: '/Users/MOPOLLIKA/coding/hackathons/clan-royale/test-rendering-gameplay.png',
    fullPage: false,
  });
  console.log('Gameplay screenshot saved.');

  // Wait 5 more seconds for combat to begin (AI auto-deploys troops)
  console.log('Waiting 5 more seconds for combat...');
  await page.waitForTimeout(5000);

  console.log('Taking combat screenshot...');
  await page.screenshot({
    path: '/Users/MOPOLLIKA/coding/hackathons/clan-royale/test-rendering-combat.png',
    fullPage: false,
  });
  console.log('Combat screenshot saved.');

  await browser.close();
  console.log('Done! All screenshots captured.');
})();
