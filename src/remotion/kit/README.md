# The component kit

A design system for technical explainer videos: one visual language, expressed as
data-driven Remotion components, for the pictures that software engineering
explanations keep needing -- a request's path, a topology, an exchange between
services, a listing with a caveat beside it.

It is a **library, not a video**. No component in this folder knows what the
video is about: every string, node, edge, message and line of code arrives as a
prop. The demonstrations in `KitRoot.tsx` are data, and swapping them out is the
whole job of using the kit.

## Where it sits

The kit is additive. Nothing in `src/lib/` (the scene DSL, the layout pass, the
render worker) imports it, and it imports nothing from the render pipeline
except the canvas constants in `tokens.ts`. The doodle pipeline and the kit are
two ways of drawing a scene, and today the project renders one of them.

`src/remotion/Root.tsx` mounts `<KitRoot />` next to the production `Scene`
composition so the kit is visible in the Studio. A production render is
unaffected: it names the `Scene` composition and never mounts a kit demo.

## The layers

Each layer may only import from the ones above it. The arrow is the whole
architecture:

```
  tokens.ts        colours, type scale, spacing, motion, canvas geometry
      |
  theme.tsx        which theme is in force; context, so a leaf can read it
      |
  lib/             geometry, graph depth, tokenizing -- plain functions, no React
  animation/       when things happen (timing.ts) and how they arrive (presets.ts)
      |
  primitives/      Text, Surface, Icon, Pill, DiagramNode, Edge, CodeBlock, Callout
      |
  layout/          Frame (the scene shell) and Stack (row/column/grid/centre)
      |
  scenes/          six scene types: what a video is made of
      |
  KitRoot.tsx      the demos that register those scene types as compositions
```

**`tokens.ts` is data-only.** Strings and numbers, no components, no font
loading, no side effects -- so that importing it is free and a layout can be
reasoned about without a render. `theme.tsx` is the only place a colour is
resolved; a component asks for `theme.accent[accent]`, never for `#4d8dff`.

**`lib/` has no React in it.** `geometry.ts` answers two questions -- where does
a line leave a box, and where is a point part-way along a path -- and answering
them as plain functions is what lets `FlowScene` and `TopologyScene` place
edges without either of them re-deriving the maths.

**`animation/` is a vocabulary, not a per-scene choice.** Six reveal presets and
one pacing function exist so that the six scene types feel like one video. A
scene says *how many* beats it has; `paceReveals` decides when they land, using
the scene's actual `durationInFrames` -- which is the narration's measured
length, not a number the scene knows. The default is a quick cascade, so the
picture is complete while the narration talks over it; a scene with a long beat
to fill says so with its `pace` prop (`ScenePace`) rather than by re-timing
itself.

## What a scene looks like

Every scene in `scenes/` is the same two pieces:

```tsx
export const SomethingScene: React.FC<Props> = ({ title, ..., theme }) => (
  <Frame name="Something scene" title={title} accent={accent} theme={theme}>
    <SomethingBody {...} />
  </Frame>
);
```

`Frame` draws the canvas, the grid, the accent wash, the animated header and the
footer, and hands its children a content box. The body is a separate component
because it needs `useFrameBox()` -- the box is only known *inside* the frame,
and it is a pair of pixel numbers rather than a DOM measurement. That is
deliberate: a measured layout needs a ref, a `delayRender` and a frame rendered
twice, and a diagram whose edges have to stop exactly on a node's border needs
the numbers on the first frame.

A body then follows one of two shapes:

- **A diagram** computes rects from the box, renders `DiagramNode`s absolutely
  positioned at those rects, and draws `Edge`s in an `EdgeLayer` above them.
- **A panel** composes `Surface`, `Text`, `CodeBlock` and layout components in
  normal flow, and lets flex do the work.

Both pace themselves with `paceReveals(count, { fps, durationInFrames })` and
apply `revealStyle(preset, frame, beats[i])` -- inline for a positioned
element, `<Reveal>` for one in flow.

## The six scene types

| Scene | The picture | The data |
| --- | --- | --- |
| `TitleScene` | An opening card | title, subtitle, eyebrow, tags, footnote |
| `PointsScene` | Three to six things, numbered or iconed, one or two columns | `{title, body, icon}[]` |
| `FlowScene` | A to B to C, left to right or top to bottom, with an optional travelling packet | `steps[]`, `edges[]` labels |
| `TopologyScene` | Several things on a grid and the wiring between them | `nodes[]` with `col`/`row`/`span`, `edges[]` |
| `SequenceScene` | Who talks to whom, in order, down a timeline | `actors[]`, `messages[]` with a `kind` |
| `CodeScene` | A listing in a window, optionally line by line, with a note beside it | `code`, `language`, `highlight[]`, `aside` |

Between them they cover REST paths, queues, event flows, distributed
topologies, design patterns and algorithm steps. What they have in common is
that the *author* states structure and the *component* computes pixels: a
`TopologyScene` node says `col: 2, row: 0`, never `x: 1140`.

## Adding a scene type

1. Write `scenes/YourScene.tsx`: a `Frame` plus a body, props typed and
   documented.
2. Pace with `paceReveals` and animate with `revealStyle`/`ramp`. If you need a
   new motion, add it to `presets.ts` rather than inlining it -- a seventh
   entrance style is a language change, and it should be visible in one place.
3. Add an `id="KitYourScene"` to `KitRoot.tsx` with a realistic storyboard.
4. Export the component and its prop type from `index.ts`.

If it needs a primitive that does not exist, add it to `primitives/` -- and if
two scenes would both want it, that is the signal it belongs there rather than
in either scene.

## Deliberate choices, and their limits

- **Relative imports carry the extension** (`'./tokens.ts'`, `'../layout/Frame.tsx'`).
  This is load-bearing repository-wide: Node runs the worker and the tests via
  type stripping, and Node requires the extension on a relative import. A kit
  file without one breaks the build, not just the lint.
- **Chrome-only CSS, on purpose.** `color-mix(in srgb, ...)` for tints and
  `paintOrder="stroke"` for label halos are not universally supported, and they
  do not need to be: the renderer is Chrome and the Studio is Chrome. Falling
  back to a colour parser would mean a second table of hand-tuned tints per
  theme.
- **Fonts load from a hook, never at module scope.** `@remotion/google-fonts`'s
  `loadFont` calls `delayRender()` and starts fetching *when it is called*, so a
  module-scope call would make every doodle render download Inter and JetBrains
  Mono. `useKitFonts()` is called by `FrameBody` and nowhere else.
- **No `Interactive.withSchema`.** The installed Remotion is 4.0.524; the
  `wrapInSequence` option that form needs arrives in 4.0.532. Scenes are plain
  typed components, and only `Frame`'s root uses `Interactive.Div` (which does
  exist here) to get a named, timeline-visible scene. Revisit on upgrade.
- **Compositions must be registered at `CANVAS` size.** The layout maths are
  absolute pixels -- `frameContentBox` subtracts the real padding, header and
  footer heights -- so a kit scene rendered at another width or height is laid
  out for 1920x1080 and scaled or cropped. `KitRoot.tsx` shows the registration.
- **A `Frame` header is one line by contract.** The content box is a number the
  body's diagram is positioned against; a title that wrapped to two lines would
  move every node in the picture. Long copy belongs in the body.
- **`DiagramNode` has a height contract.** At `NODE_STACK_MIN_HEIGHT` (206px)
  the stacked form -- icon above label above sublabel -- fits exactly; below it
  the node switches to an inline row. It is the reason a node's text never
  spills outside the rectangle its edges are anchored to.
- **This kit is not wired to the scene DSL.** `src/lib/schema.ts` describes the
  doodle shapes the model is asked for. Driving the kit from generated
  storyboards is future work and would be a new scene kind in that schema, not a
  change to these components.

## Verifying it

`npm run typecheck` covers the kit (the `src/remotion` tsconfig). To look at it,
run the Studio and open the **Kit** folder -- the six compositions are the
visual test bench, and each one is a scene a real video could use.
