# Replace custom drawing with RemotionUI (typed scene kinds)

## Context

The product currently draws every video frame through a fully custom pipeline: the model emits a flat list of 14 shape kinds (box, label, arrow, stickFigure…), which `src/lib/svg.ts` → `src/lib/doodle.ts` (roughjs) turn into stroke-animated SVG, mounted by `src/remotion/Scene.tsx`. Beside it sits a bespoke, in-repo component kit (`src/remotion/kit/`, ~6,200 lines, 7 scene types, 15 primitives) that is Studio-demo-only and explicitly not wired to the storyboard DSL. The instant web preview serves the same `sceneSvg()` as the render (the documented "one drawing step" invariant).

The goal: adopt **RemotionUI** (shadcn-style source components copied into the repo via `npx remotion-ui add`, never imported from an npm package) as the drawing system, delete the custom doodle path and the bespoke kit, and update the docs. Three decisions were made with the maintainer:

1. **Typed scene kinds** replace the 14-shape DSL: `title, points, flow, topology, sequence, code, concept`. Model prompt, validation, and layout are rewritten. Old `scenes.json` stop validating (regenerate in-app; documented).
2. **Server still renders** replace the SVG preview: a new API route renders the actual composition as PNG via `@remotion/renderer` (`renderStill`) — pixel-identical preview by construction.
3. **Direct implementation**, no BMAD spec; README + docs updated as part of the change.

Verified RemotionUI facts that shape the design: every adopted block has a `speed` prop (incl. `org-chart-build`); with `holdSeconds` omitted blocks hold to the end of the clip; copied sources import via `@/remotion/...` alias, extensionless, and load Inter (JetBrains Mono for code) at module scope — so the repo gains a `@/*` alias in three resolvers (both tsconfigs, the Remotion bundler via `webpackOverride`, and Studio via a new root `remotion.config.ts` + `@remotion/cli` devDep). The `.ts`-extension rule stays for `src/lib` (Node type stripping); the alias lives only inside `src/remotion`.

## Scene-kind → block mapping (drives Stages 1–2)

| DSL kind | Renders with | Extra fields (beyond `title, durationSeconds, narration, kind, theme?, accent?`) | Caps (superRefine + prompt) |
|---|---|---|---|
| `title` | `title-card` | `subtitle?, eyebrow?, meta?` | — |
| `points` | `feature-list` | `eyebrow?, items: [{label, detail?}]` | 2–5 items |
| `flow` | `data-flow-pipes` | `stages: [{label, detail?}], unit?, packets?` | 2–5 stages, packets 1–12 |
| `topology` | `org-chart-build` | `nodes: [{name, role?, parent?}]` | 3–10 nodes; `parent` < own index, exactly one root (refused, not cleared) |
| `sequence` | `timeline-steps` | `eyebrow?, steps: [{title, description?}]` | 2–5 steps |
| `code` | `code-reveal` | `code, language?, startLine?, highlightedLines[], filename?` | ≤24 lines, ≤100 chars/line; `language` enum (ts, tsx, js, python, go, rust, java, sql, bash, json, yaml) |
| `concept` | **local component** built from adopted primitives (no registry block fits) | `eyebrow?, explanation, terms?: [{term, note?}], keyPoints: string[], takeaway?` | 1–4 terms, 0–4 keyPoints |

- `theme?: 'dark'|'light'` (null → block default dark), `accent?: blue|cyan|violet|green|amber|rose` (null → block default). Adapter maps accent → hex using the kit's light-theme hexes (`blue #2563eb, cyan #0e9bb5, violet #7c3aed, green #0e9f6e, amber #d97706, rose #e11d48`) — copy them into the composition before the kit dies.
- Duration: blocks have fixed choreography; the adapter maps the worker's fitted scene length to `speed = clamp(NOMINAL[kind] / (0.85 × fittedSeconds), 0.4, 3)`, `NOMINAL[kind]` measured per block from the copied source (start: title 4, points 1.5+0.6n, flow 3+0.7n, topology 3.5, sequence 1+0.8n, code 2+0.35·lines, concept 3). With `holdSeconds` omitted, the block holds to the end of the clip.
- On-screen word caps per kind via `maxWrittenWords(kind)` (title 30, points 65, flow 45, topology 70, sequence 65, code 40 non-code text, concept 55), replacing `countLabelWords` with `countWrittenWords(scene)`.

## Stage 0 — RemotionUI bootstrap + alias plumbing (additive; nothing breaks)

1. `npx remotion-ui@latest init --existing` → commit the generated `remotion-ui.json`. Verify install targets with `npx remotion-ui list`.
2. `npx remotion-ui add title-card feature-list data-flow-pipes timeline-steps org-chart-build code-reveal` and `npx remotion-ui add marker-highlight arrow-annotate typewriter counter badge-stamp stagger-children fade-in slide-up scale-in spring-in path-draw text-emphasis motion-primitive motion-wrapper timing springs`. Registry deps (`code-syntax, layout, motion-tokens, path-utils, …`) land under `src/remotion/lib/` automatically. **Never patch copied sources** (keeps `remotion-ui update` clean). If `add` patches `Root.tsx` or runs installs, revert those; `id="Scene"` stays the only composition.
3. `pnpm add @remotion/paths@4.0.524` (path-draw dep) and devDep `@remotion/cli@4.0.524` (Studio + `remotion.config.ts`). pnpm is the tracked lockfile.
4. Aliases: root `tsconfig.json` and `src/remotion/tsconfig.json` get `paths: {"@/*": ["src/*"]}` (+ `baseUrl`, and `allowUmdGlobalAccess: true` in the remotion tsconfig — registry sources reference `React.FC` without importing React).
5. New `remotion.config.ts` (root): `Config.overrideWebpackConfig` with `resolve.alias: {'@': <root>/src}` — Studio only.
6. New `src/lib/bundle-config.ts` exporting `webpackAliasOverride` (type-only import from `@remotion/bundler`); `scripts/render-worker.ts` passes it as `webpackOverride` into the existing `bundle()` call. The stills route reuses it in Stage 3.

**Verify:** `npm run typecheck` (both tsconfigs), `npx remotion-ui doctor`, Studio opens and bundles with the kit intact.

## Stage 1 — Typed scene DSL; the old drawing system dies

### `src/lib/schema.ts` — rewrite
Keep: `countWords`, narration budget constants (`NARRATION_WPS`, `maxNarrationWords`, `NARRATION_MAX_CHARS`), `MIN/MAX_SCENE_SECONDS`, total-duration budget, `issueDetails`, `validateScenes`, `checkBudget`, `formatClock`, the `{scenes:[…]}` envelope, the structure-only (`ScenesShapeSchema`) vs refined (`SceneSchema`) split, and the `anchored()` mechanism. Replace:
- `SHAPE_SPECS/SHAPE_KINDS/SHAPE_NOTES` → `SCENE_KIND_SPECS/SCENE_KINDS/SCENE_NOTES` (same derivation pattern; prompt maps over them).
- `ShapeSchema/ProviderShapeSchema` → discriminated union on `kind` with the per-kind fields above. All optional scalars stored `.nullable().optional()`, required-nullable for the provider via `anchored()`; arrays (`items, stages, steps, nodes, terms, keyPoints, highlightedLines`) stay required plain arrays (strict subset allows arrays, forbids `.min/.max`).
- New `superRefine` rules: per-kind caps from the table (quoted by the prompt from the same constants), per-kind word caps, topology `parent` validation. Delete `checkBoardExtents`, `MIN/MAX_SHAPES_PER_SCENE`, `Percent`/`Height`/`PointSchema` and imports of `board.ts`/`figure.ts`/`list-metrics.ts`.

### `src/lib/layout.ts` — DELETE, and remove the step from all three consumers together
Blocks own placement; the one relational rule (topology `parent`) is validated, not resolved. The fixed-point invariant and `issues` channel disappear; the repair pass sees only `validateScenes` errors:
- `src/lib/llm.ts`: drop `layOutScenes` import/call in `generateScenes`; **rewrite `SCENES_SYSTEM_PROMPT`** around `SCENE_KINDS`/`SCENE_NOTES` (per-kind caps and word budgets from constants, "scene 1 is the title scene" stays, accent enum + theme replace colour guidance); rewrite `storyboardCapsReminder`; `SCRIPT_SYSTEM_PROMPT` loses whiteboard wording. Repair/budget/`scenesResponseFormat` machinery untouched.
- `src/lib/pipeline.ts` `readScenes` and `scripts/render-worker.ts` `loadScenes`: call `validateScenes` directly; drop the import.

### Deletions (nothing survives)
`src/lib/layout.ts`, `svg.ts`, `doodle.ts`, `timeline.ts`, `board.ts`, `figure.ts`, `list-metrics.ts`, `text-metrics.ts`, `scripts/generate-font-widths.ts`; remove `roughjs` from package.json + lockfile. (The width table measured the deleted handwriting face.)

### Temporary bridges (keep `npm run typecheck` green until Stages 2–3; each commented as such)
- `src/remotion/Scene.tsx` → placeholder: `AbsoluteFill` + `<Audio>` when `narrationPath` set (keeps the props type + audio contract).
- `src/remotion/fonts.ts` → no-op module (index.ts's side-effect import still compiles).
- `src/remotion/Root.tsx` → `DEFAULT_SCENE` becomes a valid typed `title` scene; `KitRoot` import stays (kit still compiles).
- `src/app/api/projects/[id]/preview-svg/route.ts` → stub returning 503 `PREVIEW_UNAVAILABLE` ("replaced in Stage 3").
- `src/lib/fixtures.ts` → rewrite `fakeScenes()` to three typed scenes (title + points + flow) and keep `FAKE_SCRIPT`. **This is source** (imported by `llm.ts`'s `FakeLlm`), not under `tests/`, so it must ship here or typecheck fails.

**Verify:** `npm run typecheck`; print the generated strict JSON Schema (`scenesResponseFormat()`) to confirm no `.optional()`/`minItems`/`default` leaked in.

## Stage 2 — Composition rewrite on the RemotionUI blocks

- `src/remotion/Scene.tsx` — **SceneByKind**: owns `<Audio src={staticFile(narrationPath)}>` (contract unchanged) + `AbsoluteFill`, dispatches on `scene.kind`. Props stay `{scene, sceneIndex, totalScenes, narrationPath}` so the worker needs no change. Blocks own their canvas; no header chrome is drawn (scene title lives in the page readout and on-block where the block has a title prop) — a deliberate visual-language change, documented in Stage 4.
- New `src/remotion/scene-adapters.tsx` — storyboard scene → block props: `ACCENT_HEX` map, `themeFor`, `speedFor(kind, fittedSeconds)` as above, `levelColorsFor(accent)` ramp for topology, `language` → code-syntax vocabulary if it differs.
- New `src/remotion/scenes/concept/index.tsx` — local concept scene from adopted primitives (`typewriter`/`stagger-children` for explanation + keyPoints, `marker-highlight` over terms, `badge-stamp` takeaway, `fade-in` entrances). **Nothing from the kit survives.**
- `src/remotion/fonts.ts` — rewrite: fail-loud loader for Inter 400/500/600/700 + JetBrains Mono 400/500/700 latin via `@remotion/google-fonts`, wrapped in the repo's `delayRender` + `waitUntilDone`/`cancelRender` pattern. The library dedupes per family/weight, so the blocks' own module-scope `loadFont` calls hit this cache — one fetch, one loud failure mode. `index.ts` unchanged.
- `src/remotion/Root.tsx` — remove `KitRoot`; keep single `Composition id="Scene"` with `calculateMetadata` from `scene.durationSeconds`, new typed `DEFAULT_SCENE`.
- **Delete** the entire `src/remotion/kit/` (44 files) and `public/fonts/` (woff2 + OFL). Root.tsx is the only importer and is rewritten.

**Verify:** `npm run typecheck`; Studio renders the default title scene and each kind via edited inputProps; hand-run `npm run render -- --project projects/<id> --scene n` on a regenerated (typed) project and eyeball the MP4 — proves read path, audio baking, fitted duration → speed, `-c copy` settings. Measure `NOMINAL[kind]` from sources; sanity-check blocks at `speed` extremes.

## Stage 3 — Server still renders replace the SVG preview

- New `src/lib/still.ts` (orchestration outside the route, same seam as `generate.ts`): `renderSceneStill({projectId, sceneIndex, width})` →
  1. `readScenes(projectId)` (reuses the 422/404 shapes the old route had);
  2. memoized `bundle()` per server process (serveUrl in module state; `webpackOverride: webpackAliasOverride`) + `ensureBrowser({logLevel:'error'})`;
  3. `selectComposition({serveUrl, id:'Scene', inputProps:{scene (storyboard durationSeconds), sceneIndex, totalScenes, narrationPath: null}})`;
  4. `renderStill({composition, frame: durationInFrames - 1, width})` — last frame = held, fully-revealed state. PNG bytes.
  5. Serialize: module-level promise queue (one still at a time — 12 parallel thumbnails would open 12 pages in one Chromium on a 7.6 GiB box) + small LRU `Map<projectId:scene:w, Buffer>`.
- New route `src/app/api/projects/[id]/preview/route.ts` (`runtime='nodejs'`, `dynamic='force-dynamic'`): validates `scene` (non-negative int) and optional `w` (clamped 160–1920, default 1920); returns `image/png`, `Cache-Control: public, max-age=31536000, immutable` when `v` is present (page always passes the sceneNonce → content-addressed), `no-store` otherwise; errors via `apiError` with existing codes. **Delete `preview-svg/route.ts` outright.**
- `src/app/page.tsx`: line ~1205 thumbnails → `/api/projects/${projectId}/preview?scene=${index}&v=${sceneNonce}&w=320` (1/6 scale; lazy loading + route queue handle the 12); line ~1224 board artwork → full-size URL; line ~1249 readout: replace `shapes.length` with a per-kind readout (local `switch` on `scene.kind` — types-only import from schema.ts preserved, zod stays out of the browser bundle).
- `src/app/globals.css`: remove the Architects Daughter `@font-face`.
- Decisions: stills do **not** take the render lock (the lock is about renders; the queue caps RAM); memory LRU only, no disk cache ("state is files" applies to projects, not transient thumbnails); first use costs bundle + Chrome Headless Shell download + font fetch (network — same class of caveat as today's font fetch).

**Verify:** `npm run typecheck`; `curl -sI 'http://localhost:3000/api/projects/<id>/preview?scene=0&v=1'` → 200 `image/png` with long max-age; `?w=320` returns a small PNG (`file`); no `v` → `no-store`; bad `scene` → 400; stills work while a full render runs (coexistence).

## Stage 4 — Docs (per-file)

- **README.md**: pipeline one-liner + Demo paragraph describe typed scenes on RemotionUI blocks (seven kinds, dark/light themes, accent colours); offline note becomes "stills and renders fetch Inter/JetBrains Mono on first use"; mention `remotion-ui.json`.
- **docs/visual-language.md**: biggest rewrite — typed-kind model, per-kind choreography + `speed`-from-fitted-duration rule, theme/accent vocabulary, font story, board/percent-coordinate language removed, preview guarantee becomes "the preview is a rendered frame of the composition itself" (pixel-identical by construction); kit section deleted.
- **docs/domain-model.md**: per-kind field/caps/word-budget table replaces the 14-shape vocabulary; anchors/layout/board-extent sections removed; topology `parent` rule replaces the relationships section; narration/duration rules unchanged.
- **docs/generation.md**: "drawing vocabulary" rewritten around `SCENE_KINDS`/`SCENE_NOTES`; three-step validation becomes two (structure → whole-scene rules); repair pass = validator + budget complaint.
- **docs/architecture.md**: read paths lose the layout step; "one place scenes become pictures" becomes "the composition is the one place; the preview is a rendered still of it"; repo-layout table drops public-fonts + width script, adds the component-install config; end-to-end diagram updated.
- **docs/web-application.md**: Board pane — thumbnails/artwork are rendered stills, on-demand with first-use cost, cached by storyboard version; API table row updated.
- **docs/rendering.md**: pre-flight "three steps" becomes two; otherwise unchanged.
- **docs/operations.md**: network-on-first-use names fonts alongside browser/voice model; known-gaps: remove "kit not yet driven by storyboards", add "old projects' scenes.json are invalid — regenerate in the app".
- **docs/README.md**: one-line tweaks.
- **CLAUDE.md**: update "Scene → SVG happens in exactly one place", "layout.ts computes the pixels", the text-metrics paragraph, the fonts gotcha, and the schema/provider-subset section to the typed-kind reality.

## Cross-cutting

- **Stage order** keeps `npm run typecheck` green at every boundary: 0 (additive) → 1 (schema + deletions + bridges) → 2 (bridges replaced, kit deleted) → 3 (preview + page) → 4 (docs). Only dev-mode degradation is between 1→3 (stub preview, placeholder composition).
- **Owed to the maintainer (do NOT touch)**: everything under `tests/` — inline 14-shape storyboards in fixtures/helpers, `routes.test.ts` preview-svg assertions, `render.test.ts` font/timeline source-pins, generate/api test expectations — plus `demo.mp4` regeneration and a real full render. The maintainer confirms the pnpm-lockfile refresh.
- **Risks**: block choreography vs fitted narration lengths (speed clamp is mitigation, not guarantee); first-preview latency (bundle + Chromium + fonts); stills' Chromium RAM beside a running render; old projects' `scenes.json` invalid; registry sources vs the strict remotion tsconfig; code-reveal's caret possibly visible in a last-frame thumbnail (fallback: settle on an earlier held frame).
