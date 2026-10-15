const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const { legacyWords, richWords, legacyProgress } = require('./fixtures.cjs');
const runtimeErrors = new WeakMap();

test.beforeEach(({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
});

test.afterEach(({ page }) => {
  expect(runtimeErrors.get(page), 'Browser errors during the scenario').toEqual([]);
});

async function load(page, { words = JSON.stringify(richWords), progress = legacyProgress() } = {}) {
  await page.addInitScript(({ words, progress }) => {
    if (sessionStorage.getItem('wr-fixture-loaded')) return;
    localStorage.setItem('spellRushProgress', JSON.stringify(progress));
    localStorage.setItem('spellRushWords', words);
    localStorage.setItem('spellRushHelpSeen', '1');
    sessionStorage.setItem('wr-fixture-loaded', '1');
  }, { words, progress });
  await page.goto('/');
  await expect(page.locator('#start')).toBeVisible();
}

async function start(page) {
  await page.locator('#homePreset').selectOption('custom');
  await page.locator('#start').click();
  await expect(page.locator('#gameView')).toBeVisible();
  await expect(page.locator('#answer')).toBeEnabled();
}

async function current(page) {
  return page.evaluate(() => WordData.details(state.current));
}

async function answer(page, correct = true) {
  const details = await current(page);
  await page.locator('#answer').fill(correct ? details.word.toUpperCase() : 'incorrectspelling');
  await page.locator('#answer').press('Enter');
  await expect(page.locator('#feedback')).toBeVisible();
  await expect(page.locator('#next')).toBeVisible();
  return details;
}

async function shot(page, testInfo, name) {
  const dir = path.resolve(__dirname, '../.openai/qa');
  await fs.mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${testInfo.project.name}-${name}.png`), fullPage: true, animations: 'disabled' });
}

test('home and navigation preserve existing learning progress', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page, { words: legacyWords });
  await expect(page.locator('#homeBest')).toHaveText('1840');
  await shot(page, testInfo, 'home');
  await page.locator('nav [data-view="stats"]').click();
  await expect(page.locator('#learned')).toHaveText('23');
  await expect(page.locator('#statCombo')).toHaveText('8');
  const beforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem('spellRushProgress')));
  expect(beforeReload.legacyExtension).toEqual({ preserved: true });
  expect(beforeReload.seen).toHaveLength(3);
  await page.reload();
  const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('spellRushProgress')));
  expect(afterReload.learned).toBe(23);
  expect(afterReload.xp).toBe(575);
  expect(afterReload.legacyExtension).toEqual({ preserved: true });
  expect(errors).toEqual([]);
});

for (const wrapped of [false, true]) {
  test(`reads ${wrapped ? 'JSON-wrapped' : 'raw'} legacy custom text without losing words`, async ({ page }) => {
    await load(page, { words: wrapped ? JSON.stringify(legacyWords) : legacyWords });
    await start(page);
    const words = await page.evaluate(() => bank().map(row => WordData.details(row).word));
    expect(words).toEqual(['apple', 'bridge', 'quiet']);
    await expect(page.locator('#meaning')).not.toBeEmpty();
    await expect(page.locator('#partOfSpeech')).not.toBeEmpty();
    await page.reload();
    await start(page);
    expect(await page.evaluate(() => bank().length)).toBe(3);
  });
}

test('correct feedback keeps complete learning context until Next', async ({ page }, testInfo) => {
  await load(page);
  await start(page);
  const details = await current(page);
  await expect(page.locator('#meaning')).not.toBeEmpty();
  await expect(page.locator('#partOfSpeech')).toContainText(/noun|verb|adj\.|n\.|v\./);
  await page.locator('#exampleHint summary').click();
  const hint = await page.locator('#hintExamples').innerText();
  expect(hint.toLowerCase()).not.toContain(details.word.toLowerCase());
  await shot(page, testInfo, 'game');
  await answer(page);
  const feedback = await page.locator('#feedback').innerText();
  expect(feedback).toContain(details.word);
  for (const sentence of details.examples) expect(feedback).toContain(sentence);
  await expect(page.locator('#score')).toHaveText('100');
  await page.waitForTimeout(1250); // Regression: the old 950 ms auto-advance hid the example.
  expect(await page.evaluate(() => state.answered)).toBe(1);
  expect(await page.evaluate(() => state.index)).toBe(0);
  await shot(page, testInfo, 'correct');
  await page.locator('#next').click();
  await expect(page.locator('#answer')).toBeEnabled();
  expect(await page.evaluate(() => state.index)).toBe(1);
  await expect(page.locator('#answer')).toHaveValue('');
  await expect(page.locator('#answer')).toBeFocused();
});

test('wrong answer is recorded once and retains correct spelling and examples', async ({ page }, testInfo) => {
  await load(page);
  await start(page);
  const details = await answer(page, false);
  const displayedAnswer = (await page.locator('.answer-diff').innerText()).replace(/_/g, '');
  expect(displayedAnswer).toBe('incorrectspelling');
  await expect(page.locator('#feedback')).toContainText(details.word);
  for (const sentence of details.examples) await expect(page.locator('#feedback')).toContainText(sentence);
  await page.evaluate(() => { submit(); resolve(false, 'duplicate'); });
  expect(await page.evaluate(() => state.answered)).toBe(1);
  expect(await page.evaluate(() => state.hearts)).toBe(2);
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('spellRushProgress')));
  expect(progress.seen).toHaveLength(4);
  expect(progress.seen.at(-1)).toMatchObject({ word: details.word, ok: false });
  await shot(page, testInfo, 'wrong');
  await page.locator('#next').click();
  await page.locator('nav [data-view="review"]').click();
  await page.locator('#reviewSearch').fill(details.word);
  await expect(page.locator('#reviewList')).toContainText(details.word);
  for (const sense of details.senses) await expect(page.locator('#reviewList')).toContainText(sense.meaning);
  for (const sentence of details.examples) await expect(page.locator('#reviewList')).toContainText(sentence);
});

test('pause, navigation and help preserve remaining time and answer', async ({ page }) => {
  await load(page);
  await page.clock.install();
  await start(page);
  await page.locator('#answer').fill('workinprogress');
  await page.clock.fastForward(1000);
  await page.locator('#pause').click();
  const remaining = await page.evaluate(() => state.time);
  await page.clock.fastForward(30000);
  expect(await page.evaluate(() => state.answered)).toBe(0);
  expect(await page.evaluate(() => state.time)).toBeCloseTo(remaining, 1);
  await page.locator('#resume').click();
  await page.clock.fastForward(1000);
  const resumed = await page.evaluate(() => state.time);
  expect(resumed).toBeLessThan(remaining);
  expect(resumed).toBeGreaterThan(remaining - 2);
  await expect(page.locator('#answer')).toHaveValue('workinprogress');
  await page.locator('nav [data-view="library"]').click();
  await page.clock.fastForward(30000);
  expect(await page.evaluate(() => state.answered)).toBe(0);
  await page.locator('nav [data-view="home"]').click();
  await page.locator('#start').click();
  await expect(page.locator('#gameView')).toBeVisible();
  await expect(page.locator('#answer')).toHaveValue('workinprogress');
  await page.locator('#help').click();
  await expect(page.locator('#helpDialog')).toBeVisible();
  await page.clock.fastForward(30000);
  expect(await page.evaluate(() => state.answered)).toBe(0);
  await page.locator('#helpClose').click();
  await expect(page.locator('#pausedPanel')).toBeVisible();
});

test('a perfect run keeps score, timing and persistence rules', async ({ page }, testInfo) => {
  await load(page);
  await start(page);
  let rounds = 0;
  while (await page.evaluate(() => state.running)) {
    expect(await page.evaluate(() => state.maxTime)).toBe(rounds >= 6 ? 15 : 20);
    await answer(page);
    await page.locator('#next').click();
    rounds++;
  }
  await expect(page.locator('#endView')).toBeVisible();
  expect(rounds).toBe(8);
  await expect(page.locator('#endScore')).toHaveText('1080');
  await expect(page.locator('#endCombo')).toHaveText('8');
  await expect(page.locator('#endCorrect')).toContainText('8');
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('spellRushProgress')));
  expect(progress.learned).toBe(31);
  expect(progress.xp).toBe(965);
  expect(progress.bestStreak).toBe(8);
  expect(progress.perfectRuns).toBe(2);
  expect(progress.bestScore).toBe(1840);
  expect(progress.legacyExtension).toEqual({ preserved: true });
  await shot(page, testInfo, 'end');
  await page.locator('#restart').click();
  await expect(page.locator('#answer')).toBeEnabled();
  await expect(page.locator('#score')).toHaveText('0');
  expect(await page.evaluate(() => state.answered)).toBe(0);
});

test('three misses end a round and all mistakes retain their context', async ({ page }) => {
  await load(page);
  await start(page);
  const missed = [];
  for (let i = 0; i < 3; i++) {
    missed.push(await answer(page, false));
    await page.locator('#next').click();
  }
  await expect(page.locator('#endView')).toBeVisible();
  await expect(page.locator('#missCount')).toHaveText('3');
  await page.locator('#endMistakes summary').click();
  for (const details of missed) {
    await expect(page.locator('#missList')).toContainText(details.word);
    for (const sense of details.senses) await expect(page.locator('#missList')).toContainText(sense.meaning);
    for (const sentence of details.examples) await expect(page.locator('#missList')).toContainText(sentence);
  }
});

test('timeout resolves only once and timer stops during feedback', async ({ page }) => {
  await load(page);
  await page.clock.install();
  await start(page);
  await page.clock.fastForward(21000);
  await expect(page.locator('#feedback')).toBeVisible();
  expect(await page.evaluate(() => state.answered)).toBe(1);
  expect(await page.evaluate(() => state.hearts)).toBe(2);
  await page.clock.fastForward(60000);
  expect(await page.evaluate(() => state.answered)).toBe(1);
  await expect(page.locator('#next')).toBeVisible();
});

test('all main screens fit a narrow viewport and support reduced motion', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await load(page);
  for (const name of ['home', 'review', 'stats', 'library']) {
    await page.locator(`nav [data-view="${name}"]`).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    expect(overflow, `${name} horizontally overflows`).toBe(false);
    await expect(page.locator(`#${name}View`)).toBeVisible();
  }
  await page.locator('#preset').selectOption('custom');
  await shot(page, testInfo, 'library');
  expect(errors).toEqual([]);
});

test('import and export retain multiple senses and their corresponding examples', async ({ page }) => {
  const entry = {
    word: 'record',
    senses: [
      { pos: 'noun', meaning: '记录；唱片', examples: ['This record contains every result.', 'She bought a new record.'] },
      { pos: 'verb', meaning: '录音；记录', examples: ['Please record your answer carefully.'] }
    ],
    source: 'regression-fixture',
    metadata: { reviewed: true }
  };
  const rows = [entry, ...richWords.slice(1)];
  await load(page);
  await page.locator('nav [data-view="library"]').click();
  await page.locator('#preset').selectOption('custom');
  await page.locator('#wordFile').setInputFiles({
    name: 'sense-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rows))
  });
  await expect(page.locator('#confirmDialog')).toBeVisible();
  await page.locator('#confirmAction').click();
  await page.locator('#librarySearch').fill('record');
  const list = page.locator('#libraryList');
  await expect(list).toContainText('record');
  await expect(list).toContainText('noun');
  await expect(list).toContainText('verb');
  for (const sense of entry.senses) {
    await expect(list).toContainText(sense.meaning);
    for (const sentence of sense.examples) await expect(list).toContainText(sentence);
  }
  await page.locator('#libraryList [data-edit]').click();
  await expect(page.locator('#advancedWordEditor')).toHaveAttribute('open', '');
  await expect(page.locator('#editWord')).toBeDisabled();
  entry.senses[1].examples.push('We record each result.');
  await page.locator('#editJson').fill(JSON.stringify(entry, null, 2));
  await page.locator('#wordForm button[type="submit"]').click();
  await expect(page.locator('#wordDialog')).not.toBeVisible();
  await expect(list).toContainText('We record each result.');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportWords').click();
  const download = await downloadPromise;
  const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  const exportedRows = Array.isArray(exported) ? exported : exported.words;
  expect(exportedRows.find(row => row.word === 'record')).toEqual(entry);
  await page.locator('#libraryPlay').click();
  let sawRecord = false;
  for (let i = 0; i < 3; i++) {
    const details = await current(page);
    await answer(page);
    if (details.word === 'record') {
      sawRecord = true;
      for (const sense of entry.senses) {
        await expect(page.locator('#feedback')).toContainText(sense.meaning);
        for (const sentence of sense.examples) await expect(page.locator('#feedback')).toContainText(sentence);
      }
    }
    await page.locator('#next').click();
  }
  expect(sawRecord).toBe(true);
});

test('word editor saves POS, meaning and all examples without losing existing entries', async ({ page }) => {
  await load(page);
  await page.locator('nav [data-view="library"]').click();
  await page.locator('#preset').selectOption('custom');
  await page.locator('#addWord').click();
  await expect(page.locator('#wordDialog')).toBeVisible();
  await page.locator('#editWord').fill('context');
  await page.locator('#editPos').fill('noun');
  await page.locator('#editMeaning').fill('上下文；语境');
  await page.locator('#editExamples').fill('Read the word in context.\nThe context makes the meaning clear.');
  await page.locator('#wordForm button[type="submit"]').click();
  await expect(page.locator('#wordDialog')).not.toBeVisible();
  expect(await page.evaluate(() => bank().length)).toBe(4);
  await page.locator('#librarySearch').fill('context');
  await expect(page.locator('#libraryList')).toContainText('noun');
  await expect(page.locator('#libraryList')).toContainText('上下文；语境');
  await expect(page.locator('#libraryList')).toContainText('Read the word in context.');
  await expect(page.locator('#libraryList')).toContainText('The context makes the meaning clear.');
  await page.reload();
  await page.locator('nav [data-view="library"]').click();
  await page.locator('#preset').selectOption('custom');
  expect(await page.evaluate(() => bank().length)).toBe(4);
});

test('named libraries and word editing/deletion persist with explicit confirmation', async ({ page }) => {
  await load(page);
  await page.locator('nav [data-view="library"]').click();
  await page.locator('#newLibrary').click();
  await page.locator('#libraryName').fill('QA vocabulary');
  await page.locator('#libraryForm button[type="submit"]').click();
  const libraryId = await page.locator('#preset').inputValue();
  expect(libraryId).toMatch(/^user-/);
  await page.locator('#addWord').click();
  await page.locator('#editWord').fill('context');
  await page.locator('#editPos').fill('noun');
  await page.locator('#editMeaning').fill('语境');
  await page.locator('#editExamples').fill('Read the word in context.');
  await page.locator('#wordForm button[type="submit"]').click();
  await page.locator('#libraryList [data-edit]').click();
  await page.locator('#editMeaning').fill('上下文；语境');
  await page.locator('#editExamples').fill('Read the word in context.\nThe context makes it clear.');
  await page.locator('#wordForm button[type="submit"]').click();
  await page.reload();
  await page.locator('nav [data-view="library"]').click();
  await expect(page.locator('#preset')).toHaveValue(libraryId);
  await expect(page.locator('#libraryList')).toContainText('上下文；语境');
  await expect(page.locator('#libraryList')).toContainText('The context makes it clear.');
  await page.locator('#libraryList [data-delete]').click();
  await page.locator('#cancelAction').click();
  expect(await page.evaluate(() => bank().length)).toBe(1);
  await page.locator('#libraryList [data-delete]').click();
  await page.locator('#confirmAction').click();
  expect(await page.evaluate(() => bank().length)).toBe(0);
  await page.locator('#deleteLibrary').click();
  await page.locator('#confirmAction').click();
  expect(await page.locator('#preset option').evaluateAll(options => options.some(option => option.textContent === 'QA vocabulary'))).toBe(false);
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('spellRushProgress')));
  expect(progress.learned).toBe(23);
  expect(progress.seen).toHaveLength(3);
});

test('progress backup restores records and vocabulary, rejecting malformed input safely', async ({ page }) => {
  await load(page);
  await page.locator('nav [data-view="stats"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportProgress').click();
  const backupText = await fs.readFile(await (await downloadPromise).path(), 'utf8');
  const backup = JSON.parse(backupText);
  expect(backup.spellRushProgress.legacyExtension).toEqual({ preserved: true });
  expect(backup.spellRushProgress.seen).toHaveLength(3);
  await page.locator('#restoreProgress').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"spellRushProgress":{"seen":[]}}') });
  await expect(page.locator('#toast')).toContainText('备份数据格式不完整');
  await expect(page.locator('#confirmDialog')).not.toBeVisible();
  expect(await page.evaluate(() => saved.learned)).toBe(23);
  await page.evaluate(() => localStorage.setItem('spellRushProgress', JSON.stringify({ learned: 0, seen: [], xp: 0 })));
  await page.reload();
  await page.locator('nav [data-view="stats"]').click();
  await expect(page.locator('#learned')).toHaveText('0');
  await page.locator('#restoreProgress').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
  await expect(page.locator('#confirmDialog')).toBeVisible();
  await Promise.all([page.waitForEvent('load'), page.locator('#confirmAction').click()]);
  await page.locator('nav [data-view="stats"]').click();
  await expect(page.locator('#learned')).toHaveText('23');
  expect(await page.evaluate(() => saved.legacyExtension)).toEqual({ preserved: true });
  await page.locator('nav [data-view="library"]').click();
  await page.locator('#preset').selectOption('custom');
  expect(await page.evaluate(() => bank().length)).toBe(3);
});

test('active rounds protect vocabulary edits and preserve the original question', async ({ page }) => {
  await load(page);
  await start(page);
  const original = await current(page);
  await page.locator('#letterHint').click();
  await expect(page.locator('#letterHint')).toContainText(original.word.charAt(0));
  await page.locator('nav [data-view="library"]').click();
  await page.locator('#addWord').click();
  await expect(page.locator('#wordDialog')).not.toBeVisible();
  await expect(page.locator('#toast')).toContainText('完成当前游戏');
  await page.locator('#preset').selectOption('daily');
  await page.locator('nav [data-view="home"]').click();
  await page.locator('#start').click();
  expect((await current(page)).word).toBe(original.word);
  await expect(page.locator('#modeLabel')).toContainText('自定义');
  await answer(page);
  expect(await page.evaluate(() => state.answered)).toBe(1);
});

test('long words and examples wrap, including a reduced keyboard viewport', async ({ page }, testInfo) => {
  const word = 'pneumonoultramicroscopicsilicovolcanoconiosis';
  const example = `The dictionary entry for ${word} includes a definition, pronunciation, and a detailed explanation that remains readable even on a very narrow mobile display.`;
  await page.addInitScript(() => { Math.random = () => .999; });
  await load(page, { words: JSON.stringify([[word, 'n. 一种与吸入极细硅尘有关的肺部疾病名称', example], ...richWords.slice(1)]) });
  await start(page);
  expect((await current(page)).word).toBe(word);
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width, height: 460 });
  const inputBox = await page.locator('#answer').boundingBox();
  expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(460);
  await answer(page);
  await expect(page.locator('#feedback')).toContainText(example);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await shot(page, testInfo, 'long-word');
});
