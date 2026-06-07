# Changelog

All notable changes to StorySync will be documented in this file.

## [1.0] — 2026-05-19

Initial public release. Script-to-timeline tool for After Effects 2018–2026, Windows and macOS.

### Scene Builder
- Imports **six text formats**: CSV, TSV, TXT, Markdown, Fountain (screenplay), and JSON. Auto-detection from file extension and content.
- **Paste Script** dialog — copy text from PDF, Word, Google Docs, email, or anywhere else and paste it into a multi-line text area; auto-detect or pick the format. PDF/DOC/RTF source files selected in the file picker redirect users to Paste Script.
- **Prose auto-timing** for scripts without timestamps. Blank lines act as scene boundaries; continuous prose is sentence-aware-chunked into bite-sized scenes. Read pace tuned for natural narration.
- Builds a full project structure on click: root folder, scenes sub-folder, individual scene pre-comps with description and label guide text, and a master comp with scene markers placed at each boundary.

### Voiceover Sync
- Imports `.wav` / `.mp3` / `.aif` voiceover files.
- Uses AE's `Convert Audio to Keyframes` to read per-frame amplitude. The target audio layer is soloed during analysis so music or other VO in the comp doesn't contaminate readings.
- **Live silence detection** — threshold, min-silence-duration, and min-scene-length sliders re-compute the break list instantly against a cached amplitude array (no re-analysis cost while tuning).
- Two output modes: place markers at silence midpoints, or auto-create scene comps that match the VO's natural pauses (audio is trimmed and dropped into each scene comp).

### Storyboard
- Imports a folder of numbered PNG / JPG / JPEG / PSD / AI / TIFF / BMP images with natural numeric sort (so `02.png` comes before `10.png`).
- **Multi-page PDF support** — `Import PDF (one page per scene)` brings in a multi-page PDF via `ImportAsType.COMP_CROPPED_LAYERS` and distributes each page to a scene comp.
- All references are placed as 50% opacity guide layers, scale-to-fit and centered, so they show in the timeline for reference but don't render.
- `Pick from Folder` button works around AE's legacy folder picker on Windows by using the modern file dialog and inferring the parent folder from a representative image.

### Beats
- Picks any audio-bearing layer in the active comp and detects amplitude peaks for transition timing.
- Live-tunable sensitivity (0–200) and minimum gap between peaks.
- Configurable marker color (all 16 AE marker labels).

### Settings
- **Project name + custom comp size**: width, height, FPS as editable number fields with range validation (16–16384 px, 1–120 fps). Quick-preset dropdown fills the fields with common configurations (1080p 24/25/30, 4K 24/30, Square 1080, Vertical 9:16, 720p 30).
- Settings persist via `app.settings`.

### UI
- Vertical sidebar with four panels (Build, Voiceover, Storyboard, Beats), each with a custom-drawn icon and active-state highlight.
- Top-bar `Settings` (modal dialog), `Reset` (clears panel state without touching the AE project), `?` (help).
- Sliders show live values and snap to step boundaries.
- Status bar at the bottom showing state and AE version.

### Robustness
- Line-ending normalization at parser entry — handles Windows CR-only line endings returned by ScriptUI multi-line edittext.
- Format detection requires consistent delimiter counts across multiple lines before classifying as CSV/TSV — prevents comma-rich prose from being mis-read as tabular data.
- Sentence-aware chunking ensures no scene can exceed a sensible maximum word count, even if the input is one giant paragraph.
- Every action is wrapped in an undo group; native `Ctrl/Cmd+Z` restores state cleanly.
- 144 parser unit tests covering all six formats, line-ending variants, prose chunking, custom presets, and known regressions.

### Compatibility
- After Effects 2018 (15.0) through 2026
- Windows and macOS
- Single `.jsx` file install — drop into `Scripts/ScriptUI Panels/` and open via the `Window` menu
