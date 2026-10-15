"use strict";

// Presentation for the original battle rules. No timers or answer decisions live here.
const BattleUI = (() => {
  const enemies = [
    ["词语史莱姆", 190],
    ["迷雾蝙蝠", 262],
    ["拼写哥布林", 48],
    ["语法幽灵", 310],
    ["词源巨像", 125],
    ["Boss · 遗忘魔王", 0],
  ];
  const effects = new WeakMap();
  const effectClasses = [
    "is-attacking",
    "enemy-is-hit",
    "hero-is-hit",
    "combo-burst",
    "round-enter",
  ];
  let scenes = [];

  function enemyFor(round) {
    const boss = round === 10;
    const [name, hue] = enemies[boss ? 5 : (round - 1) % 5];
    return {
      name,
      hue,
      max: boss ? 150 : 100 + Math.floor((round - 1) / 3) * 10,
      boss,
    };
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
      const enemy = enemyFor(round);
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
      ui("enemyMeta").textContent = enemy.boss
        ? "最终首领"
        : "Lv." + Math.ceil(round / 2);
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
      scene.classList.toggle("is-paused", !preview && state.paused);
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
            (step === 10 ? " Boss" : "") +
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
              ? "BOSS 来袭 · 最后一个单词，稳住！"
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
  function hit(ok, damage, streak) {
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
    if (ok && [3, 5, 8].includes(streak)) scene.classList.add("combo-burst");
    effects.set(
      scene,
      setTimeout(() => scene.classList.remove(...effectClasses), 350),
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
    enemyFor,
    level,
    render,
    newRound,
    hit,
    progress,
    reward,
  });
})();
