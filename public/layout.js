// Lays the concept map out left to right as a learning progression.
// A concept's column is one more than the deepest column of anything it builds on,
// so everything a concept needs is always somewhere to its left.

export const COLUMN_GAP = 270;
export const ROW_GAP = 66;

export function layoutByLevel(domain) {
  const byId = new Map(domain.nodes.map((n) => [n.id, n]));
  const level = new Map();
  const levelOf = (id, seen = new Set()) => {
    if (level.has(id)) return level.get(id);
    if (seen.has(id)) return 0; // a prerequisite loop in the data; do not recurse forever
    seen.add(id);
    const prereqs = byId.get(id).prereqs;
    const value = prereqs.length ? 1 + Math.max(...prereqs.map((p) => levelOf(p, seen))) : 0;
    level.set(id, value);
    return value;
  };
  for (const node of domain.nodes) levelOf(node.id);

  const columnCount = Math.max(...level.values()) + 1;
  const columns = Array.from({ length: columnCount }, () => []);
  for (const node of domain.nodes) columns[level.get(node.id)].push(node.id);

  const neighbours = new Map(domain.nodes.map((n) => [n.id, []]));
  for (const edge of domain.edges) {
    neighbours.get(edge.source).push(edge.target);
    neighbours.get(edge.target).push(edge.source);
  }

  const y = new Map();
  const place = (column) => {
    column.forEach((id, row) => y.set(id, (row - (column.length - 1) / 2) * ROW_GAP));
  };
  columns.forEach(place);

  // Pull each concept toward the concepts it links to, a few passes in each direction,
  // so links run roughly level and cross less.
  const sweep = (column, others) => {
    const target = new Map(
      column.map((id) => {
        const linked = neighbours.get(id).filter((n) => others(n));
        const mean = linked.length ? linked.reduce((sum, n) => sum + y.get(n), 0) / linked.length : y.get(id);
        return [id, mean];
      }),
    );
    column.sort((a, b) => target.get(a) - target.get(b));
    place(column);
  };
  for (let pass = 0; pass < 6; pass++) {
    for (let c = 1; c < columnCount; c++) sweep(columns[c], (n) => level.get(n) < c);
    for (let c = columnCount - 2; c >= 0; c--) sweep(columns[c], (n) => level.get(n) > c);
  }

  const positions = {};
  for (const node of domain.nodes) {
    positions[node.id] = { x: level.get(node.id) * COLUMN_GAP, y: y.get(node.id), column: level.get(node.id) };
  }
  const tallest = Math.max(...columns.map((c) => c.length));
  const headingY = -((tallest - 1) / 2) * ROW_GAP - 62;
  return { positions, columnCount, headingY };
}
