// Learner model: turns test responses into a status for every concept (node)
// and every link between concepts (edge) in the domain graph.

export const STATES = ["known", "shaky", "gap", "misconception", "untested"];

export const STATE_LABEL = {
  known: "Known",
  shaky: "Shaky",
  gap: "Gap",
  misconception: "Misconception",
  untested: "Not tested",
};

export const CONFIDENCE_LABEL = { 1: "Guessing", 2: "Fairly sure", 3: "Certain" };

// How much one multiple-choice answer counts, by stated confidence.
// A lucky guess is weak evidence of knowing; a certain wrong answer is strong evidence of not knowing.
const RIGHT_WEIGHT = { 1: 0.5, 2: 0.8, 3: 1 };
const WRONG_WEIGHT = { 1: 0.6, 2: 0.85, 3: 1 };
const OMISSION_WEIGHT = 0.35; // a written answer that leaves out something it was asked to name

const KNOWN_AT = 0.7;
const SHAKY_AT = 0.4;
const THIN_EVIDENCE = 0.6; // below this total weight, "known" is downgraded to "shaky"

function statusFrom(evidence) {
  const positive = evidence.filter((e) => e.sign > 0).reduce((sum, e) => sum + e.weight, 0);
  const negative = evidence.filter((e) => e.sign < 0).reduce((sum, e) => sum + e.weight, 0);
  const total = positive + negative;
  if (total === 0) return { state: "untested", mastery: null };
  const mastery = positive / total;
  if (mastery >= KNOWN_AT) return { state: total < THIN_EVIDENCE ? "shaky" : "known", mastery };
  return { state: mastery >= SHAKY_AT ? "shaky" : "gap", mastery };
}

/**
 * @param domain    the domain graph (nodes, edges, misconceptions, items)
 * @param responses { [itemId]: { optionId, confidence } } for multiple-choice items
 * @param grades    { [itemId]: { verdicts, misconceptions, feedback } } for graded written items
 */
export function buildModel(domain, responses, grades) {
  const edgeEvidence = Object.fromEntries(domain.edges.map((e) => [e.id, []]));
  const activeMisconceptions = new Map(); // misconception id -> item ids that showed it

  const flag = (misconceptionId, itemId) => {
    if (!activeMisconceptions.has(misconceptionId)) activeMisconceptions.set(misconceptionId, []);
    activeMisconceptions.get(misconceptionId).push(itemId);
  };

  for (const item of domain.items) {
    if (item.type === "mc") {
      const response = responses[item.id];
      if (!response) continue;
      const option = item.options.find((o) => o.id === response.optionId);
      if (!option) continue;
      const correct = Boolean(option.correct);
      const weight = (correct ? RIGHT_WEIGHT : WRONG_WEIGHT)[response.confidence];
      for (const edgeId of item.edges) {
        edgeEvidence[edgeId].push({ itemId: item.id, sign: correct ? 1 : -1, weight });
      }
      // A wrong answer picked as a guess is a gap, not a belief.
      if (option.misconception && response.confidence >= 2) flag(option.misconception, item.id);
    } else {
      const grade = grades[item.id];
      if (!grade) continue;
      for (const edgeId of item.edges) {
        const verdict = grade.verdicts[edgeId];
        if (verdict === "demonstrated") edgeEvidence[edgeId].push({ itemId: item.id, sign: 1, weight: 1 });
        else if (verdict === "contradicted") edgeEvidence[edgeId].push({ itemId: item.id, sign: -1, weight: 1 });
        else if (item.omissionCounts) edgeEvidence[edgeId].push({ itemId: item.id, sign: -1, weight: OMISSION_WEIGHT });
      }
      for (const id of grade.misconceptions) flag(id, item.id);
    }
  }

  const misconceptions = domain.misconceptions
    .filter((m) => activeMisconceptions.has(m.id))
    .map((m) => ({ ...m, itemIds: activeMisconceptions.get(m.id) }));

  const edges = {};
  for (const edge of domain.edges) {
    const evidence = edgeEvidence[edge.id];
    const status = statusFrom(evidence);
    const held = misconceptions.filter((m) => m.edges.includes(edge.id));
    if (held.length) status.state = "misconception";
    edges[edge.id] = { ...status, evidence, misconceptions: held.map((m) => m.id) };
  }

  const nodes = {};
  for (const node of domain.nodes) {
    const incident = domain.edges.filter((e) => e.source === node.id || e.target === node.id);
    const evidence = incident.flatMap((e) => edgeEvidence[e.id]);
    const status = statusFrom(evidence);
    const held = misconceptions.filter((m) => m.nodes.includes(node.id));
    if (held.length) status.state = "misconception";
    nodes[node.id] = {
      ...status,
      itemIds: [...new Set(evidence.map((e) => e.itemId))],
      misconceptions: held.map((m) => m.id),
      next: false,
    };
  }

  // "Learn next": something the learner does not have yet, whose prerequisites they do have.
  for (const node of domain.nodes) {
    const status = nodes[node.id];
    const needsWork = ["gap", "shaky", "misconception"].includes(status.state);
    status.next = needsWork && node.prereqs.every((id) => nodes[id].state === "known");
  }

  const counts = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const id in nodes) counts[nodes[id].state] += 1;

  return { nodes, edges, misconceptions, counts };
}
