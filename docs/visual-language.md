# The visual system

Every scene in the finished video is one SVG drawing, built from the
storyboard's shapes, and animated stroke by stroke. This document describes how
a scene becomes a picture, what the pictures look like, and the guarantees that
keep the preview and the video showing the same thing.

## From scene to picture

A scene carries four things: a title, a duration, a narration line, and an
ordered list of shapes. The order is the drawing order. Each shape carries a
kind, an optional semantic colour, and its geometry; some kinds also carry
anchored relationships to other shapes, and the composite kinds carry words of
their own.

The drawing itself is a function of the scene plus a **draw progress per
shape** — a number from 0 (not yet drawn) to 1 (fully drawn). That single
interface is what lets one drawing serve both the static preview (everything at
1) and the animated video (each shape at its current frame's progress).

Positions and sizes are percentages of a fixed 16:9 board. Horizontal lengths
are percentages of board width; heights, radii, font sizes and the stick
figure's height are percentages of board *height*, so circles stay round and
figures stay in proportion. Because everything is relative, a scene renders
identically at thumbnail size, in the preview, and on the 1920×1080 frame.

The board is drawn as shared paper first: a near-white ground, a light dot grid
at a fixed step, and shared definitions such as the soft drop shadow under
filled shapes. On top of that, in order: the scene's shapes, the words the
composites carry, and finally the header — the scene title, a thin rule and a
progress bar that fills as the scene draws. The header is chrome rather than
content, which is why it is drawn last and why the storyboard vocabulary
reserves the top of the board for it.

## How a shape draws itself

Each shape is painted from up to three kinds of path:

- **Outlines** are drawn on: the path is normalised so a single dash offset
  sweeps the stroke along it as progress rises. This is what produces the
  handwriting effect of a diagram being sketched.
- **Fills** fade in rather than draw, because a filled area has no meaningful
  "start" and "end". The fade begins once the outline is about a third drawn,
  so a shape reads as outlined first, then coloured in.
- **Decals** — an arrowhead, a bullet dot — appear on their own schedule. An
  arrow's head waits until the shaft is about three-quarters drawn, so it never
  floats ahead of its line.

Two deliberate exceptions: a grouping container is treated as chrome — a dashed
outline over a faint tint that fades in as one piece, because it cannot both
wear its own dash pattern and the draw-on sweep — and a cross-out is simply
drawn corner to corner over the bounds of the shape it marks.

Composites place their own text by pure arithmetic and ride the parent shape's
progress, so a card's title can never appear before the card. Text is never
materialised as a separate label shape: inserting one would shift every index
after it, and the indices are exactly what relationships are addressed by.

**The picture is required to be deterministic.** The renderer re-draws the same
scene on every frame, so any path that moved between frames would shimmer. Each
shape is generated from a random stream seeded by its own geometry — colour
deliberately excluded, so recolouring never reshuffles a line — and computed
path data is cached. A cross-out seeds from its target's geometry too. The
practical result: the picture is rock-steady frame to frame, and editing one
shape never makes the rest of the board jump.

## Timing: how a scene spends its duration

A scene's duration (as fitted to its narration — see
[rendering.md](rendering.md)) is spread across its shapes:

- a short lead-in before the first stroke,
- a lead-out after the last, and
- the remainder divided evenly among the shapes in drawing order.

Each shape's window is computed from its index rather than accumulated from a
rounded step, so the last shape always gets a slot that ends inside the scene
rather than starting after the final frame. Within its window, progress is
eased out — the stroke decelerates into place — and a shape whose window has
not opened yet is drawn fully "dash-off": invisible, but present in every
frame. That last property is what makes every frame of the video scrub-safe.

## Layout: the model states relationships, the system computes geometry

The storyboard lets a shape name another shape by its position in the scene:
a label names the box, circle or cloud it sits in; an underline names the label
it runs under; an arrow or connector names the two shapes it joins; a cross-out
names its target; a figure's caption is written under its feet without being a
shape at all.

The reason is empirical: language models state relationships well and compute
coordinates badly — before this existed, roughly half of labels overflowed
their container and a third of arrows ended in empty space. So the model
states the relationship once and a deterministic layout pass produces the
pixels, in dependency order:

1. **Labels first** (underlines size to them, cross-outs can sit over them). A
   label naming a container is centred in it and shrunk until it fits — never
   wider than most of the container, never taller, and never below a minimum
   legible size. Past that floor, a slightly overhanging label beats an
   unreadable one.
2. **Underlines** run from the label's edge, exactly as wide as the words,
   clamped so they cannot reach past the board edge.
3. **Arrows and connectors**: an anchored end is moved to the boundary of the
   shape it names — met at the ellipse for round shapes, at the rectangle for
   boxes and cards. When *both* ends are anchored, the line is solved
   centre-to-centre, which is the one formulation that does not depend on where
   the ends currently sit; that is what keeps the layout a **fixed point**. An
   arrow anchored at only one end keeps its free end where the author put it.
4. **Cross-outs** are never moved; an unresolvable one is reported and simply
   not drawn.

**The layout is a fixed point**: laying out an already-laid-out scene returns
it unchanged. That is load-bearing, because the pass runs on *every* read path
— generation, preview and render — and a pass that drifted would make a scene
look one way in the preview and another in the video.

**An unresolvable relationship is dropped, never fatal.** A missing index, a
target pointing at itself, or a target of the wrong kind is cleared, reported
in the same `path: message` form as validation complaints so it can be carried
back to the model, and the shape is drawn where the model put it. Losing a
storyboard over one mis-numbered arrow would be far worse than drawing that one
arrow slightly wrong. Two labels claiming the same container are both still
centred — because "a label is centred in what it names" is the contract — with
the pile-up reported.

**Text fitting is arithmetic, not measurement.** The layout runs in a plain
process with no text engine and no loaded font, so widths come from a
checked-in table of per-glyph advances measured once from the bundled face, in
relative units so one table serves a small caption and a large title. Kerning
is not applied, which makes the table report text slightly *wider* than the
browser draws it — the safe direction for "shrink until it fits".

## The look

The current look is a **crisp, flat whiteboard**: rounded shapes with pastel
fills on a dot grid. The geometry library underneath is the same hand-drawn
path generator the project started with, but its hand-drawn character is
switched off — no roughness, no bowing, no doubled sketch strokes, solid fills
rather than hatching. What remains is a hairline, single-pass stroke: the
Excalidraw look rather than a marker-pen sketch. (The demo video in the
repository predates this overhaul and shows the older, rougher style.)

- **Colour** is eight semantic names — a dark default ink, blue, red, green,
  amber, violet, teal and grey — each with a matching pale fill of the same
  hue, so a filled shape reads as that colour rather than as a second stroke.
  Meaning is fixed (red is failure, green success, and so on) and the palette
  is small enough that the meaning stays legible.
- **Paper** is near-white with a light blue-grey dot grid and a soft shadow
  under filled shapes.
- **Typography** is a single handwriting face for every piece of text —
  labels, captions, card titles, badge symbols, list items, header. There is
  one implementation of lettering, so changing how text looks happens once.
  The face is bundled with the project so previewing works offline, and
  fetched from its font service during rendering.
- **Line treatment**: a flat hairline, rounded caps and joins, rounded
  rectangle corners at a fixed radius, curves for clouds and stick-figure
  limbs. No hatching, no wobble.

## Preview and render are the same drawing

There is exactly one piece of code that turns a scene into a picture. The
preview asks it for the fully drawn state; the video renderer asks it for the
state at each frame. They share the paper, the grid, the palette, the header
chrome and the board constants — the only intentional difference is that the
preview embeds the font inside the drawing so it carries its own lettering
offline, while the renderer loads the same face into the page and leaves the
embedding out.

In business terms: **the storyboard image the user approves is not an
approximation of the video — it is the video's own drawing.** A change to how a
card looks, how a label shrinks, or how a colour resolves lands in both places
at once and cannot drift. The alternative — two drawing implementations — is
exactly the class of bug where the video the user waited for does not match the
proof they approved.

## The component kit

The repository also contains a second, newer design system: a **component kit**
for authored technical-explainer scenes. It is flat and modern in a different
way — two themes (dark and light), six accent colours with semantic tones
(info, success, warn, danger) that survive re-skinning, precise type rather than
handwriting (Inter for prose, JetBrains Mono for anything a machine would
spell), cards with tinted surfaces and thin borders, a blueprint grid and a
radial accent wash across the canvas.

It offers seven authored scene types, each with a clear purpose:

| Scene type | What it shows |
|---|---|
| Title | An opening card: display title, subtitle, tags, with a faint structure bleeding off the edge |
| Points | Three to six things in sequence — numbered or icon cards |
| Flow | A to B to C: boxes joined by labelled arrows, revealed in reading order, optionally with a travelling packet |
| Topology | Several things on a grid and the wiring between them, placed by cell, not by pixel |
| Sequence | Who talks to whom in order: actors on lifelines, one message per row |
| Code | A listing in a window, optionally revealed line by line with a callout panel |
| Concept | One idea in words beside a small figure of it, with terms swept by a marker and a takeaway block |

Its animations state *how many beats* a scene has and spread them across
whatever length the render gives them, with a closed vocabulary of six entrance
motions — so seven scene types feel like one video. Diagram scenes reveal by
dependency depth; flow diagrams keep a loop signal moving after the last node
lands, because a picture of a queue with nothing moving in it is a diagram,
rather than an explanation.

**The kit is not yet driven by generated storyboards.** The production render
mounts only the storyboard drawing described above; the kit is a library with
a Studio test bench of demos, explicitly built to be adopted later as new
storyboard vocabulary rather than by rewriting either side in terms of the
other. Documentation of the current product therefore describes the whiteboard
system as the one a generated video uses; the kit is where the visual language
is heading.
