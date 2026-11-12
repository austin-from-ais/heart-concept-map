// Lays the concept map out on a grid described in the domain data ("layout.rows").
// Each row is a channel read left to right. A link is drawn only when it can be a
// straight horizontal or vertical line with nothing in its way; the few links that
// cannot are left off the picture (they still count, and still show in the details).
//
// A concept may sit in more than one cell (the lungs end one channel and start the
// next), so drawn boxes have their own ids and point back to their concept.

export const COLUMN_GAP = 176;
export const ROW_GAP = 112;
export const BOX_WIDTH = 136;
export const BOX_HEIGHT = 50;

export function layoutGrid(domain) {
  const rows = domain.layout.rows;
  const boxes = [];
  const grid = new Map(); // "row,column" -> box
  const seen = new Map();

  rows.forEach((row, r) => {
    row.cells.forEach((concept, c) => {
      if (!concept) return;
      const count = (seen.get(concept) || 0) + 1;
      seen.set(concept, count);
      const box = { id: count === 1 ? concept : `${concept}~${count}`, concept, row: r, column: c, x: c * COLUMN_GAP, y: row.y * ROW_GAP };
      boxes.push(box);
      grid.set(`${r},${c}`, box);
    });
  });

  const clearBetween = (a, b) => {
    if (a.row === b.row) {
      for (let c = Math.min(a.column, b.column) + 1; c < Math.max(a.column, b.column); c++) {
        if (grid.has(`${a.row},${c}`)) return false;
      }
      return true;
    }
    if (a.column === b.column) {
      for (let r = Math.min(a.row, b.row) + 1; r < Math.max(a.row, b.row); r++) {
        if (grid.has(`${r},${a.column}`)) return false;
      }
      return true;
    }
    return false;
  };

  const links = [];
  const undrawn = [];
  for (const edge of domain.edges) {
    let best = null;
    for (const a of boxes.filter((b) => b.concept === edge.source)) {
      for (const b of boxes.filter((x) => x.concept === edge.target)) {
        if (!clearBetween(a, b)) continue;
        const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (!best || length < best.length) best = { id: edge.id, source: a.id, target: b.id, label: edge.label, length };
      }
    }
    if (best) links.push(best);
    else undrawn.push(edge.id);
  }

  const bands = rows
    .map((row, r) => ({ row, r }))
    .filter(({ row }) => row.label)
    .map(({ row, r }) => {
      const columns = row.cells.map((cell, c) => (cell ? c : -1)).filter((c) => c >= 0);
      const first = Math.min(...columns);
      const last = Math.max(...columns);
      return {
        id: `band-${r}`,
        label: row.label,
        x: ((first + last) / 2) * COLUMN_GAP,
        y: row.y * ROW_GAP,
        width: (last - first) * COLUMN_GAP + BOX_WIDTH + 36,
        height: BOX_HEIGHT + 30,
      };
    });

  return { boxes, links, undrawn, bands };
}
