/* Compatible views of the original tuple vocabulary and richer imported entries.
 * Source rows are never mutated. JSON export keeps all original fields and senses.
 */
(function (root) {
  "use strict";

  const MISSING_POS = "词性未标注";
  const POS_NAMES = {
    n: "noun",
    noun: "noun",
    v: "verb",
    verb: "verb",
    vt: "verb (vt.)",
    vi: "verb (vi.)",
    adj: "adj.",
    adjective: "adj.",
    adv: "adv.",
    adverb: "adv.",
    pron: "pron.",
    pronoun: "pron.",
    prep: "prep.",
    preposition: "prep.",
    conj: "conj.",
    conjunction: "conj.",
    int: "interj.",
    interj: "interj.",
    interjection: "interj.",
    det: "det.",
    determiner: "det.",
    art: "article",
    article: "article",
    num: "numeral",
    numeral: "numeral",
    aux: "aux.",
    auxiliary: "aux.",
    modal: "modal",
    phr: "phrase",
    phrase: "phrase",
  };
  const abbreviation =
    "(?:interj|modal|pron|prep|conj|adj|adv|aux|det|art|num|phr|int|vt|vi|n|v)";
  const embeddedPOS = new RegExp(
    "(^|[;；\\n]\\s*)((?:" +
      abbreviation +
      "\\.?\\s*(?:&|/|、|and)\\s*)*" +
      abbreviation +
      "\\.)\\s*",
    "gi",
  );

  function strings(value) {
    if (typeof value === "string") return value.trim() ? [value.trim()] : [];
    return Array.isArray(value) ? value.flatMap(strings) : [];
  }
  const unique = (values) => [...new Set(values.filter(Boolean))];
  function posLabel(value) {
    const values = strings(value);
    return unique(
      values
        .flatMap((text) => text.split(/\s*(?:&|\/|、|\band\b)\s*/i))
        .map((text) => {
          const key = text.trim().toLowerCase().replace(/\.$/, "");
          return POS_NAMES[key] || text.trim();
        }),
    ).join(" / ");
  }
  function sourceExamples(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return unique([
      ...strings(value.example),
      ...strings(value.examples),
      ...strings(value.sentence),
    ]);
  }
  function definitionParts(value, explicitPos, examples) {
    if (Array.isArray(value)) {
      const parts = value.flatMap((item) =>
        definitionParts(item, explicitPos, []),
      );
      if (parts.length === 1)
        parts[0].examples = unique([...parts[0].examples, ...examples]);
      return parts;
    }
    if (value && typeof value === "object") {
      if (
        "meaning" in value ||
        "definition" in value ||
        "translation" in value
      ) {
        return definitionParts(
          value.meaning ?? value.definition ?? value.translation,
          value.pos ?? explicitPos,
          unique([...examples, ...sourceExamples(value)]),
        );
      }
      const parts = Object.entries(value).flatMap(([key, text]) =>
        definitionParts(
          text,
          POS_NAMES[key.toLowerCase().replace(/\.$/, "")] ? key : explicitPos,
          [],
        ),
      );
      if (parts.length === 1)
        parts[0].examples = unique([...parts[0].examples, ...examples]);
      return parts;
    }
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return [];
    embeddedPOS.lastIndex = 0;
    const matches = [...text.matchAll(embeddedPOS)];
    if (!matches.length)
      return [
        {
          pos: posLabel(explicitPos) || MISSING_POS,
          meaning: text,
          examples: examples.slice(),
        },
      ];
    const parts = [];
    if (matches[0].index > 0)
      parts.push({
        pos: posLabel(explicitPos) || MISSING_POS,
        meaning: text.slice(0, matches[0].index).trim(),
        examples: [],
      });
    matches.forEach((match, index) => {
      const meaning = text
        .slice(
          match.index + match[0].length,
          matches[index + 1]?.index ?? text.length,
        )
        .trim();
      if (meaning)
        parts.push({
          pos: posLabel(match[2]) || posLabel(explicitPos) || MISSING_POS,
          meaning,
          examples: [],
        });
    });
    // A sentence supplied for a multi-POS entry has no source-level sense mapping.
    if (parts.length === 1) parts[0].examples = examples.slice();
    return parts;
  }
  function details(row) {
    const tuple = Array.isArray(row);
    const entry =
      row && typeof row === "object"
        ? row
        : { word: typeof row === "string" ? row : "" };
    const word = String(
      tuple ? (entry[0] ?? "") : (entry.word ?? entry.term ?? ""),
    ).trim();
    const explicitPos = tuple ? entry[3] : (entry.pos ?? entry.partOfSpeech);
    const rawMeaning = tuple
      ? entry[1]
      : (entry.meaning ??
        entry.meanings ??
        entry.definition ??
        entry.translation);
    const topExamples = unique(
      tuple ? strings(entry[2]) : sourceExamples(entry),
    );
    const examples = topExamples.slice();
    const sourceSenses = tuple ? entry[4] : entry.senses;
    let senses = [];
    if (Array.isArray(sourceSenses)) {
      for (const sense of sourceSenses) {
        const item =
          typeof sense === "string" ? { meaning: sense } : sense || {};
        const ownExamples = sourceExamples(item);
        examples.push(...ownExamples);
        senses.push(
          ...definitionParts(
            item.meaning ??
              item.meanings ??
              item.definition ??
              item.translation,
            item.pos ?? explicitPos,
            ownExamples,
          ),
        );
      }
    }
    // Examples beside an explicit sense list have no implicit sense assignment.
    // Keep them at entry level instead of copying another sense's sentence.
    const topSenses = definitionParts(
      rawMeaning,
      explicitPos,
      Array.isArray(sourceSenses) && sourceSenses.length ? [] : topExamples,
    );
    const contentKey = (text) => text.replace(/[;；\s]/g, "");
    // Many import formats repeat a summary above their full sense list.
    if (
      !senses.length ||
      contentKey(topSenses.map((sense) => sense.meaning).join("；")) !==
        contentKey(senses.map((sense) => sense.meaning).join("；"))
    ) {
      senses.push(
        ...topSenses.filter(
          (sense) =>
            sense.pos !== MISSING_POS ||
            !senses.some((existing) => existing.meaning === sense.meaning),
        ),
      );
    }
    const merged = new Map();
    for (const sense of senses) {
      const key = sense.pos + "\u0000" + sense.meaning;
      if (merged.has(key))
        merged.get(key).examples = unique([
          ...merged.get(key).examples,
          ...sense.examples,
        ]);
      else merged.set(key, { ...sense, examples: unique(sense.examples) });
    }
    senses = [...merged.values()];
    if (!senses.length)
      senses = [
        {
          pos: posLabel(explicitPos) || MISSING_POS,
          meaning: "释义未提供",
          examples: examples.slice(),
        },
      ];
    const suppliedPos = posLabel(explicitPos);
    const posValues = unique(
      [...senses.map((sense) => sense.pos), suppliedPos].flatMap((pos) =>
        pos.split(" / "),
      ),
    ).filter((pos) => pos !== MISSING_POS);
    return {
      word,
      meaning: unique(senses.map((sense) => sense.meaning)).join("；"),
      pos: posValues.length ? posValues.join(" / ") : MISSING_POS,
      examples: unique([
        ...examples,
        ...senses.flatMap((sense) => sense.examples),
      ]),
      senses,
    };
  }

  function validRow(row) {
    const sourceWord = Array.isArray(row)
      ? row[0]
      : typeof row === "string"
        ? row
        : (row?.word ?? row?.term);
    if (typeof sourceWord !== "string") return false;
    const word = sourceWord.trim();
    return /[a-z]/i.test(word) && !/[\r\n\u0000]/.test(word);
  }
  function jsonRows(value) {
    if (value && !Array.isArray(value) && typeof value === "object") {
      if ("word" in value || "term" in value) return [value].filter(validRow);
      if ("words" in value) {
        if (!Array.isArray(value.words))
          throw new TypeError("词库 JSON 的 words 字段需要词条数组。");
        return jsonRows(value.words);
      }
      if ("entries" in value) {
        if (!Array.isArray(value.entries))
          throw new TypeError("词库 JSON 的 entries 字段需要词条数组。");
        return jsonRows(value.entries);
      }
      return Object.entries(value)
        .map(([word, item]) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? { ...item, word: item.word ?? word }
            : { word, meaning: item },
        )
        .filter(validRow);
    }
    if (!Array.isArray(value))
      throw new TypeError("词库 JSON 需要词条数组或包含 words 的对象。");
    if (
      value.length >= 2 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string" &&
      /[\u3400-\u9fff]/.test(value[1])
    ) {
      return [value].filter(validRow);
    }
    return value
      .map((row) => (typeof row === "string" ? [row, "自定义词汇", ""] : row))
      .filter(validRow);
  }
  function delimiterFor(text) {
    let quoted = false;
    const counts = new Map(
      ["|", "｜", "\t", ",", ";", "，"].map((char) => [char, 0]),
    );
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') {
          index++;
          continue;
        }
        quoted = !quoted;
      }
      if (!quoted && /[\r\n]/.test(char)) break;
      if (!quoted && counts.has(char)) counts.set(char, counts.get(char) + 1);
    }
    return [...counts].find(([, count]) => count)?.[0] || null;
  }
  function records(text, delimiter) {
    const rows = [];
    let fields = [],
      field = "",
      quoted = false;
    const pushRow = () => {
      fields.push(field.trim());
      if (fields.some(Boolean)) rows.push(fields);
      fields = [];
      field = "";
    };
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (char === '"' && (quoted || !field.trim())) {
        if (quoted && text[index + 1] === '"') {
          field += '"';
          index++;
        } else quoted = !quoted;
      } else if (
        !quoted &&
        delimiter &&
        (char === delimiter || (/[|｜]/.test(delimiter) && /[|｜]/.test(char)))
      ) {
        fields.push(field.trim());
        field = "";
      } else if (!quoted && /[\r\n]/.test(char)) {
        pushRow();
        if (char === "\r" && text[index + 1] === "\n") index++;
      } else field += char;
    }
    if (quoted)
      throw new SyntaxError("词库中有未闭合的引号，请检查 CSV 或使用 JSON。");
    pushRow();
    return rows;
  }
  const HEADER_NAMES = {
    word: "word",
    term: "word",
    english: "word",
    单词: "word",
    英文单词: "word",
    pos: "pos",
    "part of speech": "pos",
    partofspeech: "pos",
    词性: "pos",
    meaning: "meaning",
    meanings: "meaning",
    translation: "meaning",
    definition: "meaning",
    释义: "meaning",
    中文释义: "meaning",
    example: "examples",
    examples: "examples",
    sentence: "examples",
    例句: "examples",
    英文例句: "examples",
  };
  function parse(text) {
    if (typeof text !== "string") return jsonRows(text);
    const input = text.replace(/^\uFEFF/, "").trim();
    if (!input) return [];
    if (/^[\[{]/.test(input)) return jsonRows(JSON.parse(input));
    const delimiter = delimiterFor(input);
    const rows = records(input, delimiter);
    const headers = rows[0]?.map(
      (value) => HEADER_NAMES[value.toLowerCase()] || value,
    );
    if (
      headers?.includes("word") &&
      headers.some((value) => ["pos", "meaning", "examples"].includes(value))
    ) {
      return rows
        .slice(1)
        .map((fields) => {
          const row = {};
          headers.forEach((key, index) => {
            const value = fields[index] || "";
            if (key === "examples")
              row.examples = [...(row.examples || []), ...strings(value)];
            else if (key in row)
              row[key] = [...strings(row[key]), ...strings(value)];
            else row[key] = value;
          });
          if (fields.length > headers.length)
            row.extra = fields.slice(headers.length);
          return row;
        })
        .filter(validRow);
    }
    return rows
      .map((fields) => {
        const word = fields[0].trim().toLowerCase();
        if (fields.length >= 4)
          return {
            word,
            pos: fields[1],
            meaning: fields[2],
            example: fields.slice(3).join(delimiter || "|"),
          };
        return [
          word,
          fields[1] || "自定义词汇",
          fields.slice(2).join(delimiter || "|"),
        ];
      })
      .filter(validRow);
  }
  function serialize(rows) {
    return JSON.stringify(rows, null, 2);
  }

  const IRREGULAR = {
    be: ["am", "is", "are", "was", "were", "been", "being"],
    have: ["has", "had"],
    do: ["does", "did", "done"],
    go: ["goes", "went", "gone"],
    come: ["came"],
    become: ["became"],
    take: ["took", "taken"],
    give: ["gave", "given"],
    make: ["made"],
    know: ["knew", "known"],
    think: ["thought"],
    find: ["found"],
    get: ["got", "gotten"],
    see: ["saw", "seen"],
    say: ["said"],
    tell: ["told"],
    speak: ["spoke", "spoken"],
    write: ["wrote", "written"],
    eat: ["ate", "eaten"],
    drink: ["drank", "drunk"],
    run: ["ran"],
    begin: ["began", "begun"],
    break: ["broke", "broken"],
    choose: ["chose", "chosen"],
    drive: ["drove", "driven"],
    grow: ["grew", "grown"],
    fall: ["fell", "fallen"],
    forget: ["forgot", "forgotten"],
    wear: ["wore", "worn"],
    teach: ["taught"],
    catch: ["caught"],
    buy: ["bought"],
    bring: ["brought"],
    keep: ["kept"],
    leave: ["left"],
    lose: ["lost"],
    meet: ["met"],
    feel: ["felt"],
    hold: ["held"],
    build: ["built"],
    send: ["sent"],
    spend: ["spent"],
    sleep: ["slept"],
    stand: ["stood"],
    understand: ["understood"],
    win: ["won"],
    draw: ["drew", "drawn"],
    fly: ["flew", "flown"],
    rise: ["rose", "risen"],
    ride: ["rode", "ridden"],
    shake: ["shook", "shaken"],
    steal: ["stole", "stolen"],
    undertake: ["undertook", "undertaken"],
    withdraw: ["withdrew", "withdrawn"],
    child: ["children"],
    person: ["people"],
    man: ["men"],
    woman: ["women"],
    foot: ["feet"],
    tooth: ["teeth"],
    mouse: ["mice"],
  };
  function inflections(word) {
    const forms = [word, ...(IRREGULAR[word] || [])];
    if (!/^[a-z]+$/.test(word)) return forms;
    forms.push(word + "s", word + "es", word + "ed", word + "ing");
    if (/[^aeiou]y$/.test(word))
      forms.push(word.slice(0, -1) + "ies", word.slice(0, -1) + "ied");
    if (/e$/.test(word)) forms.push(word + "d", word.slice(0, -1) + "ing");
    if (/ie$/.test(word)) forms.push(word.slice(0, -2) + "ying");
    if (/[aeiou][bcdfgklmnprstz]$/.test(word))
      forms.push(word + word.at(-1) + "ed", word + word.at(-1) + "ing");
    return unique(forms);
  }
  const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function mask(sentence, word) {
    const text = String(sentence || "");
    const target = String(word || "")
      .trim()
      .toLowerCase();
    if (!target) return text;
    const forms = [target];
    let alternatives = [target];
    if (target.includes("/")) {
      const parts = target.split("/").map((term) => term.trim());
      if (parts.every((term) => /^[a-z-]+(?:\s+[a-z-]+)*$/.test(term))) {
        alternatives = parts.slice();
        // Textbooks commonly share a suffix: concentrate/focus on.
        // Preserve literal alternatives too, so full phrase variants remain covered.
        const suffix = parts.at(-1).match(/^[a-z-]+(\s+.+)$/)?.[1];
        if (suffix)
          alternatives.push(
            ...parts
              .slice(0, -1)
              .filter((term) => !/\s/.test(term))
              .map((term) => term + suffix),
          );
      }
    }
    for (const alternative of alternatives) {
      const pieces = alternative.split(/\s+/);
      if (pieces.length === 1) forms.push(...inflections(alternative));
      else
        forms.push(
          ...inflections(pieces[0]).map((first) =>
            [first, ...pieces.slice(1)].join(" "),
          ),
        );
    }
    const patterns = unique(forms)
      .sort((a, b) => b.length - a.length)
      .map((value) =>
        escapeRegex(value).replace(/\s+/g, "\\s+").replace(/['’]/g, "['’]"),
      );
    const expression = new RegExp(
      "(^|[^\\p{L}\\p{N}_])(?:" +
        patterns.join("|") +
        ")(?=$|[^\\p{L}\\p{N}_])",
      "giu",
    );
    return text.replace(expression, (_, boundary) => boundary + "_____");
  }

  const api = Object.freeze({ details, parse, serialize, mask });
  root.WordData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
