const { test, expect } = require('@playwright/test');
const { legacyProgress } = require('./fixtures.cjs');

test('complete CET-4 loads without import and keeps long questions playable on phones', async ({ page }) => {
  const progress = legacyProgress();
  progress.seen.push({word: 'criteria', ok: false, ts: Date.now()});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(progress => {
    localStorage.setItem('spellRushProgress', JSON.stringify(progress));
    localStorage.setItem('spellRushHelpSeen', '1');
  }, progress);
  await page.goto('/');
  await expect(page.locator('#homePreset')).toHaveValue('cet4');
  await expect(page.locator('#homePreset option:checked')).toContainText('4543');
  expect(await page.evaluate(() => BANKS.cet4.length)).toBe(4543);
  const storage = await page.evaluate(() => ({
    custom: localStorage.getItem('spellRushWords'),
    libraries: localStorage.getItem('spellRushLibraries'),
    total: Object.keys(localStorage).reduce((sum, key) => sum + localStorage.getItem(key).length, 0),
  }));
  expect(storage.custom).toBeNull();
  expect(storage.libraries).toBeNull();
  expect(storage.total).toBeLessThan(10000);
  await page.setViewportSize({width: 360, height: 780});
  await page.locator('#start').click();
  // The longest Chinese prompt in the full source exposes layout regressions
  // that the original short seed vocabulary could not reveal.
  const word = await page.evaluate(() => {
    state.deck[0] = BANKS.cet4.find(row => row.word === 'survey');
    question();
    return WordData.details(state.current);
  });
  for (const height of [780, 460]) {
    await page.setViewportSize({width: 360, height});
    const input = await page.locator('#answer').boundingBox();
    expect(input.y).toBeGreaterThanOrEqual(0);
    expect(input.y + input.height).toBeLessThanOrEqual(height);
    await expect(page.locator('#meaning')).toHaveText(word.meaning);
    await expect(page.locator('#partOfSpeech')).toHaveText(word.pos);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
  await page.locator('#answer').fill(word.word);
  await page.locator('#answer').press('Enter');
  await expect(page.locator('#next')).toBeVisible();
  for (const example of word.examples) await expect(page.locator('#feedback')).toContainText(example);
  for (const sense of word.senses) await expect(page.locator('#feedback')).toContainText(sense.meaning);
  const savedProgress = await page.evaluate(() => JSON.parse(localStorage.getItem('spellRushProgress')));
  expect(savedProgress.xp).toBe(progress.xp + 25);
  expect(savedProgress.seen).toEqual(expect.arrayContaining(progress.seen));
  expect(savedProgress.legacyExtension).toEqual(progress.legacyExtension);
  expect(errors).toEqual([]);
});
