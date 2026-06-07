/**
 * StorySync v1.0
 * Explainer video scene setup & timing tool for After Effects.
 * Script to timeline in one click.
 *
 * Features:
 *   - Scene builder: CSV/TXT script import to auto project structure
 *   - Voiceover sync: silence detection to auto scene breaks
 *   - Storyboard import: folder of images placed in scene comps
 *   - Beat marker: music peak detection to transition markers
 *
 * Install: Copy to (AE)/Scripts/ScriptUI Panels/ folder
 * Open: Window menu -> StorySync
 *
 * Compatible: After Effects 2022-2026, Windows & macOS
 * License: Commercial - see LICENSE.txt
 */

(function StorySync_Main(thisObj) {

    // =========================================================================
    // JSON POLYFILL (ExtendScript is ES3 - no native JSON)
    // =========================================================================

    if (typeof JSON === "undefined") {
        JSON = {};
        JSON.stringify = function (obj) {
            if (obj === null) return "null";
            if (typeof obj === "undefined") return "null";
            if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
            if (typeof obj === "string") {
                return '"' + obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
            }
            if (obj instanceof Array) {
                var items = [];
                for (var i = 0; i < obj.length; i++) items.push(JSON.stringify(obj[i]));
                return "[" + items.join(",") + "]";
            }
            if (typeof obj === "object") {
                var pairs = [];
                for (var key in obj) {
                    if (obj.hasOwnProperty(key)) pairs.push('"' + key + '":' + JSON.stringify(obj[key]));
                }
                return "{" + pairs.join(",") + "}";
            }
            return "null";
        };
        JSON.parse = function (str) { return eval("(" + str + ")"); };
    }

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    var APP_NAME = "StorySync";
    var APP_VERSION = "1.0";
    var SETTINGS_NS = "StorySync";

    var COLOR_BG = [49 / 255, 49 / 255, 49 / 255];
    var COLOR_TEXT = [220 / 255, 220 / 255, 220 / 255];
    var COLOR_HEADER = [160 / 255, 160 / 255, 160 / 255];
    var COLOR_PRIMARY = [0, 162 / 255, 255 / 255];
    var COLOR_SUCCESS = [180 / 255, 220 / 255, 180 / 255];
    var COLOR_WARNING = [255 / 255, 200 / 255, 0];

    var COMP_PRESET_KEYS = [
        "1080p 30fps", "1080p 24fps", "1080p 25fps",
        "4K 30fps", "4K 24fps",
        "Square 1080", "Vertical 9:16", "720p 30fps"
    ];
    var COMP_PRESETS = {
        "1080p 30fps": { width: 1920, height: 1080, fps: 30 },
        "1080p 24fps": { width: 1920, height: 1080, fps: 24 },
        "1080p 25fps": { width: 1920, height: 1080, fps: 25 },
        "4K 30fps":    { width: 3840, height: 2160, fps: 30 },
        "4K 24fps":    { width: 3840, height: 2160, fps: 24 },
        "Square 1080": { width: 1080, height: 1080, fps: 30 },
        "Vertical 9:16": { width: 1080, height: 1920, fps: 30 },
        "720p 30fps":  { width: 1280, height: 720,  fps: 30 }
    };

    var MARKER_COLOR_KEYS = [
        "Red", "Yellow", "Aqua", "Pink", "Lavender", "Peach", "Sea Foam", "Blue",
        "Green", "Purple", "Orange", "Brown", "Fuchsia", "Cyan", "Sand", "Dark Green"
    ];
    var MARKER_COLORS = {
        "Red": 1, "Yellow": 2, "Aqua": 3, "Pink": 4,
        "Lavender": 5, "Peach": 6, "Sea Foam": 7, "Blue": 8,
        "Green": 9, "Purple": 10, "Orange": 11, "Brown": 12,
        "Fuchsia": 13, "Cyan": 14, "Sand": 15, "Dark Green": 16
    };

    var IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "psd", "ai", "tif", "tiff", "bmp"];
    var AUDIO_EXTENSIONS = ["wav", "mp3", "aif", "aiff", "m4a"];

    var MAX_AUDIO_SECONDS_WARN = 180; // warn for >3 min files
    var MAX_FILE_SIZE = 5242880; // 5MB cap for CSV/TXT
    var MAX_BREAKS_WARN = 30;

    // Prose chunking: scripts without timestamps get auto-timed via these.
    // Case 1 (blank-line-separated paragraphs): each paragraph -> 1 scene.
    // Case 2 (no blank lines): chunk by sentence into groups of ~20 words.
    // Duration is always derived from word count assuming a 130 wpm read rate.
    var WORDS_PER_MINUTE = 130;
    var WORDS_PER_SCENE_TARGET = 20; // mid of 17-22 range
    var WORDS_PER_SCENE_MAX = 22;
    var MIN_SCENE_SECONDS = 1.0;

    // =========================================================================
    // MODULE STATE
    // =========================================================================

    var state = {
        parsedScenes: null,
        sceneComps: null,
        masterComp: null,
        voAudioLayer: null,
        voCachedAmps: null,
        voCachedFps: null,
        voCachedStartTime: null,
        voSilences: null,
        beatAudioLayer: null,
        beatCachedAmps: null,
        beatCachedFps: null,
        beatCachedStartTime: null,
        beatPeaks: null,
        storyboardFolder: null,
        storyboardFiles: null,
        storyboardItems: null
    };

    // =========================================================================
    // UTILITIES
    // =========================================================================

    function trim(s) {
        if (s === null || typeof s === "undefined") return "";
        return String(s).replace(/^\s+|\s+$/g, "");
    }

    function padNumber(num, digits) {
        var s = String(num);
        while (s.length < digits) s = "0" + s;
        return s;
    }

    function formatTime(seconds) {
        if (seconds < 0) seconds = 0;
        var mins = Math.floor(seconds / 60);
        var secs = seconds - (mins * 60);
        var secsStr = secs.toFixed(2);
        if (secs < 10) secsStr = "0" + secsStr;
        return mins + ":" + secsStr;
    }

    function getExtension(fileName) {
        var dot = fileName.lastIndexOf(".");
        if (dot === -1) return "";
        return fileName.substring(dot + 1).toLowerCase();
    }

    function arrayContains(arr, item) {
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] === item) return true;
        }
        return false;
    }

    function getActiveComp() {
        if (!app.project) {
            alert("No project open.");
            return null;
        }
        var item = app.project.activeItem;
        if (!item || !(item instanceof CompItem)) {
            alert("Please open a composition first.");
            return null;
        }
        return item;
    }

    function findCompByName(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === name) return item;
        }
        return null;
    }

    function findExistingSceneComps() {
        // Returns array of comps named "Scene_NN - ..." sorted by number
        var found = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (!(item instanceof CompItem)) continue;
            var m = item.name.match(/^Scene_(\d+)\b/);
            if (m) {
                found.push({ num: parseInt(m[1], 10), comp: item });
            }
        }
        found.sort(function (a, b) { return a.num - b.num; });
        var comps = [];
        for (var j = 0; j < found.length; j++) comps.push(found[j].comp);
        return comps;
    }

    function deselectAllLayers(comp) {
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
    }

    function parseTimecode(str) {
        str = trim(str);
        if (str === "") return 0;
        if (str.indexOf(":") !== -1) {
            var parts = str.split(":");
            return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
        }
        return parseFloat(str.replace(/s/gi, "")) || 0;
    }

    function parseDuration(str) {
        str = trim(str);
        return parseFloat(str.replace(/s/gi, "")) || 5;
    }

    // =========================================================================
    // SETTINGS PERSISTENCE
    // =========================================================================

    function loadSetting(key, defaultVal) {
        try {
            if (app.settings.haveSetting(SETTINGS_NS, key)) {
                return app.settings.getSetting(SETTINGS_NS, key);
            }
        } catch (e) { }
        return defaultVal;
    }

    function saveSetting(key, val) {
        try { app.settings.saveSetting(SETTINGS_NS, key, String(val)); } catch (e) { }
    }

    function loadFloatSetting(key, defaultVal) {
        var v = loadSetting(key, null);
        if (v === null) return defaultVal;
        var f = parseFloat(v);
        if (isNaN(f)) return defaultVal;
        return f;
    }

    // =========================================================================
    // AUDIO ANALYSIS
    // =========================================================================

    function runConvertAudioToKeyframes(comp, audioLayer) {
        // Make this comp the active item so the menu command targets it
        comp.openInViewer();
        deselectAllLayers(comp);
        audioLayer.selected = true;

        // Solo the target layer so the comp's audio mix during analysis only
        // contains this layer (otherwise music/other VO contaminates the
        // amplitude readings used for silence and peak detection).
        var wasSolo = false;
        try { wasSolo = audioLayer.solo; } catch (e) { }
        try { audioLayer.solo = true; } catch (e) { }

        try {
            var cmdId = app.findMenuCommandId("Convert Audio to Keyframes");
            if (cmdId === 0) throw new Error("Could not find 'Convert Audio to Keyframes' menu command. Update After Effects.");
            app.executeCommand(cmdId);

            // Locate the newly-created Audio Amplitude layer
            var ampLayer = null;
            for (var i = 1; i <= comp.numLayers; i++) {
                if (comp.layer(i).name === "Audio Amplitude") { ampLayer = comp.layer(i); break; }
            }
            if (!ampLayer) throw new Error("Audio Amplitude layer was not created by After Effects.");
            return ampLayer;
        } finally {
            try { audioLayer.solo = wasSolo; } catch (e2) { }
        }
    }

    function readAmplitudes(comp, ampLayer, audioLayer) {
        var bothChannels;
        try {
            bothChannels = ampLayer.property("Effects").property("Both Channels").property("Slider");
        } catch (e) {
            throw new Error("Could not read Both Channels slider from Audio Amplitude layer.");
        }
        var fps = comp.frameRate;
        var startTime = Math.max(audioLayer.inPoint, 0);
        var endTime = Math.min(audioLayer.outPoint, comp.duration);
        if (endTime <= startTime) throw new Error("Audio layer has zero duration in comp.");
        var numFrames = Math.floor((endTime - startTime) * fps);
        var amps = [];
        for (var i = 0; i < numFrames; i++) {
            var t = startTime + (i / fps);
            amps.push(bothChannels.valueAtTime(t, false));
        }
        return { amps: amps, fps: fps, startTime: startTime };
    }

    function findSilences(amps, fps, silenceThreshold, minSilenceDuration, minSceneDuration) {
        // Returns array of silence ranges (objects with midFrame, midTime, durationSec)
        // minSceneDuration filters out breaks too close together
        var minFrames = Math.max(1, Math.floor(minSilenceDuration * fps));
        var minSceneFrames = Math.max(1, Math.floor(minSceneDuration * fps));

        var silences = [];
        var silenceStart = -1;
        for (var i = 0; i < amps.length; i++) {
            if (amps[i] < silenceThreshold) {
                if (silenceStart === -1) silenceStart = i;
            } else {
                if (silenceStart !== -1) {
                    var silLen = i - silenceStart;
                    if (silLen >= minFrames) {
                        var midFrame = silenceStart + Math.floor(silLen / 2);
                        silences.push({
                            startFrame: silenceStart,
                            endFrame: i,
                            midFrame: midFrame,
                            startTime: silenceStart / fps,
                            endTime: i / fps,
                            midTime: midFrame / fps,
                            durationSec: silLen / fps
                        });
                    }
                    silenceStart = -1;
                }
            }
        }

        // Filter: require min scene duration between consecutive break midpoints
        var filtered = [];
        var lastBreak = -minSceneFrames;
        for (var k = 0; k < silences.length; k++) {
            if ((silences[k].midFrame - lastBreak) >= minSceneFrames) {
                filtered.push(silences[k]);
                lastBreak = silences[k].midFrame;
            }
        }
        return filtered;
    }

    function findPeaks(amps, fps, sensitivity, minGapSec) {
        // sensitivity 0-100 maps to amplitude threshold
        // higher sensitivity = higher threshold (fewer peaks)
        // amplitude range is loosely 0-100, with most content under 30
        var threshold = (sensitivity / 100) * 30; // map 50 -> 15 amp units
        if (threshold < 0.5) threshold = 0.5;
        var minGapFrames = Math.max(1, Math.floor(minGapSec * fps));

        var peaks = [];
        var lastPeakFrame = -minGapFrames;
        for (var i = 1; i < amps.length - 1; i++) {
            if (amps[i] > threshold &&
                amps[i] > amps[i - 1] &&
                amps[i] >= amps[i + 1] &&
                (i - lastPeakFrame) >= minGapFrames) {
                peaks.push({ frame: i, time: i / fps, amplitude: amps[i] });
                lastPeakFrame = i;
            }
        }
        return peaks;
    }

    // =========================================================================
    // SCENE BUILDER
    // =========================================================================

    // -- delimited (CSV / TSV) ------------------------------------------------

    function stripCsvQuotes(s) {
        s = trim(s);
        if (s.length >= 2) {
            var first = s.charAt(0), last = s.charAt(s.length - 1);
            if ((first === '"' || first === "'") && (last === first)) {
                s = s.substring(1, s.length - 1);
            } else if (first === '"' || first === "'") {
                // Unbalanced quote (corrupted CSV) - strip just the leading one
                s = s.substring(1);
            } else if (last === '"' || last === "'") {
                s = s.substring(0, s.length - 1);
            }
        }
        return s;
    }

    function isHeaderRow(line, delimiter) {
        // Detect a CSV/TSV header by checking how many columns are common
        // header keywords. Avoids false-positives on data rows that happen
        // to contain substrings like "scene" or "start".
        var keywords = ["scene", "start", "end", "description", "time",
                        "text", "duration", "dialogue", "voiceover",
                        "content", "timecode", "timestamp", "length"];
        var parts = line.split(delimiter);
        var matches = 0;
        for (var i = 0; i < parts.length; i++) {
            var col = stripCsvQuotes(parts[i]).toLowerCase();
            if (arrayContains(keywords, col)) matches++;
        }
        if (parts.length <= 2) return matches === parts.length && matches > 0;
        return matches >= Math.ceil(parts.length / 2);
    }

    function parseDelimited(content, delimiter) {
        var lines = content.split("\n");
        var scenes = [];
        var startRow = 0;
        if (lines.length > 0 && isHeaderRow(lines[0], delimiter)) startRow = 1;

        var timeRangeRe = /^(\d+:\d+)\s*[\-–—]\s*(\d+:\d+)$/;

        for (var i = startRow; i < lines.length; i++) {
            var line = trim(lines[i].replace(/\r/g, ""));
            if (line === "") continue;
            var rawParts = line.split(delimiter);
            var parts = [];
            for (var pi = 0; pi < rawParts.length; pi++) parts.push(stripCsvQuotes(rawParts[pi]));

            // 4+ columns starting with a numeric scene id: scene, start, end, description
            if (parts.length >= 4 && /^\d+$/.test(parts[0])) {
                scenes.push({
                    number: parseInt(parts[0], 10) || (scenes.length + 1),
                    startTime: parseTimecode(parts[1]),
                    endTime: parseTimecode(parts[2]),
                    // Use rawParts so a description containing the delimiter
                    // (e.g. "Hello, world" in a CSV) keeps its original spaces.
                    description: trim(rawParts.slice(3).join(delimiter))
                });
                continue;
            }
            // 2+ columns with a "0:00-0:05" range in column 1: time-range + text
            if (parts.length >= 2) {
                var tr = parts[0].match(timeRangeRe);
                if (tr) {
                    scenes.push({
                        number: scenes.length + 1,
                        startTime: parseTimecode(tr[1]),
                        endTime: parseTimecode(tr[2]),
                        description: stripCsvQuotes(rawParts.slice(1).join(delimiter))
                    });
                    continue;
                }
            }
            // 2-column description + duration
            if (parts.length >= 2) {
                scenes.push({
                    number: scenes.length + 1,
                    startTime: -1,
                    endTime: -1,
                    duration: parseDuration(parts[1]),
                    description: trim(parts[0])
                });
                continue;
            }
            // 1-column fallback
            scenes.push({
                number: scenes.length + 1,
                startTime: -1,
                endTime: -1,
                duration: 5,
                description: line
            });
        }
        return scenes;
    }

    function parseCSV(content) { return parseDelimited(content, ","); }
    function parseTSV(content) { return parseDelimited(content, "\t"); }

    // -- plain text -----------------------------------------------------------
    // Three sub-modes, auto-detected:
    //   Structured ("desc | duration" per line)  -> per-line scenes
    //   Prose with blank lines (Case 1)          -> each paragraph is a scene,
    //                                               duration from word count
    //   Prose without blank lines (Case 2)       -> sentence-aware chunks of
    //                                               ~17-22 words, duration from
    //                                               word count

    function countWords(str) {
        var t = trim(str);
        if (t === "") return 0;
        return t.split(/\s+/).length;
    }

    function durationFromWords(wordCount) {
        // 130 wpm => seconds = (wordCount / 130) * 60
        var seconds = (wordCount / WORDS_PER_MINUTE) * 60;
        return seconds < MIN_SCENE_SECONDS ? MIN_SCENE_SECONDS : seconds;
    }

    function splitIntoSentences(text) {
        // Greedy sentence splitter: punctuation . ! ? followed by space/end.
        // Em-dashes do not end sentences but are kept inside the chunk.
        var sentences = [];
        var current = "";
        var len = text.length;
        for (var i = 0; i < len; i++) {
            var ch = text.charAt(i);
            current += ch;
            if (ch === "." || ch === "!" || ch === "?") {
                var next = (i + 1 < len) ? text.charAt(i + 1) : "";
                // Treat as a sentence end if followed by whitespace or end of text.
                if (next === "" || /\s/.test(next)) {
                    var t = trim(current);
                    if (t !== "") sentences.push(t);
                    current = "";
                }
            }
        }
        var tail = trim(current);
        if (tail !== "") sentences.push(tail);
        return sentences;
    }

    function chunkProseByParagraph(content) {
        // Splits on blank lines and word-count-chunks INSIDE each paragraph.
        // This unifies Case 1 (blank-line separators) and Case 2 (no separators):
        //   - Blank lines act as hard scene boundaries (never combine across)
        //   - Within each paragraph, sentences are greedy-packed into ~17-22 word
        //     chunks so no single scene can swallow the entire script
        var paragraphs = content.split(/\n\s*\n+/);
        var scenes = [];
        for (var i = 0; i < paragraphs.length; i++) {
            var paraText = trim(paragraphs[i].replace(/\s+/g, " "));
            if (paraText === "") continue;
            var paraScenes = chunkProseByWordCount(paraText);
            for (var j = 0; j < paraScenes.length; j++) {
                paraScenes[j].number = scenes.length + 1;
                scenes.push(paraScenes[j]);
            }
        }
        return scenes;
    }

    function splitLongSentence(sentence, maxWords) {
        // Split a sentence that exceeds maxWords. Try comma-clause split first;
        // fall back to raw word-count split if any clause still too long.
        if (countWords(sentence) <= maxWords) return [sentence];
        var commaParts = sentence.split(/,\s*/);
        if (commaParts.length > 1) {
            var chunks = [];
            var current = "";
            var currentWords = 0;
            for (var i = 0; i < commaParts.length; i++) {
                var pw = countWords(commaParts[i]);
                if (currentWords > 0 && currentWords + pw > maxWords) {
                    chunks.push(current);
                    current = commaParts[i];
                    currentWords = pw;
                } else {
                    current = (current === "") ? commaParts[i] : (current + ", " + commaParts[i]);
                    currentWords += pw;
                }
            }
            if (current !== "") chunks.push(current);
            var allOk = true;
            for (var j = 0; j < chunks.length; j++) {
                if (countWords(chunks[j]) > maxWords) { allOk = false; break; }
            }
            if (allOk) return chunks;
            // Some clauses still too long - flatten via raw word split
            var flat = [];
            for (var k = 0; k < chunks.length; k++) {
                if (countWords(chunks[k]) <= maxWords) {
                    flat.push(chunks[k]);
                } else {
                    flat = flat.concat(splitByRawWords(chunks[k], maxWords));
                }
            }
            return flat;
        }
        return splitByRawWords(sentence, maxWords);
    }

    function splitByRawWords(text, maxWords) {
        var words = text.split(/\s+/);
        var chunks = [];
        for (var i = 0; i < words.length; i += maxWords) {
            chunks.push(words.slice(i, Math.min(i + maxWords, words.length)).join(" "));
        }
        return chunks;
    }

    function chunkProseByWordCount(content) {
        // Case 2: collapse all whitespace, split into sentences, greedy-pack
        // into chunks at or under WORDS_PER_SCENE_MAX words. Single sentences
        // longer than the max are pre-split by clauses (commas) then by raw
        // word count if any clause is still too big.
        var flat = trim(content.replace(/\s+/g, " "));
        if (flat === "") return [];
        var rawSentences = splitIntoSentences(flat);
        if (rawSentences.length === 0) rawSentences = [flat];
        var sentences = [];
        for (var si = 0; si < rawSentences.length; si++) {
            var pieces = splitLongSentence(rawSentences[si], WORDS_PER_SCENE_MAX);
            for (var pi = 0; pi < pieces.length; pi++) sentences.push(pieces[pi]);
        }

        var scenes = [];
        var chunkText = "";
        var chunkWords = 0;
        for (var s = 0; s < sentences.length; s++) {
            var sw = countWords(sentences[s]);
            if (chunkWords > 0 && (chunkWords + sw) > WORDS_PER_SCENE_MAX) {
                scenes.push({
                    number: scenes.length + 1,
                    startTime: -1,
                    endTime: -1,
                    duration: durationFromWords(chunkWords),
                    description: chunkText
                });
                chunkText = sentences[s];
                chunkWords = sw;
            } else {
                chunkText = (chunkText === "") ? sentences[s] : (chunkText + " " + sentences[s]);
                chunkWords += sw;
            }
        }
        if (chunkText !== "") {
            scenes.push({
                number: scenes.length + 1,
                startTime: -1,
                endTime: -1,
                duration: durationFromWords(chunkWords),
                description: chunkText
            });
        }
        return scenes;
    }

    function parseProse(content) {
        // Always go through chunkProseByParagraph - it treats the whole text
        // as one paragraph when there are no blank lines (Case 2), or splits
        // on blank lines and then chunks each paragraph (Case 1). Either way,
        // no single scene can exceed WORDS_PER_SCENE_MAX words.
        return chunkProseByParagraph(content);
    }

    function parsePlainTextStructured(content) {
        // Original per-line "desc | duration" behavior. Used when at least a
        // third of non-empty lines contain a pipe separator.
        var lines = content.split("\n");
        var scenes = [];
        for (var i = 0; i < lines.length; i++) {
            var line = trim(lines[i].replace(/\r/g, ""));
            if (line === "") continue;
            var parts = line.split("|");
            if (parts.length >= 2) {
                scenes.push({
                    number: scenes.length + 1,
                    startTime: -1,
                    endTime: -1,
                    duration: parseDuration(parts[1]),
                    description: trim(parts[0])
                });
            } else {
                scenes.push({
                    number: scenes.length + 1,
                    startTime: -1,
                    endTime: -1,
                    duration: 5,
                    description: line
                });
            }
        }
        return scenes;
    }

    function parsePlainText(content) {
        // Decide between structured ("| duration" lines) and prose chunking.
        var lines = content.split("\n");
        var nonEmpty = 0;
        var pipeLines = 0;
        for (var i = 0; i < lines.length; i++) {
            var line = trim(lines[i].replace(/\r/g, ""));
            if (line === "") continue;
            nonEmpty++;
            if (line.indexOf("|") !== -1) pipeLines++;
        }
        // If at least a third of non-empty lines use "|" delimiter, treat as
        // structured. Otherwise route to prose chunking (Case 1 or Case 2).
        if (nonEmpty > 0 && pipeLines >= Math.ceil(nonEmpty / 3)) {
            return parsePlainTextStructured(content);
        }
        return parseProse(content);
    }

    // -- markdown (#/##/-/* / 1. ... with optional "(5s)" or "| 5s") ----------

    function parseMarkdown(content) {
        var scenes = [];
        var lines = content.split("\n");
        for (var i = 0; i < lines.length; i++) {
            var line = trim(lines[i].replace(/\r/g, ""));
            if (line === "") continue;

            // Skip code-fence boundaries
            if (line.indexOf("```") === 0) continue;

            var text = null;
            var headingMatch = line.match(/^#{1,6}\s+(.+)$/);
            var bulletMatch = line.match(/^[-*+]\s+(.+)$/);
            var numberedMatch = line.match(/^\d+[\.\)]\s+(.+)$/);
            if (headingMatch) text = headingMatch[1];
            else if (bulletMatch) text = bulletMatch[1];
            else if (numberedMatch) text = numberedMatch[1];
            if (text === null) continue;

            // Strip leading "Scene N:" / "Scene N -" prefix if present
            text = text.replace(/^Scene\s+\d+\s*[:\-]\s*/i, "");

            var dur = 5;
            var pipeParts = text.split("|");
            if (pipeParts.length >= 2) {
                text = trim(pipeParts[0]);
                dur = parseDuration(pipeParts[1]);
            } else {
                // "Description (5s)" or "Description (12.5)"
                var paren = text.match(/\((\d+(?:\.\d+)?)\s*s?\)\s*$/i);
                if (paren) {
                    dur = parseFloat(paren[1]);
                    text = trim(text.replace(/\(\d+(?:\.\d+)?\s*s?\)\s*$/i, ""));
                }
            }
            scenes.push({
                number: scenes.length + 1,
                startTime: -1,
                endTime: -1,
                duration: dur > 0 ? dur : 5,
                description: text
            });
        }
        return scenes;
    }

    // -- fountain screenplay format (INT./EXT. scene headings, or forced ".") -

    function parseFountain(content) {
        var scenes = [];
        var lines = content.split("\n");
        // Detect title-page block: lines like "Title: ..." separated by blank line
        var inTitlePage = false;
        if (lines.length > 0 && /^[A-Za-z][\w\s]+:/.test(trim(lines[0].replace(/\r/g, "")))) {
            inTitlePage = true;
        }
        for (var i = 0; i < lines.length; i++) {
            var line = trim(lines[i].replace(/\r/g, ""));
            if (line === "") { inTitlePage = false; continue; }
            if (inTitlePage) continue;

            // Scene heading: starts with INT./EXT./EST./I/E. or forced "."
            var isHeading = /^(INT\.|EXT\.|EST\.|I\/E\.)/i.test(line);
            var isForced = (line.charAt(0) === "." && line.length > 1 && line.charAt(1) !== ".");
            if (!isHeading && !isForced) continue;

            var desc = isForced ? line.substring(1) : line;
            scenes.push({
                number: scenes.length + 1,
                startTime: -1,
                endTime: -1,
                duration: 5, // Fountain carries no timing - default
                description: trim(desc)
            });
        }
        return scenes;
    }

    // -- JSON array of scene objects ------------------------------------------

    function parseJSONScript(content) {
        var parsed = null;
        try { parsed = JSON.parse(content); }
        catch (e) { throw new Error("Invalid JSON: " + e.message); }

        var arr = null;
        if (parsed instanceof Array) arr = parsed;
        else if (parsed && parsed.scenes instanceof Array) arr = parsed.scenes;
        else throw new Error('JSON must be an array of scenes or an object with a "scenes" array.');

        var scenes = [];
        for (var i = 0; i < arr.length; i++) {
            var item = arr[i] || {};
            var desc = item.description || item.desc || item.title || item.name || ("Scene " + (i + 1));
            var s = {
                number: parseInt(item.number || item.scene, 10) || (i + 1),
                description: String(desc),
                startTime: -1,
                endTime: -1,
                duration: 5
            };
            if (typeof item.start !== "undefined" && typeof item.end !== "undefined") {
                s.startTime = parseTimecode(String(item.start));
                s.endTime = parseTimecode(String(item.end));
            } else if (typeof item.startTime !== "undefined" && typeof item.endTime !== "undefined") {
                s.startTime = parseTimecode(String(item.startTime));
                s.endTime = parseTimecode(String(item.endTime));
            } else if (typeof item.duration !== "undefined") {
                var d = parseFloat(String(item.duration));
                if (!isNaN(d) && d > 0) s.duration = d;
            }
            scenes.push(s);
        }
        return scenes;
    }

    // -- production script (bracketed sections + VOICEOVER/VISUAL blocks) -----

    function parseProductionScript(content) {
        // Handles two production-script flavors:
        //   FULL  - "[HOOK - 0:00-0:08]" + VISUAL:/VOICEOVER: field labels.
        //   LEAN  - "[0:00-0:08]" + quoted voiceover text directly below.
        // Strategy: after a section marker, capturing is ON by default. Non-
        // voiceover labels (VISUAL:, ON SCREEN TEXT:, etc.) switch capturing
        // OFF; VOICEOVER: switches it back ON. The LEAN format has no labels,
        // so capturing stays ON and the quoted text becomes the description.
        // Two-regex deterministic match (avoids ambiguous lazy-backtracking on
        // the optional title group, which can behave inconsistently in older
        // regex engines).
        // Try "no title" first (more specific): [0:00-0:05]
        // Then "with title": [HOOK - 0:00-0:08]
        var sectionNoTitleRe   = /^\[\s*(\d+:\d+)\s*[\-–—]+\s*(\d+:\d+)\s*\]\s*$/;
        var sectionWithTitleRe = /^\[\s*([^\]\n]+?)\s*[\-–—]+\s*(\d+:\d+)\s*[\-–—]+\s*(\d+:\d+)\s*\]\s*$/;
        var lines = content.split("\n");
        var scenes = [];
        var current = null;
        var voLines = [];
        var capturing = false;

        function flush() {
            if (!current) return;
            // Backward / zero-length timestamps - error out clearly
            if (current.endTime <= current.startTime) {
                throw new Error("Invalid timestamp at [" + formatTime(current.startTime) +
                    " - " + formatTime(current.endTime) + "]. End must be after start.");
            }
            // Skip sections with no captured content AND only an auto-generated
            // title (test 8 - blank section between two valid ones).
            var hasContent = voLines.length > 0;
            var hasRealTitle = current.title && !/^Scene\s+\d+$/.test(current.title);
            if (!hasContent && !hasRealTitle) {
                current = null;
                voLines = [];
                return;
            }
            var desc = hasContent ? voLines.join(" ") : current.title;
            desc = desc.replace(/^[“”"'‘’]+\s*/, "")
                       .replace(/\s*[“”"'‘’]+$/, "")
                       .replace(/\s+/g, " ");
            desc = trim(desc);
            if (desc === "") desc = current.title;
            scenes.push({
                number: scenes.length + 1,
                startTime: current.startTime,
                endTime: current.endTime,
                description: desc
            });
            current = null;
            voLines = [];
        }

        for (var i = 0; i < lines.length; i++) {
            var line = trim(lines[i].replace(/\r/g, ""));

            // Try the title-less form first to avoid title-group ambiguity.
            var mNo = line.match(sectionNoTitleRe);
            var mWith = mNo ? null : line.match(sectionWithTitleRe);
            if (mNo || mWith) {
                flush();
                var newTitle, startStr, endStr;
                if (mNo) {
                    newTitle  = null;
                    startStr  = mNo[1];
                    endStr    = mNo[2];
                } else {
                    newTitle  = trim(mWith[1]);
                    // Reject titles that are just whitespace or empty after trim
                    if (newTitle === "") newTitle = null;
                    startStr  = mWith[2];
                    endStr    = mWith[3];
                }
                current = {
                    title: newTitle || ("Scene " + (scenes.length + 1)),
                    startTime: parseTimecode(startStr),
                    endTime: parseTimecode(endStr)
                };
                voLines = [];
                capturing = true; // capture by default after a section marker
                continue;
            }
            if (!current) continue; // skip title block and other preamble

            // Sub-scene marker like "SCENE 1 - SIGNAL ANALYSIS" continues capture
            if (/^SCENE\s+\d+\b/i.test(line)) {
                capturing = true;
                continue;
            }

            if (/^VOICEOVER\s*:?/i.test(line)) {
                capturing = true;
                var inline = trim(line.replace(/^VOICEOVER\s*:/i, "")
                                      .replace(/^VOICEOVER\s*/i, ""));
                if (inline !== "") voLines.push(inline);
                continue;
            }
            // Non-voiceover labels stop capturing until next VOICEOVER or section
            if (/^(VISUAL|ON\s+SCREEN\s+TEXT|GRAPHICS?|SFX|MUSIC|NOTE|TITLE|CAPTION)S?\s*:?/i.test(line)) {
                capturing = false;
                continue;
            }

            if (capturing && line !== "") {
                voLines.push(line);
            }
        }
        flush();
        return scenes;
    }

    // -- format detection and dispatch ----------------------------------------

    function detectFormat(content) {
        var head = trim(content.substring(0, 2000));
        if (head === "") return "txt";
        var first = head.charAt(0);

        // Production script: bracketed section markers with timecode ranges,
        // e.g. [HOOK - 0:00-0:08] using regular/en/em dashes interchangeably.
        // Check before JSON since timecodes start with [ too.
        if (/\[\s*[^\]\n]*\d+:\d+\s*[\-–—]\s*\d+:\d+\s*\]/.test(head)) {
            return "production";
        }

        // Timecode-only brackets like [0:00-0:08] (no heading) - also production.
        // Catches the case where the first char is [ followed by digits and colon.
        if (/^[\[]\s*\d+\s*:/.test(head)) {
            return "production";
        }

        // JSON: starts with [ or { AND the next non-whitespace char looks like
        // valid JSON syntax. Reject timecode-like patterns first.
        if (first === "[" || first === "{") {
            var rest = head.replace(/^[\[\{]\s*/, "");
            if (/^([\[\{"\}\]]|true|false|null|-?\d)/.test(rest)) return "json";
        }

        if (/^(INT\.|EXT\.|EST\.|I\/E\.)/im.test(head)) return "fountain";
        if (/^#{1,6}\s+/m.test(head)) return "markdown";

        // CSV/TSV requires multiple consistent lines - not just prose that
        // happens to contain commas. Refuse tabular detection if we don't
        // have at least 2 non-empty lines AND the first line's delimiter
        // count matches the second line's (otherwise it's just prose).
        var headLines = head.split("\n");
        var nonEmptyLines = [];
        for (var i = 0; i < headLines.length; i++) {
            var t = trim(headLines[i].replace(/\r/g, ""));
            if (t !== "") nonEmptyLines.push(t);
            if (nonEmptyLines.length >= 3) break;
        }
        if (nonEmptyLines.length < 2) return "txt";
        var firstLine = nonEmptyLines[0];
        var secondLine = nonEmptyLines[1];
        var commaCount1 = (firstLine.match(/,/g) || []).length;
        var commaCount2 = (secondLine.match(/,/g) || []).length;
        var tabCount1 = (firstLine.match(/\t/g) || []).length;
        var tabCount2 = (secondLine.match(/\t/g) || []).length;
        var pipeCount = (firstLine.match(/\|/g) || []).length;
        // TSV: tabs in both lines with similar counts
        if (tabCount1 >= 1 && tabCount2 >= 1 && Math.abs(tabCount1 - tabCount2) <= 1 && tabCount1 > commaCount1) return "tsv";
        // CSV: commas in both lines with similar counts (so prose with random
        // commas doesn't qualify - real CSV has consistent column count). A
        // 2-column CSV like "Time,Text\n0:00,Hello" only has 1 comma per line.
        if (commaCount1 >= 1 && commaCount2 >= 1 && commaCount1 === commaCount2 && commaCount1 > pipeCount) return "csv";
        return "txt";
    }

    function extToFormat(ext) {
        ext = (ext || "").toLowerCase();
        if (ext === "csv") return "csv";
        if (ext === "tsv") return "tsv";
        if (ext === "json") return "json";
        if (ext === "md" || ext === "markdown" || ext === "mdown") return "markdown";
        if (ext === "fountain" || ext === "spmd") return "fountain";
        if (ext === "txt" || ext === "text") return "txt";
        return null; // unknown - caller should auto-detect
    }

    function normalizeLineEndings(content) {
        // ScriptUI's multiline edittext on Windows returns text with \r-only
        // line breaks (no \n). Many parsers split on \n - normalize first so
        // every code path gets consistent input regardless of source.
        if (content === null || typeof content === "undefined") return "";
        return String(content).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }

    function parseScriptContent(content, formatHint) {
        content = normalizeLineEndings(content);
        var fmt = formatHint || detectFormat(content);
        switch (fmt) {
            case "csv":        return parseCSV(content);
            case "tsv":        return parseTSV(content);
            case "json":       return parseJSONScript(content);
            case "markdown":   return parseMarkdown(content);
            case "fountain":   return parseFountain(content);
            case "production": return parseProductionScript(content);
            case "txt":
            default:           return parsePlainText(content);
        }
    }

    function isUnsupportedBinaryFormat(ext) {
        ext = (ext || "").toLowerCase();
        return ext === "pdf" || ext === "doc" || ext === "docx" ||
               ext === "rtf" || ext === "pages" || ext === "odt" ||
               ext === "key" || ext === "ppt" || ext === "pptx";
    }

    function normalizeSceneTimings(scenes) {
        // Fill in startTime/endTime by sequencing durations when not provided
        var totalDuration = 0;
        for (var i = 0; i < scenes.length; i++) {
            var s = scenes[i];
            if (s.startTime !== -1 && s.endTime !== -1 && s.endTime > s.startTime) {
                s.duration = s.endTime - s.startTime;
                totalDuration = s.endTime;
            } else {
                if (typeof s.duration === "undefined" || s.duration <= 0) s.duration = 5;
                s.startTime = totalDuration;
                s.endTime = totalDuration + s.duration;
                totalDuration = s.endTime;
            }
        }
        return scenes;
    }

    function parseScriptFile(file) {
        if (!file.exists) { alert("File not found."); return null; }
        var size = file.length;
        if (size === 0) { alert("File is empty."); return null; }
        if (size > MAX_FILE_SIZE) { alert("File too large (max 5MB)."); return null; }

        var ext = getExtension(file.name);
        if (isUnsupportedBinaryFormat(ext)) {
            alert(
                "StorySync can't read ." + ext + " files directly.\n\n" +
                "Tip: Use 'Paste Script' instead. Open the document, " +
                "copy your scene text, and paste it into the dialog."
            );
            return null;
        }

        var content = "";
        try {
            file.encoding = "UTF-8";
            file.open("r");
            content = file.read();
            file.close();
        } catch (e) {
            try { file.close(); } catch (e2) { }
            alert("Could not read file: " + e.message);
            return null;
        }

        var fmt = extToFormat(ext); // may be null - then auto-detect
        var scenes;
        try {
            scenes = parseScriptContent(content, fmt);
        } catch (parseErr) {
            alert("Could not parse script: " + parseErr.message);
            return null;
        }
        if (!scenes || scenes.length === 0) {
            alert("No scenes found in file. Check the format or try 'Paste Script'.");
            return null;
        }
        return normalizeSceneTimings(scenes);
    }

    function validateSceneTimings(scenes) {
        // Returns an array of human-readable warning strings (overlaps,
        // duplicates, large gaps). Empty array = clean.
        var warnings = [];
        if (!scenes || scenes.length < 2) return warnings;
        var sorted = scenes.slice().sort(function (a, b) { return a.startTime - b.startTime; });
        var totalDur = 0;
        for (var i = 0; i < sorted.length; i++) {
            if (sorted[i].endTime > totalDur) totalDur = sorted[i].endTime;
        }
        var bigGapThreshold = Math.max(30, totalDur * 0.30); // 30s or 30% of total

        for (var k = 1; k < sorted.length; k++) {
            var prev = sorted[k - 1];
            var cur  = sorted[k];
            if (cur.startTime === prev.startTime && cur.endTime === prev.endTime) {
                warnings.push("Scenes \"" + prev.description.substring(0, 30) +
                    "\" and \"" + cur.description.substring(0, 30) +
                    "\" have identical timestamps [" + formatTime(cur.startTime) +
                    " - " + formatTime(cur.endTime) + "].");
            } else if (cur.startTime < prev.endTime) {
                warnings.push("Scenes overlap: \"" + prev.description.substring(0, 30) +
                    "\" ends at " + formatTime(prev.endTime) +
                    " but \"" + cur.description.substring(0, 30) +
                    "\" starts at " + formatTime(cur.startTime) + ".");
            } else if ((cur.startTime - prev.endTime) > bigGapThreshold) {
                warnings.push("Large gap of " +
                    (cur.startTime - prev.endTime).toFixed(1) + "s between \"" +
                    prev.description.substring(0, 30) + "\" and \"" +
                    cur.description.substring(0, 30) + "\".");
            }
        }
        return warnings;
    }

    function buildProjectFromScenes(scenes, projectName, preset) {
        if (!scenes || scenes.length === 0) { alert("No scenes to build."); return null; }

        // Surface timing issues to the user before we mutate the project.
        var warnings = validateSceneTimings(scenes);
        if (warnings.length > 0) {
            var msg = "Found " + warnings.length + " potential issue" +
                (warnings.length === 1 ? "" : "s") + " with the scene timing:\n\n";
            for (var w = 0; w < Math.min(warnings.length, 8); w++) msg += "- " + warnings[w] + "\n";
            if (warnings.length > 8) msg += "- ... and " + (warnings.length - 8) + " more.\n";
            msg += "\nBuild anyway? Scene comps will be created with the given timestamps; overlaps will overlap in the master comp.";
            if (!confirm(msg)) return null;
        }

        var width = preset.width;
        var height = preset.height;
        var fps = preset.fps;

        app.beginUndoGroup(APP_NAME + ": Build Project");
        try {
            var totalDuration = 0;
            for (var i = 0; i < scenes.length; i++) {
                if (scenes[i].endTime > totalDuration) totalDuration = scenes[i].endTime;
            }
            if (totalDuration <= 0) totalDuration = 5;

            // Folders
            var rootFolder = app.project.items.addFolder(projectName);
            var scenesFolder = app.project.items.addFolder("Scenes");
            scenesFolder.parentFolder = rootFolder;

            // Scene comps
            var sceneComps = [];
            for (var j = 0; j < scenes.length; j++) {
                var s = scenes[j];
                var desc = s.description || ("Scene " + s.number);
                var shortDesc = desc.substring(0, 30);
                var compName = "Scene_" + padNumber(s.number, 2) + " - " + shortDesc;
                var sceneComp = app.project.items.addComp(compName, width, height, 1, Math.max(0.1, s.duration), fps);
                sceneComp.parentFolder = scenesFolder;

                // Scene description guide
                var descLayer = sceneComp.layers.addText(desc);
                var descProp = descLayer.property("Source Text");
                var descDoc = descProp.value;
                descDoc.fontSize = 36;
                descDoc.fillColor = [1, 1, 1];
                descDoc.font = "Arial";
                descDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
                descProp.setValue(descDoc);
                descLayer.property("Position").setValue([width / 2, height / 2]);
                descLayer.name = "Scene Description [DELETE ME]";
                descLayer.guideLayer = true;
                descLayer.enabled = true;

                // Scene number label guide
                var labelLayer = sceneComp.layers.addText("Scene " + s.number);
                var labelProp = labelLayer.property("Source Text");
                var labelDoc = labelProp.value;
                labelDoc.fontSize = 24;
                labelDoc.fillColor = [0.7, 0.7, 0.7];
                labelDoc.font = "Arial";
                labelProp.setValue(labelDoc);
                labelLayer.property("Position").setValue([width / 2, height - 50]);
                labelLayer.name = "Scene Label [DELETE ME]";
                labelLayer.guideLayer = true;

                sceneComps.push(sceneComp);
            }

            // Master comp
            var masterComp = app.project.items.addComp(projectName + " - Master", width, height, 1, totalDuration, fps);
            masterComp.parentFolder = rootFolder;

            for (var k = 0; k < sceneComps.length; k++) {
                var layer = masterComp.layers.add(sceneComps[k]);
                layer.startTime = scenes[k].startTime;
                layer.inPoint = scenes[k].startTime;
                layer.outPoint = scenes[k].endTime;

                var marker = new MarkerValue(scenes[k].description || ("Scene " + scenes[k].number));
                marker.comment = "Scene " + scenes[k].number;
                masterComp.markerProperty.setValueAtTime(scenes[k].startTime, marker);
            }

            masterComp.openInViewer();
            state.sceneComps = sceneComps;
            state.masterComp = masterComp;
            return { masterComp: masterComp, sceneComps: sceneComps };
        } catch (err) {
            alert(APP_NAME + " Error (Build Project): " + err.message);
            return null;
        } finally {
            app.endUndoGroup();
        }
    }

    // =========================================================================
    // VOICEOVER SYNC
    // =========================================================================

    function importVoiceoverFile(file, preset) {
        // Imports the audio file into the project, places into a comp.
        // If the active comp can hold the full audio, use it. Otherwise create a new comp.
        try {
            var importOpts = new ImportOptions(file);
            var imported = app.project.importFile(importOpts);
            if (!imported) return null;

            var item = app.project.activeItem;
            var comp = null;
            if (item && item instanceof CompItem) {
                comp = item;
                if (comp.duration < imported.duration) comp.duration = imported.duration + 0.5;
            } else {
                comp = app.project.items.addComp("VO Sync - " + imported.name, preset.width, preset.height, 1, Math.max(imported.duration, 5), preset.fps);
                comp.openInViewer();
            }

            var voLayer = comp.layers.add(imported);
            voLayer.startTime = 0;
            voLayer.inPoint = 0;
            voLayer.outPoint = imported.duration;
            return { comp: comp, layer: voLayer, duration: imported.duration };
        } catch (e) {
            alert("Could not import voiceover: " + e.message);
            return null;
        }
    }

    function detectVOBreaks(comp, voLayer) {
        var dur = voLayer.outPoint - voLayer.inPoint;
        if (dur > MAX_AUDIO_SECONDS_WARN) {
            var go = confirm("Voiceover is " + Math.floor(dur) + " seconds long. Analysis may take a moment. Continue?");
            if (!go) return null;
        }

        var ampLayer = null;
        app.beginUndoGroup(APP_NAME + ": Analyze Voiceover");
        try {
            ampLayer = runConvertAudioToKeyframes(comp, voLayer);
            var result = readAmplitudes(comp, ampLayer, voLayer);
            return result;
        } catch (e) {
            alert(APP_NAME + " VO Analysis Error: " + e.message);
            return null;
        } finally {
            try { if (ampLayer) ampLayer.remove(); } catch (e2) { }
            app.endUndoGroup();
        }
    }

    function applyVOMarkersOnly(comp, voLayer, silences) {
        if (!silences || silences.length === 0) { alert("No scene breaks detected."); return; }
        app.beginUndoGroup(APP_NAME + ": Place VO Markers");
        try {
            for (var i = 0; i < silences.length; i++) {
                var t = voLayer.inPoint + silences[i].midTime;
                var mv = new MarkerValue("Break " + (i + 1));
                mv.comment = "Silence " + silences[i].durationSec.toFixed(2) + "s";
                try { mv.label = MARKER_COLORS["Yellow"]; } catch (e) { }
                comp.markerProperty.setValueAtTime(t, mv);
            }
            alert("Placed " + silences.length + " markers on " + comp.name + ".");
        } catch (err) {
            alert(APP_NAME + " Error: " + err.message);
        } finally {
            app.endUndoGroup();
        }
    }

    function applyVOCreateScenes(comp, voLayer, silences, preset, projectName) {
        if (!silences || silences.length === 0) { alert("No scene breaks detected."); return; }
        var voDuration = voLayer.outPoint - voLayer.inPoint;

        // Build scene list from silence midpoints
        var scenes = [];
        var prevTime = 0;
        for (var i = 0; i < silences.length; i++) {
            scenes.push({
                number: i + 1,
                startTime: prevTime,
                endTime: silences[i].midTime,
                duration: silences[i].midTime - prevTime,
                description: "VO Segment " + (i + 1)
            });
            prevTime = silences[i].midTime;
        }
        // Final segment after the last break
        scenes.push({
            number: scenes.length + 1,
            startTime: prevTime,
            endTime: voDuration,
            duration: voDuration - prevTime,
            description: "VO Segment " + (scenes.length + 1)
        });

        var built = buildProjectFromScenes(scenes, projectName, preset);
        if (!built) return;

        // Trim and place VO audio into each scene comp
        app.beginUndoGroup(APP_NAME + ": Place VO into Scenes");
        try {
            var voSource = voLayer.source;
            for (var k = 0; k < built.sceneComps.length; k++) {
                var sc = built.sceneComps[k];
                var audioCopy = sc.layers.add(voSource);
                // shift so the segment plays from the start of the scene comp
                audioCopy.startTime = -scenes[k].startTime;
                audioCopy.inPoint = 0;
                audioCopy.outPoint = scenes[k].endTime - scenes[k].startTime;
                audioCopy.name = "Voiceover";
                audioCopy.moveToEnd();
            }
        } catch (err) {
            alert(APP_NAME + " Warning placing VO in scenes: " + err.message);
        } finally {
            app.endUndoGroup();
        }
    }

    // =========================================================================
    // STORYBOARD IMPORT
    // =========================================================================

    function listImageFilesInFolder(folder) {
        var all = folder.getFiles();
        var images = [];
        for (var i = 0; i < all.length; i++) {
            if (all[i] instanceof File) {
                var ext = getExtension(all[i].name);
                if (arrayContains(IMAGE_EXTENSIONS, ext)) images.push(all[i]);
            }
        }
        // Sort by name (numeric-aware)
        images.sort(function (a, b) {
            return naturalCompare(a.name, b.name);
        });
        return images;
    }

    function naturalCompare(a, b) {
        var ax = [], bx = [];
        a.replace(/(\d+)|(\D+)/g, function (_, $1, $2) { ax.push([$1 || Infinity, $2 || ""]); return ""; });
        b.replace(/(\d+)|(\D+)/g, function (_, $1, $2) { bx.push([$1 || Infinity, $2 || ""]); return ""; });
        while (ax.length && bx.length) {
            var an = ax.shift(), bn = bx.shift();
            var nn = (parseFloat(an[0]) || an[0]) - (parseFloat(bn[0]) || bn[0]);
            if (nn) return nn;
            if (an[1] !== bn[1]) return an[1] > bn[1] ? 1 : -1;
        }
        return ax.length - bx.length;
    }

    function placeFootageItemInScene(sceneComp, item) {
        // Adds a FootageItem as a guide layer, scaled-to-fit and centered.
        var img = sceneComp.layers.add(item);
        img.name = "Storyboard [REFERENCE]";
        img.guideLayer = true;
        img.property("Opacity").setValue(50);
        var compW = sceneComp.width;
        var compH = sceneComp.height;
        var imgW = item.width || 1920;
        var imgH = item.height || 1080;
        var scale = Math.min(compW / imgW, compH / imgH) * 100;
        img.property("Scale").setValue([scale, scale]);
        img.property("Position").setValue([compW / 2, compH / 2]);
        img.moveToEnd();
    }

    function placeStoryboardInScenes(imageFiles, sceneComps) {
        if (!imageFiles || imageFiles.length === 0) { alert("No images in folder."); return; }
        if (!sceneComps || sceneComps.length === 0) { alert("No scene comps available. Build scenes first."); return; }

        app.beginUndoGroup(APP_NAME + ": Place Storyboard Images");
        try {
            var folder = app.project.items.addFolder("Storyboard References");
            var placed = 0;
            var max = Math.min(imageFiles.length, sceneComps.length);
            for (var i = 0; i < max; i++) {
                try {
                    var opts = new ImportOptions(imageFiles[i]);
                    var item = app.project.importFile(opts);
                    item.parentFolder = folder;
                    placeFootageItemInScene(sceneComps[i], item);
                    placed++;
                } catch (e) { }
            }
            var msg = "Placed " + placed + " image(s) in scenes.";
            if (imageFiles.length > sceneComps.length) msg += "\n" + (imageFiles.length - sceneComps.length) + " extra image(s) ignored.";
            if (imageFiles.length < sceneComps.length) msg += "\n" + (sceneComps.length - imageFiles.length) + " scene(s) have no image.";
            alert(msg);
        } catch (err) {
            alert(APP_NAME + " Storyboard Error: " + err.message);
        } finally {
            app.endUndoGroup();
        }
    }

    function placeStoryboardItemsInScenes(items, sceneComps) {
        // Same as placeStoryboardInScenes but takes already-imported FootageItems
        // (e.g. PDF pages produced by extractPdfPages).
        if (!items || items.length === 0) { alert("No storyboard items to place."); return; }
        if (!sceneComps || sceneComps.length === 0) { alert("No scene comps available. Build scenes first."); return; }

        app.beginUndoGroup(APP_NAME + ": Place Storyboard PDF Pages");
        try {
            var placed = 0;
            var max = Math.min(items.length, sceneComps.length);
            for (var i = 0; i < max; i++) {
                try {
                    placeFootageItemInScene(sceneComps[i], items[i]);
                    placed++;
                } catch (e) { }
            }
            var msg = "Placed " + placed + " PDF page(s) in scenes.";
            if (items.length > sceneComps.length) msg += "\n" + (items.length - sceneComps.length) + " extra page(s) ignored.";
            if (items.length < sceneComps.length) msg += "\n" + (sceneComps.length - items.length) + " scene(s) have no image.";
            alert(msg);
        } catch (err) {
            alert(APP_NAME + " Storyboard Error: " + err.message);
        } finally {
            app.endUndoGroup();
        }
    }

    function extractPdfPages(pdfFile) {
        // Tries to import a multi-page PDF as a composition so each page becomes
        // its own FootageItem. Falls back to single-page import if AE returns a
        // FootageItem instead of a CompItem (older AE behavior or single-page PDF).
        if (!pdfFile.exists) throw new Error("PDF file not found: " + pdfFile.fsName);

        var folder = app.project.items.addFolder("Storyboard PDF - " + pdfFile.displayName);
        var opts = new ImportOptions(pdfFile);

        // Try comp-with-layers import first (one layer per page)
        var imported = null;
        try {
            opts.importAs = ImportAsType.COMP_CROPPED_LAYERS;
            imported = app.project.importFile(opts);
        } catch (e1) {
            try {
                opts.importAs = ImportAsType.COMP;
                imported = app.project.importFile(opts);
            } catch (e2) {
                imported = app.project.importFile(new ImportOptions(pdfFile));
            }
        }
        if (!imported) throw new Error("AE could not import the PDF.");

        var pages = [];
        if (imported instanceof CompItem) {
            // Each page is one layer; layer.source is the page FootageItem.
            // AE creates layers with page 1 at the BOTTOM of the stack, so we
            // walk from numLayers down to 1 to get pages in 1..N order.
            for (var i = imported.numLayers; i >= 1; i--) {
                var src = null;
                try { src = imported.layer(i).source; } catch (e) { }
                if (src && src instanceof FootageItem) pages.push(src);
            }
            // Move all page FootageItems + the import comp into our folder
            for (var p = 0; p < pages.length; p++) {
                try { pages[p].parentFolder = folder; } catch (e) { }
            }
            try { imported.parentFolder = folder; } catch (e) { }
        } else if (imported instanceof FootageItem) {
            try { imported.parentFolder = folder; } catch (e) { }
            pages.push(imported);
        }
        return pages;
    }

    // =========================================================================
    // BEAT MARKER
    // =========================================================================

    function getAudioLayersInActiveComp() {
        var comp = app.project ? app.project.activeItem : null;
        if (!comp || !(comp instanceof CompItem)) return { comp: null, layers: [] };
        var layers = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var l = comp.layer(i);
            if (l.hasAudio) layers.push(l);
        }
        return { comp: comp, layers: layers };
    }

    function detectBeatsInLayer(comp, audioLayer) {
        var ampLayer = null;
        app.beginUndoGroup(APP_NAME + ": Analyze Music");
        try {
            ampLayer = runConvertAudioToKeyframes(comp, audioLayer);
            return readAmplitudes(comp, ampLayer, audioLayer);
        } catch (e) {
            alert(APP_NAME + " Beat Analysis Error: " + e.message);
            return null;
        } finally {
            try { if (ampLayer) ampLayer.remove(); } catch (e2) { }
            app.endUndoGroup();
        }
    }

    function placeBeatMarkers(comp, audioLayer, peaks, markerColorName) {
        if (!peaks || peaks.length === 0) { alert("No peaks to place."); return; }
        app.beginUndoGroup(APP_NAME + ": Place Beat Markers");
        try {
            var colorIdx = MARKER_COLORS[markerColorName] || MARKER_COLORS["Green"];
            for (var i = 0; i < peaks.length; i++) {
                var t = audioLayer.inPoint + peaks[i].time;
                var mv = new MarkerValue("Beat " + (i + 1));
                mv.comment = "Amp " + peaks[i].amplitude.toFixed(2);
                try { mv.label = colorIdx; } catch (e) { }
                comp.markerProperty.setValueAtTime(t, mv);
            }
            alert("Placed " + peaks.length + " beat markers on " + comp.name + ".");
        } catch (err) {
            alert(APP_NAME + " Error: " + err.message);
        } finally {
            app.endUndoGroup();
        }
    }

    // =========================================================================
    // QUICK ACTIONS
    // =========================================================================

    function cleanGuideLayers(comp) {
        if (!comp) return;
        app.beginUndoGroup(APP_NAME + ": Clean Guide Layers");
        try {
            var removed = 0;
            // iterate top-down because removal shifts indices
            for (var i = comp.numLayers; i >= 1; i--) {
                var l = comp.layer(i);
                if (l.guideLayer) { l.remove(); removed++; }
            }
            alert("Removed " + removed + " guide layer(s) from " + comp.name + ".");
        } catch (e) {
            alert(APP_NAME + " Error: " + e.message);
        } finally {
            app.endUndoGroup();
        }
    }

    function undoLastAction() {
        // AE's Undo menu name is dynamic ("Undo Build Project" etc.) so
        // findMenuCommandId("Undo") returns 0. Try the canonical command id
        // (16 is Edit > Undo across AE versions) first, then probe a few
        // common menu names as a fallback.
        var probes = [
            "Undo Build Project",
            "Undo Place VO Markers",
            "Undo Place Beat Markers",
            "Undo Place Storyboard Images",
            "Undo Place VO into Scenes",
            "Undo Clean Guide Layers",
            "Undo Analyze Voiceover",
            "Undo Analyze Music",
            "Undo"
        ];
        try {
            app.executeCommand(16);
            return;
        } catch (e) { }
        for (var i = 0; i < probes.length; i++) {
            try {
                var id = app.findMenuCommandId(probes[i]);
                if (id !== 0) { app.executeCommand(id); return; }
            } catch (e2) { }
        }
        alert("Could not invoke Undo automatically. Use Edit > Undo (Ctrl/Cmd+Z).");
    }

    // =========================================================================
    // UI BUILDER
    // =========================================================================

    function buildUI(parent) {
        parent.orientation = "column";
        parent.alignChildren = ["fill", "fill"];
        parent.spacing = 0;
        parent.margins = 0;

        // ====================================================================
        // TOP BAR: title + version + settings + help
        // ====================================================================
        var topBar = parent.add("group");
        topBar.orientation = "row";
        topBar.alignChildren = ["left", "center"];
        topBar.alignment = ["fill", "top"];
        topBar.margins = [10, 8, 10, 8];
        topBar.spacing = 8;

        var title = topBar.add("statictext", undefined, APP_NAME);
        try {
            title.graphics.font = ScriptUI.newFont(title.graphics.font.name, "Bold", 14);
            title.graphics.foregroundColor = title.graphics.newPen(title.graphics.PenType.SOLID_COLOR, COLOR_TEXT, 1);
        } catch (e) { }

        var topSpacer = topBar.add("group");
        topSpacer.alignment = ["fill", "center"];

        var resetBtn = topBar.add("button", undefined, "Reset");
        resetBtn.preferredSize = [60, 22];
        resetBtn.helpTip = "Clear all imported script, voiceover, storyboard, and beat data from this panel (does not touch your AE project).";
        var settingsBtn = topBar.add("button", undefined, "Settings");
        settingsBtn.preferredSize = [70, 22];
        var helpBtn = topBar.add("button", undefined, "?");
        helpBtn.preferredSize = [26, 22];
        // Kept for back-compat with earlier wiring; a no-op "Refresh" lives in
        // the Marks panel header now. We still need the symbol to exist.
        var refreshBtn = { onClick: null };

        // ====================================================================
        // MAIN ROW: sidebar + content stack
        // ====================================================================
        var main = parent.add("group");
        main.orientation = "row";
        main.alignChildren = ["fill", "fill"];
        main.alignment = ["fill", "fill"];
        main.margins = 0;
        main.spacing = 0;

        // ================================================================
        // PAINT helpers (custom drawing via onDraw)
        // ================================================================
        var PAINT = {
            sidebarBg:     [0.13, 0.13, 0.15, 1],
            navIdleText:   [0.62, 0.62, 0.66, 1],
            navActiveText: [1.00, 1.00, 1.00, 1],
            navActiveBg:   [0.22, 0.23, 0.27, 1],
            navAccent:     [0.00, 0.66, 1.00, 1],
            cardBg:        [0.20, 0.20, 0.22, 1],
            cardBorder:    [0.30, 0.30, 0.34, 1]
        };

        function _brush(g, c) { return g.newBrush(g.BrushType.SOLID_COLOR, c); }
        function _pen(g, c, w) { return g.newPen(g.PenType.SOLID_COLOR, c, w || 1); }

        function _fillRect(g, x, y, w, h, color) {
            g.newPath();
            g.moveTo(x, y);
            g.lineTo(x + w, y);
            g.lineTo(x + w, y + h);
            g.lineTo(x, y + h);
            g.closePath();
            g.fillPath(_brush(g, color));
        }

        function _strokeRect(g, x, y, w, h, color, lw) {
            g.newPath();
            g.moveTo(x, y);
            g.lineTo(x + w, y);
            g.lineTo(x + w, y + h);
            g.lineTo(x, y + h);
            g.closePath();
            g.strokePath(_pen(g, color, lw || 1));
        }

        function _paintIcon(g, kind, x, y, size, color) {
            // Draws a simple icon glyph inside an (x, y, size, size) box.
            var s = size;
            var pn = _pen(g, color, 1.5);
            if (kind === "dash") {
                // 2x2 grid of squares
                var sq = Math.floor(s / 2.6);
                var gap = Math.floor(s / 6);
                for (var i = 0; i < 2; i++) {
                    for (var j = 0; j < 2; j++) {
                        _fillRect(g, x + j * (sq + gap), y + i * (sq + gap), sq, sq, color);
                    }
                }
            } else if (kind === "build") {
                // 3 stacked horizontal bars of varying length
                var barH = Math.floor(s / 6);
                var spacing = Math.floor(s / 7);
                var top = y + Math.floor((s - (3 * barH + 2 * spacing)) / 2);
                _fillRect(g, x, top + 0 * (barH + spacing), s,            barH, color);
                _fillRect(g, x, top + 1 * (barH + spacing), Math.floor(s * 0.7), barH, color);
                _fillRect(g, x, top + 2 * (barH + spacing), Math.floor(s * 0.85), barH, color);
            } else if (kind === "vo") {
                // Speaker triangle + 2 wave chevrons
                var triW = Math.floor(s * 0.45);
                var triH = Math.floor(s * 0.6);
                var triX = x;
                var triY = y + Math.floor((s - triH) / 2);
                g.newPath();
                g.moveTo(triX, triY + triH * 0.30);
                g.lineTo(triX + triW * 0.55, triY + triH * 0.30);
                g.lineTo(triX + triW, triY);
                g.lineTo(triX + triW, triY + triH);
                g.lineTo(triX + triW * 0.55, triY + triH * 0.70);
                g.lineTo(triX, triY + triH * 0.70);
                g.closePath();
                g.fillPath(_brush(g, color));
                for (var wv = 0; wv < 2; wv++) {
                    var wx = x + triW + Math.floor(s * 0.10) + wv * Math.floor(s * 0.18);
                    var wh = Math.floor(s * 0.20) - wv * Math.floor(s * 0.04);
                    g.newPath();
                    g.moveTo(wx, y + s / 2 - wh);
                    g.lineTo(wx + Math.floor(s * 0.12), y + s / 2);
                    g.lineTo(wx, y + s / 2 + wh);
                    g.strokePath(pn);
                }
            } else if (kind === "story") {
                // Image frame with a small mountain inside
                _strokeRect(g, x, y, s, Math.floor(s * 0.78), color, 1.5);
                var floor = y + Math.floor(s * 0.78);
                g.newPath();
                g.moveTo(x + 2, floor - 2);
                g.lineTo(x + Math.floor(s * 0.35), floor - Math.floor(s * 0.45));
                g.lineTo(x + Math.floor(s * 0.55), floor - Math.floor(s * 0.25));
                g.lineTo(x + Math.floor(s * 0.78), floor - Math.floor(s * 0.55));
                g.lineTo(x + s - 2, floor - 2);
                g.strokePath(pn);
            } else if (kind === "marks") {
                // Vertical timeline + 2 diamond markers
                g.newPath();
                g.moveTo(x + Math.floor(s / 2), y);
                g.lineTo(x + Math.floor(s / 2), y + s);
                g.strokePath(pn);
                var d = Math.floor(s / 5);
                for (var mk = 0; mk < 2; mk++) {
                    var cx = x + Math.floor(s / 2);
                    var cy = y + Math.floor(s * (0.28 + mk * 0.44));
                    g.newPath();
                    g.moveTo(cx, cy - d);
                    g.lineTo(cx + d, cy);
                    g.lineTo(cx, cy + d);
                    g.lineTo(cx - d, cy);
                    g.closePath();
                    g.fillPath(_brush(g, color));
                }
            }
        }

        // ----- Sidebar (left) -----
        var sidebar = main.add("group");
        sidebar.orientation = "column";
        sidebar.alignChildren = ["fill", "top"];
        sidebar.alignment = ["left", "fill"];
        sidebar.preferredSize = [76, -1];
        sidebar.margins = [4, 8, 4, 8];
        sidebar.spacing = 2;
        try {
            sidebar.graphics.backgroundColor = sidebar.graphics.newBrush(
                sidebar.graphics.BrushType.SOLID_COLOR, PAINT.sidebarBg);
        } catch (e) { }

        // Active panel index, used by onDraw to render the highlighted item.
        var activePanelIdx = 0;
        var navItems = [];

        function makeNavItem(idx, iconKey, label, hint) {
            // Use a "button" widget for reliable click handling, then override
            // its drawing with onDraw to paint our own icon + label + highlight.
            var b = sidebar.add("button", undefined, "");
            b.preferredSize = [66, 60];
            b.helpTip = hint || "";
            b.__iconKey = iconKey;
            b.__label = label;
            b.__idx = idx;
            b.onDraw = function () {
                var g = this.graphics;
                var w = this.size[0];
                var h = this.size[1];
                var isActive = (this.__idx === activePanelIdx);

                if (isActive) {
                    _fillRect(g, 2, 2, w - 4, h - 4, PAINT.navActiveBg);
                    _fillRect(g, 0, 6, 3, h - 12, PAINT.navAccent);
                }

                var iconSize = 22;
                var iconX = Math.floor((w - iconSize) / 2);
                var iconY = 9;
                var iconColor = isActive ? PAINT.navActiveText : PAINT.navIdleText;
                _paintIcon(g, this.__iconKey, iconX, iconY, iconSize, iconColor);

                var labelColor = iconColor;
                var labelPen = _pen(g, labelColor);
                var font = null;
                try { font = ScriptUI.newFont("Arial", isActive ? "Bold" : "Regular", 10); } catch (e) { }
                var textY = iconY + iconSize + 7;
                try {
                    var m = g.measureString(this.__label, font, w);
                    var textX = Math.floor((w - m[0]) / 2);
                    g.drawString(this.__label, labelPen, textX, textY, font);
                } catch (e2) {
                    g.drawString(this.__label, labelPen, 8, textY, font);
                }
            };
            navItems.push(b);
            return b;
        }

        function setActivePanel(idx) {
            activePanelIdx = idx;
            for (var i = 0; i < navItems.length; i++) {
                try { navItems[i].notify("onDraw"); } catch (e) { }
            }
        }

        var navBuild = makeNavItem(0, "build", "Build",     "Scene Builder - parse scripts into scene comps");
        var navVO    = makeNavItem(1, "vo",    "Voiceover", "Voiceover Sync - silence detection");
        var navSB    = makeNavItem(2, "story", "Storyboard", "Storyboards - images + multi-page PDFs");
        var navMarks = makeNavItem(3, "marks", "Beats",     "Beat Markers - peak detection on music");

        // ----- Content stack (right) -----
        var contentArea = main.add("group");
        contentArea.orientation = "stack";
        contentArea.alignChildren = ["fill", "fill"];
        contentArea.alignment = ["fill", "fill"];
        contentArea.margins = [10, 10, 10, 10];

        // ============== Settings state ==============
        // Source of truth is width/height/fps as numbers. The preset dropdown
        // in the Settings dialog is just a quick-fill helper - it pushes values
        // into the W/H/FPS fields. Save reads W/H/FPS directly so it never
        // depends on dropdown.selection.text (which was unreliable across AE
        // versions and caused the "always 1080p horizontal" bug).
        var _settings = {
            projectName: loadSetting("lastProjectName", "Untitled"),
            width: 1920,
            height: 1080,
            fps: 30
        };
        // Load with migration from the old "lastPreset" key
        (function loadCompSettings() {
            var haveW = false;
            try { haveW = app.settings.haveSetting(SETTINGS_NS, "compWidth"); } catch (e) { }
            if (haveW) {
                _settings.width  = parseFloat(loadSetting("compWidth",  "1920")) || 1920;
                _settings.height = parseFloat(loadSetting("compHeight", "1080")) || 1080;
                _settings.fps    = parseFloat(loadSetting("compFps",    "30"))   || 30;
            } else {
                // Migrate from legacy preset-key storage
                var oldKey = loadSetting("lastPreset", "1080p 30fps");
                var oldPreset = COMP_PRESETS[oldKey] || COMP_PRESETS[COMP_PRESET_KEYS[0]];
                _settings.width  = oldPreset.width;
                _settings.height = oldPreset.height;
                _settings.fps    = oldPreset.fps;
            }
        })();

        function getProjectName() { return _settings.projectName; }
        function getCurrentPreset() {
            return { width: _settings.width, height: _settings.height, fps: _settings.fps };
        }

        function findMatchingPresetKey(w, h, fps) {
            for (var k = 0; k < COMP_PRESET_KEYS.length; k++) {
                var key = COMP_PRESET_KEYS[k];
                var p = COMP_PRESETS[key];
                if (p.width === w && p.height === h && Math.abs(p.fps - fps) < 0.01) return key;
            }
            return null; // means "Custom"
        }

        function showSettingsDialog() {
            var dlg = new Window("dialog", APP_NAME + " - Settings");
            dlg.orientation = "column";
            dlg.alignChildren = ["fill", "top"];
            dlg.margins = 14;
            dlg.spacing = 8;

            // --- Project name ---
            var nameGrp = dlg.add("group");
            nameGrp.alignChildren = ["fill", "center"];
            nameGrp.add("statictext", undefined, "Project:").preferredSize = [90, -1];
            var nameInput = nameGrp.add("edittext", undefined, _settings.projectName);
            nameInput.preferredSize = [240, -1];

            // --- Quick preset dropdown (a fill-in helper, NOT the source of truth) ---
            var presetGrp = dlg.add("group");
            presetGrp.alignChildren = ["fill", "center"];
            presetGrp.add("statictext", undefined, "Quick preset:").preferredSize = [90, -1];
            var presetItems = COMP_PRESET_KEYS.concat(["Custom"]);
            var presetDD = presetGrp.add("dropdownlist", undefined, presetItems);
            presetDD.preferredSize = [240, -1];

            // --- Width / Height / FPS ---
            function makeNumberRow(labelText, initVal, width) {
                var g = dlg.add("group");
                g.alignChildren = ["fill", "center"];
                g.add("statictext", undefined, labelText).preferredSize = [90, -1];
                var inp = g.add("edittext", undefined, String(initVal));
                inp.preferredSize = [width || 100, -1];
                return inp;
            }
            var widthInput  = makeNumberRow("Width (px):",  _settings.width,  100);
            var heightInput = makeNumberRow("Height (px):", _settings.height, 100);
            var fpsInput    = makeNumberRow("FPS:",         _settings.fps,    100);

            // Initialize the dropdown to whatever matches current values (or "Custom")
            (function initPresetSelection() {
                var key = findMatchingPresetKey(_settings.width, _settings.height, _settings.fps);
                var sel = (key === null) ? (presetItems.length - 1) : 0;
                if (key !== null) {
                    for (var i = 0; i < COMP_PRESET_KEYS.length; i++) {
                        if (COMP_PRESET_KEYS[i] === key) { sel = i; break; }
                    }
                }
                presetDD.selection = sel;
            })();

            // When the preset changes, auto-fill the W/H/FPS fields.
            // "Custom" leaves the fields alone.
            presetDD.onChange = function () {
                if (!presetDD.selection) return;
                var label = presetDD.selection.text;
                if (label === "Custom") return;
                var p = COMP_PRESETS[label];
                if (!p) return;
                widthInput.text  = String(p.width);
                heightInput.text = String(p.height);
                fpsInput.text    = String(p.fps);
            };

            var hint = dlg.add("statictext", undefined,
                "Pick a preset to auto-fill, or type any width/height/fps. " +
                "Width and height: 16-16384. FPS: 1-120.",
                { multiline: true });
            hint.preferredSize = [380, 36];
            styleStatus(hint, "info");

            var btnRow = dlg.add("group");
            btnRow.alignment = ["right", "top"];
            var cancelBtn = btnRow.add("button", undefined, "Cancel", { name: "cancel" });
            var okBtn = btnRow.add("button", undefined, "Save", { name: "ok" });

            okBtn.onClick = function () {
                // Read W/H/FPS directly. Dropdown selection is ignored.
                var w = parseInt(trim(widthInput.text), 10);
                var h = parseInt(trim(heightInput.text), 10);
                var f = parseFloat(trim(fpsInput.text));
                if (isNaN(w) || w < 16 || w > 16384) {
                    alert("Width must be an integer between 16 and 16384.");
                    return;
                }
                if (isNaN(h) || h < 16 || h > 16384) {
                    alert("Height must be an integer between 16 and 16384.");
                    return;
                }
                if (isNaN(f) || f < 1 || f > 120) {
                    alert("FPS must be a number between 1 and 120.");
                    return;
                }
                _settings.projectName = trim(nameInput.text) || "Untitled";
                _settings.width  = w;
                _settings.height = h;
                _settings.fps    = f;
                saveSetting("lastProjectName", _settings.projectName);
                saveSetting("compWidth",  w);
                saveSetting("compHeight", h);
                saveSetting("compFps",    f);
                // Also save a matching preset key (or "Custom") for display purposes
                var matched = findMatchingPresetKey(w, h, f);
                saveSetting("lastPreset", matched || "Custom");
                dlg.close(1);
            };
            cancelBtn.onClick = function () { dlg.close(0); };
            dlg.show();
        }

        // ============== BUILD (Scene Builder) PANEL ==============
        var sceneGrp = contentArea.add("group");
        sceneGrp.orientation = "column";
        sceneGrp.alignChildren = ["fill", "top"];
        sceneGrp.spacing = 6;
        var sceneHeader = sceneGrp.add("statictext", undefined, "Comp Builder");
        try { sceneHeader.graphics.font = ScriptUI.newFont(sceneHeader.graphics.font.name, "Bold", 14); } catch (e) { }
        var sceneSub = sceneGrp.add("statictext", undefined, "Parse a script and create scene comps.");
        styleStatus(sceneSub, "info");

        var importBtnGrp = sceneGrp.add("group");
        importBtnGrp.orientation = "row";
        importBtnGrp.alignChildren = ["fill", "center"];
        importBtnGrp.spacing = 4;
        var importScriptBtn = importBtnGrp.add("button", undefined, "Import Script File");
        var pasteScriptBtn = importBtnGrp.add("button", undefined, "Paste Script");
        var hintText = sceneGrp.add("statictext", undefined, "Formats: CSV, TSV, TXT, MD, Fountain, JSON. PDF/Word - use Paste.");
        styleStatus(hintText, "info");
        var sceneList = sceneGrp.add("listbox", undefined, [], { multiselect: false });
        sceneList.preferredSize = [-1, 150];
        var sceneStatus = sceneGrp.add("statictext", undefined, "No script loaded.");
        styleStatus(sceneStatus, "info");
        var buildBtn = sceneGrp.add("button", undefined, "Build Project Structure");

        // ============== VOICEOVER PANEL ==============
        var voGrp = contentArea.add("group");
        voGrp.orientation = "column";
        voGrp.alignChildren = ["fill", "top"];
        voGrp.spacing = 6;
        var voHeader = voGrp.add("statictext", undefined, "VO Sync");
        try { voHeader.graphics.font = ScriptUI.newFont(voHeader.graphics.font.name, "Bold", 14); } catch (e) { }
        var voSub = voGrp.add("statictext", undefined, "Detect silences in voiceover and align scenes to natural pauses.");
        styleStatus(voSub, "info");

        var importVOBtn = voGrp.add("button", undefined, "Import Voiceover");
        var thresholdControl = makeLabeledSlider(voGrp, "Silence threshold:", loadFloatSetting("silenceThreshold", 3), 0, 20, 1, "");
        var minSilenceControl = makeLabeledSlider(voGrp, "Min silence:", loadFloatSetting("minSilenceDuration", 0.4), 0.1, 2.0, 0.1, "s");
        var minSceneControl = makeLabeledSlider(voGrp, "Min scene length:", loadFloatSetting("minSceneDuration", 2.0), 1.0, 10.0, 0.1, "s");
        var voList = voGrp.add("listbox", undefined, []);
        voList.preferredSize = [-1, 110];
        var voStatus = voGrp.add("statictext", undefined, "No voiceover loaded.");
        styleStatus(voStatus, "info");
        var voModeGrp = voGrp.add("group");
        voModeGrp.orientation = "row";
        voModeGrp.alignment = ["fill", "center"];
        var voModeMarkers = voModeGrp.add("radiobutton", undefined, "Markers only");
        var voModeScenes = voModeGrp.add("radiobutton", undefined, "Create scenes");
        voModeMarkers.value = true;
        var applyVOBtn = voGrp.add("button", undefined, "Apply VO Sync");

        // ============== STORYBOARD PANEL ==============
        var sbGrp = contentArea.add("group");
        sbGrp.orientation = "column";
        sbGrp.alignChildren = ["fill", "top"];
        sbGrp.spacing = 6;
        var sbHeader = sbGrp.add("statictext", undefined, "Storyboards");
        try { sbHeader.graphics.font = ScriptUI.newFont(sbHeader.graphics.font.name, "Bold", 14); } catch (e) { }
        var sbSub = sbGrp.add("statictext", undefined, "Import a folder of images or a multi-page PDF as scene references.");
        styleStatus(sbSub, "info");

        var pickFolderBtn = sbGrp.add("button", undefined, "Select Image Folder");
        var pickFileBtn = sbGrp.add("button", undefined, "Pick from Folder (modern dialog)");
        var pickPdfBtn = sbGrp.add("button", undefined, "Import PDF (one page per scene)");
        var sbHint = sbGrp.add("statictext", undefined,
            "Supports PNG, JPG, PSD, AI, TIFF + multi-page PDF.",
            { multiline: true });
        sbHint.preferredSize = [-1, 30];
        styleStatus(sbHint, "info");
        var sbStatus = sbGrp.add("statictext", undefined, "No folder selected.");
        styleStatus(sbStatus, "info");
        var placeStoryboardBtn = sbGrp.add("button", undefined, "Place in Scene Comps");

        // ============== MARKS (Beat) PANEL ==============
        var beatGrp = contentArea.add("group");
        beatGrp.orientation = "column";
        beatGrp.alignChildren = ["fill", "top"];
        beatGrp.spacing = 6;
        var beatHeader = beatGrp.add("statictext", undefined, "Beat Markers");
        try { beatHeader.graphics.font = ScriptUI.newFont(beatHeader.graphics.font.name, "Bold", 14); } catch (e) { }
        var beatSub = beatGrp.add("statictext", undefined, "Detect amplitude peaks in a music layer and place comp markers.");
        styleStatus(beatSub, "info");

        var beatLayerGrp = beatGrp.add("group");
        beatLayerGrp.alignChildren = ["fill", "center"];
        beatLayerGrp.add("statictext", undefined, "Layer:").preferredSize = [56, -1];
        var beatLayerDropdown = beatLayerGrp.add("dropdownlist", undefined, ["(none)"]);
        beatLayerDropdown.alignment = ["fill", "center"];
        beatLayerDropdown.selection = 0;
        var beatLayerRefresh = beatLayerGrp.add("button", undefined, "Refresh");
        beatLayerRefresh.preferredSize = [60, 22];

        var sensitivityControl = makeLabeledSlider(beatGrp, "Sensitivity:", loadFloatSetting("peakSensitivity", 50), 0, 200, 1, "");
        var minGapControl = makeLabeledSlider(beatGrp, "Min gap:", loadFloatSetting("minPeakGap", 0.3), 0.1, 2.0, 0.1, "s");

        var colorGrp = beatGrp.add("group");
        colorGrp.alignChildren = ["fill", "center"];
        colorGrp.add("statictext", undefined, "Color:").preferredSize = [56, -1];
        var colorDropdown = colorGrp.add("dropdownlist", undefined, MARKER_COLOR_KEYS);
        colorDropdown.alignment = ["fill", "center"];
        var savedColor = loadSetting("markerColor", "Green");
        var colorIdx = 8;
        for (var c = 0; c < MARKER_COLOR_KEYS.length; c++) {
            if (MARKER_COLOR_KEYS[c] === savedColor) { colorIdx = c; break; }
        }
        colorDropdown.selection = colorIdx;

        var detectPeaksBtn = beatGrp.add("button", undefined, "Detect Peaks");
        var beatStatus = beatGrp.add("statictext", undefined, "No peaks detected.");
        styleStatus(beatStatus, "info");
        var placeMarkersBtn = beatGrp.add("button", undefined, "Place Markers");

        // ====================================================================
        // STATUS BAR
        // ====================================================================
        var statusBar = parent.add("group");
        statusBar.orientation = "row";
        statusBar.alignChildren = ["fill", "center"];
        statusBar.alignment = ["fill", "bottom"];
        statusBar.margins = [10, 6, 10, 6];
        var statusLeft = statusBar.add("statictext", undefined, "● Ready");
        statusLeft.alignment = ["left", "center"];
        styleStatus(statusLeft, "ok");
        var statusSpacer = statusBar.add("group");
        statusSpacer.alignment = ["fill", "center"];
        var statusRight = statusBar.add("statictext", undefined, "AE " + (app && app.version ? app.version.split(" ")[0] : "?"));
        statusRight.alignment = ["right", "center"];
        styleStatus(statusRight, "info");

        // ====================================================================
        // SIDEBAR NAV WIRING (show one panel at a time)
        // ====================================================================
        var panels = [sceneGrp, voGrp, sbGrp, beatGrp];
        function showPanel(idx) {
            for (var i = 0; i < panels.length; i++) panels[i].visible = (i === idx);
            setActivePanel(idx);
            try { if (idx === 3) populateBeatLayers(); } catch (e) { }
            try { parent.layout.layout(true); } catch (e) { }
        }
        navBuild.onClick = function () { showPanel(0); };
        navVO.onClick    = function () { showPanel(1); };
        navSB.onClick    = function () { showPanel(2); };
        navMarks.onClick = function () { showPanel(3); };

        settingsBtn.onClick = showSettingsDialog;

        function resetPanel() {
            // Clear data state. Does not touch the AE project itself - only the
            // panel's in-memory references to parsed scripts, analyzed audio,
            // detected breaks/peaks, and selected storyboard files.
            state.parsedScenes = null;
            state.sceneComps = null;
            state.masterComp = null;
            state.voAudioLayer = null;
            state.voCachedAmps = null;
            state.voCachedFps = null;
            state.voCachedStartTime = null;
            state.voSilences = null;
            state.beatAudioLayer = null;
            state.beatCachedAmps = null;
            state.beatCachedFps = null;
            state.beatCachedStartTime = null;
            state.beatPeaks = null;
            state.storyboardFolder = null;
            state.storyboardFiles = null;
            state.storyboardItems = null;

            // Reset UI on each panel
            try {
                sceneList.removeAll();
                sceneStatus.text = "No script loaded.";
                styleStatus(sceneStatus, "info");

                voList.removeAll();
                voStatus.text = "No voiceover loaded.";
                styleStatus(voStatus, "info");

                sbStatus.text = "No folder selected.";
                styleStatus(sbStatus, "info");

                beatStatus.text = "No peaks detected.";
                styleStatus(beatStatus, "info");
                populateBeatLayers();
            } catch (e) { }

            try {
                statusLeft.text = "● Reset";
                styleStatus(statusLeft, "ok");
            } catch (e) { }
        }

        resetBtn.onClick = function () {
            var ok = confirm(
                "Reset the panel?\n\n" +
                "This clears the parsed script, voiceover analysis, storyboard " +
                "selection, and beat detection from this panel.\n\n" +
                "It does NOT delete anything from your After Effects project."
            );
            if (ok) resetPanel();
        };

        showPanel(0);

        // =====================================================================
        // EVENT WIRING
        // =====================================================================

        helpBtn.onClick = function () {
            alert(
                APP_NAME + " v" + APP_VERSION + "\n" +
                "Script to timeline in one click.\n\n" +
                "SETTINGS (top bar)\n" +
                "  Project name, width, height, and FPS - or pick a quick preset.\n" +
                "  Custom W/H/FPS supported.\n\n" +
                "BUILD\n" +
                "  Import Script File: CSV, TSV, TXT, Markdown, Fountain, or JSON.\n" +
                "  Paste Script: drop in any text from PDF, Word, Google Docs, etc.\n" +
                "  Scripts without timestamps are auto-timed for natural read pace.\n" +
                "  Tip: use blank lines between scenes for the cleanest results;\n" +
                "  StorySync will also handle continuous prose automatically.\n" +
                "  Then Build Project Structure to create folders, scene comps,\n" +
                "  guide text layers, and a master comp with scene markers.\n\n" +
                "VOICEOVER\n" +
                "  Import a WAV/MP3. StorySync analyzes amplitude to find silences.\n" +
                "  Tune the threshold sliders live. Apply as markers, or auto-split\n" +
                "  into scene comps that match the VO timing.\n\n" +
                "STORYBOARD\n" +
                "  Pick a folder of numbered images (PNG/JPG/PSD/AI/TIFF) or import\n" +
                "  a multi-page PDF (one page per scene). Pages are placed as 50%\n" +
                "  guide layers in each scene comp.\n\n" +
                "BEATS\n" +
                "  Pick a music layer in your active comp, Detect Peaks, then Place\n" +
                "  Markers. Sensitivity and min-gap are live-tunable.\n\n" +
                "RESET (top bar)\n" +
                "  Clears the panel state without touching your AE project.\n\n" +
                "All actions are undoable."
            );
        };

        refreshBtn.onClick = function () {
            populateBeatLayers();
            updateSceneStatus();
        };

        // ---- Scene Builder events ----
        importScriptBtn.onClick = function () {
            var filter = "Script files:*.csv;*.tsv;*.txt;*.md;*.markdown;*.fountain;*.spmd;*.json,All files:*.*";
            var f = File.openDialog("Select script file", filter);
            if (!f) return;
            var scenes = parseScriptFile(f);
            if (!scenes) return;
            state.parsedScenes = scenes;
            updateSceneList();
        };

        pasteScriptBtn.onClick = function () {
            var scenes = showPasteDialog();
            if (!scenes) return;
            state.parsedScenes = scenes;
            updateSceneList();
        };

        function updateSceneList() {
            sceneList.removeAll();
            if (!state.parsedScenes || state.parsedScenes.length === 0) {
                sceneStatus.text = "No scenes parsed.";
                styleStatus(sceneStatus, "warn");
                return;
            }
            for (var i = 0; i < state.parsedScenes.length; i++) {
                var s = state.parsedScenes[i];
                sceneList.add("item", padNumber(s.number, 2) + ". " + s.description + "  (" + s.duration.toFixed(1) + "s)");
            }
            sceneStatus.text = "Loaded " + state.parsedScenes.length + " scene(s).";
            styleStatus(sceneStatus, "ok");
        }

        function updateSceneStatus() {
            if (state.sceneComps && state.sceneComps.length > 0) {
                sceneStatus.text = "Built " + state.sceneComps.length + " scene comp(s).";
                styleStatus(sceneStatus, "ok");
            }
        }

        buildBtn.onClick = function () {
            if (!state.parsedScenes || state.parsedScenes.length === 0) {
                alert("Import a script file first.");
                return;
            }
            var projName = getProjectName();
            var built = buildProjectFromScenes(state.parsedScenes, projName, getCurrentPreset());
            if (built) {
                sceneStatus.text = "Built " + built.sceneComps.length + " scene comp(s) + master.";
                styleStatus(sceneStatus, "ok");
            }
        };

        // ---- Voiceover events ----
        importVOBtn.onClick = function () {
            var f = File.openDialog("Select voiceover audio file", "Audio files:*.wav;*.mp3;*.aif;*.aiff;*.m4a,All files:*.*");
            if (!f) return;
            var ext = getExtension(f.name);
            if (!arrayContains(AUDIO_EXTENSIONS, ext)) {
                alert("Please select an audio file (.wav, .mp3, .aif).");
                return;
            }
            var preset = getCurrentPreset();
            var imp = importVoiceoverFile(f, preset);
            if (!imp) return;
            state.voAudioLayer = imp.layer;
            voStatus.text = "Loaded " + f.name + " (" + imp.duration.toFixed(1) + "s). Analyzing...";
            styleStatus(voStatus, "info");
            voList.removeAll();
            // Wait a tick so the UI updates - then analyze
            var data = detectVOBreaks(imp.comp, imp.layer);
            if (!data) {
                voStatus.text = "Analysis failed.";
                styleStatus(voStatus, "warn");
                return;
            }
            state.voCachedAmps = data.amps;
            state.voCachedFps = data.fps;
            state.voCachedStartTime = data.startTime;
            voStatus.text = "Analyzed " + data.amps.length + " frames.";
            styleStatus(voStatus, "ok");
            recomputeVOSilences();
        };

        function recomputeVOSilences() {
            if (!state.voCachedAmps) return;
            var threshold = thresholdControl.getValue();
            var minSil = minSilenceControl.getValue();
            var minScn = minSceneControl.getValue();
            saveSetting("silenceThreshold", threshold);
            saveSetting("minSilenceDuration", minSil);
            saveSetting("minSceneDuration", minScn);

            var sil = findSilences(state.voCachedAmps, state.voCachedFps, threshold, minSil, minScn);
            state.voSilences = sil;
            voList.removeAll();
            if (sil.length === 0) {
                voStatus.text = "No breaks detected. Lower the threshold.";
                styleStatus(voStatus, "warn");
                return;
            }
            if (sil.length > MAX_BREAKS_WARN) {
                voStatus.text = "Found " + sil.length + " breaks (too many?). Raise min silence.";
                styleStatus(voStatus, "warn");
            } else {
                voStatus.text = "Found " + sil.length + " break(s).";
                styleStatus(voStatus, "ok");
            }
            for (var i = 0; i < sil.length; i++) {
                voList.add("item", "Break " + (i + 1) + " at " + formatTime(sil[i].midTime) + "  (" + sil[i].durationSec.toFixed(2) + "s silence)");
            }
        }

        thresholdControl.setOnChange(recomputeVOSilences);
        minSilenceControl.setOnChange(recomputeVOSilences);
        minSceneControl.setOnChange(recomputeVOSilences);

        applyVOBtn.onClick = function () {
            if (!state.voSilences || state.voSilences.length === 0) {
                alert("Import a voiceover and detect breaks first.");
                return;
            }
            if (!state.voAudioLayer) {
                alert("Voiceover layer reference lost. Re-import the audio file.");
                return;
            }
            var comp = null;
            try { comp = state.voAudioLayer.containingComp; } catch (e) { }
            if (!comp) {
                alert("Could not find the comp containing the voiceover.");
                return;
            }
            if (voModeMarkers.value) {
                applyVOMarkersOnly(comp, state.voAudioLayer, state.voSilences);
            } else {
                applyVOCreateScenes(comp, state.voAudioLayer, state.voSilences, getCurrentPreset(), getProjectName());
            }
        };

        // ---- Storyboard events ----
        function loadStoryboardFolder(folder) {
            state.storyboardFolder = folder;
            state.storyboardFiles = listImageFilesInFolder(folder);
            state.storyboardItems = null;
            if (state.storyboardFiles.length === 0) {
                sbStatus.text = "No images found in folder.";
                styleStatus(sbStatus, "warn");
                return;
            }
            var sceneCount = state.sceneComps ? state.sceneComps.length : findExistingSceneComps().length;
            if (sceneCount === 0) {
                sbStatus.text = "Found " + state.storyboardFiles.length + " image(s). Build scenes first.";
                styleStatus(sbStatus, "warn");
            } else {
                var matched = Math.min(state.storyboardFiles.length, sceneCount);
                sbStatus.text = "Found " + state.storyboardFiles.length + " image(s). " + matched + "/" + sceneCount + " matched.";
                styleStatus(sbStatus, "ok");
            }
        }

        pickFolderBtn.onClick = function () {
            var f = Folder.selectDialog("Select storyboard image folder");
            if (!f) return;
            loadStoryboardFolder(f);
        };

        pickFileBtn.onClick = function () {
            // Workaround for AE's legacy folder picker on Windows: open the
            // modern file picker, let the user pick any image inside the target
            // folder, then use that file's parent as the folder.
            var filter = "Images:*.png;*.jpg;*.jpeg;*.psd;*.ai;*.tif;*.tiff;*.bmp,All files:*.*";
            var pickedFile = File.openDialog("Pick any image from your storyboard folder", filter);
            if (!pickedFile) return;
            var parent = pickedFile.parent;
            if (!parent) { alert("Could not determine parent folder."); return; }
            loadStoryboardFolder(parent);
        };

        pickPdfBtn.onClick = function () {
            var f = File.openDialog("Select PDF storyboard", "PDF:*.pdf,All files:*.*");
            if (!f) return;
            sbStatus.text = "Importing PDF pages...";
            styleStatus(sbStatus, "info");
            var pages;
            try { pages = extractPdfPages(f); }
            catch (e) {
                alert("PDF import failed: " + e.message);
                return;
            }
            if (!pages || pages.length === 0) {
                sbStatus.text = "Could not extract pages from PDF.";
                styleStatus(sbStatus, "warn");
                return;
            }
            state.storyboardItems = pages;
            state.storyboardFiles = null;
            state.storyboardFolder = null;
            var sceneCount = state.sceneComps ? state.sceneComps.length : findExistingSceneComps().length;
            if (sceneCount === 0) {
                sbStatus.text = "Imported " + pages.length + " PDF page(s). Build scenes first.";
                styleStatus(sbStatus, "warn");
            } else {
                var matched = Math.min(pages.length, sceneCount);
                sbStatus.text = "Imported " + pages.length + " PDF page(s). " + matched + "/" + sceneCount + " matched.";
                styleStatus(sbStatus, "ok");
            }
        };

        placeStoryboardBtn.onClick = function () {
            var hasFiles = state.storyboardFiles && state.storyboardFiles.length > 0;
            var hasItems = state.storyboardItems && state.storyboardItems.length > 0;
            if (!hasFiles && !hasItems) {
                alert("Pick a storyboard source first (folder, file, or PDF).");
                return;
            }
            var comps = state.sceneComps;
            if (!comps || comps.length === 0) comps = findExistingSceneComps();
            if (!comps || comps.length === 0) {
                alert("No scene comps found. Build scenes first.");
                return;
            }
            if (hasItems) placeStoryboardItemsInScenes(state.storyboardItems, comps);
            else placeStoryboardInScenes(state.storyboardFiles, comps);
        };

        // ---- Beat Marker events ----
        function populateBeatLayers() {
            beatLayerDropdown.removeAll();
            var info = getAudioLayersInActiveComp();
            if (!info.comp) {
                beatLayerDropdown.add("item", "(no comp open)");
                beatLayerDropdown.selection = 0;
                return;
            }
            if (info.layers.length === 0) {
                beatLayerDropdown.add("item", "(no audio layers in comp)");
                beatLayerDropdown.selection = 0;
                return;
            }
            for (var i = 0; i < info.layers.length; i++) {
                beatLayerDropdown.add("item", info.layers[i].name);
            }
            beatLayerDropdown.selection = 0;
        }
        populateBeatLayers();

        beatLayerRefresh.onClick = populateBeatLayers;

        detectPeaksBtn.onClick = function () {
            var info = getAudioLayersInActiveComp();
            if (!info.comp || info.layers.length === 0) {
                alert("Open a comp containing an audio layer first.");
                return;
            }
            var sel = beatLayerDropdown.selection;
            if (!sel) { alert("Pick an audio layer."); return; }
            var selIdx = beatLayerDropdown.selection.index;
            if (selIdx < 0 || selIdx >= info.layers.length) { alert("Layer selection invalid."); return; }
            var audioLayer = info.layers[selIdx];
            state.beatAudioLayer = audioLayer;

            beatStatus.text = "Analyzing...";
            styleStatus(beatStatus, "info");
            var data = detectBeatsInLayer(info.comp, audioLayer);
            if (!data) { beatStatus.text = "Analysis failed."; styleStatus(beatStatus, "warn"); return; }
            state.beatCachedAmps = data.amps;
            state.beatCachedFps = data.fps;
            recomputeBeatPeaks();
        };

        function recomputeBeatPeaks() {
            if (!state.beatCachedAmps) return;
            var sensitivity = sensitivityControl.getValue();
            var minGap = minGapControl.getValue();
            saveSetting("peakSensitivity", sensitivity);
            saveSetting("minPeakGap", minGap);
            var peaks = findPeaks(state.beatCachedAmps, state.beatCachedFps, sensitivity, minGap);
            state.beatPeaks = peaks;
            beatStatus.text = "Found " + peaks.length + " peak(s).";
            styleStatus(beatStatus, peaks.length > 0 ? "ok" : "warn");
        }

        sensitivityControl.setOnChange(recomputeBeatPeaks);
        minGapControl.setOnChange(recomputeBeatPeaks);

        placeMarkersBtn.onClick = function () {
            if (!state.beatPeaks || state.beatPeaks.length === 0) {
                alert("Detect peaks first.");
                return;
            }
            if (!state.beatAudioLayer) { alert("Beat audio layer reference lost. Re-detect."); return; }
            var comp = null;
            try { comp = state.beatAudioLayer.containingComp; } catch (e) { }
            if (!comp) { alert("Comp not found."); return; }
            var colorName = colorDropdown.selection ? colorDropdown.selection.text : "Green";
            saveSetting("markerColor", colorName);
            placeBeatMarkers(comp, state.beatAudioLayer, state.beatPeaks, colorName);
        };

        colorDropdown.onChange = function () { saveSetting("markerColor", colorDropdown.selection.text); };
    }

    function styleHeader(textCtrl) {
        try {
            textCtrl.graphics.font = ScriptUI.newFont(textCtrl.graphics.font.name, "Bold", 10);
            textCtrl.graphics.foregroundColor = textCtrl.graphics.newPen(textCtrl.graphics.PenType.SOLID_COLOR, COLOR_HEADER, 1);
        } catch (e) { }
    }

    function styleStatus(textCtrl, kind) {
        try {
            var color = COLOR_TEXT;
            if (kind === "ok") color = COLOR_SUCCESS;
            else if (kind === "warn") color = COLOR_WARNING;
            textCtrl.graphics.foregroundColor = textCtrl.graphics.newPen(textCtrl.graphics.PenType.SOLID_COLOR, color, 1);
        } catch (e) { }
    }

    function makeLabeledSlider(parent, labelText, initVal, minVal, maxVal, step, suffix) {
        // Builds: [label] [slider] [value]
        var grp = parent.add("group");
        grp.orientation = "row";
        grp.alignChildren = ["fill", "center"];
        var lbl = grp.add("statictext", undefined, labelText);
        lbl.preferredSize = [110, -1];
        var slider = grp.add("slider", undefined, initVal, minVal, maxVal);
        slider.preferredSize = [-1, 20];
        var val = grp.add("statictext", undefined, formatSliderValue(initVal, step, suffix));
        val.preferredSize = [46, -1];

        var onChangeCallback = null;
        function snap(v) {
            if (step <= 0) return v;
            return Math.round(v / step) * step;
        }
        slider.onChanging = function () {
            var v = snap(slider.value);
            val.text = formatSliderValue(v, step, suffix);
        };
        slider.onChange = function () {
            var v = snap(slider.value);
            slider.value = v;
            val.text = formatSliderValue(v, step, suffix);
            if (onChangeCallback) onChangeCallback();
        };

        return {
            getValue: function () { return snap(slider.value); },
            setValue: function (v) { slider.value = snap(v); val.text = formatSliderValue(slider.value, step, suffix); },
            setOnChange: function (fn) { onChangeCallback = fn; }
        };
    }

    function formatSliderValue(v, step, suffix) {
        var decimals = 0;
        if (step > 0 && step < 1) {
            // count decimals in step
            var s = String(step);
            var dot = s.indexOf(".");
            if (dot !== -1) decimals = s.length - dot - 1;
        }
        return v.toFixed(decimals) + (suffix || "");
    }

    // -- Paste Script dialog (for PDF, Word, Google Docs, email, anything) ----

    function showPasteDialog() {
        var FORMAT_LABELS = ["Auto-detect", "CSV", "TSV", "Plain text", "Markdown", "Fountain", "JSON", "Production Script"];
        var FORMAT_VALUES = [null, "csv", "tsv", "txt", "markdown", "fountain", "json", "production"];

        var dlg = new Window("dialog", APP_NAME + " - Paste Script", undefined);
        dlg.orientation = "column";
        dlg.alignChildren = ["fill", "top"];
        dlg.margins = 12;
        dlg.spacing = 8;

        var info = dlg.add("statictext", undefined,
            "Paste your script text below. Works with text copied from PDF, Word, Google Docs, email - anywhere.",
            { multiline: true });
        info.preferredSize = [560, 30];

        var fmtGrp = dlg.add("group");
        fmtGrp.alignChildren = ["left", "center"];
        fmtGrp.add("statictext", undefined, "Format:");
        var fmtDD = fmtGrp.add("dropdownlist", undefined, FORMAT_LABELS);
        fmtDD.selection = 0;
        fmtGrp.add("statictext", undefined, "(Auto-detect handles most cases)");

        var textArea = dlg.add("edittext", undefined, "", { multiline: true, scrolling: true });
        textArea.preferredSize = [560, 340];

        var btnGrp = dlg.add("group");
        btnGrp.alignment = ["fill", "top"];
        btnGrp.add("statictext", undefined, "").alignment = ["fill", "center"]; // spacer
        var cancelBtn = btnGrp.add("button", undefined, "Cancel", { name: "cancel" });
        var okBtn = btnGrp.add("button", undefined, "Parse", { name: "ok" });

        var result = null;
        okBtn.onClick = function () {
            var content = textArea.text;
            if (trim(content) === "") {
                alert("Paste some text first.");
                return;
            }
            var idx = fmtDD.selection ? fmtDD.selection.index : 0;
            var fmt = FORMAT_VALUES[idx];
            var scenes;
            try {
                scenes = parseScriptContent(content, fmt);
            } catch (e) {
                alert("Could not parse: " + e.message);
                return;
            }
            if (!scenes || scenes.length === 0) {
                alert("No scenes detected. Try a different format from the dropdown.");
                return;
            }
            result = normalizeSceneTimings(scenes);
            dlg.close(1);
        };
        cancelBtn.onClick = function () { dlg.close(0); };

        if (dlg.show() === 1) return result;
        return null;
    }

    // =========================================================================
    // ENTRY
    // =========================================================================

    function createPanel(thisObj) {
        var pal = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", APP_NAME + " v" + APP_VERSION, undefined, { resizeable: true });

        try {
            buildUI(pal);
        } catch (e) {
            alert(APP_NAME + " UI Error: " + e.message + "\n\nLine: " + (e.line || "?"));
            return null;
        }

        if (pal instanceof Window) {
            pal.center();
            pal.show();
        } else {
            pal.layout.layout(true);
            pal.layout.resize();
            pal.onResizing = pal.onResize = function () {
                try { this.layout.resize(); } catch (e) { }
            };
        }
        return pal;
    }

    // Check AE version - need 2018+ for guideLayer etc.
    try {
        if (parseFloat(app.version) < 15) {
            alert(APP_NAME + " requires After Effects 2018 (15.0) or newer.");
            return;
        }
    } catch (e) { }

    createPanel(thisObj);

})(this);
