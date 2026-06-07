# Contributing to StorySync

Thanks for thinking about contributing. StorySync is a single-file After Effects ScriptUI panel — the codebase is small, deliberately, and that's how I'd like to keep it.

## What's most welcome

- **Bug reports** with a script/script-snippet that reproduces the issue and the version of After Effects you're on
- **New input format parsers** — if there's a script format you use that StorySync doesn't handle, a parser PR is great
- **Performance improvements** on large scripts (300+ scenes)
- **Mac-specific fixes** — most testing happens on Windows
- **Test coverage** in `test_parsers.js` for edge cases

## What probably isn't a fit

- Adding new dependencies (StorySync is intentionally a single `.jsx` file)
- Major UI rewrites — open an issue first to discuss
- Features that require a paid Adobe extension framework (CEP/UXP)

## Development setup

```bash
git clone https://github.com/yuvraj-xyz/storysync.git
cd storysync

# Run the parser test suite
node test_parsers.js
```

For testing inside After Effects, copy `StorySync.jsx` into your AE `Scripts/ScriptUI Panels/` folder, then re-open it via the `Window` menu each time you change the file.

## Code style

- **ExtendScript ES3 only.** No `const`, `let`, arrow functions, template literals, spread, `forEach`, or anything that Node accepts but ExtendScript doesn't.
- Reserved-word identifiers from Java that ExtendScript blocks include: `short`, `final`, `class`, `enum`, and others. Use `var` declarations with non-reserved names.
- Validate with `node --check StorySync.jsx` before submitting — this catches most syntax issues, though it doesn't catch reserved-word problems (those need testing inside AE).
- Keep helper functions small. Prefer adding tests in `test_parsers.js` over manual testing.

## Pull request checklist

- [ ] `node test_parsers.js` passes
- [ ] `node --check StorySync.jsx` is clean
- [ ] If you added a new feature, you also added a test case
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] PR description includes "before/after" or repro steps

## Reporting bugs

Open an [issue](https://github.com/yuvraj-xyz/storysync/issues/new/choose) with:

1. After Effects version (Help → About)
2. OS (Windows / macOS) and version
3. The script content that triggered the bug (paste it directly or attach a `.txt`)
4. Steps to reproduce
5. What happened vs. what you expected

## Code of conduct

Be kind. Assume good faith. If you wouldn't say it to a stranger at a motion-design meetup, don't say it on the issue tracker.
