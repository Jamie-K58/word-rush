const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const WordData = require('../word-utils.js');

test('legacy tuple keeps all POS definitions and example punctuation', () => {
  const row = ['schedule', 'n.计划表,日程表;vt.安排;预定', 'We scheduled a short review before the exam.'];
  const before = JSON.stringify(row);
  const result = WordData.details(row);
  assert.equal(result.word, 'schedule');
  assert.equal(result.meaning, '计划表,日程表；安排;预定');
  assert.equal(result.pos, 'noun / verb (vt.)');
  assert.deepEqual(result.senses.map(sense => [sense.pos, sense.meaning]), [['noun', '计划表,日程表'], ['verb (vt.)', '安排;预定']]);
  assert.deepEqual(result.examples, [row[2]]);
  assert.deepEqual(result.senses.map(sense => sense.examples), [[], []]);
  assert.equal(JSON.stringify(row), before);
});

test('compound POS tags retain transitive and intransitive distinctions', () => {
  assert.equal(WordData.details(['register', 'vt.&vi.登记;注册', '']).pos, 'verb (vt.) / verb (vi.)');
  assert.equal(WordData.details(['forecast', 'vt&n. 预测;预报', '']).pos, 'verb (vt.) / noun');
});

test('missing POS and examples are explicit; audio timecodes are not examples', () => {
  assert.equal(WordData.details(['apple', '苹果', '']).pos, '词性未标注');
  assert.deepEqual(WordData.details(['campus', 'n.校园', [6.53, 7.89]]).examples, []);
});

test('rich JSON round trip preserves senses, examples and unknown metadata', () => {
  const rows = [{word: 'bank', meaning: '银行；倾斜', phonetic: '/bæŋk/', source: {edition: 2}, senses: [
    {pos: 'noun', meaning: '银行', examples: ['The bank is closed.', 'I called the bank.'], sourcePage: 24},
    {pos: 'verb', meaning: '倾斜', example: 'The plane banked to the left.'}
  ]}];
  const parsed = WordData.parse(WordData.serialize(rows));
  assert.deepEqual(parsed, rows);
  const result = WordData.details(parsed[0]);
  assert.deepEqual(result.senses.map(sense => sense.meaning), ['银行', '倾斜']);
  assert.equal(result.senses[0].examples.length, 2);
  assert.deepEqual(result.senses[1].examples, ['The plane banked to the left.']);
  assert.equal(result.examples.length, 3);
});

test('entry-level sentences do not acquire invented sense associations', () => {
  const row = {word: 'bank', meaning: '银行', example: 'The bank is open.', senses: [
    {pos: 'noun', meaning: '银行', examples: ['I called the bank.']},
    {pos: 'verb', meaning: '倾斜', examples: ['The plane banks to the left.']}
  ]};
  const result = WordData.details(row);
  assert.deepEqual(result.senses.map(sense => sense.meaning), ['银行', '倾斜']);
  assert.deepEqual(result.senses[0].examples, ['I called the bank.']);
  assert.deepEqual(result.senses[1].examples, ['The plane banks to the left.']);
  assert.deepEqual(result.examples, ['The bank is open.', 'I called the bank.', 'The plane banks to the left.']);
  const explicit = WordData.details({...row, pos: 'noun'});
  assert.deepEqual(explicit.senses[0].examples, ['I called the bank.']);
});

test('tuple JSON preserves explicit fourth-column POS and extra columns', () => {
  const row = ['apple', '苹果', ['I eat an apple.', 'The apple is red.'], 'noun', [{pos: 'noun', meaning: '苹果', examples: ['I eat an apple.']}], {source: 'local'}];
  assert.deepEqual(WordData.parse(JSON.stringify([row]))[0], row);
  assert.equal(WordData.details(row).pos, 'noun');
});

test('multiple array and dictionary meanings remain visible', () => {
  const result = WordData.details({word: 'light', meaning: {noun: ['光', '灯'], adjective: '轻的'}, examples: ['The light is on.']});
  assert.equal(result.meaning, '光；灯；轻的');
  assert.equal(result.pos, 'noun / adj.');
  assert.equal(result.examples.length, 1);
  assert.ok(result.senses.every(sense => sense.examples.length === 0));
});

test('definition branches preserve only their explicit sentence mapping', () => {
  const row = {word: 'bank', meaning: {
    noun: {meaning: '银行', example: 'I called the bank.'},
    verb: {meaning: '倾斜', example: 'The plane banks to the left.'}
  }, examples: ['I learned the word bank.']};
  const result = WordData.details(row);
  assert.deepEqual(result.senses[0].examples, ['I called the bank.']);
  assert.deepEqual(result.senses[1].examples, ['The plane banks to the left.']);
  assert.equal(result.examples.length, 3);
  const array = WordData.details({word: 'bank', meaning: ['银行', '倾斜'], example: 'The bank is open.'});
  assert.ok(array.senses.every(sense => sense.examples.length === 0));
  assert.deepEqual(array.examples, ['The bank is open.']);
});

test('plain input supports original two/three columns and new four columns', () => {
  assert.deepEqual(WordData.parse('apple｜苹果\nlook forward to|期望|I look forward to your reply.'), [
    ['apple', '苹果', ''], ['look forward to', '期望', 'I look forward to your reply.']
  ]);
  const row = WordData.parse('accommodate|verb|容纳；使适合|The hotel can accommodate up to 500 guests.')[0];
  assert.equal(row.pos, 'verb');
  assert.equal(WordData.details(row).examples[0], 'The hotel can accommodate up to 500 guests.');
});

test('CSV quoted commas, semicolons, quotes and multiline examples survive', () => {
  const csv = '\uFEFFword,pos,meaning,example\r\naccommodate,verb,"容纳,使适合；住宿","The hotel can accommodate guests, families, and friends.\nShe said ""welcome""."';
  const row = WordData.parse(csv)[0];
  assert.equal(row.meaning, '容纳,使适合；住宿');
  assert.deepEqual(row.examples, ['The hotel can accommodate guests, families, and friends.\nShe said "welcome".']);
});

test('CSV multiple example columns and custom metadata survive', () => {
  const row = WordData.parse('word,meaning,example,example,lesson\napple,苹果,I eat an apple.,The apple is red.,3')[0];
  assert.deepEqual(row.examples, ['I eat an apple.', 'The apple is red.']);
  assert.equal(row.lesson, '3');
});

test('JSON accepts containers, single objects and word dictionaries', () => {
  assert.equal(WordData.parse('{"words":[{"word":"apple","pos":"noun","meaning":"苹果"}]}')[0].pos, 'noun');
  assert.equal(WordData.parse('{"word":"apple","meaning":"苹果"}').length, 1);
  assert.equal(WordData.parse('{"apple":"苹果"}')[0].word, 'apple');
});

test('malformed JSON word types are rejected without coercing fake English words', () => {
  for (const word of [{foo: 'bar'}, ['apple', 'pear'], null, 42, true]) {
    assert.deepEqual(WordData.parse(JSON.stringify([{word, meaning: '错误类型'}])), []);
    assert.deepEqual(WordData.parse(JSON.stringify([[word, '错误类型', '']])), []);
  }
  const tuple = ['sign up (for sth.)', '报名', 'You can sign up tomorrow.'];
  assert.deepEqual(WordData.parse('[' + JSON.stringify(tuple) + ']'), [tuple]);
  const object = {word: 'leave...alone', meaning: '不打扰', senses: [{pos: 'phrase', meaning: '不打扰', examples: ['Leave me alone.']}]};
  assert.deepEqual(WordData.parse('[' + JSON.stringify(object) + ']'), [object]);
});

test('malformed words and entries containers do not become fake vocabulary', () => {
  for (const container of [{words: 'not-an-array'}, {words: null}, {entries: {}}, {entries: 42}]) {
    assert.throws(() => WordData.parse(JSON.stringify(container)), TypeError);
  }
  assert.deepEqual(WordData.parse('{"words":[]}'), []);
});

test('plain parser preserves phrases, slash alternatives and punctuation', () => {
  const rows = WordData.parse("sign up (for sth.)|报名\nconcentrate/focus on|集中精力于\nleave...alone|不打扰\nchildren's book|儿童书籍");
  assert.equal(rows.length, 4);
  assert.equal(WordData.details(rows[0]).word, 'sign up (for sth.)');
  assert.equal(WordData.details(rows[3]).word, "children's book");
});

test('malformed JSON or CSV reports an error instead of corrupting import', () => {
  assert.throws(() => WordData.parse('[{"word":'), SyntaxError);
  assert.throws(() => WordData.parse('apple|苹果|"Unclosed sentence'), SyntaxError);
});

test('mask hides exact targets and common inflections without hiding substrings', () => {
  assert.equal(WordData.mask('Adapt, adapted, adapting, adaptation and ADAPTS.', 'adapt'), '_____, _____, _____, adaptation and _____.');
  assert.equal(WordData.mask('She applied and applies; he is applying.', 'apply'), 'She _____ and _____; he is _____.');
  assert.equal(WordData.mask('He equipped the room, then is equipping another.', 'equip'), 'He _____ the room, then is _____ another.');
  assert.equal(WordData.mask('We scheduled it; scheduling is useful.', 'schedule'), 'We _____ it; _____ is useful.');
  assert.equal(WordData.mask('A kind person helps mankind.', 'kind'), 'A _____ person helps mankind.');
});

test('mask handles irregular forms, repeated words, phrase inflection and safe regex literals', () => {
  assert.equal(WordData.mask('She wrote what she had written.', 'write'), 'She _____ what she had _____.');
  assert.equal(WordData.mask('We look forward to it; she looks forward to it.', 'look forward to'), 'We _____ it; she _____ it.');
  assert.equal(WordData.mask('A well-known, well-known author.', 'well-known'), 'A _____, _____ author.');
  assert.equal(WordData.mask('The flat is beside an apartment.', 'apartment/flat'), 'The _____ is beside an _____.');
  assert.equal(WordData.mask('She undertook a difficult task and has undertaken another.', 'undertake'), 'She _____ a difficult task and has _____ another.');
  assert.equal(WordData.mask('She focused on the work; I concentrate on it.', 'concentrate/focus on'), 'She _____ the work; I _____ it.');
  assert.equal(WordData.mask('Try a+b, not ab.', 'a+b'), 'Try _____, not ab.');
  assert.equal(WordData.mask('A word remains.', ''), 'A word remains.');
});

test('all original textbook definitions and audio metadata remain available', () => {
  const root = path.resolve(__dirname, '..');
  const context = {window: {}};
  vm.createContext(context);
  for (const file of ['教材词库.js', '教材扩展词库.js', 'vocabulary.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file});
  const banks = vm.runInContext('BANKS', context);
  const byWord = new Map(banks.gaokao.map(row => [row.word, row]));
  const textbookWords = context.window.GBANK.themes.flatMap(theme => theme.sections.flatMap(section => section.words));
  for (const [word, meaning] of textbookWords) {
    if (!/[a-z]/i.test(word) || !meaning?.trim()) continue;
    const entry = byWord.get(word.trim().toLowerCase());
    assert.ok(entry, `Missing textbook term: ${word}`);
    assert.ok(entry.senses.some(sense => sense.meaning === meaning.trim()), `Missing definition: ${word} ${meaning}`);
  }
  for (const [word, meaning] of context.window.GAOKAO_EXTRA) {
    const fixed = ({onfucius: 'confucius', urt: 'yogurt', rctic: 'arctic', hood: 'childhood'})[word] || word;
    assert.ok(byWord.get(fixed.toLowerCase()).senses.some(sense => sense.meaning === meaning.trim()), `Missing expanded definition: ${word}`);
  }
  assert.equal(byWord.get('campus').sources[0].time[0], 6.53);
  assert.equal(byWord.get('campus').sources[0].audio, 'audio/theme1.mp3');
  assert.ok(byWord.get('schedule').examples[0].includes('scheduled'));
  assert.equal(byWord.get('campus').examples.length, 0);
  assert.ok(WordData.details(byWord.get('stress')).meaning.includes('重音'));
  assert.ok(WordData.details(byWord.get('stress')).meaning.includes('压力'));
  assert.ok(banks.gaokao.every(row => row.examples.every(example => !/use “|reviewed “|sentence with “|meaning of “/.test(example))));
  assert.equal(banks.online.length, 360);
  let checkedExamples = 0;
  for (const row of Object.values(banks).flat()) {
    const entry = WordData.details(row);
    for (const example of entry.examples) {
      checkedExamples++;
      assert.notEqual(WordData.mask(example, entry.word), example, `Unmasked built-in target: ${entry.word}`);
    }
  }
  assert.equal(checkedExamples, 199);
});

test('built-in CET-4 matches the complete import pack and retains legacy review lookup', () => {
  const root = path.resolve(__dirname, '..');
  const context = vm.createContext({window: {}});
  vm.runInContext(fs.readFileSync(path.join(root, 'vocabulary.js'), 'utf8'), context);
  const before = vm.runInContext('BANKS.cet4', context);
  vm.runInContext(fs.readFileSync(path.join(root, 'data/cet4/cet4-bank.js'), 'utf8'), context);
  const bank = vm.runInContext('BANKS.cet4', context);
  const source = JSON.parse(fs.readFileSync(path.join(root, 'data/cet4/cet4-full.json'), 'utf8'));
  assert.equal(bank.length, 4543);
  assert.equal(JSON.stringify(bank), JSON.stringify(source.words));
  assert.equal(vm.runInContext('BANKS.cet4Legacy', context), before);
  assert.ok(before.some(row => WordData.details(row).word === 'criteria'));
  const words = bank.map(row => WordData.details(row));
  assert.ok(words.every(row => row.senses.every(sense => sense.pos && sense.pos !== '词性未标注')));
  assert.equal(words.filter(row => !row.examples.length).length, 22);
  const like = words.find(row => row.word === 'like');
  for (const pos of ['noun', 'verb', 'adj.', 'adv.', 'prep.']) assert.ok(like.pos.includes(pos));
});
