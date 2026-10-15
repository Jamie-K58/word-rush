const { test, expect } = require("@playwright/test");
const { richWords, legacyProgress } = require("./fixtures.cjs");

const errors = new WeakMap();
const gameScene = (page) => page.locator("#gameView .battle-scene");
const hud = (scene, name) => scene.locator(`[data-ui="${name}"]`);

test.beforeEach(({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") messages.push(message.text());
  });
});

test.afterEach(({ page }) => {
  expect(
    errors.get(page),
    "Battle scenarios must not produce runtime errors",
  ).toEqual([]);
});

async function load(page, progress = legacyProgress()) {
  await page.addInitScript(
    ({ words, progress }) => {
      localStorage.setItem("spellRushWords", JSON.stringify(words));
      localStorage.setItem("spellRushProgress", JSON.stringify(progress));
      localStorage.setItem("spellRushHelpSeen", "1");
      // A stable first question makes the small-screen layout check meaningful.
      Math.random = () => 0.999;
    },
    { words: richWords, progress },
  );
  await page.goto("/");
  await expect(page.locator("#start")).toBeVisible();
}

async function start(page) {
  await page.locator("#homePreset").selectOption("custom");
  await page.locator("#start").click();
  await expect(page.locator("#answer")).toBeEnabled();
}

async function answer(page, correct = true) {
  const word = await page.evaluate(() => WordData.details(state.current).word);
  await page.locator("#answer").fill(correct ? word : "wrongspelling");
  await page.locator("#answer").press("Enter");
  await expect(page.locator("#next")).toBeVisible();
}

async function battleState(page) {
  return page.evaluate(() => ({
    hp: state.enemyHp,
    max: state.enemyMax,
    shields: state.hearts,
    index: state.index,
    score: state.score,
    streak: state.streak,
    answered: state.answered,
  }));
}

test("home opens on a loaded battle scene with ten rounds and saved growth", async ({
  page,
}) => {
  await load(page);
  const scene = page.locator("#homeView .battle-scene");
  await expect(scene).toBeVisible();
  await expect(scene.locator("[data-step]")).toHaveCount(10);
  await expect(scene.locator('[data-step="10"]')).toHaveText("10");
  await expect(scene.locator('[data-step="10"]')).not.toHaveClass(/boss-node/);
  await expect(hud(scene, "shields")).toHaveAttribute("aria-label", /3/);
  await expect(page.locator("#homeLevel")).toHaveText("Lv.2");
  await expect(hud(scene, "level")).toHaveText("Lv.2");
  await expect(page.locator("#homeXpText")).toContainText("75");
  expect(
    await page.locator("#homeXpBar").evaluate((el) => el.style.width),
  ).toBe("15%");
  for (const selector of [".hero-fighter img", ".enemy-fighter img"]) {
    const image = scene.locator(selector);
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((el) => el.complete && el.naturalWidth > 0))
      .toBe(true);
  }
  const sceneBox = await scene.boundingBox();
  const titleBox = await page.locator("#homeTitle").boundingBox();
  expect(sceneBox.height).toBeGreaterThan(140);
  expect(titleBox.height).toBeLessThan(sceneBox.height);
});

test("correct spelling persists encounter health and advances after a kill", async ({
  page,
}) => {
  await load(page);
  await page.clock.install();
  await start(page);
  const scene = gameScene(page);
  expect(await battleState(page)).toMatchObject({
    hp: 90,
    max: 90,
    shields: 3,
    score: 0,
  });
  await expect(scene.locator('[data-step="1"]')).toHaveClass(/is-current/);
  await answer(page);
  expect(await battleState(page)).toMatchObject({
    hp: 58,
    max: 90,
    shields: 3,
    score: 100,
    streak: 1,
  });
  await expect(hud(scene, "enemyHealth")).toHaveText("58 / 90");
  await expect(hud(scene, "damage")).toHaveText("−32");
  expect(
    parseFloat(await hud(scene, "enemyHp").evaluate((el) => el.style.width)),
  ).toBeCloseTo(64.444, 2);
  await expect(scene).toHaveClass(/is-attacking/);
  await expect(scene).toHaveClass(/enemy-is-hit/);
  await page.clock.fastForward(500);
  await expect(scene).not.toHaveClass(/is-attacking|enemy-is-hit/);
  await expect(hud(scene, "damage")).toHaveCSS("opacity", "0");
  await page.locator("#next").click();
  expect(await battleState(page)).toMatchObject({
    hp: 58,
    max: 90,
    index: 1,
  });
  await expect(scene.locator('[data-step="1"]')).toHaveClass(/is-complete/);
  await expect(scene.locator('[data-step="2"]')).toHaveClass(/is-current/);
  await answer(page);
  expect(await battleState(page)).toMatchObject({
    hp: 26,
    max: 90,
    score: 210,
    streak: 2,
  });
  await page.locator("#next").click();
  await answer(page);
  expect(await battleState(page)).toMatchObject({
    hp: 0,
    max: 90,
    index: 2,
  });
  await expect(hud(scene, "damage")).toHaveText("−26");
  await page.clock.fastForward(500);
  await expect(scene).toHaveClass(/is-defeated/);
  await expect(hud(scene, "enemyHealth")).toHaveText("0 / 90");
  await page.locator("#next").click();
  expect(await battleState(page)).toMatchObject({
    hp: 120,
    max: 120,
    index: 3,
  });
  await expect(hud(scene, "enemyMeta")).toHaveText("精英战");
  await expect(scene).not.toHaveClass(/is-defeated/);
});

test("wrong spelling reduces one shield without damaging the enemy", async ({
  page,
}) => {
  await load(page);
  await page.clock.install();
  await start(page);
  const scene = gameScene(page);
  await answer(page, false);
  expect(await battleState(page)).toMatchObject({
    hp: 90,
    max: 90,
    shields: 2,
    score: 0,
    streak: 0,
  });
  await expect(hud(scene, "shields")).toHaveAttribute("aria-label", /2/);
  expect(
    parseFloat(await hud(scene, "heroHp").evaluate((el) => el.style.width)),
  ).toBeCloseTo(200 / 3, 3);
  await expect(scene).toHaveClass(/hero-is-hit/);
  await page.evaluate(() => {
    submit();
    resolve(false, "duplicate");
  });
  expect(await battleState(page)).toMatchObject({ shields: 2, answered: 1 });
  await page.clock.fastForward(500);
  await expect(scene).not.toHaveClass(/hero-is-hit/);
  await expect(hud(scene, "damage")).toHaveCSS("opacity", "0");
  await page.locator("#next").click();
  await expect(scene.locator('[data-step="1"]')).toHaveClass(/is-missed/);
});

test("a perfect run kills the Boss through encounter damage and awards XP", async ({
  page,
}) => {
  const progress = { ...legacyProgress(), xp: 475 };
  await load(page, progress);
  await page.clock.install();
  await start(page);
  const scene = gameScene(page);
  let expectedScore = 0;
  let questions = 0;
  while (await page.evaluate(() => state.running)) {
    const before = await battleState(page);
    if (questions === 5) {
      await expect(hud(scene, "enemyMeta")).toHaveText("BOSS 战");
      await expect(scene).toHaveClass(/is-boss/);
      expect(before.hp).toBe(200);
    }
    if (before.index < 10)
      await expect(scene.locator(`[data-step="${before.index + 1}"]`)).toHaveClass(/is-current/);
    await answer(page);
    questions++;
    expectedScore += 100 + before.streak * 10;
    expect(await battleState(page)).toMatchObject({ score: expectedScore });
    await page.locator("#next").click();
  }
  expect(questions).toBe(8);
  expect(await page.evaluate(() => state.victory)).toBe(true);
  expect(await page.evaluate(() => state.encounter)).toBe(2);
  await expect(page.locator("#endView")).toBeVisible();
  await expect(page.locator("#endScore")).not.toHaveText("0");
  await expect(page.locator("#endReward")).toContainText("XP");
  await expect(page.locator("#endLevel")).toContainText("Lv.2");
  const persisted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("spellRushProgress")),
  );
  expect(persisted.xp).toBe(progress.xp + 390);
  expect(persisted.learned).toBe(progress.learned + questions);
  expect(persisted.perfectRuns).toBe(progress.perfectRuns + 1);
  expect(persisted.unlockedCosmetics).toEqual(expect.arrayContaining([
    "elite-crest", "combo-mark", "boss-aura",
  ]));
  expect(persisted.defeatedEncounters).toEqual([
    "词语史莱姆", "词源巨像", "遗忘魔王",
  ]);
  expect(persisted.legacyExtension).toEqual(progress.legacyExtension);
  await page.locator('nav [data-view="home"]').click();
  await expect(page.locator("#homeLevel")).toHaveText("Lv.2");
});

test("ten-question limit without a Boss kill is a loss and can be retried", async ({
  page,
}) => {
  await load(page);
  await page.clock.install();
  await start(page);
  for (let round = 1; round <= 10; round++) {
    await answer(page, ![4, 8].includes(round));
    await page.locator("#next").click();
  }
  await expect(page.locator("#endView")).toBeVisible();
  expect(await page.evaluate(() => state.victory)).toBe(false);
  const exhausted = await battleState(page);
  expect(exhausted).toMatchObject({ answered: 10, shields: 1 });
  expect(exhausted.hp).toBeGreaterThan(0);
  await expect(page.locator("#endKicker")).toHaveText("RUN COMPLETE");
  expect(await page.evaluate(() => state.finished)).toBe(true);
  await page.locator("#restart").click();
  await expect(page.locator("#answer")).toBeEnabled();
  expect(await battleState(page)).toMatchObject({
    hp: 90,
    max: 90,
    index: 0,
    answered: 0,
    shields: 3,
  });
});

test("every single-miss position can recover and clear the Boss within ten rounds", async ({
  page,
}) => {
  test.setTimeout(120000);
  await load(page);
  await page.clock.install();
  await start(page);
  // R9 and R10 do not occur in a flawless run; check every reachable first miss.
  for (let missedRound = 1; missedRound <= 8; missedRound++) {
    await test.step(`Recover after a miss in round ${missedRound}`, async () => {
      if (missedRound > 1) await page.locator("#restart").click();
      let questions = 0;
      while (await page.evaluate(() => state.running)) {
        await answer(page, questions + 1 !== missedRound);
        questions++;
        await page.locator("#next").click();
      }
      expect(questions).toBeLessThanOrEqual(10);
      expect(await page.evaluate(() => state.victory)).toBe(true);
      expect(await page.evaluate(() => state.hearts)).toBe(2);
      await expect(page.locator("#endView")).toHaveClass(/is-victory/);
      await expect(page.locator("#endCorrect")).toHaveText(`${questions - 1} / ${questions}`);
    });
  }
});

test("skip and timeout consume shields and preserve the unanswered word for review", async ({ page }) => {
  await load(page);
  await page.clock.install();
  await start(page);
  await page.locator("#skip").click();
  expect(await battleState(page)).toMatchObject({ hp: 90, shields: 2, answered: 1 });
  expect(await page.evaluate(() => state.misses[0].reason)).toBe("skip");
  await page.locator("#next").click();
  const word = await page.evaluate(() => WordData.details(state.current).word);
  await page.clock.fastForward(20001);
  await expect(page.locator("#feedback")).toContainText(word);
  expect(await battleState(page)).toMatchObject({ hp: 90, shields: 1, answered: 2 });
  expect(await page.evaluate(() => state.misses[1].reason)).toBe("timeout");
  await page.clock.fastForward(60000);
  expect(await page.evaluate(() => state.answered)).toBe(2);
  await expect(page.locator("#next")).toBeVisible();
});

test("an answer submitted after the deadline cannot score before the next timer tick", async ({ page }) => {
  await load(page);
  await page.clock.install();
  await start(page);
  const word = await page.evaluate(() => WordData.details(state.current).word);
  await page.locator("#answer").fill(word);
  // Move wall-clock time without firing the interval, as with a delayed timer task.
  const expired = await page.evaluate(() => state.deadline + 1);
  await page.clock.setSystemTime(expired);
  await page.locator("#answer").press("Enter");
  await expect(page.locator("#next")).toBeVisible();
  expect(await battleState(page)).toMatchObject({ score: 0, shields: 2, answered: 1 });
  expect(await page.evaluate(() => state.misses[0].reason)).toBe("timeout");
});

test("shield depletion ends the fight and restart restores the first encounter", async ({
  page,
}) => {
  await load(page);
  await start(page);
  for (let i = 0; i < 3; i++) {
    await answer(page, false);
    await page.locator("#next").click();
  }
  await expect(page.locator("#endView")).toBeVisible();
  expect(await page.evaluate(() => state.victory)).toBe(false);
  await expect(page.locator("#endTitle")).toHaveText("休整，再出发。");
  await page.locator("#restart").click();
  await expect(page.locator("#answer")).toBeEnabled();
  expect(await battleState(page)).toMatchObject({ hp: 90, max: 90, shields: 3, index: 0 });
});

test("pause and navigation preserve combat state and typed answer", async ({
  page,
}) => {
  await load(page);
  await page.clock.install();
  await start(page);
  await answer(page);
  const damaged = await battleState(page);
  await page.locator('nav [data-view="stats"]').click();
  await page.clock.fastForward(60000);
  expect(await battleState(page)).toEqual(damaged);
  await page.locator('nav [data-view="home"]').click();
  await page.locator("#start").click();
  expect(await battleState(page)).toEqual(damaged);
  await expect(page.locator("#next")).toBeFocused();
  await page.locator("#next").click();
  await page.locator("#answer").fill("partial");
  await page.locator("#pause").click();
  await expect(gameScene(page)).toHaveClass(/is-paused/);
  const paused = await battleState(page);
  await page.clock.fastForward(60000);
  await page.evaluate(() => submit());
  expect(await battleState(page)).toEqual(paused);
  await page.locator('nav [data-view="library"]').click();
  await page.locator('nav [data-view="home"]').click();
  await page.locator("#start").click();
  await expect(page.locator("#answer")).toHaveValue("partial");
  expect(await battleState(page)).toEqual(paused);
  await expect(gameScene(page)).not.toHaveClass(/is-paused/);
});

test("compact battle and input fit a phone and remain usable with its keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await load(page);
  await start(page);
  const scene = gameScene(page);
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  for (const selector of ["#meaning", "#partOfSpeech", "#answer"]) {
    const box = await page.locator(selector).boundingBox();
    expect(
      box.y,
      `${selector} starts above the viewport`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      box.y + box.height,
      `${selector} needs scrolling before entering an answer`,
    ).toBeLessThanOrEqual(780);
  }
  const sceneBox = await scene.boundingBox();
  expect(sceneBox.height).toBeGreaterThan(120);
  expect(sceneBox.height).toBeLessThan(350);
  await page.setViewportSize({ width: 360, height: 460 });
  await expect(page.locator("#answer")).toBeFocused();
  const input = await page.locator("#answer").boundingBox();
  expect(input.y).toBeGreaterThanOrEqual(0);
  expect(input.y + input.height).toBeLessThanOrEqual(460);
  await answer(page);
  const fullWord = await page.evaluate(
    () => WordData.details(state.current).word,
  );
  await expect(page.locator("#feedback")).toContainText(fullWord);
  await expect(page.locator("#feedback")).toContainText(
    "The hotel can accommodate up to 500 guests.",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("reduced motion keeps battle feedback and learning information usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await load(page);
  await start(page);
  await answer(page);
  await expect(hud(gameScene(page), "enemyHealth")).toHaveText("58 / 90");
  await expect(page.locator("#feedback")).toContainText(
    "The hotel can accommodate up to 500 guests.",
  );
  const duration = await gameScene(page).evaluate((el) =>
    parseFloat(getComputedStyle(el).animationDuration),
  );
  expect(duration).toBeLessThanOrEqual(0.01);
  await page.locator("#next").click();
  await expect(page.locator("#answer")).toBeEnabled();
});
