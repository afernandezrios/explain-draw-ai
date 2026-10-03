import { useMemo } from "react";
import { loadFont } from "@remotion/google-fonts/Inter";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CODE_THEMES } from "@/remotion/lib/code-syntax";
import { getSafeAreaPadding } from "@/remotion/lib/layout";
import { EASING } from "@/remotion/lib/motion-tokens";
import { ArrowAnnotate } from "@/remotion/primitives/arrow-annotate";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

/**
 * The outlines the block can draw. Mirrors `DIAGRAM_SHAPES` in the storyboard
 * schema, but is declared here so the block stays a component with props of its
 * own -- Studio renders it with no storyboard behind it.
 */
export type DiagramNodeShape = "box" | "database";

export type DiagramNode = {
  name: string;
  /** Line under the name. */
  note?: string;
  /** Outline of the box; omitted is the plain rounded rectangle. */
  shape?: DiagramNodeShape;
};

export type DiagramEdge = {
  /** Index of the box the arrow leaves, in the same `nodes` array. */
  from: number;
  /** Index of the box the arrow arrives at. May equal `from` for a loop. */
  to: number;
  /** What travels along the arrow. */
  label?: string;
};

export type DiagramSceneProps = {
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
  /** Heading above the diagram. Omit to drop it. */
  title?: string;
  accentColor?: string;
  backgroundColor?: string;
  theme?: "dark" | "light";
  /** Animation speed multiplier. */
  speed?: number;
};

/** The round-trip the block is built to draw: phone asks, server answers. */
const DEFAULT_NODES: DiagramNode[] = [
  { name: "Phone", note: "sends a request" },
  { name: "Server", note: "runs your code" },
  { name: "Database", note: "holds every row", shape: "database" },
];

const DEFAULT_EDGES: DiagramEdge[] = [
  { from: 0, to: 1, label: "request" },
  { from: 1, to: 2, label: "query" },
  { from: 2, to: 1, label: "rows" },
  { from: 1, to: 0, label: "response" },
];

/**
 * Beat plan in seconds. `diagramNominal` reads the same constants, so the two
 * cannot drift; a tune here is one line there.
 */
const T = {
  head: 0.1,
  headFor: 0.4,
  /** The first box springs in. */
  boxStart: 0.5,
  /** Seconds between rows, and between boxes inside a row. */
  layerStagger: 0.24,
  siblingStagger: 0.08,
  /** Pause after the last box lands, before the first arrow draws. */
  arrowsAfter: 0.15,
  /** One arrow draws itself, and the start offset between consecutive arrows. */
  arrowDraw: 0.5,
  arrowStagger: 0.3,
  labelAfter: 0.05,
  labelFor: 0.25,
  settle: 0.3,
} as const;

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/**
 * What the layout helpers need of a node and an edge. The storyboard's fields
 * are nullable, the block's own props are not, and the nominal is called with
 * the storyboard's -- so the helpers take the looser side.
 */
type LayoutNode = { name: string; note?: string | null; shape?: DiagramNodeShape | null };
type LayoutEdge = { from: number; to: number; label?: string | null };

/**
 * Reachability over a diagram whose edges may form cycles -- a round trip is a
 * cycle. Boolean closure, no recursion.
 */
function reachability(nodeCount: number, edges: LayoutEdge[]): boolean[][] {
  const reach = Array.from({ length: nodeCount }, () =>
    Array<boolean>(nodeCount).fill(false),
  );
  for (const edge of edges) {
    if (edge.from !== edge.to && edge.from < nodeCount && edge.to < nodeCount) {
      reach[edge.from][edge.to] = true;
    }
  }
  for (let k = 0; k < nodeCount; k += 1) {
    for (let i = 0; i < nodeCount; i += 1) {
      if (!reach[i][k]) continue;
      for (let j = 0; j < nodeCount; j += 1) {
        if (reach[k][j]) reach[i][j] = true;
      }
    }
  }
  return reach;
}

/**
 * How the boxes arrange themselves.
 *
 * Boxes that can reach each other -- a round trip, any loop -- are one cluster,
 * and a cluster is drawn as a ring: three boxes make a triangle, two sit side
 * by side, and the arrows run the way they are drawn by hand instead of
 * collapsing into one flat row. Each cluster then takes a row from the
 * condensation of the rest (acyclic by construction, so a few passes settle
 * it), and a plain chain still stacks top-down, one box per row.
 */
function diagramShape(nodeCount: number, edges: LayoutEdge[]) {
  const reach = reachability(nodeCount, edges);

  // Mutually reachable boxes share a cluster, named by its smallest index.
  const cluster = Array.from({ length: nodeCount }, (_, i) => {
    let rep = i;
    for (let j = 0; j < i; j += 1) {
      if (reach[i][j] && reach[j][i]) rep = Math.min(rep, j);
    }
    return rep;
  });

  // Longest path over the clusters: an edge only pushes a *different* cluster,
  // and between clusters there are no cycles left.
  const clusterRow = Array<number>(nodeCount).fill(0);
  for (let pass = 0; pass < nodeCount; pass += 1) {
    for (const edge of edges) {
      if (edge.from >= nodeCount || edge.to >= nodeCount) continue;
      const from = cluster[edge.from];
      const to = cluster[edge.to];
      if (from !== to) clusterRow[to] = Math.max(clusterRow[to], clusterRow[from] + 1);
    }
  }

  const layers = cluster.map((rep) => clusterRow[rep]);
  const maxLayer = layers.reduce((max, layer) => Math.max(max, layer), 0);
  const rowCounts = Array<number>(maxLayer + 1).fill(0);
  layers.forEach((layer) => {
    rowCounts[layer] += 1;
  });
  const maxRow = rowCounts.reduce((max, count) => Math.max(max, count), 0);
  return { cluster, layers, maxLayer, maxRow };
}

/**
 * Seconds from the first beat to the last, at speed 1: every box lands, then
 * every arrow draws and its label settles. Exported so the adapter's nominal
 * and the animation cannot disagree -- the concept scene's pattern.
 */
export function diagramNominal(nodes: LayoutNode[], edges: LayoutEdge[]): number {
  if (nodes.length === 0) return T.boxStart + T.settle;
  const { maxLayer, maxRow } = diagramShape(nodes.length, edges);
  return (
    T.boxStart +
    maxLayer * T.layerStagger +
    (maxRow - 1) * T.siblingStagger +
    T.arrowsAfter +
    Math.max(0, edges.length - 1) * T.arrowStagger +
    T.arrowDraw +
    T.labelAfter +
    T.labelFor +
    T.settle
  );
}

/** How far a forward arrow bows, and how much further each repeat bows. */
const FORWARD_BOW = 0.22;
const BACK_BOW = 0.42;
const REPEAT_BOW = 0.16;

/**
 * A database's width as a fraction of a box's, and its cap's half-height as a
 * fraction of its own -- the tall cylinder of the software-diagram icon,
 * around 3:4 width to height.
 */
const DB_ASPECT = 0.55;
const DB_CAP = 0.14;

/**
 * A free-form boxes-and-arrows diagram that assembles itself: boxes spring in
 * row by row, then each arrow draws by hand between the borders of the boxes it
 * connects, and its label fades in at the curve's midpoint. A box is a rounded
 * rectangle unless its `shape` says `database`, which draws the cylinder a
 * store of rows gets -- and arrows trim to that curve, not to the rectangle
 * behind it.
 *
 * Positions come from a layout pass, not from the storyboard: a chain of boxes
 * stacks top-down, while boxes that can reach each other -- a round trip, any
 * loop -- are drawn as a ring, three of them a triangle. Every row is centred.
 * The model names content; the geometry is the block's business.
 */
export const Diagram: React.FC<DiagramSceneProps> = ({
  nodes = DEFAULT_NODES,
  edges = DEFAULT_EDGES,
  title,
  accentColor = "#E8B86D",
  backgroundColor,
  theme = "dark",
  speed = 1,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const palette = CODE_THEMES[theme];
  const safe = getSafeAreaPadding({ width, height });

  const at = (seconds: number) => (seconds * fps) / speed;
  const ease = (from: number, to: number, easing = EASING.enter) =>
    interpolate(frame, [at(from), at(to)], [0, 1], { easing, ...clamp });

  // Portrait is the same design on a taller stage -- org-chart-build's scale.
  const portrait = height > width;
  const u = portrait
    ? Math.min(width / 496, height / 896)
    : Math.min(width / 1024, height / 576);

  const headIn = ease(T.head, T.head + T.headFor);

  const chartW = Math.min(width - safe.paddingLeft - safe.paddingRight, 900 * u);
  const nodeH = 62 * u;
  const nodeW = 200 * u;
  const colGap = 40 * u;
  const rowGap = 82 * u;

  /* The layout is a function of the node and edge lists, not of the frame --
   * keyed on a signature rather than the arrays, because a caller passing
   * literals hands this fresh references every frame. Shape is in the
   * signature because a database's proportions move the geometry. */
  const signature =
    nodes.map((node) => `${node.name}:${node.note ?? "-"}:${node.shape ?? "-"}`).join("|") +
    "#" +
    edges.map((edge) => `${edge.from}>${edge.to}:${edge.label ?? "-"}`).join("|");

  const layout = useMemo(() => {
    const { cluster, layers, maxLayer } = diagramShape(nodes.length, edges);

    // Each cluster's member boxes, in listed order; a cluster of one is an
    // ordinary cell.
    const rows: number[][] = Array.from({ length: maxLayer + 1 }, () => []);
    const members = new Map<number, number[]>();
    nodes.forEach((_, index) => {
      const rep = cluster[index];
      let list = members.get(rep);
      if (list === undefined) {
        list = [];
        members.set(rep, list);
        rows[layers[index]].push(rep);
      }
      list.push(index);
    });
    rows.forEach((row) => row.sort((a, b) => a - b));

    /* Sizes and cell geometry at a given box width: a database is the tall,
       narrow box of the icon, and a cluster of several boxes is a ring --
       neighbours keep the same gap they would have side by side. */
    const attempt = (width: number) => {
      const sizes = nodes.map((node) =>
        node.shape === "database"
          ? { w: width * DB_ASPECT, h: (width * DB_ASPECT * 4) / 3 }
          : { w: width, h: nodeH },
      );

      const cells = rows.map((row) =>
        row.map((rep) => {
          const list = members.get(rep) ?? [];
          const half = list.map((index) => ({
            w: sizes[index].w / 2,
            h: sizes[index].h / 2,
          }));
          if (list.length === 1) {
            return {
              list,
              offsets: [{ x: 0, y: 0 }],
              w: sizes[list[0]].w,
              h: sizes[list[0]].h,
            };
          }
          const widest = Math.max(...half.map((h) => h.w));
          const radius = (2 * widest + colGap) / (2 * Math.sin(Math.PI / list.length));
          const start = list.length === 2 ? 0 : -Math.PI / 2;
          const offsets = list.map((_, seat) => {
            const angle = start + (seat * 2 * Math.PI) / list.length;
            return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
          });
          const minX = Math.min(...offsets.map((o, seat) => o.x - half[seat].w));
          const maxX = Math.max(...offsets.map((o, seat) => o.x + half[seat].w));
          const minY = Math.min(...offsets.map((o, seat) => o.y - half[seat].h));
          const maxY = Math.max(...offsets.map((o, seat) => o.y + half[seat].h));
          return {
            list,
            offsets: offsets.map((o) => ({
              x: o.x - (minX + maxX) / 2,
              y: o.y - (minY + maxY) / 2,
            })),
            w: maxX - minX,
            h: maxY - minY,
          };
        }),
      );

      const rowW = cells.map(
        (row) =>
          row.reduce((sum, cell) => sum + cell.w, 0) + Math.max(0, row.length - 1) * colGap,
      );
      return { sizes, cells, rowW };
    };

    // Wide rows shrink the boxes; the second pass measures the shrunken
    // layout, which is enough because the shrink is linear.
    let boxWidth = nodeW;
    for (let pass = 0; pass < 2; pass += 1) {
      const widest = Math.max(...attempt(boxWidth).rowW, 0);
      if (widest > chartW) boxWidth *= chartW / widest;
    }
    const { sizes, cells } = attempt(boxWidth);

    // Rows stack top-down at the height each actually needs, and every row is
    // centred against the widest one.
    const rowH = cells.map((row) => Math.max(...row.map((cell) => cell.h), 0));
    const rowTop: number[] = [];
    let stacked = 0;
    rowH.forEach((h) => {
      rowTop.push(stacked);
      stacked += h + rowGap;
    });
    const chartH = Math.max(0, stacked - rowGap);

    const centers = nodes.map((_, index) => ({ x: 0, y: 0 }));
    const landings = nodes.map((_, index) => 0);

    rows.forEach((row, layer) => {
      const rowW =
        cells[layer].reduce((sum, cell) => sum + cell.w, 0) +
        Math.max(0, row.length - 1) * colGap;
      let x = (chartW - rowW) / 2;
      let seat = 0;
      row.forEach((_rep, cellIndex) => {
        const cell = cells[layer][cellIndex];
        const cellX = x + cell.w / 2;
        const cellY = rowTop[layer] + rowH[layer] / 2;
        cell.list.forEach((index, pos) => {
          centers[index] = {
            x: cellX + cell.offsets[pos].x,
            y: cellY + cell.offsets[pos].y,
          };
          landings[index] =
            T.boxStart + layers[index] * T.layerStagger + seat * T.siblingStagger;
          seat += 1;
        });
        x += cell.w + colGap;
      });
    });

    return { layers, sizes, chartH, centers, landings };
    // The layout is a function of the lists' content, not of their identity --
    // a caller passing literals hands this fresh arrays every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, chartW, nodeH, nodeW, colGap, rowGap]);

  const { layers, sizes, chartH, centers, landings } = layout;

  // Every box has landed by here; the arrows wait for the whole grid, so an
  // arrow never draws toward a box that is still arriving.
  const lastBox =
    nodes.reduce((latest, _node, index) => Math.max(latest, landings[index]), 0) + 0.3;
  const edgeStart = (index: number) =>
    lastBox + T.arrowsAfter + index * T.arrowStagger;

  /** Half height of a database's cap; the rim math and the drawing share it. */
  const dbCap = (h: number) => h * DB_CAP;

  /**
   * Where a line from a box's centre leaves its rim, `cap` half-heights in.
   * A plain box's rim is the rectangle (`cap` 0) and this reproduces the old
   * min(sx, sy) exactly; a database's rim is the same rectangle with
   * elliptical caps, so its arrows land on the curve instead of floating past
   * the corner the cylinder does not have.
   */
  const rimPoint = (
    center: { x: number; y: number },
    dx: number,
    dy: number,
    direction: 1 | -1,
    cap: number,
    halfW: number,
    halfH: number,
  ) => {
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const flank = halfH - cap;
    const tSide = absDx === 0 ? Infinity : halfW / absDx;
    let t: number;
    if (tSide * absDy <= flank) {
      t = tSide;
    } else if (absDy === 0) {
      t = halfW;
    } else if (cap === 0) {
      t = flank / absDy;
    } else {
      // The ray meets the cap ellipse centred at (0, ±flank) with radii
      // (halfW, cap): (dx*t/halfW)^2 + ((dy*t - flank)/cap)^2 = 1. The farther
      // root is the one leaving the box.
      const a = (absDx * absDx) / (halfW * halfW) + (absDy * absDy) / (cap * cap);
      const b = (-2 * absDy * flank) / (cap * cap);
      const c = (flank * flank) / (cap * cap) - 1;
      t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    }
    const scale = t * 1.06;
    return {
      x: center.x + dx * scale * direction,
      y: center.y + dy * scale * direction,
    };
  };

  /* One path per edge, in chart pixels, then wrapped in the smallest square
   * box that holds it -- square so the wrapper's fraction conversion scales
   * both axes alike and the drawn curve is exactly the one computed here. */
  const drawnEdges = edges.map((edge, index) => {
    const from = centers[edge.from];
    const to = centers[edge.to];
    if (from === undefined || to === undefined) return null;

    const repeat = edges
      .slice(0, index)
      .filter((other) => other.from === edge.from && other.to === edge.to).length;

    let p0: { x: number; y: number };
    let p2: { x: number; y: number };
    let bow: number;

    if (edge.from === edge.to) {
      // A loop over the box's own top edge: out of the left shoulder, back
      // into the right one, arcing above -- never a zero-length straight line.
      const size = sizes[edge.from];
      p0 = { x: from.x - size.w * 0.22, y: from.y - size.h / 2 + 6 * u };
      p2 = { x: from.x + size.w * 0.22, y: from.y - size.h / 2 + 6 * u };
      const dx = p2.x - p0.x;
      const dy = p2.y - p0.y;
      const midX = (p0.x + p2.x) / 2;
      const midY = (p0.y + p2.y) / 2;
      const desiredX = from.x;
      const desiredY = from.y - size.h / 2 - 52 * u;
      bow =
        ((desiredX - midX) * -dy + (desiredY - midY) * dx) / (dx * dx + dy * dy);
    } else {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      // A cylinder's arrows are trimmed to its curved cap; a box's to the
      // rectangle.
      const fromSize = sizes[edge.from];
      const toSize = sizes[edge.to];
      p0 = rimPoint(
        from,
        dx,
        dy,
        1,
        nodes[edge.from]?.shape === "database" ? dbCap(fromSize.h) : 0,
        fromSize.w / 2,
        fromSize.h / 2,
      );
      p2 = rimPoint(
        to,
        dx,
        dy,
        -1,
        nodes[edge.to]?.shape === "database" ? dbCap(toSize.h) : 0,
        toSize.w / 2,
        toSize.h / 2,
      );
      const forward =
        layers[edge.to] > layers[edge.from] ||
        (layers[edge.to] === layers[edge.from] && edge.to > edge.from);
      // Positive bow means "one side" of the travel direction, so a forward
      // leg and its return arc physically opposite sides with the same sign.
      bow = (forward ? FORWARD_BOW : BACK_BOW) + repeat * REPEAT_BOW;
    }

    // The control point the primitive will use, mirrored here for the label.
    const dx = p2.x - p0.x;
    const dy = p2.y - p0.y;
    const midX = (p0.x + p2.x) / 2;
    const midY = (p0.y + p2.y) / 2;
    const control = { x: midX - dy * bow, y: midY + dx * bow };

    // Quadratic midpoint: label anchor.
    const labelAt = {
      x: 0.25 * p0.x + 0.5 * control.x + 0.25 * p2.x,
      y: 0.25 * p0.y + 0.5 * control.y + 0.25 * p2.y,
    };
    const length = Math.hypot(dx, dy) || 1;
    // Offset along the curve's own normal, on the same side as the bow.
    const normal = { x: -dy / length, y: dx / length };
    const side = bow >= 0 ? 1 : -1;
    const labelPos = {
      x: labelAt.x + normal.x * side * 13 * u,
      y: labelAt.y + normal.y * side * 13 * u,
    };

    const pad = 18 * u;
    const minX = Math.min(p0.x, p2.x, control.x);
    const maxX = Math.max(p0.x, p2.x, control.x);
    const minY = Math.min(p0.y, p2.y, control.y);
    const maxY = Math.max(p0.y, p2.y, control.y);
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const sideLength = Math.max(contentW, contentH) + pad * 2;
    const originX = minX - pad - (sideLength - pad * 2 - contentW) / 2;
    const originY = minY - pad - (sideLength - pad * 2 - contentH) / 2;

    const delay = at(edgeStart(index));
    const duration = Math.max(1, Math.round((T.arrowDraw * fps) / speed));
    const labelIn = ease(
      edgeStart(index) + T.arrowDraw + T.labelAfter,
      edgeStart(index) + T.arrowDraw + T.labelAfter + T.labelFor,
    );

    return { edge, index, p0, p2, bow, sideLength, originX, originY, delay, duration, labelPos, labelIn };
  });

  return (
    <AbsoluteFill
      style={{
        background: backgroundColor ?? palette.page,
        fontFamily,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `${safe.paddingTop}px ${safe.paddingRight}px`,
      }}
    >
      <div style={{ width: chartW }}>
        {title ? (
          <div
            style={{
              marginBottom: 26 * u,
              color: palette.fg,
              fontSize: 28 * u,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              opacity: headIn,
              translate: `0 ${(1 - headIn) * 12 * u}px`,
            }}
          >
            {title}
          </div>
        ) : null}

        <div style={{ position: "relative", height: chartH }}>
          {drawnEdges.map((drawn) => {
            if (drawn === null) return null;
            const { p0, p2, bow, sideLength, originX, originY, delay, duration } = drawn;
            return (
              <div
                key={`edge-${drawn.index}`}
                style={{
                  position: "absolute",
                  left: originX,
                  top: originY,
                  width: sideLength,
                  height: sideLength,
                  pointerEvents: "none",
                }}
              >
                <ArrowAnnotate
                  /* The primitive computes in its own pixel box and multiplies
                   * the fractions by these -- without them it falls back to
                   * 320x220 and the arrow draws at the wrong size in the
                   * wrapper. */
                  width={sideLength}
                  height={sideLength}
                  from={{ x: (p0.x - originX) / sideLength, y: (p0.y - originY) / sideLength }}
                  to={{ x: (p2.x - originX) / sideLength, y: (p2.y - originY) / sideLength }}
                  bow={bow}
                  stroke={accentColor}
                  strokeWidth={2.2 * u}
                  headSize={13 * u}
                  sketch
                  delayInFrames={delay}
                  durationInFrames={duration}
                />
              </div>
            );
          })}

          {nodes.map((node, index) => {
            const landing = landings[index];
            const pop = spring({
              frame: frame - at(landing),
              fps,
              config: { damping: 16, stiffness: 165, mass: 0.65 },
            });
            const fade = ease(landing, landing + 0.3);
            const database = node.shape === "database";
            const size = sizes[index];
            const cap = dbCap(size.h);

            return (
              <div
                key={`${node.name}-${index}`}
                style={{
                  position: "absolute",
                  left: centers[index].x - size.w / 2,
                  top: centers[index].y - size.h / 2,
                  width: size.w,
                  height: size.h,
                  opacity: fade,
                  scale: `${0.9 + pop * 0.1}`,
                }}
              >
                {database ? (
                  /* A cylinder: two elliptical caps over a straight-sided
                   * body. The shadow rides the composite silhouette, so it
                   * follows the curve. */
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      filter: `drop-shadow(0 ${8 * u}px ${20 * u}px ${palette.shadow})`,
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: cap * 2,
                        borderRadius: "50%",
                        background: palette.window,
                        border: `1px solid ${accentColor}55`,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: cap,
                        height: size.h - cap * 2,
                        background: palette.window,
                        borderLeft: `1px solid ${accentColor}55`,
                        borderRight: `1px solid ${accentColor}55`,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: 0,
                        height: cap * 2,
                        borderRadius: "50%",
                        background: palette.window,
                        border: `1px solid ${accentColor}55`,
                        boxShadow: `inset 0 1px 0 ${palette.highlight}`,
                      }}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: 11 * u,
                      background: palette.window,
                      border: `1px solid ${accentColor}55`,
                      boxShadow: `inset 0 1px 0 ${palette.highlight}, 0 ${8 * u}px ${
                        22 * u
                      }px ${palette.shadow}`,
                    }}
                  />
                )}

                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    overflow: "hidden",
                    padding: `0 ${12 * u}px`,
                    // On a cylinder the words sit in the body, under the top
                    // face, not behind its curve.
                    paddingTop: database ? cap * 1.6 : undefined,
                  }}
                >
                  <div
                    style={{
                      color: palette.fg,
                      fontSize: (database ? 14 : 15) * u,
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {node.name}
                  </div>
                  {node.note ? (
                    <div
                      style={{
                        marginTop: 2 * u,
                        color: palette.dim,
                        // A narrow cylinder wraps its note instead of
                        // ellipsizing it away.
                        fontSize: (database ? 12.5 : 14.5) * u,
                        fontWeight: 500,
                        lineHeight: 1.25,
                        whiteSpace: database ? "normal" : "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {node.note}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          {/* Labels last, over both the arrows and the boxes, so a dense
              diagram's words are never painted out by its geometry. */}
          {drawnEdges.map((drawn) => {
            if (drawn === null || !drawn.edge.label) return null;
            return (
              <div
                key={`label-${drawn.index}`}
                style={{
                  position: "absolute",
                  left: drawn.labelPos.x,
                  top: drawn.labelPos.y,
                  translate: "-50% -50%",
                  color: accentColor,
                  fontSize: 13 * u,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  whiteSpace: "nowrap",
                  opacity: drawn.labelIn,
                }}
              >
                {drawn.edge.label}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
