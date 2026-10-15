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
  await expect(scene.locator('[data-step="10"]')).toHaveClass(/boss-node/);
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

test("correct spelling uses original damage and resets enemy health next round", async ({
  page,
}) => {
  await load(page);
  await page.clock.install();
  await start(page);
  const scene = gameScene(page);
  expect(await battleState(page)).toMatchObject({
    hp: 100,
    max: 100,
    shields: 3,
    score: 0,
  });
  await expect(scene.locator('[data-step="1"]')).toHaveClass(/is-current/);
  await answer(page);
  expect(await battleState(page)).toMatchObject({
    hp: 76,
    max: 100,
    shields: 3,
    score: 100,
    streak: 1,
  });
  await expect(hud(scene, "enemyHealth")).toHaveText("76 / 100");
  expect(await hud(scene, "enemyHp").evaluate((el) => el.style.width)).toBe(
    "76%",
  );
  await expect(scene).toHaveClass(/is-attacking/);
  await expect(scene).toHaveClass(/enemy-is-hit/);
  await page.clock.fastForward(500);
  await expect(scene).not.toHaveClass(/is-attacking|enemy-is-hit/);
  await expect(hud(scene, "damage")).toHaveCSS("opacity", "0");
  await page.locator("#next").click();
  expect(await battleState(page)).toMatchObject({
    hp: 100,
    max: 100,
    index: 1,
  });
  await expect(scene.locator('[data-step="1"]')).toHaveClass(/is-complete/);
  await expect(scene.locator('[data-step="2"]')).toHaveClass(/is-current/);
  await answer(page);
  expect(await battleState(page)).toMatchObject({
    hp: 69,
    score: 210,
    streak: 2,
  });
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
    hp: 100,
    max: 100,
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

test("ten-round run preserves Boss, score, XP and original level thresholds", async ({
  page,
}) => {
  const progress = { ...legacyProgress(), xp: 475 };
  await load(page, progress);
  await start(page);
  const scene = gameScene(page);
  let expectedScore = 0;
  for (let i = 0; i < 10; i++) {
    const max = i === 9 ? 150 : 100 + Math.floor(i / 3) * 10;
    expect(await battleState(page)).toMatchObject({ hp: max, max, index: i });
    await expect(scene.locator(`[data-step="${i + 1}"]`)).toHaveClass(
      /is-current/,
    );
    if (i === 9) {
      await expect(scene).toHaveClass(/is-boss/);
      await expect(hud(scene, "enemyName")).toContainText(/Boss|BOSS|魔王/);
      await expect(hud(scene, "enemyHealth")).toHaveText("150 / 150");
      expect(await page.evaluate(() => state.maxTime)).toBe(12);
    }
    await answer(page);
    expectedScore += 100 + i * 10;
    expect(await battleState(page)).toMatchObject({
      hp: max - Math.min(max, 24 + i * 7),
      score: expectedScore,
    });
    if (i === 0) await expect(hud(scene, "level")).toHaveText("Lv.2");
    await page.locator("#next").click();
  }
  await expect(page.locator("#endView")).toBeVisible();
  await expect(page.locator("#endScore")).toHaveText("1450");
  await expect(page.locator("#endReward")).toContainText("250");
  await expect(page.locator("#endLevel")).toContainText("Lv.2");
  const persisted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("spellRushProgress")),
  );
  expect(persisted.xp).toBe(725);
  expect(persisted.learned).toBe(progress.learned + 10);
  expect(persisted.legacyExtension).toEqual(progress.legacyExtension);
  await page.locator('nav [data-view="home"]').click();
  await expect(page.locator("#homeLevel")).toHaveText("Lv.2");
  expect(
    await page.locator("#homeXpBar").evaluate((el) => el.style.width),
  ).toBe("45%");
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
  await expect(hud(gameScene(page), "enemyHealth")).toHaveText("76 / 100");
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
