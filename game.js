"use strict";

// Keep the original storage keys and records. New fields are additive.
const store = {
  read(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      toast("浏览器未能保存数据，请导出备份。");
      return false;
    }
  },
};
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const details = (row) => WordData.details(row);
const storedProgress = store.read("spellRushProgress", {});
const saved = Object.assign(
  {
    learned: 0,
    days: 1,
    seen: [],
    xp: 0,
    daily: 0,
    dailyDate: "",
    bestStreak: 0,
    bestScore: 0,
    perfectRuns: 0,
    chapter: 1,
    defeatedEncounters: [],
    unlockedCosmetics: [],
  },
  storedProgress &&
    typeof storedProgress === "object" &&
    !Array.isArray(storedProgress)
    ? storedProgress
    : {},
);
if (!Array.isArray(saved.seen)) saved.seen = [];
if (!Array.isArray(saved.defeatedEncounters)) saved.defeatedEncounters = [];
if (!Array.isArray(saved.unlockedCosmetics)) saved.unlockedCosmetics = [];
saved.chapter = Math.max(1, Number(saved.chapter) || 1);
const storedLibraries = store.read("spellRushLibraries", []);
const libraries = Array.isArray(storedLibraries)
  ? storedLibraries.filter(
      (x) => x && typeof x.id === "string" && Array.isArray(x.words),
    )
  : [];
let legacyCustom = store.read("spellRushWords", "");
// Some old versions wrote plain text rather than a JSON-encoded string.
if (!legacyCustom) {
  try {
    legacyCustom = localStorage.getItem("spellRushWords") || "";
  } catch (_) {}
}
let customRows;
try {
  customRows = WordData.parse(
    typeof legacyCustom === "string"
      ? legacyCustom
      : JSON.stringify(legacyCustom),
  );
} catch (_) {
  customRows = [];
}
const state = {
  deck: [],
  index: 0,
  score: 0,
  streak: 0,
  bestStreak: 0,
  correct: 0,
  answered: 0,
  hearts: 3,
  enemyHp: 100,
  enemyMax: 100,
  encounter: 0,
  enemyDefeated: false,
  newEncounterPending: false,
  victory: false,
  xpEarned: 0,
  startingXp: 0,
  lastBattleMessage: "",
  maxTime: 20,
  time: 20,
  deadline: 0,
  timer: null,
  running: false,
  paused: false,
  mode: "challenge",
  phase: "idle",
  current: null,
  misses: [],
  view: "home",
  bankName: "",
  finished: false,
};
let reviewFilter = "weak",
  reviewLimit = 30,
  libraryLimit = 30,
  editingIndex = -1,
  toastTimer,
  confirmationAction = null,
  bulkBank = null;

function localDay(date = new Date()) {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}
function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").classList.add("on");
  toastTimer = setTimeout(() => $("toast").classList.remove("on"), 2600);
}
function persist() {
  return store.write("spellRushProgress", saved);
}
// Render valid records without deleting unexpected fields or older stored data.
function history() {
  return saved.seen.filter(
    (x) => x && typeof x.word === "string" && typeof x.ok === "boolean",
  );
}
function shuffle(array) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function bank() {
  const key = $("preset").value;
  return key === "custom"
    ? customRows
    : libraries.find((x) => x.id === key)?.words || BANKS[key] || [];
}
function isCustomBank() {
  return (
    $("preset").value === "custom" ||
    libraries.some((x) => x.id === $("preset").value)
  );
}
function bankName() {
  return $("preset").selectedOptions[0]?.textContent || "词库";
}
function saveBank(rows) {
  if (!isCustomBank()) return false;
  if ($("preset").value === "custom") {
    if (!store.write("spellRushWords", WordData.serialize(rows))) return false;
    customRows = rows;
  } else {
    const library = libraries.find((x) => x.id === $("preset").value);
    const previous = library.words;
    library.words = rows;
    if (!store.write("spellRushLibraries", libraries)) {
      library.words = previous;
      return false;
    }
  }
  $("customWords").value = WordData.serialize(rows);
  renderLibrary();
  updateHome();
  return true;
}
function syncPresets(value) {
  $("preset")
    .querySelectorAll("[data-user-library]")
    .forEach((x) => x.remove());
  for (const library of libraries) {
    const option = new Option(library.name, library.id);
    option.dataset.userLibrary = "true";
    $("preset").append(option);
  }
  $("preset").value = [...$("preset").options].some((x) => x.value === value)
    ? value
    : "cet4";
  $("homePreset").innerHTML = $("preset").innerHTML;
  $("homePreset").value = $("preset").value;
}
function selectBank(value) {
  $("preset").value = value;
  $("homePreset").value = value;
  store.write("spellRushPreset", value);
  libraryLimit = 30;
  $("librarySearch").value = "";
  renderLibrary();
}

// Original Web Audio feedback, kept short and opt-in through the sound control.
const sfx = {
  enabled: store.read("spellRushSound", true),
  ctx: null,
  ensure() {
    if (!this.enabled) return null;
    try {
      if (!this.ctx)
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    } catch (_) {}
    return this.ctx;
  },
  tone(f, dur, type = "sine", when = 0) {
    const c = this.ensure();
    if (!c) return;
    const o = c.createOscillator(),
      g = c.createGain(),
      t = c.currentTime + when;
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  },
  correct() {
    this.tone(523.25, 0.12);
    this.tone(783.99, 0.16, "sine", 0.09);
  },
  wrong() {
    this.tone(196, 0.18, "triangle");
  },
  over() {
    this.tone(329.63, 0.2);
    this.tone(261.63, 0.3, "sine", 0.2);
  },
};
let pronunciationAudio = null;
function speakWithSystem(word) {
  if (!word || !window.speechSynthesis || !window.SpeechSynthesisUtterance)
    return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    u.rate = 0.9;
    const voice = speechSynthesis
      .getVoices()
      .find((v) => /^en[-_]/i.test(v.lang));
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
    return true;
  } catch (_) {
    return false;
  }
}
function speakWord(word) {
  if (!word) return;
  if (speakWithSystem(word)) return;
  try {
    if (pronunciationAudio) pronunciationAudio.pause();
    const audio = new Audio(
      "https://dict.youdao.com/dictvoice?audio=" +
        encodeURIComponent(word) +
        "&type=2",
    );
    pronunciationAudio = audio;
    audio.onerror = () => toast("暂时无法发音，请稍后再试。");
    audio.play()?.catch(() => toast("暂时无法发音，请稍后再试。"));
  } catch (_) {
    toast("此浏览器暂不支持发音。");
  }
}

function stopSpeech() {
  if (pronunciationAudio) pronunciationAudio.pause();
  try {
    window.speechSynthesis?.cancel();
  } catch (_) {}
}
function showView(view, focusHeading = true) {
  const previousView = state.view;
  if (state.view === "game" && view !== "game" && state.phase === "question")
    pauseGame();
  stopSpeech();
  state.view = view;
  document.querySelectorAll("main > .view").forEach((el) => {
    el.hidden = el.id !== view + "View";
    el.classList.remove("view-enter");
  });
  const active = $(view + "View");
  active.classList.add("view-enter");
  document.querySelectorAll("nav [data-view]").forEach((el) => {
    if (
      el.dataset.view === view ||
      (["game", "end"].includes(view) && el.dataset.view === "home")
    )
      el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  document.body.dataset.view = view;
  if (view !== "game") document.body.classList.remove("keyboard-open");
  if (view === "home") updateHome();
  if (view === "review") renderReview();
  if (view === "stats") renderStats();
  if (view === "library") renderLibrary();
  if (previousView !== view) window.scrollTo({ top: 0, behavior: "instant" });
  if (focusHeading && view !== "game") {
    const h = active.querySelector("h1");
    if (h) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}
function updateHome() {
  $("homeBest").textContent = saved.bestScore || 0;
  $("homeToday").textContent = history().filter(
    (x) => x.ts && localDay(new Date(x.ts)) === localDay(),
  ).length;
  $("start").innerHTML = state.running
    ? '继续战斗 <span aria-hidden="true">→</span>'
    : '开始挑战 <span aria-hidden="true">→</span>';
  $("resumeNote").hidden = !state.running;
  $("resumeNote").textContent =
    state.phase === "feedback"
      ? "本局待继续，返回查看答案并进入下一回合。"
      : "本局已暂停，继续即可回到当前回合。";
  $("homePreset").disabled = state.running;
  const weak = reviewRecords().filter((x) => !x.last.ok).length;
  $("reviewCount").textContent = weak;
  $("reviewCount").hidden = !weak;
  if ($("chapterLabel")) {
    const defeated = saved.defeatedEncounters.length;
    const chapter = Math.min(3, Math.max(1, saved.chapter || 1));
    $("chapterLabel").textContent = "CHAPTER " + chapter;
    $("chapterProgress").textContent =
      defeated + " / 3 怪物已击败 · " +
      (chapter >= 3
        ? "Boss 徽记已解锁"
        : "下一目标：" + (chapter === 1 ? "词语史莱姆" : "遗忘魔王"));
    $("chapterMarks").innerHTML = ["词语史莱姆", "词源巨像", "遗忘魔王"]
      .map(
        (name, i) =>
          '<span class="' +
          (saved.defeatedEncounters.includes(name) ? "is-done" : "") +
          (i + 1 === chapter ? " is-current" : "") +
          '">' +
          (saved.defeatedEncounters.includes(name) ? "✓" : i + 1) +
          "</span>",
      )
      .join("");
  }
  if (window.Progression) Progression.render(saved);
  BattleUI.progress(saved.xp);
  BattleUI.render(state, saved);
}

function learningHtml(row, masked = false) {
  const d = details(row);
  const senses = d.senses?.length
    ? d.senses
    : [{ pos: d.pos, meaning: d.meaning, examples: d.examples }];
  const seenExamples = new Set();
  const body = senses
    .map((s) => {
      const examples = Array.isArray(s.examples) ? s.examples : [];
      examples.forEach((e) => seenExamples.add(e));
      return (
        '<div class="sense"><div class="sense-meta"><span class="pos">' +
        escapeHtml(s.pos || "词性未标注") +
        '</span><span class="meaning-copy">' +
        escapeHtml(s.meaning || d.meaning) +
        "</span></div>" +
        examples
          .map(
            (e) =>
              '<p class="example-line" lang="en">' +
              escapeHtml(masked ? WordData.mask(e, d.word) : e) +
              "</p>",
          )
          .join("") +
        "</div>"
      );
    })
    .join("");
  const extra = (d.examples || []).filter((e) => !seenExamples.has(e));
  return (
    '<div class="word-learning">' +
    body +
    (extra.length
      ? '<div class="entry-examples"><span class="eyebrow">词条例句</span>'
      : "") +
    extra
      .map(
        (e) =>
          '<p class="example-line" lang="en">' +
          escapeHtml(masked ? WordData.mask(e, d.word) : e) +
          "</p>",
      )
      .join("") +
    (extra.length ? "</div>" : "") +
    (!(d.examples || []).length
      ? '<p class="missing-data">此词条暂未收录例句</p>'
      : "") +
    "</div>"
  );
}
function setEnabled(on) {
  ["answer", "submit", "speak", "skip", "letterHint"].forEach(
    (id) => ($(id).disabled = !on),
  );
}
function stats() {
  $("round").textContent =
    "ROUND " + String(state.index + 1).padStart(2, "0") + " / 10";
  $("score").textContent = state.score;
  $("streak").textContent = "× " + String(state.streak).padStart(2, "0");
  $("accuracy").textContent = state.answered
    ? Math.round((state.correct / state.answered) * 100) + "%"
    : "—";
  BattleUI.render(state, saved);
  $("pause").disabled =
    !state.running || !["question", "paused"].includes(state.phase);
  $("pause").textContent = state.paused ? "▷" : "Ⅱ";
  $("pause").setAttribute("aria-label", state.paused ? "继续游戏" : "暂停游戏");
}
function timerBar() {
  const p = Math.max(0, Math.min(100, (state.time / state.maxTime) * 100));
  $("timerBar").style.width = p + "%";
  $("timeText").textContent =
    "00:" + String(Math.max(0, Math.ceil(state.time))).padStart(2, "0");
  $("timer").classList.toggle("urgent", state.time <= 5);
  $("timer").setAttribute("aria-valuemax", state.maxTime);
  $("timer").setAttribute("aria-valuenow", Math.max(0, Math.ceil(state.time)));
}
function question() {
  if (!state.running) return;
  if (state.index >= 10 || !state.deck.length) return finish();
  clearInterval(state.timer);
  state.current = state.deck[state.index % state.deck.length];
  state.phase = "question";
  state.paused = false;
  const d = details(state.current),
    r = state.index + 1;
  // Enemy health belongs to the encounter, so moving to a new question does
  // not heal the current enemy. A new encounter is initialized by next().
  const enemy = BattleUI.encounterFor(state.encounter || 0);
  state.lastBattleMessage = "";
  state.maxTime = r >= 10 ? 12 : r >= 7 ? 15 : 20;
  state.time = state.maxTime;
  state.deadline = Date.now() + state.time * 1000;
  $("modeLabel").textContent =
    state.mode === "review" ? "错题复习" : state.bankName;
  $("meaning").textContent = d.meaning;
  $("meaning").scrollTop = 0;
  $("partOfSpeech").textContent = d.pos || "词性未标注";
  $("letterCount").textContent =
    d.word.replace(/[^a-z]/gi, "").length + " LETTERS";
  $("answer").value = "";
  $("exampleHint").open = false;
  $("letterHint").textContent = "首字母提示";
  $("hintExamples").innerHTML = d.examples.length
    ? d.examples
        .map(
          (e) =>
            '<p class="example-line" lang="en">' +
            escapeHtml(WordData.mask(e, d.word)) +
            "</p>",
        )
        .join("")
    : '<p class="missing-data">此词条暂未收录例句。可通过听发音获得提示。</p>';
  $("feedback").hidden = true;
  $("feedback").innerHTML = "";
  $("questionArea").hidden = false;
  $("pausedPanel").hidden = true;
  $("inputRow").classList.remove("shake");
  $("battleTip").textContent = enemy.boss
    ? "BOSS 战 · 生命值跨题保留，完成最后一击。"
    : "拼对单词发动攻击，连续命中提升伤害。";
  if (state.newEncounterPending) {
    state.newEncounterPending = false;
    BattleUI.newEncounter(!!enemy.boss);
  } else {
    BattleUI.newRound();
  }
  setEnabled(true);
  stats();
  timerBar();
  $("questionArea").classList.remove("view-enter");
  void $("questionArea").offsetWidth;
  $("questionArea").classList.add("view-enter");
  state.timer = setInterval(tick, 100);
  window.scrollTo({ top: 0, behavior: "instant" });
  $("answer").focus({ preventScroll: true });
}
function tick() {
  if (!state.running || state.paused || state.phase !== "question") return;
  state.time = Math.max(0, (state.deadline - Date.now()) / 1000);
  timerBar();
  if (state.time <= 0) resolve(false, "timeout");
}
function calcGain() {
  return 100 + Math.min(100, state.streak * 10);
}
function enterEncounter(index) {
  const encounter = BattleUI.encounterFor(index);
  state.encounter = Math.max(0, Math.min(2, Number(index) || 0));
  state.enemyMax = encounter.max;
  state.enemyHp = encounter.max;
  state.enemyDefeated = false;
  state.newEncounterPending = true;
}
function pushSeen(word, ok) {
  saved.seen.push({ word, ok, ts: Date.now() });
  saved.wordEntries =
    saved.wordEntries && typeof saved.wordEntries === "object"
      ? saved.wordEntries
      : {};
  Object.defineProperty(saved.wordEntries, word, {
    value: state.current,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
function floatScore(gain) {
  const el = document.createElement("span");
  el.className = "float-score";
  el.textContent = "+" + gain;
  $("gamePanel").append(el);
  setTimeout(() => el.remove(), 350);
}
function answerDifference(value, correct) {
  // Character alignment keeps insertions and omissions readable without penalizing shifted letters.
  const a = [...value].slice(0, 150),
    b = [...correct].slice(0, 150),
    dp = Array.from({ length: a.length + 1 }, () =>
      new Array(b.length + 1).fill(0),
    );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] +
          (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1),
      );
  const out = [];
  let i = a.length,
    j = b.length;
  while (i || j) {
    if (
      i &&
      j &&
      dp[i][j] ===
        dp[i - 1][j - 1] +
          (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1)
    ) {
      out.push(
        a[i - 1].toLowerCase() === b[j - 1].toLowerCase()
          ? escapeHtml(a[i - 1])
          : '<mark class="diff-wrong">' + escapeHtml(a[i - 1]) + "</mark>",
      );
      i--;
      j--;
    } else if (i && dp[i][j] === dp[i - 1][j] + 1) {
      out.push('<mark class="diff-wrong">' + escapeHtml(a[--i]) + "</mark>");
    } else {
      out.push('<span class="diff-missing" aria-label="缺少字符">_</span>');
      j--;
    }
  }
  return out.reverse().join("");
}
function resolve(ok, reason = "answer") {
  if (!state.running || state.phase !== "question" || state.paused) return;
  // A delayed submit can arrive after the browser has not fired the timer tick.
  // The deadline is authoritative, so it must never score as a correct answer.
  if (reason !== "timeout" && state.deadline && Date.now() >= state.deadline)
    return resolve(false, "timeout");
  clearInterval(state.timer);
  state.phase = "feedback";
  setEnabled(false);
  stopSpeech();
  state.answered++;
  const d = details(state.current),
    typed = $("answer").value.trim();
  let gain = 0,
    damage = 0,
    defeated = false,
    encounter = BattleUI.encounterFor(state.encounter || 0);
  if (ok) {
    gain = calcGain();
    const nextStreak = state.streak + 1;
    const comboMultiplier =
      nextStreak >= 5 ? 1.5 : nextStreak >= 3 ? 1.25 : 1;
    // Combo milestones add burst damage. Clamp the final hit to the remaining
    // HP so the floating number communicates the actual amount removed.
    damage = Math.min(
      state.enemyHp,
      Math.round(encounter.attack * comboMultiplier),
    );
    state.enemyHp = Math.max(0, state.enemyHp - damage);
    defeated = state.enemyHp <= 0;
    state.enemyDefeated = defeated;
    state.correct++;
    state.streak++;
    state.score += gain;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    const today = localDay();
    if (saved.dailyDate !== today) {
      saved.daily = 0;
      saved.dailyDate = today;
    }
    saved.daily = (saved.daily || 0) + 1;
    const earnedXp = 25 + (defeated ? encounter.reward || 0 : 0);
    state.xpEarned += earnedXp;
    saved.xp = (saved.xp || 0) + earnedXp;
    saved.learned = (saved.learned || 0) + 1;
    saved.bestStreak = Math.max(saved.bestStreak || 0, state.streak);
    state.lastBattleMessage =
      (defeated
        ? "击败 " + encounter.name + "！+" + (encounter.reward || 0) + " XP · "
        : [3, 5, 8].includes(state.streak)
        ? "连击突破 × " + state.streak + " · "
        : "命中！ ") +
      "造成 " +
      damage +
      " 点伤害";
    sfx.correct();
    floatScore(gain);
    $("streak").classList.remove("combo-pop");
    void $("streak").offsetWidth;
    $("streak").classList.add("combo-pop");
  } else {
    state.streak = 0;
    state.hearts--;
    state.misses.push({
      entry: state.current,
      word: d.word,
      meaning: d.meaning,
      answer: typed,
      reason,
      round: state.index + 1,
    });
    state.lastBattleMessage =
      "护盾 −1 · " +
      (state.hearts
        ? "看清答案，下一回合再出击。"
        : "护盾耗尽，本次试炼结束。");
    sfx.wrong();
  }
  pushSeen(d.word, ok);
  persist();
  stats();
  BattleUI.hit(ok, damage, state.streak, defeated);
  $("questionArea").hidden = true;
  if (defeated && encounter.boss) state.victory = true;
  if (defeated) {
    if (!saved.defeatedEncounters.includes(encounter.name))
      saved.defeatedEncounters.push(encounter.name);
    saved.chapter = Math.max(saved.chapter || 1, Math.min(3, state.encounter + 2));
    if (state.encounter === 1 && !saved.unlockedCosmetics.includes("elite-crest"))
      saved.unlockedCosmetics.push("elite-crest");
    if (encounter.boss && !saved.unlockedCosmetics.includes("boss-aura"))
      saved.unlockedCosmetics.push("boss-aura");
  }
  if (state.streak >= 5 && !saved.unlockedCosmetics.includes("combo-mark"))
    saved.unlockedCosmetics.push("combo-mark");
  if (window.Progression) Progression.sync(saved);
  if (defeated && encounter.boss) state.victory = true;
  persist();
  const end =
    state.hearts <= 0 || state.victory || state.index + 1 >= 10;
  const nextEncounter = defeated
    ? BattleUI.encounterFor(state.encounter + 1)
    : null;
  const nextLabel = end
    ? "查看战果"
    : defeated
      ? nextEncounter.boss
        ? "挑战 Boss"
        : "进入精英战"
      : "下一回合";
  $("feedback").className = "feedback " + (ok ? "good" : "bad") + " view-enter";
  $("feedback").innerHTML =
    '<div class="feedback-head"><span class="feedback-symbol" aria-hidden="true">' +
    (ok ? "✓" : "×") +
    '</span><span class="eyebrow">' +
    (ok
      ? "命中 · CORRECT"
      : reason === "timeout"
        ? "TIME IS UP"
        : reason === "skip"
          ? "SKIPPED"
          : "NOT QUITE") +
    "</span></div>" +
    (!ok
      ? '<div class="your-answer"><span class="eyebrow">YOUR ANSWER</span><div class="answer-diff">' +
        (typed
          ? answerDifference(typed, d.word)
          : reason === "timeout"
            ? "未作答 · 时间到"
            : "已跳过") +
        '</div></div><span class="eyebrow">CORRECT SPELLING</span>'
      : "") +
    '<h2 class="feedback-word" lang="en">' +
    escapeHtml(d.word) +
    "</h2>" +
    learningHtml(state.current) +
    '<div class="feedback-footer"><div>' +
    (ok
      ? '<strong class="feedback-gain">+' +
        gain +
        '</strong><span class="feedback-xp">+' +
        (25 + (defeated ? encounter.reward || 0 : 0)) +
        ' XP</span>'
      : "") +
    '<span class="feedback-combo">COMBO × ' +
    String(state.streak).padStart(2, "0") +
    '</span></div><button class="primary" id="next">' +
    nextLabel +
    ' <span>→</span></button></div><button class="text-button pronunciation" data-pronounce="' +
    escapeHtml(d.word) +
    '">↗ 听发音</button>';
  $("feedback").hidden = false;
  // No auto-advance: examples remain available until the player explicitly continues.
  $("next").onclick = () => {
    if (state.phase !== "feedback") return;
    if (end) finish();
    else {
      state.index++;
      if (state.enemyDefeated) enterEncounter(state.encounter + 1);
      question();
    }
  };
  if (!ok) {
    $("feedback").classList.add("shake");
    setTimeout(() => $("feedback").classList.remove("shake"), 220);
  }
  $("next").focus({ preventScroll: true });
}
function pauseGame() {
  if (!state.running || state.phase !== "question") return;
  state.time = Math.max(0, (state.deadline - Date.now()) / 1000);
  if (state.time <= 0) {
    resolve(false, "timeout");
    return;
  }
  clearInterval(state.timer);
  state.paused = true;
  state.phase = "paused";
  setEnabled(false);
  stopSpeech();
  $("questionArea").hidden = true;
  $("pausedPanel").hidden = false;
  stats();
  timerBar();
}
function resumeGame() {
  if (!state.running || state.phase !== "paused") return;
  state.paused = false;
  state.phase = "question";
  state.deadline = Date.now() + state.time * 1000;
  $("pausedPanel").hidden = true;
  $("questionArea").hidden = false;
  setEnabled(true);
  stats();
  state.timer = setInterval(tick, 100);
  $("answer").focus({ preventScroll: true });
}
function begin(mode = "challenge") {
  if (state.running) {
    showView("game", false);
    if (state.phase === "paused") resumeGame();
    else if (state.phase === "feedback")
      $("next")?.focus({ preventScroll: true });
    else if (state.phase === "question")
      $("answer").focus({ preventScroll: true });
    return;
  }
  let rows = bank();
  if (mode === "review") {
    const weak = reviewRecords()
      .filter((x) => !x.last.ok)
      .map((x) => x.row);
    if (weak.length) rows = weak;
    else {
      const known = new Set(history().map((x) => x.word));
      rows = rows.filter((x) => !known.has(details(x).word));
      toast("暂无错题，先复习未练过的词。");
    }
  }
  if (!rows.length) {
    toast("词库为空，请先添加或选择其他词库。");
    showView("library");
    return;
  }
  clearInterval(state.timer);
  Object.assign(state, {
    deck: shuffle(rows),
    index: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,
    correct: 0,
    answered: 0,
    hearts: 3,
    enemyHp: BattleUI.encounterFor(0).max,
    enemyMax: BattleUI.encounterFor(0).max,
    encounter: 0,
    enemyDefeated: false,
    newEncounterPending: false,
    victory: false,
    xpEarned: 0,
    startingXp: saved.xp || 0,
    lastBattleMessage: "",
    misses: [],
    running: true,
    paused: false,
    mode,
    phase: "question",
    finished: false,
    bankName: bankName(),
  });
  sfx.ensure();
  showView("game", false);
  question();
}
function submit() {
  if (state.phase !== "question" || state.paused || !state.running) return;
  const v = $("answer").value.trim().toLowerCase().replace(/\s+/g, " ");
  if (state.deadline && Date.now() >= state.deadline) {
    resolve(false, "timeout");
    return;
  }
  if (!v) {
    toast("先输入答案");
    return;
  }
  resolve(v === details(state.current).word.toLowerCase().replace(/\s+/g, " "));
}
function finish() {
  if (!state.running || state.finished) return;
  clearInterval(state.timer);
  state.finished = true;
  state.running = false;
  state.paused = false;
  state.phase = "ended";
  stopSpeech();
  setEnabled(false);
  const oldBest = saved.bestScore || 0;
  saved.bestScore = Math.max(oldBest, state.score);
  saved.days = Math.min(21, (saved.days || 1) + (state.correct >= 6 ? 1 : 0));
  if (state.victory && state.correct === state.answered)
    saved.perfectRuns = (saved.perfectRuns || 0) + 1;
  saved.runs = (saved.runs || 0) + 1;
  persist();
  const completed = state.victory;
  $("endView").classList.toggle("is-victory", completed);
  $("endKicker").textContent = completed ? "TRIAL COMPLETE" : "RUN COMPLETE";
  $("endTitle").textContent =
    state.mode === "review"
      ? "复习完成"
      : completed
        ? "试炼完成！"
        : state.hearts <= 0
          ? "休整，再出发。"
          : state.encounter === 2
            ? "Boss 还未倒下"
            : "继续推进，别停在这里";
  $("endScore").textContent = state.score;
  $("endCorrect").textContent = state.correct + " / " + state.answered;
  $("endCombo").textContent = state.bestStreak;
  $("endBest").textContent = saved.bestScore;
  $("newBest").hidden = state.score <= oldBest;
  $("endReward").textContent =
    "+" +
    state.xpEarned +
    " XP · " +
    Math.round((state.correct / Math.max(1, state.answered)) * 100) +
    "% 命中率";
  $("missCount").textContent = state.misses.length;
  $("endMistakes").open = false;
  $("missList").innerHTML = state.misses.length
    ? state.misses.map((m, i) => wordRow(m.entry, i, "miss", false)).join("")
    : '<div class="empty-state"><h3>这一局，全部记住了。</h3><p>没有需要复习的错题。</p></div>';
  $("endReview").disabled = !state.misses.length;
  showView("end");
  BattleUI.reward(state.startingXp, saved.xp || 0);
  sfx.over();
  updateHome();
}

function allWordMap() {
  const map = new Map();
  const quality = (d) =>
    d.examples.length * 100 +
    d.senses.length * 2 +
    (d.pos !== "词性未标注" ? 1 : 0);
  [
    ...Object.values(BANKS).flat(),
    ...customRows,
    ...libraries.flatMap((x) => x.words),
  ].forEach((row) => {
    const d = details(row);
    if (!d.word) return;
    const old = map.get(d.word);
    if (!old || quality(details(old)) < quality(d)) map.set(d.word, row);
  });
  return map;
}
function reviewRecords() {
  const records = new Map();
  history().forEach((last) => {
    const old = records.get(last.word);
    if (!old || Number(last.ts || 0) >= Number(old.last.ts || 0))
      records.set(last.word, { last, row: null });
  });
  const words = allWordMap();
  return [...records]
    .map(([word, record]) => ({
      ...record,
      row: saved.wordEntries?.[word] ||
        words.get(word) || [word, "释义暂未收录", ""],
    }))
    .sort((a, b) => Number(b.last.ts || 0) - Number(a.last.ts || 0));
}
function wordRow(row, index, context, editable = false) {
  const d = details(row);
  const last = history()
      .reverse()
      .find((x) => x.word === d.word),
    status = last ? (last.ok ? "已掌握" : "待巩固") : "未练习";
  return (
    '<article class="word-row"><div class="word-row-heading"><h3 lang="en">' +
    escapeHtml(d.word) +
    '</h3><span class="word-state ' +
    (last?.ok ? "mastered" : last ? "weak" : "") +
    '">' +
    status +
    "</span></div>" +
    learningHtml(row) +
    '<div class="row-actions"><button class="text-button" data-pronounce="' +
    escapeHtml(d.word) +
    '" aria-label="听 ' +
    escapeHtml(d.word) +
    ' 的发音">↗ 听发音</button>' +
    (editable
      ? '<button class="text-button" data-edit="' +
        index +
        '">编辑</button><button class="text-button danger" data-delete="' +
        index +
        '">删除</button>'
      : "") +
    "</div></article>"
  );
}
function matchesSearch(row, value) {
  const d = details(row);
  return (d.word + " " + d.meaning + " " + d.pos + " " + d.examples.join(" "))
    .toLowerCase()
    .includes(value.toLowerCase());
}
function renderReview() {
  const records = reviewRecords(),
    weak = records.filter((x) => !x.last.ok);
  $("weakCount").textContent = weak.length;
  $("reviewStart").disabled = state.running || (!weak.length && !bank().length);
  const search = $("reviewSearch").value.trim();
  const filtered = records.filter(
    (x) =>
      (reviewFilter === "all" ||
        (reviewFilter === "weak" ? !x.last.ok : x.last.ok)) &&
      matchesSearch(x.row, search),
  );
  $("reviewList").innerHTML =
    filtered
      .slice(0, reviewLimit)
      .map((x, i) => wordRow(x.row, i, "review"))
      .join("") ||
    '<div class="empty-state"><span class="empty-symbol">↗</span><h3>' +
      (search
        ? "没有找到这个单词"
        : reviewFilter === "weak"
          ? "暂时没有待巩固的词"
          : "还没有练习记录") +
      "</h3><p>" +
      (search ? "换一个拼写或释义试试。" : "每次练习都会在这里留下记录。") +
      '</p><button class="text-button" data-view="home">去练一局 →</button></div>';
  $("reviewMore").hidden = filtered.length <= reviewLimit;
  updateHome();
}
function renderLibrary() {
  const rows = bank(),
    editable = isCustomBank();
  $("customTools").hidden = !editable;
  $("bankCount").textContent = rows.length + " WORDS";
  if (bulkBank !== $("preset").value) {
    $("customWords").value = editable ? WordData.serialize(rows) : "";
    bulkBank = $("preset").value;
  }
  const search = $("librarySearch").value.trim();
  const filtered = rows
    .map((row, index) => ({ row, index }))
    .filter((x) => matchesSearch(x.row, search));
  $("libraryList").innerHTML =
    filtered
      .slice(0, libraryLimit)
      .map((x) => wordRow(x.row, x.index, "library", editable))
      .join("") ||
    '<div class="empty-state"><h3>' +
      (search ? "没有匹配的词条" : "词库还是空白的") +
      "</h3><p>" +
      (search ? "换个关键词试试。" : "添加第一个单词，或导入已有词表。") +
      "</p></div>";
  $("libraryMore").hidden = filtered.length <= libraryLimit;
}
function renderStats() {
  const seen = history(),
    good = seen.filter((x) => x.ok),
    unique = new Set(seen.map((x) => x.word));
  $("statWords").textContent = unique.size;
  $("statAccuracy").textContent = seen.length
    ? Math.round((good.length / seen.length) * 100) + "%"
    : "—";
  $("statCombo").textContent = saved.bestStreak || 0;
  $("statBest").textContent = saved.bestScore || 0;
  $("learned").textContent = saved.learned || 0;
  $("days").textContent = (saved.days || 1) + " / 21";
  $("xpText").textContent = (saved.xp || 0) + " XP";
  $("statLevel").textContent = "Lv." + BattleUI.level(saved.xp);
  $("dailyGoal").textContent =
    (saved.dailyDate === localDay() ? saved.daily || 0 : 0) + " / 5";
  $("perfectRuns").textContent = saved.perfectRuns || 0;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { date: d, key: localDay(d) };
  });
  const counts = days.map(
      (d) =>
        seen.filter((x) => x.ts && localDay(new Date(x.ts)) === d.key).length,
    ),
    max = Math.max(1, ...counts);
  $("trendChart").innerHTML = days
    .map(
      (d, i) =>
        '<div class="trend-day ' +
        (i === 6 ? "today" : "") +
        '"><span class="trend-value">' +
        counts[i] +
        '</span><div class="trend-track"><i style="--bar:' +
        (counts[i] / max) * 100 +
        '%"></i></div><span class="trend-date">' +
        (i === 6
          ? "今天"
          : String(d.date.getMonth() + 1).padStart(2, "0") +
            "." +
            String(d.date.getDate()).padStart(2, "0")) +
        "</span></div>",
    )
    .join("");
  $("trendChart").setAttribute(
    "aria-label",
    days.map((d, i) => d.key + "：" + counts[i] + " 次练习").join("；"),
  );
  const achievements = [
    ["第一次拼对", saved.learned || 0, 1],
    ["连续拼对 5 词", saved.bestStreak || 0, 5],
    ["今日答对 5 词", saved.dailyDate === localDay() ? saved.daily || 0 : 0, 5],
    ["答对 10 个不同单词", new Set(good.map((x) => x.word)).size, 10],
    ["一局十题全对", saved.perfectRuns || 0, 1],
    ["累计答对 50 词", saved.learned || 0, 50],
  ];
  $("achievements").innerHTML = achievements
    .map(
      ([label, value, target]) =>
        '<div class="milestone-row ' +
        (value >= target ? "done" : "") +
        '"><span>' +
        (value >= target ? "✓ " : "") +
        label +
        "</span><b>" +
        Math.min(value, target) +
        " / " +
        target +
        "</b></div>",
    )
    .join("");
}

function download(name, body) {
  const url = URL.createObjectURL(
      new Blob([body], { type: "application/json;charset=utf-8" }),
    ),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function confirmAction(title, text, callback) {
  confirmationAction = callback;
  $("confirmTitle").textContent = title;
  $("confirmText").textContent = text;
  $("confirmDialog").showModal();
}
function editWord(index = -1) {
  editingIndex = index;
  const row = index >= 0 ? bank()[index] : null,
    d = row ? details(row) : null;
  $("wordEditorTitle").textContent = row ? "编辑单词." : "添加单词.";
  $("editWord").value = d?.word || "";
  $("editPos").value = d?.pos === "词性未标注" ? "" : d?.pos || "";
  $("editMeaning").value = d?.meaning || "";
  $("editExamples").value = d?.examples.join("\n") || "";
  // Complex entries use the complete source to avoid flattening sense relationships.
  const complex =
    !!row &&
    (d.senses.length > 1 ||
      d.examples.some((x) => /[\r\n]/.test(x)) ||
      (Array.isArray(row)
        ? row.length > 4
        : Object.keys(row).some(
            (k) =>
              !["word", "pos", "meaning", "examples", "example"].includes(k),
          )));
  $("editJson").value = complex ? JSON.stringify(row, null, 2) : "";
  $("advancedWordEditor").open = !!complex;
  ["editWord", "editPos", "editMeaning", "editExamples"].forEach(
    (id) => ($(id).disabled = !!complex),
  );
  $("wordError").textContent = "";
  $("wordDialog").showModal();
  (complex ? $("editJson") : $("editWord")).focus();
}
function guardBankEdit(action) {
  if (state.running) {
    toast("请先完成当前游戏，再修改词库。");
    return;
  }
  action();
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest("button[data-view]");
  if (nav) {
    showView(nav.dataset.view);
    return;
  }
  const pronounce = e.target.closest("[data-pronounce]");
  if (pronounce) {
    speakWord(pronounce.dataset.pronounce);
    return;
  }
  const edit = e.target.closest("[data-edit]");
  if (edit) {
    guardBankEdit(() => editWord(Number(edit.dataset.edit)));
    return;
  }
  const remove = e.target.closest("[data-delete]");
  if (remove)
    guardBankEdit(() => {
      const index = Number(remove.dataset.delete);
      confirmAction(
        "删除这个词条？",
        details(bank()[index]).word + " 的学习记录会保留。",
        () => saveBank(bank().filter((_, i) => i !== index)),
      );
    });
});
$("start").onclick = () => begin();
$("libraryPlay").onclick = () => begin();
$("reviewStart").onclick = () => begin("review");
$("restart").onclick = () => begin(state.mode);
$("answerForm").onsubmit = (e) => {
  e.preventDefault();
  if (!composing) submit();
};
// Ignore IME confirmation; Enter becomes a submission only after composition ends.
let composing = false;
$("answer").addEventListener("compositionstart", () => (composing = true));
$("answer").addEventListener("compositionend", () => (composing = false));
$("answer").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.isComposing || composing || e.keyCode === 229))
    e.preventDefault();
});
$("skip").onclick = () => resolve(false, "skip");
$("speak").onclick = () => {
  if (state.phase === "question") speakWord(details(state.current).word);
};
$("pause").onclick = () => (state.paused ? resumeGame() : pauseGame());
$("resume").onclick = resumeGame;
$("endEarly").onclick = finish;
$("endReview").onclick = () => {
  reviewFilter = "weak";
  document
    .querySelectorAll("[data-review-filter]")
    .forEach((x) =>
      x.setAttribute("aria-pressed", x.dataset.reviewFilter === reviewFilter),
    );
  showView("review");
};
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    !e.repeat &&
    state.view === "game" &&
    !document.querySelector("dialog[open]")
  ) {
    if (state.phase === "question") pauseGame();
    else if (state.phase === "paused") resumeGame();
  }
});
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Enter" && e.repeat) e.preventDefault();
  },
  true,
);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseGame();
});
window.addEventListener("pagehide", () => {
  pauseGame();
});
// Safari may keep the layout viewport tall while its keyboard covers the bottom.
window.visualViewport?.addEventListener("resize", () => {
  requestAnimationFrame(() => {
    const viewport = window.visualViewport;
    document.body.classList.toggle(
      "keyboard-open",
      state.view === "game" &&
        document.activeElement === $("answer") &&
        viewport.height < innerHeight * 0.8,
    );
    if (
      state.view !== "game" ||
      state.phase !== "question" ||
      document.activeElement !== $("answer") ||
      viewport.height >= innerHeight * 0.8
    )
      return;
    const overflow =
      $("answer").getBoundingClientRect().bottom -
      (viewport.offsetTop + viewport.height - 20);
    if (overflow > 0) window.scrollBy({ top: overflow, behavior: "instant" });
  });
});
$("preset").onchange = () => selectBank($("preset").value);
$("homePreset").onchange = () => selectBank($("homePreset").value);
$("help").onclick = () => {
  pauseGame();
  $("helpDialog").showModal();
};
$("helpClose").onclick = () => {
  store.write("spellRushHelpSeen", 1);
  $("helpDialog").close();
};
$("soundToggle").checked = sfx.enabled;
$("soundState").textContent = sfx.enabled ? "ON" : "OFF";
$("soundToggle").onchange = (e) => {
  sfx.enabled = e.target.checked;
  store.write("spellRushSound", sfx.enabled);
  $("soundState").textContent = sfx.enabled ? "ON" : "OFF";
  if (sfx.enabled) sfx.correct();
};
document.querySelectorAll("[data-review-filter]").forEach(
  (button) =>
    (button.onclick = () => {
      reviewFilter = button.dataset.reviewFilter;
      reviewLimit = 30;
      document
        .querySelectorAll("[data-review-filter]")
        .forEach((x) => x.setAttribute("aria-pressed", x === button));
      renderReview();
    }),
);
$("reviewSearch").oninput = () => {
  reviewLimit = 30;
  renderReview();
};
$("librarySearch").oninput = () => {
  libraryLimit = 30;
  renderLibrary();
};
$("reviewMore").onclick = () => {
  reviewLimit += 30;
  renderReview();
};
$("libraryMore").onclick = () => {
  libraryLimit += 30;
  renderLibrary();
};
$("newLibrary").onclick = () =>
  guardBankEdit(() => {
    $("libraryName").value = "";
    $("libraryDialog").showModal();
    $("libraryName").focus();
  });
$("libraryForm").onsubmit = (e) => {
  e.preventDefault();
  const name = $("libraryName").value.trim();
  if (!name) return;
  const id = "user-" + Date.now();
  libraries.push({ id, name: name.slice(0, 80), words: [] });
  if (!store.write("spellRushLibraries", libraries)) {
    libraries.pop();
    return;
  }
  syncPresets(id);
  selectBank(id);
  $("libraryDialog").close();
  toast("词库已创建，添加第一个单词吧。");
};
$("addWord").onclick = () => guardBankEdit(() => editWord());
$("letterHint").onclick = () => {
  if (state.phase === "question")
    $("letterHint").textContent =
      "首字母：" + details(state.current).word.charAt(0);
};
$("wordForm").onsubmit = (e) => {
  e.preventDefault();
  try {
    let row;
    if ($("editJson").value.trim()) {
      const parsed = WordData.parse("[" + $("editJson").value + "]");
      if (parsed.length !== 1)
        throw new Error("请输入一个完整且有效的 JSON 词条。");
      row = parsed[0];
    } else {
      row = {
        word: $("editWord").value.trim().toLowerCase(),
        pos: $("editPos").value.trim(),
        meaning: $("editMeaning").value.trim(),
        examples: $("editExamples")
          .value.split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean),
      };
      const parsed = WordData.parse(JSON.stringify([row]));
      if (parsed.length !== 1)
        throw new Error("请填写有效的英文单词和中文释义。");
    }
    const rows = [...bank()],
      word = details(row).word;
    if (rows.some((x, i) => i !== editingIndex && details(x).word === word))
      throw new Error("词库中已有这个单词，请编辑已有词条。");
    if (editingIndex >= 0) rows[editingIndex] = row;
    else rows.push(row);
    if (saveBank(rows)) {
      $("wordDialog").close();
      toast("词条已保存");
    }
  } catch (error) {
    $("wordError").textContent = error.message || "词条格式无法解析。";
  }
};
$("saveWords").onclick = () =>
  guardBankEdit(() => {
    try {
      const rows = WordData.parse($("customWords").value);
      if (!rows.length && $("customWords").value.trim())
        throw new Error("没有找到有效的单词，请检查格式。");
      if (saveBank(rows)) toast("已保存 " + rows.length + " 个词条");
    } catch (error) {
      toast(error.message || "无法解析词表");
    }
  });
$("wordFile").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  guardBankEdit(async () => {
    try {
      const rows = WordData.parse(await file.text());
      if (!rows.length) throw new Error("文件中没有有效词条。");
      confirmAction(
        "导入 " + rows.length + " 个词条？",
        "导入会替换当前自定义词库的词条，学习记录会保留。可先导出当前词库备份。",
        () => {
          if (saveBank(rows)) toast("词库已导入");
        },
      );
    } catch (error) {
      toast(error.message || "文件无法读取");
    }
  });
};
$("exportWords").onclick = () =>
  download(bankName() + ".json", WordData.serialize(bank()));
$("deleteLibrary").onclick = () =>
  guardBankEdit(() =>
    confirmAction(
      "删除当前词库？",
      "词库内容将被删除，相关学习记录与错题仍会保留。",
      () => {
        const value = $("preset").value;
        if (value === "custom") {
          saveBank([]);
        } else {
          const index = libraries.findIndex((x) => x.id === value);
          if (index < 0) return;
          const removed = libraries.splice(index, 1);
          if (!store.write("spellRushLibraries", libraries)) {
            libraries.splice(index, 0, ...removed);
            return;
          }
          syncPresets("cet4");
          selectBank("cet4");
        }
        toast("词库已删除");
      },
    ),
  );
$("cancelAction").onclick = () => {
  $("confirmDialog").close();
  confirmationAction = null;
};
$("confirmAction").onclick = () => {
  const action = confirmationAction;
  confirmationAction = null;
  $("confirmDialog").close();
  action?.();
};
$("exportProgress").onclick = () =>
  download(
    "word-rush-backup-" + localDay() + ".json",
    JSON.stringify(
      {
        version: 3,
        exportedAt: new Date().toISOString(),
        spellRushProgress: saved,
        spellRushWords: WordData.serialize(customRows),
        spellRushLibraries: libraries,
      },
      null,
      2,
    ),
  );
$("restoreProgress").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  guardBankEdit(async () => {
    try {
      const backup = JSON.parse(await file.text()),
        progress = backup.spellRushProgress;
      if (
        !progress ||
        !Array.isArray(progress.seen) ||
        !progress.seen.every(
          (x) => x && typeof x.word === "string" && typeof x.ok === "boolean",
        ) ||
        typeof progress.learned !== "number" ||
        !Number.isFinite(progress.learned)
      )
        throw new Error("备份数据格式不完整。");
      const words = WordData.parse(
        typeof backup.spellRushWords === "string"
          ? backup.spellRushWords
          : JSON.stringify(backup.spellRushWords || []),
      );
      const importedLibraries = backup.spellRushLibraries || [];
      if (
        !Array.isArray(importedLibraries) ||
        !importedLibraries.every(
          (x) =>
            x &&
            typeof x.id === "string" &&
            typeof x.name === "string" &&
            Array.isArray(x.words) &&
            WordData.parse(JSON.stringify(x.words)).length === x.words.length,
        )
      )
        throw new Error("备份词库格式不完整。");
      confirmAction(
        "恢复这份备份？",
        "这会替换当前学习记录和自定义词库。建议先导出当前数据。",
        () => {
          const entries = [
              ["spellRushProgress", progress],
              ["spellRushWords", WordData.serialize(words)],
              ["spellRushLibraries", importedLibraries],
            ],
            original = entries.map(([key]) => [key, localStorage.getItem(key)]);
          try {
            for (const [key, value] of entries)
              localStorage.setItem(key, JSON.stringify(value));
            location.reload();
          } catch (_) {
            for (const [key, value] of original) {
              try {
                if (value === null) localStorage.removeItem(key);
                else localStorage.setItem(key, value);
              } catch (_) {}
            }
            toast("恢复失败，原有数据已尽量保留，请检查浏览器存储空间。");
          }
        },
      );
    } catch (error) {
      toast(error.message || "无法读取备份");
    }
  });
};

BattleUI.init();
syncPresets(store.read("spellRushPreset", "cet4"));
if (window.Progression) {
  Progression.sync(saved);
  persist();
}
renderLibrary();
stats();
updateHome();
