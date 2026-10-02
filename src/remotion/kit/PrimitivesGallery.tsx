/**
 * The markup primitives on one screen: seven small demos, one per component.
 *
 * This is the kit's visual test bench for the markup layer, the way
 * `KitRoot.tsx` is for the six scene types. Each cell is deliberately the
 * smallest thing that shows what the component is for -- an arrow with a bend,
 * a highlight sweeping over a phrase, two nodes and the connection between
 * them -- and the composition is registered so opening the Studio is the same
 * as looking at the whole vocabulary at once.
 *
 * The demos are data + JSX only: they exercise the primitives exactly the way a
 * hand-written scene would, with `paceReveals` handing out the beats, so if a
 * demo needs a prop the primitives do not have, that is a finding.
 */

import React from 'react';
import { useVideoConfig } from 'remotion';
import { SPACE } from './tokens.ts';
import { useTheme } from './theme.tsx';
import { Frame, FrameCaption } from './layout/Frame.tsx';
import { Column, Grid, Row } from './layout/Stack.tsx';
import { paceReveals, staggerTimings, type Timing } from './animation/timing.ts';
import { Box } from './primitives/Box.tsx';
import { Arrow } from './primitives/Arrow.tsx';
import { Label } from './primitives/Label.tsx';
import { Highlight } from './primitives/Highlight.tsx';
import { Node } from './primitives/Node.tsx';
import { Connection } from './primitives/Connection.tsx';
import { CodeBlock } from './primitives/CodeBlock.tsx';

/** A beat split into `count` entrances inside one cell. */
function inside(beat: Timing, count: number): Timing[] {
  return staggerTimings(count, { start: beat.delay, step: 8, duration: beat.duration });
}

/**
 * One demo, framed and named. The cell is a `Box`, so the gallery is also the
 * first consumer of the component it is documenting.
 */
const DemoCell: React.FC<{
  name: string;
  beat: Timing;
  span?: boolean;
  children: React.ReactNode;
}> = ({ name, beat, span = false, children }) => (
  <Box
    pad={SPACE.lg}
    enter={beat}
    preset="fade"
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: SPACE.md,
      minHeight: 0,
      ...(span ? { gridColumn: 'span 2' } : {}),
    }}
  >
    <Label variant="label" tone="muted">
      {name}
    </Label>
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>{children}</div>
  </Box>
);

const BoxDemo: React.FC<{ beat: Timing }> = ({ beat }) => {
  const beats = inside(beat, 3);
  return (
    <Row gap={SPACE.sm} wrap>
      <Box pad={16} enter={beats[0]}>
        <Label variant="small" tone="secondary">
          plain
        </Label>
      </Box>
      <Box pad={16} accent="blue" raised enter={beats[1]}>
        <Label variant="small" accent="blue">
          raised
        </Label>
      </Box>
      <Box pad={16} tone="danger" outlined={false} enter={beats[2]}>
        <Label variant="small">toned</Label>
      </Box>
    </Row>
  );
};

const ArrowDemo: React.FC<{ beat: Timing }> = ({ beat }) => {
  const beats = inside(beat, 2);
  return (
    <>
      <Arrow from={{ x: 6, y: 34 }} to={{ x: 250, y: 34 }} accent="cyan" label="request" enter={beats[0]} />
      <Arrow
        from={{ x: 6, y: 96 }}
        to={{ x: 250, y: 96 }}
        bend={26}
        dashed
        arrow="both"
        accent="amber"
        label="retry"
        enter={beats[1]}
      />
    </>
  );
};

const LabelDemo: React.FC<{ beat: Timing }> = ({ beat }) => {
  const theme = useTheme();
  const beats = inside(beat, 3);
  return (
    <Column gap={SPACE.sm}>
      <Label variant="heading" enter={beats[0]}>
        Heading
      </Label>
      <Label variant="small" mono tone="secondary" enter={beats[1]}>
        GET /orders/42
      </Label>
      {/* A line for the plate to knock out of. */}
      <div style={{ position: 'relative', paddingTop: 4 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            height: 2,
            backgroundColor: theme.borderStrong,
          }}
        />
        <Label variant="small" plate enter={beats[2]}>
          plate over a line
        </Label>
      </div>
    </Column>
  );
};

const HighlightDemo: React.FC<{ beat: Timing }> = ({ beat }) => {
  const beats = inside(beat, 2);
  return (
    <Label variant="body">
      Ship it{' '}
      <Highlight accent="amber" enter={beats[0]}>
        on Friday
      </Highlight>{' '}
      and{' '}
      <Highlight variant="underline" accent="cyan" enter={beats[1]}>
        measure
      </Highlight>
      .
    </Label>
  );
};

const NodeDemo: React.FC<{ beat: Timing }> = ({ beat }) => {
  const beats = inside(beat, 2);
  return (
    <>
      <Node x={0} y={14} w={152} h={108} icon="browser" label="Client" accent="cyan" enter={beats[0]} />
      <Node x={198} y={14} w={152} h={108} icon="server" label="API" sublabel=":443" enter={beats[1]} />
    </>
  );
};

const ConnectionDemo: React.FC<{ beat: Timing }> = ({ beat }) => {
  const beats = inside(beat, 3);
  // The rectangle is the contract: the same object places the node and anchors
  // the connection.
  const client = { x: 0, y: 26, w: 140, h: 96 };
  const api = { x: 214, y: 26, w: 140, h: 96 };
  return (
    <>
      <Node {...client} label="Client" icon="browser" accent="cyan" enter={beats[0]} />
      <Node {...api} label="API" icon="server" enter={beats[1]} />
      <Connection from={client} to={api} label="POST" accent="blue" enter={beats[2]} />
    </>
  );
};

const CodeDemo: React.FC<{ beat: Timing }> = ({ beat }) => (
  <CodeBlock
    code={`const job = await queue.add('email', payload, {
  attempts: 3,
});`}
    language="ts"
    title="queue.ts"
    highlight={[2]}
    fontSize={22}
    reveals={inside(beat, 3)}
    style={{ height: '100%' }}
  />
);

const GalleryBody: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();
  // A slower cascade than a scene's default: this composition is watched as a
  // bench, not narrated over, so each cell can take its turn.
  const beats = paceReveals(7, { fps, durationInFrames, staggerSeconds: 0.45 });

  return (
    <Grid columns={4} gap={SPACE.lg} style={{ height: '100%', gridTemplateRows: '1fr 1fr' }}>
      <DemoCell name="Box" beat={beats[0]}>
        <BoxDemo beat={beats[0]} />
      </DemoCell>
      <DemoCell name="Arrow" beat={beats[1]}>
        <ArrowDemo beat={beats[1]} />
      </DemoCell>
      <DemoCell name="Label" beat={beats[2]}>
        <LabelDemo beat={beats[2]} />
      </DemoCell>
      <DemoCell name="Highlight" beat={beats[3]}>
        <HighlightDemo beat={beats[3]} />
      </DemoCell>
      <DemoCell name="Node" beat={beats[4]}>
        <NodeDemo beat={beats[4]} />
      </DemoCell>
      <DemoCell name="Connection" beat={beats[5]}>
        <ConnectionDemo beat={beats[5]} />
      </DemoCell>
      <DemoCell name="CodeBlock" beat={beats[6]} span>
        <CodeDemo beat={beats[6]} />
      </DemoCell>
    </Grid>
  );
};

export const PrimitivesGallery: React.FC = () => (
  <Frame
    name="Markup primitives"
    eyebrow="Component kit"
    title="The markup primitives"
    accent="cyan"
    footer={<FrameCaption>State the structure; the component computes the pixels.</FrameCaption>}
  >
    <GalleryBody />
  </Frame>
);
