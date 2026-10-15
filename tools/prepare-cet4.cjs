/* Build a traceable Word Rush import pack from the upstream CET-4 JSONL files.
 * No inferred POS, generated examples, or root-word senses. The static browser
 * bank reuses the existing cet4 selection and leaves saved progress untouched.
 */
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, ".openai", "cet4-sources");
const outputDir = path.join(root, "data", "cet4");
const repository = "https://github.com/KyleBing/english-vocabulary";
const revision = process.env.CET4_SOURCE_REVISION || "c4c6c80879ff17d7025c28fb853a4991c8e6be6a";
const rawBase = `https://raw.githubusercontent.com/KyleBing/english-vocabulary/${revision}/`;
const sources = [
  { file: "cet4-full.jsonl", upstream: "full_line_jsonl/full/正序/四级.jsonl" },
  { file: "cet4-random-full.jsonl", upstream: "full_line_jsonl/full/乱序/四级.jsonl" },
];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const unique = (values) => [...new Set(values.filter(Boolean))];
const clean = (value) => typeof value === "string" ? value.trim() : "";
const posNames = {
  a: "adj", ad: "adv", adjective: "adj", adverb: "adv",
  noun: "n", verb: "v", determiner: "det", interjection: "interj", int: "interj",
  "modal verb": "modal", "aux v": "aux & v",
  convention: "convention (惯用表达)",
};
function normalizePos(value) {
  // These are formatting repairs, not grammatical reclassification. Keep the
  // exact original label in provenance, including the source's malformed ones.
  const text = clean(value).replace(/^3、释义\s*[:：]\s*/, "")
    .replace(/^\(缩作OK\)\s*/, "").replace(/^\.\s*/, "");
  const separator = /[,，]/.test(text) ? " / " : " & ";
  return unique(text.split(/\s*(?:&|\/|,|，|\band\b)\s*/).map((part) => {
    const token = part.trim().replace(/\.$/, "");
    return posNames[token] || token;
  })).join(separator);
}
function families(value) {
  return normalizePos(value).split(/\s*(?:&|\/|,|、|\band\b)\s*/).map((part) =>
    /^(v|vt|vi|verb)$/.test(part) ? "verb" : part,
  );
}

async function main() {
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  if (process.argv.includes("--download")) {
    for (const source of [...sources, { file: "LICENSE-KyleBing.txt", upstream: "LICENSE" }]) {
      const response = await fetch(rawBase + source.upstream.split("/").map(encodeURIComponent).join("/"));
      if (!response.ok) throw new Error(`Download ${source.upstream}: HTTP ${response.status}`);
      await fs.writeFile(path.join(sourceDir, source.file), Buffer.from(await response.arrayBuffer()));
    }
  }

  const entries = new Map();
  const originalHeadwords = new Set();
  const manifestSources = [];
  for (const source of sources) {
    const raw = await fs.readFile(path.join(sourceDir, source.file));
    const rows = raw.toString("utf8").trim().split(/\r?\n/).map(JSON.parse);
    manifestSources.push({ path: source.upstream, rows: rows.length, bytes: raw.length, sha256: sha256(raw) });
    for (const row of rows) {
      const originalHeadword = clean(row.headWord).toLowerCase();
      originalHeadwords.add(originalHeadword);
      // Both spellings occur upstream. Cambridge confirms reservoir; retain the
      // original misspelling only in provenance, never as a spelling answer.
      const word = originalHeadword === "reservior" ? "reservoir" : originalHeadword;
      const data = row.content?.word?.content;
      if (!word || !data) throw new Error(`Missing headword or content in ${source.file}`);
      let entry = entries.get(word);
      if (!entry) entries.set(word, entry = { word, senses: [], examples: new Map(), sourceRows: [], synos: [], phonetics: [] });
      const sourceRef = { bookId: row.bookId, wordId: row.content.word.wordId, wordRank: row.wordRank, headWord: row.headWord };
      entry.sourceRows.push({ ...sourceRef, trans: data.trans || [], synos: (data.syno?.synos || []).map((sense) => ({ pos: sense.pos, tran: sense.tran })) });
      for (const sense of data.trans || []) {
        if (!clean(sense.pos) || !clean(sense.tranCn)) throw new Error(`Unlabelled source sense: ${word}`);
        entry.senses.push({ pos: normalizePos(sense.pos), meaning: clean(sense.tranCn) });
      }
      for (const sense of data.syno?.synos || []) {
        if (clean(sense.pos) && clean(sense.tran)) entry.synos.push({ pos: normalizePos(sense.pos), meaning: clean(sense.tran), sourceRef });
      }
      for (const sentence of data.sentence?.sentences || []) {
        const text = clean(sentence.sContent);
        if (!text) continue;
        if (!entry.examples.has(text)) entry.examples.set(text, []);
        if (clean(sentence.sCn)) entry.examples.set(text, unique([...entry.examples.get(text), clean(sentence.sCn)]));
      }
      if (data.ukphone || data.usphone) entry.phonetics.push({ ...sourceRef, uk: data.ukphone || "", us: data.usphone || "" });
    }
  }

  let supplementedWords = 0;
  let supplementedSenses = 0;
  const provenance = [];
  const words = [...entries.values()].sort((a, b) => a.word < b.word ? -1 : a.word > b.word ? 1 : 0).map((entry) => {
    // Judge coverage by POS family. Keep source vt./vi. in the actual added
    // senses, while avoiding hundreds of duplicated generic-v verb entries.
    const originalFamilies = new Set(entry.senses.flatMap((sense) => families(sense.pos)));
    const supplements = entry.synos.filter((sense) => families(sense.pos).some((family) => !originalFamilies.has(family)));
    const dedupe = new Map();
    for (const sense of [...entry.senses, ...supplements]) {
      const key = sense.pos + "\u0000" + sense.meaning;
      if (!dedupe.has(key)) dedupe.set(key, { pos: sense.pos, meaning: sense.meaning });
    }
    if (supplements.length) supplementedWords++;
    supplementedSenses += unique(supplements.map((sense) => sense.pos + "\u0000" + sense.meaning)).length;
    provenance.push({ word: entry.word, sourceRows: entry.sourceRows, phonetics: entry.phonetics,
      exampleTranslations: [...entry.examples.values()],
      supplementarySenses: supplements.map((sense) => ({ ...sense, sourceField: "content.word.content.syno.synos" })) });
    return { word: entry.word, senses: [...dedupe.values()], examples: [...entry.examples.keys()] };
  });

  const source = { repository, revision, license: "BSD-3-Clause", sourceFiles: manifestSources.map((item) => item.path),
    note: "Preserves all source trans POS/meanings; missing POS families supplemented only from the current word's syno.synos. Examples remain at entry level." };
  const pack = { name: `四级词汇 · 完整源词性与例句（${words.length}词）`, source, words };
  const outputs = [];
  async function writeJson(filename, value) {
    const serialized = JSON.stringify(value) + "\n";
    await fs.writeFile(path.join(outputDir, filename), serialized, "utf8");
    outputs.push({ file: filename, words: value.words?.length, characters: serialized.length, utf8Bytes: Buffer.byteLength(serialized), utf16Bytes: serialized.length * 2, sha256: sha256(serialized) });
  }
  await writeJson("cet4-full.json", pack);
  const browserBank = `/* Generated by tools/prepare-cet4.cjs.\n * Source: ${repository} @ ${revision}\n * BSD-3-Clause: see LICENSE-KyleBing.txt.\n * Keep the previous seed entries available to historical review lookup.\n */\nBANKS.cet4Legacy = BANKS.cet4;\nBANKS.cet4 = ${JSON.stringify(words)};\n`;
  await fs.writeFile(path.join(outputDir, "cet4-bank.js"), browserBank, "utf8");
  outputs.push({ file: "cet4-bank.js", words: words.length, characters: browserBank.length, utf8Bytes: Buffer.byteLength(browserBank), sha256: sha256(browserBank) });
  for (const [name, start, end] of [["a-f", "a", "g"], ["g-l", "g", "m"], ["m-r", "m", "s"], ["s-z", "s", "{"]]) {
    await writeJson(`cet4-${name}.json`, { ...pack, name: `四级词汇 · ${name.toUpperCase()}`, words: words.filter((word) => word.word >= start && word.word < end) });
  }
  await writeJson("source-provenance.json", { repository, note: "Audit file, not a vocabulary import pack. Source trans records preserve raw POS, Chinese and English glosses, and book/word IDs. synos are source metadata for the current headword, not relWord roots. exampleTranslations indexes the main import entry's examples array; multiple source translations for one English example remain separate.", entries: provenance });
  const missingExamples = words.filter((word) => !word.examples.length).map((word) => word.word);
  const stats = { sourceRows: manifestSources.reduce((total, item) => total + item.rows, 0), uniqueSourceHeadwords: originalHeadwords.size, correctedSourceHeadwords: 1, uniqueWords: words.length,
    senses: words.reduce((total, word) => total + word.senses.length, 0),
    wordsWithMultiplePosFamilies: words.filter((word) => new Set(word.senses.flatMap((sense) => families(sense.pos))).size > 1).length,
    supplementedWords, supplementedSenses, examples: words.reduce((total, word) => total + word.examples.length, 0),
    missingPos: words.filter((word) => word.senses.some((sense) => !sense.pos)).length,
    missingExamples: missingExamples.length, missingExampleWords: missingExamples };
  await writeJson("manifest.json", { repository, revision, sourceFiles: manifestSources, stats, outputs });
  await writeJson("manual-qc.json", { note: "Source issues preserved for review. cet4-bank.js supplies the built-in CET-4 bank; import JSON remains available separately.", issues: [
    { word: "reservior", type: "corrected-misspelling", correctedHeadword: "reservoir", evidence: "https://dictionary.cambridge.org/us/dictionary/english/reservoir", note: "Merged into reservoir in import packs; original source headWord/bookId/wordId remain in provenance. No misspelling is accepted as a new spelling answer." },
    { type: "unmapped-example-senses", note: "Source sentences are not reliably mapped to individual senses. Their Chinese translations are indexed in source-provenance.json against the corresponding main entry's examples; no assignment to POS senses is inferred." },
    { type: "source-coverage", note: "The term full refers to all retained source senses/POS, not an official examination inventory or an exhaustive dictionary." },
  ] });
  await fs.copyFile(path.join(sourceDir, "LICENSE-KyleBing.txt"), path.join(outputDir, "LICENSE-KyleBing.txt"));
  console.log(JSON.stringify({ stats, outputs }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
