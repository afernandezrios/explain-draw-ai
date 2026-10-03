# Domain model: script, storyboard, scene kind

The product's data model is small and deliberately explicit. There are two
creative documents — a **script** and a **storyboard** — and one vocabulary of
drawing instructions: eight **scene kinds**. Every stage of the system reads and
writes the same things, and every rule about them lives in one place, so the
model's instructions, the validator, the preview and the renderer cannot
disagree.

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
and what the preview shows. Two properties are guaranteed about any storyboard
in the system, because every path that reads one re-establishes them:

1. **It is structurally well-formed** — every scene has the fields its kind
   requires, in range and of the right type.
2. **It is valid** — it satisfies the whole-scene rules its kind imposes.

Structure is checked first, and the order is load-bearing: a complaint about
counts or budgets can only be attached to a scene that already has the right
shape. The rules below describe a storyboard after both steps.

### Scenes

A scene is a kind, a title, a duration, a narration line, and the fields that
kind carries. Two further fields are optional: a theme and an accent colour.

| Property | Rule |
|---|---|
| Duration | Between 7 and 20 seconds |
| Narration | One spoken line in English, never empty |
| Narration length | At most the scene's duration × 2 words per second |
| Title | A few words naming the scene, at most 120 characters |
| Theme | Dark (the default) or light |
| Accent | One of six named colours, or the block's own default |
| Written words | At most the kind's own budget (see below) |

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

## The scene kinds

Each scene names one of eight kinds, and the kind decides how the scene is
drawn and what fields it carries. A kind is not a template the model fills with
coordinates: the storyboard states **content and one relationship**, and the
component that draws the kind computes the rest — where each row sits, how wide
a label may run, how the lines route, when each beat lands.

| Kind | What it is for | What it carries | Caps and rules | Screen words |
|---|---|---|---|---|
| `title` | The opening card, and any full-screen statement | An optional eyebrow above the headline, and optional subtitle and meta lines below it | — | 30 |
| `points` | A list being ticked off | An optional eyebrow; items, each a label with an optional detail line | 2–5 items | 65 |
| `flow` | A left-to-right pipeline | Stages, each a label with an optional detail; the unit the payload is counted in; how many payloads to push through | 2–5 stages; 1–12 packets | 45 |
| `topology` | A hierarchy — an org chart, a taxonomy, a family tree | Nodes, each a name, an optional role, and the index of its parent | 3–10 nodes; exactly one root; every parent listed before its children | 70 |
| `diagram` | Free-form boxes and arrows — a round-trip, a handshake, who asks whom | Boxes, each a name, an optional note and an optional shape — the default rounded rectangle, or the cylinder a store of rows is drawn as; arrows, each naming the boxes it leaves and lands on by index, with an optional label | 2–6 boxes; 1–8 arrows; every arrow names boxes that exist — loops, back-arrows and repeated arrows are allowed | 70 |
| `sequence` | An ordered process walked step by step | An optional eyebrow; steps, each a title with an optional description | 2–5 steps | 65 |
| `code` | An editor writing out a listing | The code; an optional filename, language badge and starting line number; the lines to focus once it is written | At most 24 lines of at most 100 characters; the language from a fixed list | 40, counted on the editor's chrome only — the listing itself is bounded by lines and characters |
| `concept` | One idea explained, with the vocabulary around it | An optional eyebrow; the explanation; the terms worth defining; the key points; an optional takeaway | 1–4 terms; up to 4 key points; an explanation of at most 800 characters | 55 |

### The word budget

"Written words" counts **everything the scene writes on screen**: its title, a
list item's label and detail, a stage's label and detail, a node's name and
role, a diagram's box names, notes and arrow labels, an explanation with its
terms and points, a code editor's filename and language badge. The budget is
per kind — a title card holds a headline and little else, while a chart of ten
labelled nodes legitimately writes more — and every written run is counted, so
no field is a way around the cap. The one exception is the code listing itself:
it is the scene's subject rather than its writing, and it is bounded by lines
and characters instead.

### Colour

**Theme** is the page behind a scene: dark by default, light as a change of
register. **Accent** is a named colour marking the one thing that matters most
in a scene: blue, cyan, violet, green, amber or rose, or nothing for the
block's own default. The accent is semantic — a colour choice in the storyboard
is a statement about what matters, and the palette is small enough that the
meaning stays legible. There is no per-element colour: one accent per scene,
applied by the block according to its own design.

### The field caps

Each kind's counts are part of the rule, not advice: a list of two to five
items, a pipeline of two to five stages and one to twelve packets, a hierarchy
of three to ten nodes, a diagram of two to six boxes and one to eight arrows, a
rail of two to five steps, a listing of at most twenty-four lines of at most a
hundred characters, a concept with one to four terms and up to four key points.
The caps exist because a drawing has a size: past them, the scene stops being
readable. The model's prompt quotes every number from the same constants the
validator enforces.

## Relationships: two, and both are judged

Two fields in the storyboard state a relationship, and both name other items by
index.

In a hierarchy, a node names its parent by the index — counting from zero — of
a node **listed before it in the same scene**, and exactly one node has no
parent — the root.

In a diagram, an arrow names the box it leaves and the box it lands on by their
indexes in the scene's own box list. There is no ordering rule and no root: an
arrow may point at any box, including one listed later, the box it left (a
loop), or a box an earlier arrow already touched. A round-trip — the phone
asks, the server answers — is exactly that shape, and it is the reason the
diagram is a kind of its own.

Both rules are strict, and the difference from a hint matters: a parent listed
after its child, a chart with no root or two, or an arrow naming a box the
scene does not have is **refused** — reported to the model for repair, or to
the user for a hand-edited file — never quietly fixed and never dropped.
Requiring the parent to come first also makes a cycle impossible in a
hierarchy; in a diagram cycles are legal, so the drawing component breaks them
for layout instead.

Everything else a scene needs is not a relationship the model states, because
it is not the model's job: where a node sits in its level, how wide a label may
run before it shrinks, where a connector leaves a box, which way an arrow bows
when its twin comes back. The drawing component decides all of it from the
kind's fields.

## What is checked where

The system distinguishes two layers of correctness, and the distinction is
load-bearing:

- **Structure** — types, ranges, required fields, string lengths, and the
  number bounds the drawing model can express directly (a parent index inside
  its list, a listing inside its character budget). This is the contract the
  model's reply is parsed against. A reply that breaks structure cannot be
  repaired, because the complaint cannot even be attached to a well-formed
  scene.
- **Whole-scene rules** — the per-kind counts, the topology rules above, each
  kind's word budget and the narration budget. This layer is applied *after*
  structure, and its complaints are the ones the model gets a chance to repair.
  It is also applied on every subsequent read, so a hand-edited storyboard is
  judged exactly like a generated one.

Nothing geometric is checked, because nothing geometric is stored: a scene's
positions and sizes are computed by its block at draw time, from fields that
are already in range. The rules are counts and words, and every one of them is
stated in the model's prompt from the same number the validator uses.

## What comes out

Once the storyboard is valid and within budget, it is what the renderer draws:
the total duration determines roughly how long the video runs, each scene's
narration is spoken, and each scene is drawn by its kind's component in order.
The video and its artifacts are described in [rendering.md](rendering.md); the
kinds above are turned into pictures by the system described in
[visual-language.md](visual-language.md).
