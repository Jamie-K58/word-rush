function localDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

const legacyWords = 'apple｜n. 苹果\nbridge｜n. 桥\nquiet｜adj. 安静的';
const richWords = [
  ['accommodate', 'v. 容纳；使适合', 'The hotel can accommodate up to 500 guests.'],
  ['bridge', 'n. 桥；v. 跨越', 'We walked across the bridge.'],
  ['quiet', 'adj. 安静的', 'Please keep quiet.']
];

function legacyProgress() {
  return {
    learned: 23, days: 7, xp: 575, daily: 3, dailyDate: localDate(),
    seen: [
      { word: 'apple', ok: false, ts: Date.now() - 300000 },
      { word: 'bridge', ok: true, ts: Date.now() - 200000 },
      { word: 'quiet', ok: false, ts: Date.now() - 100000 }
    ],
    bestScore: 1840, bestStreak: 8, perfectRuns: 1,
    legacyExtension: { preserved: true }
  };
}

module.exports = { localDate, legacyWords, richWords, legacyProgress };
