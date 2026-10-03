# Domain model: script, storyboard, scene, shape

The product's data model is small and deliberately explicit. There are two
creative documents — a **script** and a **storyboard** — and one vocabulary of
drawing instructions. Every stage of the system reads and writes the same
three things, and every rule about them lives in one place, so the model's
instructions, the validator, the preview and the renderer cannot disagree.

## The input

Everything starts with pasted text: a topic, a question, an explanation, a
draft lesson. It is accepted up to 20,000 characters. Shorter is better — the
input is the *subject*, not the script; the model writes the script.

## The script

The script is the narrative backbone of the video: a short title and a body of
English prose, long enough to carry a roughly five-minute narration. It is
produced by the model, stored beside the project's input, and is the only
creative document the user can rewrite by hand without regenerating the video
(the storyboard can then be rebuilt from it).

A script is capped at 160 characters of title, matching what the model is
allowed to produce. The body has no hard rule beyond fitting the model's reply;
the five-minute target is carried by the storyboard, not by the script.

## The storyboard

The storyboard is the plan for the video: an ordered list of scenes, scene 1
being the title scene. It is what the user reviews, what the renderer draws,
and what the preview shows. Three properties are guaranteed about any storyboard
in the system, because every path that reads one re-establishes them:

1. **It is structurally well-formed** — every scene and shape has the fields
   its kind requires, in range and of the right type.
2. **It is laid out** — every shape that named another shape has had that
   relationship turned into geometry.
3. **It is valid** — it satisfies the whole-scene rules the drawing model
   imposes.

The order matters: relationships are resolved first, because resolving them can
fix problems that the later checks would otherwise refuse (a label that shrinks
to fit its box, for instance). The rules below describe a storyboard after all
three steps.

### Scenes

A scene is a title, a duration, a narration line and a list of shapes.

| Property | Rule |
|---|---|
| Duration | Between 7 and 20 seconds |
| Narration | One spoken line in English, never empty |
| Narration length | At most the scene's duration × 2 words per second |
| Shapes | Between 3 and 12 |
| Written words | At most 20 words across the whole scene |

The storyboard as a whole is planned to land near five minutes; the product
accepts a total between 4:30 and 5:30 and tells the user when a storyboard
falls outside that window, suggesting it be regenerated. The window is a
review-time check, not a reason to reject a storyboard outright — the user sees
it and decides.

The narration budget is derived from the scene's own duration rather than being
one flat number: a 7-second scene is held to 14 words, a 20-second scene to 40.
The rate behind that arithmetic (2 words per second) is a planning rate
calibrated against the bundled voice's measured pace; it is deliberately
conservative, because the renderer refuses narration audio that overruns its
scene rather than speeding the voice up or truncating it. A scene written to
its full budget still has real slack at render time.

### The word budget

"Written words" counts **everything drawn as text on the board**, not just
shapes of the label kind: labels, the caption under a stick figure, a card's
title, a badge's symbol, a list's heading and its items. They are all drawn in
the same handwriting and take the same space, so a separate allowance for
carried text would be a way around the cap. One scene, one budget of 20 words.

### Shapes

A scene's shapes are drawn in order, and the order is meaningful: a container
drawn first sits behind everything after it. Each shape is one of fourteen
kinds.

**Position** is expressed in percentages of the 16:9 board: horizontal
positions run 0–100 left to right, vertical positions 0–100 top to bottom.
Sizes that would distort a round shape if measured on one axis — radii, figure
heights — are percentages of board *height* on both axes, so circles stay
circular at any canvas size. This percentage language is what makes a scene
render identically in a small preview and on a 1920×1080 frame.

**Colour** is one of eight named slots, or nothing:

| Colour | Meaning |
|---|---|
| *(none)* | The default dark ink — the ordinary drawing colour |
| `accent` | Blue; the positive highlight |
| `emphasis` | Red; failures, problems, removals |
| `success` | Green; good outcomes |
| `warn` | Amber; cautions |
| `violet`, `teal` | Extra categories, when two more colours are needed |
| `gray` | De-emphasised parts |

The palette is semantic on purpose: a colour choice in the storyboard is a
statement about meaning, and the visual system keeps the palette small enough
that the meaning stays legible.

#### The primitive kinds

| Kind | What it draws | What it is for |
|---|---|---|
| `box` | A crisp rounded rectangle | A thing, a component, a step |
| `circle` | A clean circle | A state, an actor, a focal point |
| `cloud` | A cloud outline | Thoughts, "the cloud", something vague |
| `label` | A few handwritten words on a baseline | Naming anything |
| `underline` | A line under text | Emphasis on a written phrase |
| `arrow` | A line with a solid head | Direction, movement, causality |
| `connector` | A plain line | A relationship without direction |
| `divider` | A short horizontal rule | Separating parts of the board |
| `stickFigure` | A stick person | A user, a person, an actor |
| `crossOut` | A large X over another shape | Something broken, cancelled or removed |

#### The composite kinds

Four further kinds carry words and structure of their own, so a scene gets more
done inside its 12-shape cap. Their text is placed by the system — it is never
re-expressed as separate label shapes, because inserting a shape would shift the
indices that relationships are addressed by, and because the text must still
count against the one word budget.

| Kind | What it draws |
|---|---|
| `card` | A rounded panel with an optional short title inside its top — one concept, titled |
| `container` | A large dashed tinted panel drawn behind other shapes, grouping them |
| `badge` | A small filled circle holding a 1–3 character symbol, like a step number or a tick |
| `bulletList` | A titled list of up to six short phrases, running down the board |

## Relationships: the model states, the system computes

A pile of coordinates is not a diagram. The storyboard therefore lets a shape
name **another shape in the same scene, by its position in the scene's list**:

- a label can say which box, circle or cloud it sits in;
- an underline can say which label it runs under;
- an arrow or connector can say which two shapes it joins;
- a cross-out can say which shape it crosses;
- a stick figure's caption is drawn under its feet without being a shape at all.

The division of labour is the point: the model is good at *relationships*
("this arrow runs from the users to the server") and bad at the *arithmetic*
they imply — how wide a word will be in this handwriting, where a circle's edge
falls. So the model states the relationship once, and the system computes the
pixels: text is centred in its box and shrunk until it fits, line ends snap onto
the edges they name, an underline is sized to the words above it, a caption is
written below the figure's feet.

Two rules keep this robust:

- **A relationship that cannot be resolved is dropped, not fatal.** If a shape
  names an index that does not exist or a shape of the wrong kind, the
  relationship is cleared and the shape is drawn where the model put it. The
  problem is reported and fed back to the model on the next attempt — but a
  storyboard is never thrown away over one. (A cross-out is the exception: it
  has nowhere to stand without its target, so an unresolvable one is reported
  and simply not drawn.)
- **Resolving is a fixed point.** Relationships are resolved on every read, and
  resolving an already-resolved storyboard changes nothing — no coordinate
  drifts on the second pass. This is what makes it safe to re-resolve a stored
  storyboard every time it is read, whether the model or a human hand-edited it.

## What is checked where

The system distinguishes two layers of correctness, and the distinction is
load-bearing:

- **Structure** — types, ranges, required fields. This is the contract the
  model's reply is parsed against. A reply that breaks structure cannot be
  repaired, because the complaint cannot even be attached to a well-formed
  scene.
- **Whole-scene rules** — the word budget, the narration budget, the shape
  count, list length, and the board-extent rule below. This layer is applied
  *after* structure, and its complaints are the ones the model gets a chance to
  repair. It is also applied on every subsequent read, so a hand-edited
  storyboard is judged exactly like a generated one.

The **board-extent rule** deserves its own note: individual positions are in
range by construction, but their *sum* is not. A box placed at 80% with a width
of 30% is a valid box whose right third hangs off the board, and anything
anchored inside it would be cut off too. So every shape is checked against the
edges it actually reaches — accounting for the fact that horizontal and
vertical lengths are measured on different axes — and a shape that would be
clipped is refused with a message saying how far it reaches and where the edge
is.

## What comes out

Once the storyboard is valid and within budget, it is what the renderer draws:
the total duration determines roughly how long the video runs, each scene's
narration is spoken, and each scene is drawn in order. The video and its
artifacts are described in [rendering.md](rendering.md); the vocabulary above is
turned into pictures by the system described in
[visual-language.md](visual-language.md).
