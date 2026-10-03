# The visual system

Every scene in the finished video is one of seven **scene kinds**, and each kind
is drawn by its own choreographed component — a scene block taken from
**RemotionUI** and copied into this repository as source. This document
describes how a scene becomes a picture, what the pictures look like, and the
guarantees that keep the preview and the video showing the same thing.

## From scene to picture

A scene names its kind and carries that kind's content: a title card carries a
headline and its smaller lines, a list carries its points, a pipeline carries
its stages, a hierarchy carries its nodes and their parents. The storyboard
carries no coordinates, no sizes and no colour values. The block for the kind
computes everything else — placement, spacing, text fitting, line routing —
and fills the whole frame itself. There is no shared header, title bar or
progress chrome drawn over it; where a scene's title appears, the block's own
design decides.

The component source for each kind lives in the repository rather than being
installed as a package, so the drawing is ours to read and to adjust, and
refreshing it is a deliberate command rather than a dependency bump.

Each block draws to the same stage: a 1920×1080 canvas at 24 frames per second,
with a safe area the block keeps its content inside. A block reads the canvas
each frame and lays itself out against it — which is also why a still can be
produced at any width without redrawing anything.

## The seven kinds

| Kind | What it shows | How it moves |
|---|---|---|
| Title | The opening card: headline, with a small eyebrow above and an optional subtitle and meta line below | Each headline line rises out of its own mask in turn; a single sweep of light crosses the headline once it is standing, and the card holds under a slow push |
| Points | A list of two to five points being worked through | Rows arrive one at a time; each row's rule draws across and its check strokes in behind it, so the scene lands on a list visibly ticked off |
| Flow | A left-to-right pipeline with a payload moving through it | Stages come up in order and the pipes draw between them; payloads then travel hop by hop, lighting each stage as they land and ticking its tally, until the last one drains and completes |
| Topology | A hierarchy of three to ten nodes — an org chart, a taxonomy | Levels assemble top-down: connectors draw down from the parents already standing, and the nodes land on the ends of those lines a beat later |
| Sequence | An ordered process of two to five steps along a rail | The rail draws ahead of a travelling head; each step lights as the head lands on it, works through a ring that closes, then checks off and dims to done as the head moves on |
| Code | A code editor writing out a listing | A write head moves through the listing character by character with the caret riding its tip; once the file is complete, the lines that matter are focused and the rest of the listing recedes |
| Concept | An explanation with its vocabulary: a paragraph, the terms it uses, the points to keep, a takeaway | The paragraph types on under a resting caret; each term is struck by a marker in turn; the key points rise as a staggered list; the takeaway is stamped on |

The choreography is the point: a scene *does* something — a pipeline runs, a
list gets ticked off — rather than fading in as a finished diagram. And because
all seven kinds share one motion vocabulary, seven kinds of scene still read as
one video.

## Fitting a scene to its narration

A block's choreography runs for a natural length of its own, decided from the
scene's own content — more points, a longer listing, a longer paragraph all
take longer to play out. The composition compares that natural length with the
scene's **fitted** length (the storyboard duration adjusted at render time to
the measured narration — see [rendering.md](rendering.md)) and sets a speed for
the block:

```
speed = natural length ÷ (0.85 × fitted seconds), clamped between 0.4× and 3×
```

The 0.85 leaves a little air between the last beat and the end of the clip, and
after the last beat the block simply holds its finished state. The clamp is the
safety rail: no narration can push a block past three times its tempo, or below
two fifths of it.

## Theme and accent

**Theme** is the page behind a scene: dark (the default) or light. It is a
change of register rather than a per-scene flavour — both are first-class looks
that the blocks are designed for.

**Accent** is colour used as a signal: one accent names the single thing that
matters most in a scene. Six are available — blue, cyan, violet, green, amber
and rose — and when none is named, the block's own default stands. The
hierarchy kind is the one place an accent spreads: it draws a ramp of related
tints, one per level, so a chart stays inside the shared palette instead of
inventing colours.

## Type

The blocks set everything in **Inter**, with **JetBrains Mono** for code — a
precise, modern pairing rather than a handwriting face. The faces are loaded at
render time through Remotion's Google Fonts integration: the first render in a
process fetches them, the frame is held until they are ready, and a fetch that
fails fails the render loudly rather than quietly drawing every label in a
fallback face. One loader serves the whole composition and the stills server
alike, so each face is fetched once per process rather than once per block.

This is why **rendering and stills are not offline on first use**: the fonts,
the headless browser and the voice model are the three things fetched from the
network the first time a process needs them. Afterwards they are cached.

## Preview and render are the same drawing

The Board's preview is not a drawing at all: it is a **frame of the composition
itself**, rendered server-side through the same player the worker uses. The
still is taken from the scene's last frame — every block holds its finished
state to the end of its clip, so the last frame is the fully revealed scene —
and it is produced by the same blocks, the same fonts, the same canvas and the
same theme and accent the render will use.

In business terms: **the picture the user approves is a frame of the video, not
an approximation of it.** A change to how a list ticks off, how a headline
sweeps or how an accent resolves lands in the preview and the video at once and
cannot drift. The only difference is that a still is silent.

Stills cost something on first use — the composition is bundled, the browser is
downloaded and the fonts are fetched once per server process — and are then
cached in memory, one at a time and keyed to the storyboard version that
produced them, so a rebuilt storyboard never shows a stale frame. They never
take the render lock, so the Board stays available while a render is in flight.
