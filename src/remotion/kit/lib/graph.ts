/**
 * Reading a diagram's shape out of its edges.
 *
 * A topology scene reveals itself in dependency order -- the client appears,
 * then the API it calls, then the database behind that -- and the order is a
 * property of the edges, not something the author should have to restate as a
 * per-node `order` field that can silently disagree with them.
 *
 * Depth is shortest-path distance from a node with nothing pointing at it. A
 * cycle has no such node, so each remaining component is seeded from its first
 * node in the given order: the result is always total and always deterministic,
 * and a graph that is entirely one cycle still animates in the order it was
 * written.
 */

export type GraphEdge = { from: string; to: string };

export function depthByNode(ids: string[], edges: GraphEdge[]): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const id of ids) {
    outgoing.set(id, []);
  }
  for (const edge of edges) {
    if (!outgoing.has(edge.from) || !outgoing.has(edge.to)) {
      // An edge naming a node that does not exist is dropped here rather than
      // thrown on: the scene still draws, and the caller can see the missing
      // edge in the picture.
      continue;
    }
    outgoing.get(edge.from)?.push(edge.to);
    hasIncoming.add(edge.to);
  }

  const depth = new Map<string, number>();
  const seed = (id: string): void => {
    depth.set(id, 0);
    const queue: string[] = [id];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) {
        break;
      }
      const next = depth.get(current) ?? 0;
      for (const target of outgoing.get(current) ?? []) {
        const known = depth.get(target);
        if (known === undefined || known > next + 1) {
          depth.set(target, next + 1);
          queue.push(target);
        }
      }
    }
  };

  for (const id of ids) {
    if (!hasIncoming.has(id)) {
      seed(id);
    }
  }
  for (const id of ids) {
    if (!depth.has(id)) {
      seed(id);
    }
  }
  return depth;
}

/**
 * How far one of a pair of opposing edges must bow to be told apart from its
 * twin. Two lines drawn between the same pair of nodes would otherwise sit on
 * top of each other and read as one.
 *
 * The side is chosen by the node ids rather than by which edge happens to be
 * written first, so the picture does not change when the edge list is
 * reordered.
 *
 * The magnitude is the caller's, because it is really a statement about the gap
 * between the two nodes: each of the pair bows `bend` out at its middle, and
 * the two labels sit one above each bow, so a pair whose nodes stand close
 * together -- or whose labels are long -- needs a wider bow than the default.
 */
export function reciprocalBend(edge: GraphEdge, edges: GraphEdge[], bend = 36): number {
  const reciprocal = edges.some((other) => other.from === edge.to && other.to === edge.from);
  if (!reciprocal) {
    return 0;
  }
  return edge.from < edge.to ? bend : -bend;
}
