"use strict";

// Additive achievements: old learning records and unknown reward IDs stay intact.
const Progression = (() => {
  const stages = ["词语史莱姆", "词源巨像", "遗忘魔王"];
  const rewards = Object.freeze({
    "elite-crest": { label: "精英徽章", description: "佩戴于角色护盾栏", mark: "◇" },
    "combo-mark": { label: "金色咒矢", description: "攻击轨迹变为金色", mark: "↗" },
    "word-keeper": { label: "翡翠法袍", description: "角色换上翡翠配色", mark: "◆" },
    "boss-aura": { label: "王者印记", description: "角色脚下的通关纹章", mark: "✧" },
  });
  const ids = Object.freeze(Object.keys(rewards));

  function masteredCount(saved) {
    const latest = new Map();
    for (const row of Array.isArray(saved.seen) ? saved.seen : []) {
      if (!row || typeof row.word !== "string" || typeof row.ok !== "boolean") continue;
      const key = row.word.trim().toLowerCase();
      if (!key) continue;
      const timestamp = Number(row.ts) || 0;
      const previous = latest.get(key);
      if (!previous || timestamp >= previous.timestamp)
        latest.set(key, { timestamp, ok: row.ok });
    }
    return [...latest.values()].filter((row) => row.ok).length;
  }

  function defeatedStages(saved) {
    const defeated = Array.isArray(saved.defeatedEncounters) ? saved.defeatedEncounters : [];
    return stages.filter((name) => defeated.includes(name));
  }

  function sync(saved) {
    if (!Array.isArray(saved.unlockedCosmetics)) saved.unlockedCosmetics = [];
    if (!Array.isArray(saved.defeatedEncounters)) saved.defeatedEncounters = [];
    const defeated = defeatedStages(saved);
    const nextIndex = stages.findIndex((name) => !defeated.includes(name));
    // Keep the existing storage field; the page labels the three steps as one chapter.
    saved.chapter = nextIndex === -1 ? 3 : nextIndex + 1;
    const eligible = [
      ["elite-crest", defeated.includes(stages[1])],
      ["combo-mark", Number(saved.bestStreak) >= 5],
      ["word-keeper", masteredCount(saved) >= 20],
      ["boss-aura", defeated.includes(stages[2])],
    ];
    const unlocked = [];
    for (const [id, earned] of eligible) {
      if (earned && !saved.unlockedCosmetics.includes(id)) {
        saved.unlockedCosmetics.push(id);
        unlocked.push(id);
      }
    }
    return unlocked;
  }

  function rewardLabel(id) {
    return rewards[id]?.label || "收藏奖励";
  }

  function render(saved) {
    const byId = (id) => document.getElementById(id);
    if (!byId("chapterLabel")) return;
    const defeated = defeatedStages(saved);
    const unlocked = Array.isArray(saved.unlockedCosmetics) ? saved.unlockedCosmetics : [];
    const next = stages.find((name) => !defeated.includes(name));
    const complete = defeated.includes(stages[2]);
    byId("chapterLabel").textContent = "CHAPTER 01 · 遗迹试炼";
    byId("chapterProgress").textContent = defeated.length + " / 3 已击败";
    byId("chapterMarks").innerHTML = stages.map((name, i) => {
      const done = defeated.includes(name);
      return '<span class="chapter-step ' + (done ? "is-done" : name === next ? "is-current" : "") + '">' +
        '<b aria-hidden="true">' + (done ? "✓" : i + 1) + "</b><span>" +
        ["普通", "精英", "Boss"][i] + "<small>" + name + "</small></span>" +
        '<span class="sr-only">' + (done ? "已击败" : name === next ? "下一个目标" : "未击败") + "</span></span>";
    }).join("");
    byId("chapterNext").textContent = complete
      ? "遗迹已通关 · 每局从普通战重新挑战"
      : "下一目标：" + next + " · 每局从普通战出发";
    byId("chapterReward").textContent = complete
      ? "王者印记已装备 · 再挑战，积累更多词汇"
      : "通关奖励：100 XP + 王者印记";

    const goals = [
      { label: "首次击败精英", value: defeated.includes(stages[1]) ? 1 : 0, total: 1, id: "elite-crest" },
      { label: "达成 5 连击", value: Math.min(5, Math.max(0, Number(saved.bestStreak) || 0)), total: 5, id: "combo-mark" },
      { label: "掌握 20 个不同单词", value: Math.min(20, masteredCount(saved)), total: 20, id: "word-keeper" },
    ];
    byId("journeyGoals").innerHTML = goals.map((goal) => {
      const done = unlocked.includes(goal.id);
      return '<li class="journey-goal ' + (done ? "is-done" : "") + '"><span>' +
        goal.label + '<small>解锁 ' + rewardLabel(goal.id) + "</small></span><strong>" +
        (done ? "已达成" : goal.value + " / " + goal.total) + "</strong></li>";
    }).join("");
    byId("collectionCount").textContent = ids.filter((id) => unlocked.includes(id)).length + " / " + ids.length;
    byId("cosmeticCollection").innerHTML = ids.map((id) => {
      const earned = unlocked.includes(id);
      const reward = rewards[id];
      return '<li class="collection-item ' + id + (earned ? " is-unlocked" : "") + '">' +
        '<span class="collection-swatch" aria-hidden="true">' + reward.mark + "</span><span>" + reward.label +
        "<small>" + (earned ? reward.description : "尚未解锁") + "</small></span><b>" + (earned ? "已装备" : "待解锁") + "</b></li>";
    }).join("");
  }

  return Object.freeze({ sync, render, rewardLabel, ids, masteredCount });
})();
