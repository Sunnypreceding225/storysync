<div align="center">

# StorySync

**Script to timeline in one click.**

An After Effects ScriptUI panel that builds your scene structure, syncs voiceover, imports storyboards, and places beat markers — automatically. Free and open source.

[![Watch the demo](https://img.youtube.com/vi/u1ncqPEuGug/maxresdefault.jpg)](https://youtu.be/u1ncqPEuGug)

*▲ Click to watch the 4-minute walkthrough on YouTube*

</div>

---

## Why this exists

Setting up a new explainer/commercial project in After Effects is the same 30–60 minutes every single time:

- Import your script
- Create individual scene comps with matching durations
- Set up a master comp and place each scene in order
- Drop in voiceover, scrub for natural pauses
- Import storyboard frames into each scene
- Mark beat hits on the music track for transition timing

StorySync collapses all of that into roughly **30 seconds**, then gets out of your way so you can animate.

> *"I got tired of manually setting up projects in AE, so I built this."* — [Featured on r/AfterEffects](https://www.reddit.com/r/AfterEffects/) (9.2K views, 16 comments)

## What it does

| Feature | What it replaces |
|---|---|
| **Scene Builder** — parse any script format into a full scene-comp + master-comp structure | 20+ minutes of New Composition / Pre-compose / Place layer / Rename |
| **Voiceover Sync** — auto-detect silences and align scenes to natural VO pauses | Manual scrubbing and marker placement |
| **Storyboard Import** — drop a folder of images or a multi-page PDF into the right scenes | Importing files, dragging into pre-comps, scaling, opacity tweaks |
| **Beat Markers** — find amplitude peaks in your music and place transition markers | Watching the waveform and pressing `*` for every hit |

Built as a single `.jsx` file — drop it into AE's `ScriptUI Panels` folder and you're done.

## Install (30 seconds)

1. Download the latest [`StorySync.jsx`](https://github.com/yuvraj-xyz/storysync/releases/latest)
2. Copy it to your AE Scripts/ScriptUI Panels folder:
   - **Windows:** `C:\Program Files\Adobe\Adobe After Effects [version]\Support Files\Scripts\ScriptUI Panels\`
   - **macOS:** `/Applications/Adobe After Effects [version]/Scripts/ScriptUI Panels/`
3. Open AE → **Edit** → **Preferences** → **Scripting & Expressions** → check **Allow Scripts to Write Files and Access Network**
4. Restart AE. Open the panel via **Window** → **StorySync**

That's it. Dock it next to Properties and forget the install.

## Quick start

### Build scene comps from a script

1. Click **Settings** → set project name, comp size, FPS
2. Paste any script via **Paste Script** (or **Import Script File** to load from disk)
3. Click **Build Project Structure**

A full folder of scene pre-comps and a master comp with markers is created in 1–2 seconds.

### Sync voiceover

1. Switch to the **Voiceover** tab
2. **Import Voiceover** (`.wav` or `.mp3`)
3. Tune the silence threshold sliders live — preview updates instantly
4. Apply as **Markers only** or **Create scenes** from the detected pauses

### Multi-page PDF storyboard

1. Switch to the **Storyboard** tab
2. **Import PDF (one page per scene)**
3. Each PDF page is placed in the matching scene comp as a 50% opacity guide layer

## Supported script formats

StorySync auto-detects what you give it. Pick a file, or paste from anywhere.

| Format | Example | Use case |
|---|---|---|
| **Production script** | `[HOOK — 0:00–0:08]` + `VOICEOVER:` blocks | Real explainer/commercial scripts |
| **Lean production** | `[0:00–0:08]` + quoted text below | Stripped-down voiceover scripts |
| **CSV / TSV** | `scene,start,end,description` | Spreadsheet workflows |
| **Plain text** | `Scene description | 5s` | Quick one-liners |
| **Markdown** | `# Heading (5s)` or `- bullet | 5s` | Notion / Obsidian / docs |
| **Fountain** | `INT./EXT.` scene headings | Screenplay-style scripts |
| **JSON** | `[{description, duration}]` | Structured / programmatic input |
| **Prose paragraphs** | Just write what the voiceover says | StorySync auto-times at a natural read pace |

Scripts without timestamps get auto-timed and chunked by sentence and paragraph boundaries.

## Compatibility

- After Effects **2018 (15.0)** through **2026**
- Windows and macOS
- Single-file install — no dependencies, no Node, no Adobe extension manager

## Examples

The repo includes ready-to-run example scripts:

- [`examples/example_script.csv`](examples/example_script.csv)
- [`examples/example_script.txt`](examples/example_script.txt)

## Tests

The parser logic has **189 unit tests** covering every supported format, line-ending edge cases, prose chunking, and bug regressions. Run them with Node:

```bash
node test_parsers.js
```

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). The codebase is one `.jsx` file (ExtendScript / ES3) plus a Node test harness — easy to dig into.

Found a bug or have a feature request? Open an [issue](https://github.com/yuvraj-xyz/storysync/issues).

## License

MIT. See [LICENSE](LICENSE). Free for personal and commercial use, including in client work.

## Author

Built by [Yuvraj Paliwal](https://github.com/yuvraj-xyz) — building [Acticio](https://acticio.com), an AI hiring platform that ranks candidates by what they've built, not what they wrote on a resume.

[Twitter](https://twitter.com/yuvraj_xyz) · [YouTube](https://youtube.com/@yuvrajfx0)

---

<div align="center">

If StorySync saves you time, a ⭐ on the repo helps other motion designers find it.

</div>
