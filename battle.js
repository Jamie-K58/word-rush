"use strict";

// Battle presentation only. Encounter state and answer decisions stay in game.js.
const BattleUI = (() => {
  const encounters = [
    { name: "词语史莱姆", hue: 190, stage: "普通战", max: 90, attack: 32, reward: 30 },
    { name: "词源巨像", hue: 125, stage: "精英战", max: 120, attack: 44, reward: 60 },
    {
      name: "遗忘魔王",
      hue: 0,
      stage: "BOSS 战",
      // Stage-scaled attacks let a broken combo recover within ten turns.
      max: 200,
      attack: 56,
      reward: 100,
      boss: true,
    },
  ];
  const effects = new WeakMap();
  const effectClasses = [
    "is-attacking",
    "enemy-is-hit",
    "hero-is-hit",
    "combo-burst",
    "combo-super",
    "round-enter",
    "enemy-defeated",
    "boss-entrance",
  ];
  let scenes = [];

  function encounterFor(index) {
    return encounters[Math.max(0, Math.min(encounters.length - 1, index))];
  }
  function level(xp) {
    return Math.floor(Math.max(0, Number(xp) || 0) / 500) + 1;
  }
  function shieldHtml(hearts) {
    return Array.from(
      { length: 3 },
      (_, i) =>
        '<svg class="shield ' +
        (i < hearts ? "is-active" : "is-spent") +
        '" viewBox="0 0 24 26" aria-hidden="true"><path d="M12 2 21 6v7c0 6-9 11-9 11S3 19 3 13V6z"/><path class="shield-mark" d="m8 12 3 3 5-6"/></svg>',
    ).join("");
  }
  function init() {
    scenes = [...document.querySelectorAll(".battle-scene")];
    const template = document.getElementById("battleTemplate");
    scenes.forEach((scene) => scene.append(template.content.cloneNode(true)));
  }
  function resetEffects(scene) {
    clearTimeout(effects.get(scene));
    scene.classList.remove(...effectClasses);
  }
  function render(state, progress) {
    scenes.forEach((scene) => {
      const preview = scene.dataset.preview === "true" && !state.running;
      const round = preview ? 1 : Math.min(10, state.index + 1);
      const enemy = preview
        ? encounterFor(0)
        : encounterFor(state.encounter || 0);
      const hearts = preview ? 3 : state.hearts;
      const hp = preview ? enemy.max : state.enemyHp;
      const max = preview ? enemy.max : state.enemyMax;
      const ui = (name) => scene.querySelector('[data-ui="' + name + '"]');
      ui("round").textContent =
        "ROUND " + String(round).padStart(2, "0") + " / 10";
      ui("level").textContent = "Lv." + level(progress.xp);
      ui("shields").innerHTML = shieldHtml(hearts);
      ui("shields").setAttribute("aria-label", "剩余 " + hearts + " 格护盾");
      ui("heroHp").style.width = Math.max(0, (hearts / 3) * 100) + "%";
      ui("enemyName").textContent = enemy.name;
      ui("enemyMeta").textContent = enemy.stage;
      ui("enemyHealth").textContent = hp + " / " + max;
      ui("enemyHp").style.width =
        Math.max(0, Math.min(100, (hp / max) * 100)) + "%";
      const hpTrack = ui("enemyHp").parentElement;
      hpTrack.setAttribute("aria-valuemax", max);
      hpTrack.setAttribute("aria-valuenow", hp);
      scene.querySelector(".enemy-fighter img").style.filter = enemy.boss
        ? "saturate(1.1)"
        : "hue-rotate(" + enemy.hue + "deg) saturate(.85)";
      scene.classList.toggle("is-boss", enemy.boss);
      scene.classList.toggle("is-elite", !enemy.boss && enemy === encounters[1]);
      scene.classList.toggle("is-defeated", !preview && state.enemyDefeated);
      scene.classList.toggle("is-paused", !preview && state.paused);
      const unlocked = progress.unlockedCosmetics || [];
      scene.classList.toggle("has-combo-trail", unlocked.includes("combo-mark"));
      scene.classList.toggle("has-jade-mantle", unlocked.includes("word-keeper"));
      scene.classList.toggle("has-boss-sigil", unlocked.includes("boss-aura"));
      const heroCrest = ui("heroCrest");
      if (heroCrest) heroCrest.hidden = !unlocked.includes("elite-crest");
      scene.querySelectorAll("[data-step]").forEach((node) => {
        const step = Number(node.dataset.step);
        const resolved = !preview && step <= state.answered;
        const miss = resolved && state.misses.some((m) => m.round === step);
        node.classList.toggle("is-current", step === round);
        node.classList.toggle("is-complete", resolved && !miss);
        node.classList.toggle("is-missed", miss);
        node.setAttribute(
          "aria-label",
          "第 " +
            step +
            " 回合" +
            (resolved ? (miss ? "，未命中" : "，命中") : ""),
        );
      });
      ui("callout").textContent = preview
        ? "以单词为咒语，开启你的试炼。"
        : state.paused
          ? "战斗暂停 · 护盾与时间已冻结"
          : state.phase === "feedback"
            ? state.lastBattleMessage
          : enemy.boss
              ? "BOSS 来袭 · 连击蓄势，完成最后一击！"
              : enemy.stage === "精英战"
                ? "精英战 · 护住连击，集中火力。"
              : state.streak >= 3
                ? "连击 × " + state.streak + " · 保持你的攻击节奏"
                : "看准释义，用拼写发动攻击。";
    });
  }
  function newRound() {
    scenes.forEach((scene) => {
      resetEffects(scene);
      if (scene.dataset.preview === "true") return;
      void scene.offsetWidth;
      scene.classList.add("round-enter");
      effects.set(
        scene,
        setTimeout(() => scene.classList.remove("round-enter"), 350),
      );
    });
  }
  function newEncounter(boss = false) {
    scenes.forEach((scene) => {
      resetEffects(scene);
      void scene.offsetWidth;
      scene.classList.add(boss ? "boss-entrance" : "round-enter");
      effects.set(scene, setTimeout(() => scene.classList.remove("boss-entrance", "round-enter"), 350));
    });
  }
  function hit(ok, damage, streak, defeated = false) {
    const scene = scenes.find((s) => s.dataset.preview !== "true");
    if (!scene) return;
    resetEffects(scene);
    scene.querySelector('[data-ui="damage"]').textContent = ok
      ? "−" + damage
      : "−1 护盾";
    void scene.offsetWidth;
    scene.classList.add(
      ...(ok ? ["is-attacking", "enemy-is-hit"] : ["hero-is-hit"]),
    );
    if (ok && streak >= 3) scene.classList.add("combo-burst");
    if (ok && streak >= 5) scene.classList.add("combo-super");
    if (ok && defeated) scene.classList.add("enemy-defeated");
    const transient = defeated
      ? effectClasses.filter((name) => name !== "enemy-defeated")
      : effectClasses;
    effects.set(
      scene,
      setTimeout(() => scene.classList.remove(...transient), 350),
    );
  }
  function progress(xp) {
    const within = Math.max(0, Number(xp) || 0) % 500;
    document.getElementById("homeLevel").textContent = "Lv." + level(xp);
    document.getElementById("homeXpText").textContent = within + " / 500 XP";
    document.getElementById("homeXpBar").style.width = within / 5 + "%";
    document
      .getElementById("homeXpTrack")
      .setAttribute("aria-valuenow", within);
  }
  function reward(before, after) {
    const upgraded = level(after) > level(before);
    document.getElementById("endLevel").textContent =
      (upgraded ? "升级！ " : "") + "Lv." + level(after);
    document.getElementById("rewardNote").textContent = upgraded
      ? "成长等级提升！当前经验 " + (after % 500) + " / 500 XP"
      : "距离下一级还需 " + (500 - (after % 500)) + " XP · 学习记录已保存";
    const bar = document.getElementById("rewardXpBar");
    bar.style.width = (upgraded ? 0 : (before % 500) / 5) + "%";
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        bar.style.width = (after % 500) / 5 + "%";
      }),
    );
  }
  return Object.freeze({
    init,
    encounterFor,
    level,
    render,
    newRound,
    newEncounter,
    hit,
    progress,
    reward,
  });
})();
