/**
 * The kit's own compositions: one per scene type, each with a realistic
 * storyboard behind it.
 *
 * These are the kit's documentation and its test bench at once. A design system
 * that is only described in prose cannot be looked at, and one whose examples
 * are lorem ipsum cannot be judged: every composition here is a scene from a
 * video that could ship -- a request path, a topology, an order saga -- so that
 * opening the Studio is the same as seeing the kit used.
 *
 * They live in a `Folder` of their own so the project's real `Scene`
 * composition is not buried under six demos. Nothing in this file is imported
 * by the render pipeline: a production render never mounts a kit demo.
 */

import React from 'react';
import { Composition, Folder } from 'remotion';
import { CANVAS } from './tokens.ts';
import { TitleScene, type TitleSceneProps } from './scenes/TitleScene.tsx';
import { PointsScene, type PointsSceneProps } from './scenes/PointsScene.tsx';
import { FlowScene, type FlowSceneProps } from './scenes/FlowScene.tsx';
import { TopologyScene, type TopologySceneProps } from './scenes/TopologyScene.tsx';
import { SequenceScene, type SequenceSceneProps } from './scenes/SequenceScene.tsx';
import { CodeScene, type CodeSceneProps } from './scenes/CodeScene.tsx';

/** Eight seconds: long enough for every scene type to finish its own pacing. */
const DEMO_FRAMES = 8 * CANVAS.fps;

const TITLE: TitleSceneProps = {
  eyebrow: 'Chapter 02',
  title: 'Designing a REST API',
  subtitle: 'Resources, verbs, and the status codes that carry the meaning.',
  tags: ['GET', 'POST', 'PATCH', 'DELETE', '201 Created'],
  footnote: 'Backend fundamentals',
  accent: 'blue',
};

const POINTS: PointsSceneProps = {
  eyebrow: 'Architecture',
  title: 'Why event-driven systems scale',
  points: [
    {
      title: 'Producers emit, then forget',
      body: 'A producer writes one event and moves on. It never waits to learn what happened next.',
      icon: 'broadcast',
    },
    {
      title: 'The broker holds the backlog',
      body: 'Events wait in a log until something is ready for them, so a slow consumer slows nobody else.',
      icon: 'queue',
    },
    {
      title: 'Consumers subscribe',
      body: 'New readers join without the producer changing, which is what makes a new feature additive.',
      icon: 'users',
    },
    {
      title: 'Failures are replayed',
      body: 'A crashed worker restarts and resumes from its offset. The event did not disappear.',
      icon: 'clock',
    },
  ],
  variant: 'icon',
  columns: 2,
  footnote: 'At-least-once delivery is the price of not losing anything',
  accent: 'violet',
};

const FLOW: FlowSceneProps = {
  eyebrow: 'Anatomy',
  title: 'One request, end to end',
  steps: [
    { label: 'Client', sublabel: 'browser', icon: 'browser', accent: 'cyan' },
    { label: 'API', sublabel: ':443', icon: 'server' },
    { label: 'Order service', sublabel: 'node', icon: 'gear' },
    { label: 'Postgres', sublabel: 'orders', icon: 'database', accent: 'green' },
  ],
  edges: ['GET /orders/42', 'handler', 'SELECT'],
  pulse: true,
  footnote: 'Each hop adds latency, and each hop can fail on its own',
  accent: 'blue',
};

const TOPOLOGY: TopologySceneProps = {
  eyebrow: 'Distributed systems',
  title: 'Where the pieces live',
  nodes: [
    { id: 'client', label: 'Client', icon: 'browser', col: 0, row: 0, accent: 'cyan' },
    { id: 'gateway', label: 'API gateway', sublabel: 'rate limit', icon: 'route', col: 1, row: 0 },
    { id: 'orders', label: 'Orders', sublabel: '3 replicas', icon: 'cube', col: 2, row: 0 },
    { id: 'payments', label: 'Payments', sublabel: '2 replicas', icon: 'bolt', col: 2, row: 1 },
    { id: 'postgres', label: 'Postgres', sublabel: 'primary', icon: 'database', col: 1, row: 1, accent: 'green' },
    { id: 'redis', label: 'Redis', sublabel: 'cache', icon: 'layers', col: 0, row: 1, accent: 'amber' },
  ],
  edges: [
    { from: 'client', to: 'gateway', label: 'HTTPS' },
    { from: 'gateway', to: 'client', label: '200', dashed: true },
    { from: 'gateway', to: 'orders', label: 'gRPC' },
    { from: 'gateway', to: 'payments', label: 'gRPC' },
    { from: 'orders', to: 'postgres', label: 'SQL' },
    { from: 'payments', to: 'postgres', label: 'SQL' },
    { from: 'orders', to: 'redis', label: 'cache', dashed: true },
  ],
  footnote: 'Two services, one database: the coupling the diagram makes visible',
  accent: 'violet',
};

const SEQUENCE: SequenceSceneProps = {
  eyebrow: 'Event-driven',
  title: 'An order, placed asynchronously',
  actors: [
    { id: 'client', label: 'Client', icon: 'browser', accent: 'cyan' },
    { id: 'api', label: 'Orders API', icon: 'server' },
    { id: 'broker', label: 'Broker', icon: 'queue', accent: 'amber' },
    { id: 'worker', label: 'Worker', icon: 'gear', accent: 'green' },
  ],
  messages: [
    { from: 'client', to: 'api', label: 'POST /orders', note: '202 Accepted' },
    { from: 'api', to: 'client', label: 'order accepted', kind: 'response' },
    { from: 'api', to: 'broker', label: 'orders.created', kind: 'async', note: 'topic: orders' },
    { from: 'broker', to: 'worker', label: 'consume', kind: 'async' },
    { from: 'worker', to: 'worker', label: 'charge card', note: 'attempt 1' },
    { from: 'worker', to: 'broker', label: 'ack', kind: 'response' },
  ],
  footnote: 'The client is answered long before the work is done',
  accent: 'amber',
};

const CODE: CodeSceneProps = {
  eyebrow: 'Design patterns',
  title: 'Idempotent request handling',
  filename: 'routes/orders.ts',
  language: 'ts',
  code: `app.post('/orders', async (req, res) => {
  const order = await orders.create(req.body);
  res.status(201).json(order);
});`,
  highlight: [2],
  progressive: true,
  aside: {
    title: 'Retries make this run twice',
    body: 'A client that times out will send the same request again. Without a key, the second one creates a second order.',
    points: ['Send an Idempotency-Key', 'Store the key with the result', 'Replay the first answer'],
    icon: 'key',
    tone: 'warn',
  },
  caption: 'A handler answers with the thing it made',
  accent: 'green',
};

export const KitRoot: React.FC = () => (
  <Folder name="Kit">
    <Composition
      id="KitTitle"
      component={TitleScene}
      durationInFrames={DEMO_FRAMES}
      fps={CANVAS.fps}
      width={CANVAS.width}
      height={CANVAS.height}
      defaultProps={TITLE}
    />
    <Composition
      id="KitPoints"
      component={PointsScene}
      durationInFrames={DEMO_FRAMES}
      fps={CANVAS.fps}
      width={CANVAS.width}
      height={CANVAS.height}
      defaultProps={POINTS}
    />
    <Composition
      id="KitFlow"
      component={FlowScene}
      durationInFrames={DEMO_FRAMES}
      fps={CANVAS.fps}
      width={CANVAS.width}
      height={CANVAS.height}
      defaultProps={FLOW}
    />
    <Composition
      id="KitTopology"
      component={TopologyScene}
      durationInFrames={DEMO_FRAMES}
      fps={CANVAS.fps}
      width={CANVAS.width}
      height={CANVAS.height}
      defaultProps={TOPOLOGY}
    />
    <Composition
      id="KitSequence"
      component={SequenceScene}
      durationInFrames={DEMO_FRAMES}
      fps={CANVAS.fps}
      width={CANVAS.width}
      height={CANVAS.height}
      defaultProps={SEQUENCE}
    />
    <Composition
      id="KitCode"
      component={CodeScene}
      durationInFrames={DEMO_FRAMES}
      fps={CANVAS.fps}
      width={CANVAS.width}
      height={CANVAS.height}
      defaultProps={CODE}
    />
  </Folder>
);
