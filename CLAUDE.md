# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Next dev server, http://localhost:3000
npm run typecheck    # tsc over both tsconfigs: the app, and src/remotion separately
npm test             # vitest, tests/e2e only
npm run build        # production build
npx next typegen     # only when typecheck complains about .next/types
npm run render -- --project projects/<id>          # whole video, via the worker
npm run render -- --project projects/<id> --scene 3 # one scene as preview.mp4
```

There is no unit-test layer; every test is an e2e test in `tests/e2e/` and `npm test` renders **real video** with real ffmpeg, Chrome and Piper. It is slow in the way the product is slow, and the full-render test is the slowest thing in the repo by far. Suite-wide settings live in `vitest.config.mts` (`fileParallelism: false` and long timeouts are deliberate — two concurrent renders is what the render lock exists to prevent, on a 7.6 GiB machine).

In this project's workflow the test suite and the fixtures are the maintainer's step: the specs under `_bmad-output/` routinely freeze `tests/` and the fixtures and hand `npm test` to a human pass. Check with the maintainer before writing or modifying tests as part of a feature change.

`pnpm-lock.yaml` is the tracked lockfile, while the README says `npm install` (and `node_modules/` currently carries both npm and pnpm markers). Refreshing the lockfile is tracked as deferred work — confirm with the maintainer before switching package managers.

## Architecture

Three consumers share one contract, and that is the shape of the whole repo:

- **The Next app** (`src/app/`) — API routes plus one client page.
- **The render worker** (`scripts/render-worker.ts`) — a separate process, spawned by the app or run by hand.
- **The Remotion composition** (`src/remotion/`) — bundled and rendered by the worker.

All three import the same `src/lib/*.ts` modules **directly as `.ts`** (e.g. `import { validateScenes } from './schema.ts'`). That is load-bearing, not a style choice: Node 24 runs the worker and the tests via type stripping, and Node requires the extension on relative imports, while webpack/esbuild resolve the same specifier. Never change a relative import to an extensionless one.

There is a second, independent constraint on `src/lib/schema.ts`: its zod definitions are *also* what generates the JSON Schema sent to the model, and the provider's strict structured-output mode accepts only a subset of JSON Schema. So the root must be an object (hence the `{scenes: [...]}` envelope), `.optional()` must be `.nullable()`, and `.default()` and array `.min()/.max()` are forbidden. Bounds on numbers are the way to constrain things, which is where the per-scene caps live. Anything the strict subset cannot express (shapes per scene, total duration, label words, the narration word budget) is enforced by `superRefine` and stated in the prompt — and the prompt text is *derived* from the constants here (`SCENES_SYSTEM_PROMPT` maps over `SHAPE_KINDS`/`SHAPE_NOTES` and reads the caps), so the prompt and the validator cannot drift. Adding a shape kind to `SHAPE_SPECS` reaches the model automatically; the exhaustive `SHAPE_NOTES` record forces you to describe it.

One split in that file looks like duplication and is load-bearing: `SceneShapeSchema` is structure only, and it is what `ScenesEnvelopeSchema` — and so the provider — is held to, while `SceneSchema` adds the refinements that `validateScenes` applies on this side (and that the worker re-runs via `readScenes`). If the envelope carried the refined schema, those refinements would fire during request parsing and reject the reply *before* `generateScenes` could hand the validator's complaints back for its one repair pass — leaving that repair dead code for exactly the failures it exists to fix, and turning a one-word overrun into a discarded storyboard. Keep them apart.

### The pipeline and its seams

`textToScript` → `scriptToScenes` → `scenesToVideo`, all in `src/lib/pipeline.ts`, which also owns project paths and folder creation. The LLM boundary (`src/lib/llm.ts`) is the **only** thing the tests fake; everything behind it — validation, file I/O, rendering, ffmpeg — is real in test as in production.

Two consequences worth knowing before refactoring:

- A Next route module may export only HTTP methods and its route config, so orchestration that a test needs to reach lives in `src/lib/generate.ts`, not in the handler. It takes `llm: Llm = new OpenAiLlm()` as a defaulted parameter (built per call, so constructing it touches neither the network nor the environment) and returns failures as data (`ApiFailure`) rather than an HTTP response.
- `failureFrom()` in `src/lib/http.ts` is the single mapping from thrown `PipelineError`/`LlmError` onto `{error, code, details?}`. Two mappings would be two places for a status code to drift.

### Project state is files, not a database

A project is a folder under `PROJECTS_DIR` (`src/lib/render-config.ts` names every file). `status.json` is the worker's live state and the only record of what is happening, precisely because the worker is a separate process that can be killed. Every write goes through `writeJsonAtomic`/`writeTextAtomic` (`src/lib/atomic.ts`, temp name then rename, unique temp names so a throttled progress write cannot interleave with a forced one). Every video is rendered to a temp name and renamed into place, so a cancelled render never leaves a half-written MP4.

`src/lib/render-status.ts` holds the status contract and deliberately imports no `fs`, so the browser bundle can share the types. The page (`src/app/page.tsx`) likewise only takes **types** from `schema.ts` — never values — to keep zod out of the browser bundle; every budget string it prints was formatted by the server.

### One render at a time, across every entry point

`projects/.active-render.json` is the app's only cross-project state. The app spawns the worker and *then* claims the lock with the worker's pid (`src/lib/render-jobs.ts`); the worker also claims the same lock itself (`src/lib/render-lock.ts`), and accepts a lock carrying its own pid. That is why a CLI render and an app render mutually exclude, why pressing Cancel in the browser can stop a terminal-started render, and why a lock whose process is gone is reclaimed on sight. When changing job startup, preserve the ordering and the "only ever speak for the worker you were created for" pid checks — a late exit from an old worker must not stamp `failed` over a newer running render.

### The worker's stage order

validate storyboard → take lock → ensure browser → **synthesize every narration** → bundle → per-scene render → ffprobe each clip → ffmpeg concat `-c copy`. Exit codes: `0` success, `1` refusal/failure, `130` cancelled.

- Narration is synthesized unconditionally, before bundling, one WAV per scene (`narration/scene-NNN.wav`), and never reused from a previous run. Each WAV is ffprobed against its scene's frame-rounded length plus one tolerance constant; an overrun refuses the render rather than speeding the voice up or truncating it.
- Piper is an external subprocess only — spawned from PATH, never imported or bundled (it is GPL; the app's own code must not link it).
- Audio is baked into each scene clip (`<Audio>` in `src/remotion/Scene.tsx`, `enforceAudioTrack`, `AUDIO_*` constants), never muxed afterwards. The join is `-c copy`, which is only lossless while every clip agrees on codec, pixel format, frame rate, canvas **and** audio parameters — that agreement is the whole reason those constants live together in `src/lib/render-config.ts` instead of at each call site. `MAX_FRAME_CONCURRENCY` is pinned at 2 by the RAM budget and is not a supported knob.
- A clip whose loudest sample is at or below `AUDIO_SILENCE_MAX_VOLUME_DB` is refused: an audio stream's presence proves nothing, since `enforceAudioTrack` produces one whether or not anything played.

### Scene → SVG happens in exactly one place

`sceneSvg()` in `src/lib/svg.ts` turns a scene plus a per-shape draw progress into an SVG. The Remotion composition feeds it per-frame progress from `drawWindows()` (`src/lib/timeline.ts`); the preview route feeds it 1 for everything. Because both go through the same function, the preview cannot disagree with the render about what a scene looks like — keep it that way. Geometry helpers live in `board.ts` (coordinate space, palette, paper), `doodle.ts` (shape → rough.js paths) and `figure.ts` (the stick figure's proportions, shared with the schema's board-extent check).

### The model states relationships; `layout.ts` computes the pixels

The model cannot see what it draws, so the DSL lets a shape name another shape by its index in the same scene (`label.inShape`, `underline.underLabel`, `fromShape`/`toShape` on arrows and connectors, `crossOut.target`, `stickFigure.label`) and `layOutScenes()` in `src/lib/layout.ts` turns those anchors into geometry: text centred in its box and shrunk to fit, line ends snapped onto the edges they name, an underline sized to the words it runs under, a caption written below a figure's feet. Three rules hold it together:

- **It runs on every read path**, in one order: parse against `ScenesShapeSchema` (structure only) → `layOutScenes` → `validateScenes`. Generation (`generateScenes`), the app (`readScenes`) and the worker (`loadScenes`) all do exactly this, so a hand-edited `scenes.json` is laid out like a generated one. The order is load-bearing: the pass can fix what the refinements would refuse, so judging geometry before laying it out would reject a storyboard the renderer would have drawn.
- **It is a fixed point** — `layOutScenes(layOutScenes(s))` equals `layOutScenes(s)` — because it runs again on every read. A shape with no anchors is returned byte-identical, which is what keeps pre-anchor storyboards and the frozen fixtures unchanged. Any new pass must keep that property: an anchored coordinate that depends on where the ends *currently* are will drift on the second run.
- **An unresolvable anchor is cleared, not fatal**, and the shape is drawn where the model put it; the pass returns those as `issues`, which `generateScenes` folds into the same repair list as validation errors — but it will not throw away a storyboard over one. `crossOut.target` cannot be cleared (it is required), so an unresolvable one is reported and simply not drawn.

Two more invariants worth keeping:

- **A figure's caption is never materialised as a `label` shape.** It is drawn from the figure (`captionPlacement`, used by both `svg.ts` and the layout pass), because inserting a shape would shift every index after it, and the indices are exactly what the anchors address. `countLabelWords` counts it, so it cannot be used to smuggle words past the per-scene cap. The composite shapes' carried text (a card's title, a badge's symbol, a bullet list's title and items) works the same way: placed by pure functions of the shape's own fields, never written back as coordinates.
- **The anchor fields are where the two schemas split.** `ShapeSchema` (what we parse with) has them `.nullable().optional()`; `ProviderShapeSchema` is derived per-kind from the same `SHAPE_SPECS` via `anchored()` — which *strips* both wrappers before re-applying `null` — because a leftover `.optional()` keeps the field out of `required` and hides it from the model entirely. `ANCHORED_FIELDS` also lists the nullable text fields the composite shapes carry (`card.title`, `badge.text`, `bulletList.title`): a reply that omits one fails the structural parse, and `generateScenes` throws on that before the repair pass could run — never let a missing field whose only sensible value is `null` discard a storyboard. The prompt is assembled from `SHAPE_KINDS`/`SHAPE_NOTES`, so a new kind documents its own anchors there; the general "shapes address each other by index" rule is prose in `SCENES_SYSTEM_PROMPT` and needs a look when a new anchored field appears.

Text widths come from a generated table (`src/lib/text-metrics.ts`) — regenerate it with `node scripts/generate-font-widths.ts` if the bundled face is ever replaced. It is a sum of per-glyph advances, so kerning is not applied and text is measured slightly wide, which is the safe direction for fitting.

## Environment

`.env.local` is read by the **Next server only**: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `PROJECTS_DIR`, and the `PIPER_*` pair. The app passes its environment on to the worker it spawns, so app renders see them — but the worker does **not** read `.env.local` itself, so a render started from your terminal needs `PIPER_MODELS_DIR`/`PIPER_VOICE` exported in that shell. Relative `PIPER_MODELS_DIR` resolves against the project root, not the working directory.

The code's defaults are DeepSeek (`DEFAULT_BASE_URL`/`DEFAULT_MODEL` in `src/lib/llm.ts`), while the README's env table still lists OpenAI's endpoint and model. The code wins; the README row is drift.

DeepSeek rejects the strict `json_schema` mode, so every generate normally pays a rejected request then a plain-JSON retry with the schema in the prompt. The fallback path is expected, not an error path — but it means a Generate makes up to six requests, and each model call disables thinking mode.

## Gotchas

- **Rendering is not offline.** The renderer loads Architects Daughter through `@remotion/google-fonts` at render time and fails loudly without network. The in-app preview embeds `public/fonts/architects-daughter-latin-400.woff2` instead, and `src/remotion/index.ts` imports `fonts.ts` for its side effect only — a tree-shaking change there would silently render every label in a fallback face.
- Two tsconfigs: the root one **excludes** `src/remotion`, which has its own. `npm run typecheck` runs both.
- Route handlers set `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`, and `next.config.js` keeps `@remotion/renderer` and `@remotion/bundler` out of the server bundle (they spawn children and resolve native binaries from their own directory). Vitest aliases `next/server` to `next/server.js` for the same class of reason.
- `NARRATION_WPS = 2.5` in `src/lib/schema.ts` is asserted, never measured — accepted storyboards can in principle be refused at render time if the voice speaks slower. It is on the deferred-work list; lower the constant if the first real render bites.
- Remotion is the one dependency with a licence worth checking before commercial use; the README links the terms.

## Specs and workflow

Feature work here is spec-driven through BMAD. The artifacts are **gitignored**: specs and implementation notes under `_bmad-output/implementation-artifacts/`, with `_bmad-output/implementation-artifacts/deferred-work.md` listing what is outstanding and known-unfixed. `README.md` is unusually thorough and is the public contract — when behaviour changes, it is part of the change.
