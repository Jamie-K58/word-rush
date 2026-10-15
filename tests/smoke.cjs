const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (fs.existsSync(edge) ? edge : undefined);

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.cjs'), '--dist'], {
    env: { ...process.env, PORT: '4175' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.once('exit', code => reject(new Error(`Preview server stopped (${code}).`)));
      server.stdout.once('data', resolve);
      server.stderr.once('data', body => reject(new Error(String(body))));
    });
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    await page.goto('http://127.0.0.1:4175/');
    for (const selector of ['.hero-fighter img', '.enemy-fighter img']) {
      const loaded = await page.locator('#homeView ' + selector).evaluate(image => image.complete && image.naturalWidth > 0);
      if (!loaded) throw new Error('Built battle artwork did not load: ' + selector);
    }
    await page.locator('#start').click();
    const entry = await page.evaluate(() => WordData.details(state.current));
    if (!entry.word || !entry.meaning) throw new Error('Built game did not load vocabulary.');
    await page.locator('#answer').fill(entry.word);
    await page.locator('#answer').press('Enter');
    await page.locator('#next').waitFor({ state: 'visible' });
    if ((await page.locator('#score').textContent()) !== '100') throw new Error('Built game did not score its first answer.');
    if ((await page.locator('#gameView [data-ui="enemyHealth"]').textContent()) !== '58 / 90') throw new Error('Built battle did not apply stage damage.');
    await page.goto('http://127.0.0.1:4175/' + encodeURIComponent('单词冲刺-免费网页版.html'));
    await page.locator('#start').waitFor({ state: 'visible' });
    if (errors.length) throw new Error(errors.join('\n'));
    process.stdout.write('Built site smoke passed: battle artwork, stage damage, vocabulary, submission, score, legacy entry and browser console.\n');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
