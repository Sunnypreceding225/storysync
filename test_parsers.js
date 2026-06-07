// Node test harness for StorySync's parsers.
// Loads parser functions directly from StorySync.jsx, runs them against
// hand-crafted inputs for all six supported formats, and asserts behavior.
//
// Run: node test_parsers.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'StorySync.jsx'), 'utf8');

// Extract everything from "function trim(s)" to "function buildProjectFromScenes("
// That block contains every parser + helper we need to test.
const startIdx = SRC.indexOf('function trim(s)');
const endIdx = SRC.indexOf('function buildProjectFromScenes');
if (startIdx < 0 || endIdx < 0) {
    console.error('FATAL: could not locate parser block in StorySync.jsx');
    process.exit(2);
}
const parserCode = SRC.slice(startIdx, endIdx);

// Function names we want exposed on the sandbox after eval.
const EXPORTS = [
    'trim', 'padNumber', 'formatTime', 'getExtension', 'arrayContains',
    'parseTimecode', 'parseDuration',
    'parseDelimited', 'parseCSV', 'parseTSV',
    'parsePlainText', 'parsePlainTextStructured', 'parseProse',
    'chunkProseByParagraph', 'chunkProseByWordCount', 'splitIntoSentences',
    'splitLongSentence', 'splitByRawWords',
    'countWords', 'durationFromWords',
    'parseMarkdown', 'parseFountain', 'parseJSONScript',
    'parseProductionScript',
    'detectFormat', 'extToFormat', 'parseScriptContent',
    'normalizeSceneTimings', 'isUnsupportedBinaryFormat',
    'validateSceneTimings'
];

const wrapped = parserCode + '\n' +
    EXPORTS.map(n => `this.${n} = ${n};`).join('\n');

// Sandbox with only ES3-compatible globals (mirrors ExtendScript).
// Inject the prose-chunking constants that live above our extraction window.
const sandbox = vm.createContext({
    JSON, Array, String, Number, Math, RegExp, Error,
    parseInt, parseFloat, isNaN, Infinity, undefined,
    WORDS_PER_MINUTE: 130,
    WORDS_PER_SCENE_TARGET: 20,
    WORDS_PER_SCENE_MAX: 22,
    MIN_SCENE_SECONDS: 1.0
});
vm.runInContext(wrapped, sandbox);

const P = sandbox; // shorthand

// ---- Test harness ----

let pass = 0, fail = 0;
const failures = [];

function eq(actual, expected, name) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) { pass++; }
    else {
        fail++;
        failures.push({ name, expected: e, actual: a });
        console.log(`  FAIL: ${name}\n    expected: ${e}\n    actual:   ${a}`);
    }
}

function ok(cond, name) {
    if (cond) { pass++; }
    else {
        fail++;
        failures.push({ name, expected: 'truthy', actual: 'falsy' });
        console.log(`  FAIL: ${name}`);
    }
}

function section(name) { console.log(`\n[${name}]`); }

// ===== UTILITIES =====
section('utilities');
eq(P.trim('  hi  '), 'hi', 'trim');
eq(P.trim(null), '', 'trim(null)');
eq(P.padNumber(3, 2), '03', 'padNumber single');
eq(P.padNumber(15, 2), '15', 'padNumber double');
eq(P.getExtension('foo.CSV'), 'csv', 'getExtension lower');
eq(P.getExtension('no_ext'), '', 'getExtension none');
ok(P.arrayContains(['a', 'b'], 'a'), 'arrayContains hit');
ok(!P.arrayContains(['a', 'b'], 'c'), 'arrayContains miss');
eq(P.parseTimecode('0:05'), 5, 'parseTimecode 0:05');
eq(P.parseTimecode('1:30'), 90, 'parseTimecode 1:30');
eq(P.parseTimecode('5s'), 5, 'parseTimecode 5s');
eq(P.parseTimecode('5'), 5, 'parseTimecode bare');
eq(P.parseDuration('7s'), 7, 'parseDuration 7s');
eq(P.parseDuration(''), 5, 'parseDuration default');

// ===== CSV =====
section('parseCSV');
const csv4col = 'scene,start,end,description\n1,0:00,0:05,Logo intro\n2,0:05,0:12,Problem statement';
const csv4parsed = P.parseCSV(csv4col);
eq(csv4parsed.length, 2, 'csv 4-col count');
eq(csv4parsed[0].number, 1, 'csv 4-col scene 1 number');
eq(csv4parsed[0].startTime, 0, 'csv 4-col scene 1 start');
eq(csv4parsed[0].endTime, 5, 'csv 4-col scene 1 end');
eq(csv4parsed[0].description, 'Logo intro', 'csv 4-col scene 1 desc');
eq(csv4parsed[1].description, 'Problem statement', 'csv 4-col scene 2 desc');

const csv2col = 'Logo intro,5\nProblem statement,7';
const csv2parsed = P.parseCSV(csv2col);
eq(csv2parsed.length, 2, 'csv 2-col count');
eq(csv2parsed[0].description, 'Logo intro', 'csv 2-col desc');
eq(csv2parsed[0].duration, 5, 'csv 2-col duration');

// Header detection
const csv_header_only = 'description,duration\nLogo intro,5';
const csvHdrParsed = P.parseCSV(csv_header_only);
eq(csvHdrParsed.length, 1, 'csv header-only-row stripped');
eq(csvHdrParsed[0].description, 'Logo intro', 'csv post-header desc');

// Commas inside description (4-col path joins remaining parts)
const csvComma = '1,0:00,0:05,Hello, world';
const csvCommaParsed = P.parseCSV(csvComma);
eq(csvCommaParsed[0].description, 'Hello, world', 'csv comma-in-desc');

// ===== TSV =====
section('parseTSV');
const tsv = 'scene\tstart\tend\tdescription\n1\t0:00\t0:05\tLogo intro\n2\t0:05\t0:12\tProblem statement';
const tsvParsed = P.parseTSV(tsv);
eq(tsvParsed.length, 2, 'tsv count');
eq(tsvParsed[0].description, 'Logo intro', 'tsv desc 1');
eq(tsvParsed[1].endTime, 12, 'tsv end 2');

// ===== Plain text (structured "| duration" form) =====
section('parsePlainText (structured)');
const txt = 'Logo intro | 5s\nProblem statement | 7s\nIntroduce the product';
const txtParsed = P.parsePlainText(txt);
eq(txtParsed.length, 3, 'txt structured count');
eq(txtParsed[0].duration, 5, 'txt structured duration 1');
eq(txtParsed[0].description, 'Logo intro', 'txt structured desc 1');
eq(txtParsed[2].duration, 5, 'txt structured default duration');
eq(txtParsed[2].description, 'Introduce the product', 'txt structured desc 3');

// ===== Plain text prose: Case 1 (blank-line paragraphs) =====
section('parsePlainText prose Case 1 (paragraphs)');
const proseCase1 =
    'Technology has always left the service business behind.\n' +
    'Until now.\n' +
    '\n' +
    'Menutize.ai is the definitive platform—\n' +
    'the last operating system you will ever need.\n' +
    '\n' +
    'Built to start with you, scale with you,\n' +
    'and become an asset you can one day pass on….';
const c1 = P.parsePlainText(proseCase1);
eq(c1.length, 3, 'Case 1: blank lines -> 3 scenes');
eq(c1[0].description, 'Technology has always left the service business behind. Until now.', 'Case 1: paragraph 1 joins internal line breaks');
eq(c1[1].description, 'Menutize.ai is the definitive platform— the last operating system you will ever need.', 'Case 1: paragraph 2 joins internal line breaks');
eq(c1[2].description, 'Built to start with you, scale with you, and become an asset you can one day pass on….', 'Case 1: paragraph 3 joins internal line breaks');
// Every paragraph's duration must equal countWords/130*60
for (let i = 0; i < c1.length; i++) {
    const w = P.countWords(c1[i].description);
    const expected = Math.max(1, (w / 130) * 60);
    ok(Math.abs(c1[i].duration - expected) < 0.01, `Case 1: para ${i + 1} duration matches ${w}w @ 130wpm`);
}

// ===== Plain text prose: Case 2 (no blank lines, word-count chunking) =====
section('parsePlainText prose Case 2 (word chunks)');
const proseCase2 =
    'Technology has always left the service business behind. Until now.\n' +
    'Menutize.ai is the definitive platform—\n' +
    'the last operating system you will ever need.\n' +
    'Built to start with you, scale with you,\n' +
    'and become an asset you can one day pass on….';
const c2 = P.parsePlainText(proseCase2);
ok(c2.length >= 2, 'Case 2: produces multiple scenes from prose');
// Every scene should be at or under 22 words (or just one sentence if longer)
let allUnderCap = true;
let totalWords = 0;
for (const s of c2) {
    const w = P.countWords(s.description);
    totalWords += w;
    if (w > 22) { // WORDS_PER_SCENE_MAX
        // Single-sentence overrun is OK; check it's at most 1 sentence worth
        const sents = P.splitIntoSentences(s.description);
        if (sents.length > 1) allUnderCap = false;
    }
}
ok(allUnderCap, 'Case 2: multi-sentence chunks stay <= 22 words');
// Words across all scenes should equal the input
const inputFlat = proseCase2.replace(/\s+/g, ' ').trim();
eq(totalWords, P.countWords(inputFlat), 'Case 2: no words lost in chunking');

// Long run-on with no line breaks -> still chunks
const longRunOn = 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten. Eleven. Twelve. Thirteen. Fourteen. Fifteen. Sixteen. Seventeen. Eighteen. Nineteen. Twenty. Twenty one. Twenty two. Twenty three. Twenty four. Twenty five.';
const cRO = P.parsePlainText(longRunOn);
ok(cRO.length >= 2, 'long run-on chunks into multiple scenes');

// Single short prose line (no blank, no pipe)
const oneLine = 'Just a short script.';
const sl = P.parsePlainText(oneLine);
eq(sl.length, 1, 'single short line -> single scene');
eq(sl[0].description, 'Just a short script.', 'single line preserved');
ok(sl[0].duration >= 1, 'min scene duration enforced');

// ===== Word/duration helpers =====
section('countWords / durationFromWords');
eq(P.countWords('one two three'), 3, 'countWords');
eq(P.countWords(''), 0, 'countWords empty');
eq(P.countWords('  spaced  out  text  '), 3, 'countWords ignores extra whitespace');
ok(Math.abs(P.durationFromWords(130) - 60) < 0.001, '130 words = 60s exact');
ok(P.durationFromWords(0) === 1.0, 'min duration floor 1s');
ok(Math.abs(P.durationFromWords(65) - 30) < 0.001, '65 words = 30s');

// ===== Sentence splitting =====
section('splitIntoSentences');
eq(P.splitIntoSentences('One. Two. Three.'), ['One.', 'Two.', 'Three.'], 'split simple sentences');
eq(P.splitIntoSentences('Hello! World? Yes.'), ['Hello!', 'World?', 'Yes.'], 'split mixed punctuation');
eq(P.splitIntoSentences('Half a sentence with no end'), ['Half a sentence with no end'], 'unterminated tail kept');
eq(P.splitIntoSentences(''), [], 'split empty');

// ===== Markdown =====
section('parseMarkdown');
const md = [
    '# Logo intro (5s)',
    '## Problem statement (7s)',
    '- Introduce the product | 13s',
    '- Feature 1 dashboard overview | 10s',
    '1. Testimonial (10s)',
    '2) CTA (5s)',
    '```',
    'code fence to ignore',
    '```',
    ''
].join('\n');
const mdParsed = P.parseMarkdown(md);
eq(mdParsed.length, 6, 'md scene count');
eq(mdParsed[0].description, 'Logo intro', 'md heading desc strips paren');
eq(mdParsed[0].duration, 5, 'md heading duration from paren');
eq(mdParsed[1].duration, 7, 'md h2 duration');
eq(mdParsed[2].description, 'Introduce the product', 'md bullet desc');
eq(mdParsed[2].duration, 13, 'md bullet pipe duration');
eq(mdParsed[4].description, 'Testimonial', 'md numbered 1.');
eq(mdParsed[5].description, 'CTA', 'md numbered 2)');

// "Scene N:" prefix stripped
const mdScenePrefix = '# Scene 1: Logo intro (5s)\n# Scene 2 - Problem (7s)';
const mdSpParsed = P.parseMarkdown(mdScenePrefix);
eq(mdSpParsed[0].description, 'Logo intro', 'md strip "Scene 1:" prefix');
eq(mdSpParsed[1].description, 'Problem', 'md strip "Scene 2 -" prefix');

// ===== Fountain =====
section('parseFountain');
const fountain = [
    'Title: Demo',
    'Credit: Written by',
    'Author: Me',
    '',
    'INT. COFFEE SHOP - DAY',
    '',
    'A woman sits with her laptop, frustrated.',
    '',
    'EXT. PARK - DAY',
    '',
    'She walks across the park.',
    '',
    '.MONTAGE - VARIOUS LOCATIONS',
    '',
    'Lots of stuff happens.',
    '',
    'I/E. CAR - NIGHT',
    '',
    'EST. CITY SKYLINE'
].join('\n');
const fountainParsed = P.parseFountain(fountain);
eq(fountainParsed.length, 5, 'fountain scene count (skips title page)');
eq(fountainParsed[0].description, 'INT. COFFEE SHOP - DAY', 'fountain scene 1');
eq(fountainParsed[1].description, 'EXT. PARK - DAY', 'fountain scene 2');
eq(fountainParsed[2].description, 'MONTAGE - VARIOUS LOCATIONS', 'fountain forced scene strips dot');
eq(fountainParsed[3].description, 'I/E. CAR - NIGHT', 'fountain I/E scene');
eq(fountainParsed[4].description, 'EST. CITY SKYLINE', 'fountain EST scene');
eq(fountainParsed[0].duration, 5, 'fountain default duration');

// ===== JSON =====
section('parseJSONScript');
const json1 = JSON.stringify([
    { description: 'Logo intro', duration: 5 },
    { description: 'Problem statement', start: '0:05', end: '0:12' },
    { number: 3, title: 'Intro', duration: 13 }
]);
const j1 = P.parseJSONScript(json1);
eq(j1.length, 3, 'json array length');
eq(j1[0].description, 'Logo intro', 'json desc field');
eq(j1[0].duration, 5, 'json duration');
eq(j1[1].startTime, 5, 'json start parse');
eq(j1[1].endTime, 12, 'json end parse');
eq(j1[2].description, 'Intro', 'json title->description');
eq(j1[2].number, 3, 'json explicit number');

// Wrapped form
const json2 = JSON.stringify({ scenes: [{ description: 'Solo', duration: 8 }] });
const j2 = P.parseJSONScript(json2);
eq(j2.length, 1, 'json wrapped {scenes:} works');
eq(j2[0].duration, 8, 'json wrapped duration');

// Invalid JSON throws
let threw = false;
try { P.parseJSONScript('not json'); } catch (e) { threw = true; }
ok(threw, 'invalid JSON throws');

threw = false;
try { P.parseJSONScript('{"foo": 1}'); } catch (e) { threw = true; }
ok(threw, 'JSON object without scenes throws');

// ===== Format detection =====
section('detectFormat');
eq(P.detectFormat('[{"a":1}]'), 'json', 'detect json array');
eq(P.detectFormat('{"scenes":[]}'), 'json', 'detect json object');
eq(P.detectFormat('INT. ROOM - DAY\n\nText.'), 'fountain', 'detect fountain INT.');
eq(P.detectFormat('EXT. PARK - DAY'), 'fountain', 'detect fountain EXT.');
eq(P.detectFormat('# Heading\nbody'), 'markdown', 'detect markdown');
eq(P.detectFormat('a,b,c,d\n1,2,3,4'), 'csv', 'detect csv (commas)');
eq(P.detectFormat('a\tb\tc\td\n1\t2\t3\t4'), 'tsv', 'detect tsv (tabs)');
eq(P.detectFormat('Logo | 5s\nIntro | 7s'), 'txt', 'detect plaintext (pipes)');
eq(P.detectFormat(''), 'txt', 'detect empty -> txt');

// ===== Extension mapping =====
section('extToFormat');
eq(P.extToFormat('csv'), 'csv', 'ext csv');
eq(P.extToFormat('CSV'), 'csv', 'ext case-insensitive');
eq(P.extToFormat('tsv'), 'tsv', 'ext tsv');
eq(P.extToFormat('md'), 'markdown', 'ext md');
eq(P.extToFormat('markdown'), 'markdown', 'ext markdown');
eq(P.extToFormat('fountain'), 'fountain', 'ext fountain');
eq(P.extToFormat('spmd'), 'fountain', 'ext spmd');
eq(P.extToFormat('json'), 'json', 'ext json');
eq(P.extToFormat('txt'), 'txt', 'ext txt');
eq(P.extToFormat('jpg'), null, 'ext unknown -> null');

// ===== Unsupported binary formats =====
section('isUnsupportedBinaryFormat');
ok(P.isUnsupportedBinaryFormat('pdf'), 'pdf unsupported');
ok(P.isUnsupportedBinaryFormat('PDF'), 'PDF case-insensitive');
ok(P.isUnsupportedBinaryFormat('docx'), 'docx unsupported');
ok(P.isUnsupportedBinaryFormat('pages'), 'pages unsupported');
ok(!P.isUnsupportedBinaryFormat('csv'), 'csv supported');
ok(!P.isUnsupportedBinaryFormat('md'), 'md supported');

// ===== Dispatch =====
section('parseScriptContent dispatch');
const d1 = P.parseScriptContent('Logo | 5s', null);
eq(d1.length, 1, 'auto-detect plaintext');
eq(d1[0].description, 'Logo', 'auto-detect plaintext desc');

const d2 = P.parseScriptContent('1,0:00,0:05,Logo', 'csv');
eq(d2[0].description, 'Logo', 'forced csv format');

const d3 = P.parseScriptContent('# Logo (5s)', 'markdown');
eq(d3[0].duration, 5, 'forced markdown format');

const d4 = P.parseScriptContent('INT. ROOM - DAY', null);
eq(d4[0].description, 'INT. ROOM - DAY', 'auto-detect fountain');

const d5 = P.parseScriptContent('[{"description":"Solo","duration":3}]', null);
eq(d5[0].duration, 3, 'auto-detect json');

// ===== Normalize timings =====
section('normalizeSceneTimings');
const raw = [
    { number: 1, startTime: -1, endTime: -1, duration: 5, description: 'a' },
    { number: 2, startTime: -1, endTime: -1, duration: 7, description: 'b' },
    { number: 3, startTime: -1, endTime: -1, duration: 3, description: 'c' }
];
const normed = P.normalizeSceneTimings(raw);
eq(normed[0].startTime, 0, 'norm 0 start');
eq(normed[0].endTime, 5, 'norm 0 end');
eq(normed[1].startTime, 5, 'norm 1 start sequenced');
eq(normed[1].endTime, 12, 'norm 1 end sequenced');
eq(normed[2].startTime, 12, 'norm 2 start sequenced');
eq(normed[2].endTime, 15, 'norm 2 end sequenced');

// Mixed: explicit start/end preserved, missing filled
const mixed = [
    { number: 1, startTime: 0, endTime: 5, description: 'a' },
    { number: 2, startTime: -1, endTime: -1, duration: 7, description: 'b' }
];
const mixedN = P.normalizeSceneTimings(mixed);
eq(mixedN[0].duration, 5, 'norm explicit duration filled');
eq(mixedN[1].startTime, 5, 'norm next sequenced from prior end');
eq(mixedN[1].endTime, 12, 'norm next end');

// ===== Line ending normalization (ScriptUI Windows quirk) =====
section('line endings');
const userText =
    "Technology has always left the service business behind.\n" +
    "Until now.\n" +
    "Menutize.ai is the definitive platform—\n" +
    "the last operating system you will ever need.\n" +
    "Built to start with you, scale with you,\n" +
    "and become an asset you can one day pass on….\n" +
    "But we're more than software.\n" +
    "We're infrastructure.";
const lfScenes = P.parseScriptContent(userText, null);
const crScenes = P.parseScriptContent(userText.replace(/\n/g, '\r'), null);
const crlfScenes = P.parseScriptContent(userText.replace(/\n/g, '\r\n'), null);
ok(lfScenes.length >= 2, 'LF: produces multiple scenes');
eq(crScenes.length, lfScenes.length, 'CR-only same scene count as LF (regression: ScriptUI Win edittext)');
eq(crlfScenes.length, lfScenes.length, 'CRLF same scene count as LF');
// Same descriptions
for (let i = 0; i < lfScenes.length; i++) {
    eq(crScenes[i].description, lfScenes[i].description, `CR scene ${i+1} desc matches LF`);
}

// ===== Regression: [timecode] strings must not be classified as JSON =====
section('regression: bracket-timecode is not JSON');
eq(P.detectFormat('[0:00-0:08]\n\n"Hello world."'), 'production', '[timecode] detected as production, not json');
eq(P.detectFormat('[HOOK - 0:00-0:08]\nbody'), 'production', '[HEADING-time-time] detected as production');
eq(P.detectFormat('[0:00–0:08]\nbody'), 'production', 'en-dash timecode bracket detected as production');
// Real JSON still works
eq(P.detectFormat('[{"a":1}]'), 'json', 'real JSON still detected');
eq(P.detectFormat('{"scenes":[]}'), 'json', 'real JSON object still detected');
// Make sure parsing routes correctly (no JSON.parse error on bracket-timecode prose)
const bracketProse = '[0:00-0:08]\n\nVOICEOVER: "Hello world."\n\n[0:08-0:16]\n\nVOICEOVER: "Second scene."';
const bp = P.parseScriptContent(bracketProse, null);
ok(bp.length >= 1, 'bracket-timecode prose parses without throwing');

// ===== Production script (real-world explainer format) =====
section('parseProductionScript');
const prod = [
    'ACTICIO — Explainer Video Script',
    'Duration: 60-90 Seconds',
    '',
    '',
    '[HOOK - 0:00-0:08]',
    '',
    'VISUAL:',
    'Hundreds of resumes flood the screen.',
    'AI-generated resumes duplicate infinitely.',
    '',
    'VOICEOVER:',
    '"Hiring used to be hard.',
    'Now with AI-generated resumes…',
    'it\'s becoming impossible."',
    '',
    '',
    '[PROBLEM - 0:08-0:20]',
    '',
    'VISUAL:',
    'Two candidates appear side-by-side.',
    '',
    'VOICEOVER:',
    '"Everyone looks qualified on paper.',
    'But resumes don\'t show who can actually build."'
].join('\n');
const prodScenes = P.parseProductionScript(prod);
eq(prodScenes.length, 2, 'production: 2 sections detected, title block skipped');
eq(prodScenes[0].startTime, 0, 'production: scene 1 start = 0:00');
eq(prodScenes[0].endTime, 8, 'production: scene 1 end = 0:08');
ok(prodScenes[0].description.indexOf('Hiring used to be hard') !== -1, 'production: scene 1 description from VOICEOVER block');
ok(prodScenes[0].description.indexOf('VISUAL') === -1, 'production: VISUAL content excluded from description');
ok(prodScenes[0].description.indexOf('VOICEOVER') === -1, 'production: VOICEOVER label not in description');
eq(prodScenes[1].startTime, 8, 'production: scene 2 start = 0:08');
eq(prodScenes[1].endTime, 20, 'production: scene 2 end = 0:20');
ok(prodScenes[1].description.indexOf('Everyone looks qualified') !== -1, 'production: scene 2 description from VOICEOVER block');

// Em-dash and en-dash variants
const dashVariants = '[INTRO — 0:00—0:08]\n\nVOICEOVER:\n"Em dash test."\n\n[OUTRO – 0:08–0:16]\n\nVOICEOVER:\n"En dash test."';
const dvScenes = P.parseProductionScript(dashVariants);
eq(dvScenes.length, 2, 'production: handles em-dash and en-dash');
eq(dvScenes[0].endTime, 8, 'production: em-dash timecode parsed');
eq(dvScenes[1].endTime, 16, 'production: en-dash timecode parsed');

// Auto-detect production format from real text
eq(P.detectFormat('[HOOK — 0:00–0:08]\n\nVOICEOVER:\n"hi"'), 'production', 'auto-detect production from real-world script');

// Lean production format - just [timecode] then quoted VO text, no labels
const lean = [
    '[0:00–0:08]',
    '',
    '"Hiring used to be hard.',
    'Now with AI-generated resumes…',
    'it\'s becoming impossible."',
    '',
    '',
    '[0:08–0:20]',
    '',
    '"Everyone looks qualified on paper.',
    'But resumes don\'t show who can actually build."',
    '',
    '',
    '[1:20–1:30]',
    '',
    '"Stop hiring based on resumes.',
    'Start hiring based on builders.',
    '',
    'Acticio.',
    'Hire Real Builders."'
].join('\n');
const leanScenes = P.parseProductionScript(lean);
eq(leanScenes.length, 3, 'lean production: 3 timecode sections');
ok(leanScenes[0].description.indexOf('Hiring used to be hard') !== -1, 'lean: scene 1 VO captured (no VOICEOVER: label)');
ok(leanScenes[0].description.indexOf('becoming impossible') !== -1, 'lean: multi-line VO joined');
ok(leanScenes[1].description.indexOf('Everyone looks qualified') !== -1, 'lean: scene 2 VO captured');
ok(leanScenes[2].description.indexOf('Acticio') !== -1, 'lean: scene 3 keeps post-blank-line content');
eq(leanScenes[0].startTime, 0, 'lean: scene 1 start');
eq(leanScenes[0].endTime, 8, 'lean: scene 1 end');
eq(leanScenes[2].endTime, 90, 'lean: scene 3 end = 1:30');

// ===== Regression: prose with many commas must not be classified as CSV =====
section('regression: comma-rich prose');
const proseWithCommas = "Technology has always left service behind. With Menutize, you choose your industry, and within seconds, a beautiful, battle-tested storefront is deployed. You edit your details, connect your domain, and link your bank. Just like that, you're in business.";
eq(P.detectFormat(proseWithCommas), 'txt', 'single-line prose with commas not mis-detected as csv');
const single = P.parseScriptContent(proseWithCommas, null);
ok(single.length >= 2, 'single-line prose with many sentences produces >=2 scenes');
let maxW = 0;
for (const s of single) { const w = P.countWords(s.description); if (w > maxW) maxW = w; }
ok(maxW <= 22, `regression: max words/scene <= 22 (got ${maxW})`);

// ===== Regression: blank-line + long paragraph must still chunk inside paragraphs =====
section('regression: paragraph-aware word chunking');
const longPara = "First short paragraph.\n\n" + "x".repeat(0) + "This is a much longer second paragraph that goes on and on with many words and many sentences. " + "It just keeps going. ".repeat(8) + "And ends here.";
const lpScenes = P.parseScriptContent(longPara, null);
maxW = 0;
for (const s of lpScenes) { const w = P.countWords(s.description); if (w > maxW) maxW = w; }
ok(maxW <= 22, `regression: long paragraph chunked, max words <= 22 (got ${maxW})`);
ok(lpScenes.length >= 2, `long paragraph produces multiple scenes (got ${lpScenes.length})`);

// ===== Regression: long single sentence chunks at commas and word count =====
section('regression: long sentence chunking');
const longSentence = "Hiring today is no longer about simply reviewing resumes because AI tools have made it easier than ever for candidates to optimize wording and appear qualified on paper even when they lack real execution ability, which creates a huge problem for technical hiring teams trying to identify people who can actually build products, solve problems, and ship consistently in real-world environments.";
const ls = P.parseScriptContent(longSentence, null);
ok(ls.length >= 3, `long sentence chunked into multiple scenes (got ${ls.length})`);
let maxLs = 0;
for (const s of ls) { const w = P.countWords(s.description); if (w > maxLs) maxLs = w; }
ok(maxLs <= 22, `no chunk exceeds 22 words (max ${maxLs})`);

// Sentence with no commas falls back to raw word count split
const noComma = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five";
const ncChunks = P.splitLongSentence(noComma, 10);
ok(ncChunks.length >= 2, 'no-comma sentence falls back to raw word count split');

// ===== Regression: blank production sections are skipped =====
section('regression: blank production sections');
const blank = "[0:00–0:05]\n\n[0:05–0:10]\nActual line.";
const blankScenes = P.parseProductionScript(blank);
eq(blankScenes.length, 1, 'blank section skipped, only the one with content survives');
eq(blankScenes[0].description, 'Actual line.', 'surviving scene has correct content');

// Blank section with a real title is kept
const titleNoContent = "[INTRO - 0:00–0:05]\n\n[0:05–0:10]\nContent here.";
const tncScenes = P.parseProductionScript(titleNoContent);
eq(tncScenes.length, 2, 'section with real title kept even when content is blank');
eq(tncScenes[0].description, 'INTRO', 'blank-content scene falls back to its title');

// ===== Regression: backward timestamps throw =====
section('regression: backward timestamps');
let backThrew = false;
try { P.parseProductionScript("[0:20–0:10]\nReversed."); }
catch (e) { backThrew = true; ok(e.message.indexOf('Invalid') !== -1, 'backward timestamp error mentions Invalid'); }
ok(backThrew, 'backward timestamp throws');

let zeroLenThrew = false;
try { P.parseProductionScript("[0:10–0:10]\nZero length."); }
catch (e) { zeroLenThrew = true; }
ok(zeroLenThrew, 'zero-length timestamp throws');

// ===== Regression: 2-column CSV detected (was misclassified as txt) =====
section('regression: 2-column CSV detection');
eq(P.detectFormat("Time,Text\n0:00,Hello\n0:05,World"), 'csv', '2-column CSV detected (1 comma per line)');
const twoCol = P.parseScriptContent("Time,Text\n0:00,Hello\n0:05,World", null);
ok(twoCol.length >= 2, '2-column CSV produces scenes');

// ===== validateSceneTimings =====
section('validateSceneTimings');
eq(P.validateSceneTimings([]), [], 'empty -> no warnings');
eq(P.validateSceneTimings([{startTime: 0, endTime: 5, description: "a"}]), [], 'single scene -> no warnings');

// Overlap
const overlap = [
    {startTime: 0, endTime: 8, description: "Scene one"},
    {startTime: 6, endTime: 12, description: "Scene two overlaps"}
];
const oWarn = P.validateSceneTimings(overlap);
ok(oWarn.length === 1 && oWarn[0].indexOf('overlap') !== -1, 'detects overlap');

// Duplicate
const dup = [
    {startTime: 0, endTime: 8, description: "Scene A"},
    {startTime: 0, endTime: 8, description: "Scene B"}
];
const dWarn = P.validateSceneTimings(dup);
ok(dWarn.length === 1 && dWarn[0].indexOf('identical') !== -1, 'detects duplicate timestamps');

// Large gap
const gap = [
    {startTime: 0, endTime: 5, description: "Quick"},
    {startTime: 262, endTime: 430, description: "Huge jump"}
];
const gWarn = P.validateSceneTimings(gap);
ok(gWarn.length === 1 && gWarn[0].indexOf('gap') !== -1, 'detects large gap');

// Clean adjacent scenes - no warnings
const clean = [
    {startTime: 0, endTime: 5, description: "a"},
    {startTime: 5, endTime: 10, description: "b"},
    {startTime: 10, endTime: 15, description: "c"}
];
eq(P.validateSceneTimings(clean), [], 'clean adjacent scenes -> no warnings');

// ===== Edge: empty input =====
section('edge cases');
eq(P.parseCSV(''), [], 'parseCSV empty');
eq(P.parsePlainText(''), [], 'parsePlainText empty');
eq(P.parseMarkdown(''), [], 'parseMarkdown empty');
eq(P.parseFountain(''), [], 'parseFountain empty');

// CRLF line endings (Windows)
const crlf = '# Logo intro (5s)\r\n# Problem (7s)\r\n';
const crlfParsed = P.parseMarkdown(crlf);
eq(crlfParsed.length, 2, 'CRLF line endings');
eq(crlfParsed[0].description, 'Logo intro', 'CRLF md desc 1');

// ===== Summary =====
console.log(`\n--------\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
