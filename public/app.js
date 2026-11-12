import { buildModel, STATES, STATE_LABEL, CONFIDENCE_LABEL } from "./model.js";
import { layoutByLevel, COLUMN_GAP, ROW_GAP } from "./layout.js";

const app = document.getElementById("app");
const SAVE_KEY = "concept-map-session-v1";

const COLOR = {
  paper: "#edf1f3", surface: "#ffffff", ink: "#1a2238", muted: "#5c667a", line: "#c9d1da",
  known: "#1e7b6e", shaky: "#e0a526", shakySoft: "#f6dfa0", misconception: "#be2a4f", halo: "#8fa4f3",
};

let domain;
let session = newSession();
let cy = null;

function newSession() {
  return { index: 0, responses: {}, written: {}, grades: {}, gradeErrors: {}, optionOrder: {} };
}

const esc = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(session));
  } catch {
    // Saving is a convenience; the app works without it.
  }
}

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    return saved && saved.finished ? saved : null;
  } catch {
    return null;
  }
}

function setStage(stage) {
  for (const li of document.querySelectorAll(".stages li")) {
    li.classList.toggle("current", li.dataset.stage === stage);
  }
}

function show(html, stage) {
  if (cy) {
    cy.destroy();
    cy = null;
  }
  setStage(stage);
  app.innerHTML = html;
  app.focus();
}

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* ---------- Moving between screens ---------- */

// Each screen has its own address (#home, #test, #map), so the browser Back button works.
const testInProgress = () => Boolean(session.started) && !session.finished && !session.sample;
const mapReady = () => Boolean(session.finished || session.sample);

function render() {
  const screen = location.hash.slice(1);
  if (screen === "test" && testInProgress()) return showQuestion();
  if (screen === "map" && mapReady()) return showMap();
  if (screen !== "home") history.replaceState(null, "", "#home");
  showIntro();
}

function go(screen) {
  if (location.hash.slice(1) === screen) render();
  else location.hash = screen;
}

window.addEventListener("hashchange", render);

// Escape puts away whatever is open: a selected concept or link on the map.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && cy && !cy.$(":selected").empty()) cy.elements().unselect();
});

/* ---------- Intro ---------- */

function showIntro() {
  const mcCount = domain.items.filter((i) => i.type === "mc").length;
  const writtenCount = domain.items.length - mcCount;
  const saved = loadSaved();
  show(
    `<div class="column">
      <h1>Find out what you know about the heart, and what to learn next</h1>
      <p class="lede">Answer ${mcCount} multiple-choice questions${writtenCount ? ` and ${writtenCount} short written ones` : ""}. You will then see a map of the topic with your own knowledge drawn onto it.</p>
      <ul class="intro-key">
        <li><span class="swatch known"></span>Filled in: you know it</li>
        <li><span class="swatch shaky"></span>Half filled: you are unsure</li>
        <li><span class="swatch gap"></span>Empty: a gap</li>
        <li><span class="swatch misconception"></span>Red: a belief to correct</li>
      </ul>
      <div class="actions">
        ${testInProgress() ? `<button id="continue">Continue the test (question ${session.index + 1} of ${domain.items.length})</button>` : ""}
        <button id="start" class="${testInProgress() ? "quiet" : ""}">${testInProgress() ? "Start over" : "Start the test"}</button>
        ${saved ? `<button class="quiet" id="resume">Open your last map</button>` : ""}
        <button class="quiet" id="sample">See a sample learner's map</button>
      </div>
      <p class="hint">The test takes about ten minutes. For each answer you will also say how sure you are, which is how the map tells a lucky guess from real knowledge.</p>
    </div>`,
    "test",
  );
  document.getElementById("start").onclick = () => {
    session = newSession();
    session.started = true;
    for (const item of domain.items) {
      if (item.type === "mc") session.optionOrder[item.id] = shuffled(item.options.map((o) => o.id));
    }
    go("test");
  };
  const resumeTest = document.getElementById("continue");
  if (resumeTest) resumeTest.onclick = () => go("test");
  document.getElementById("sample").onclick = () => {
    session = newSession();
    session.sample = true;
    for (const [itemId, [optionId, confidence]] of Object.entries(domain.sampleLearner)) {
      session.responses[itemId] = { optionId, confidence };
    }
    go("map");
  };
  if (saved) {
    document.getElementById("resume").onclick = () => {
      session = saved;
      go("map");
    };
  }
}

/* ---------- Test ---------- */

function progressHtml() {
  const bars = domain.items
    .map((_, i) => `<span class="${i < session.index ? "done" : i === session.index ? "now" : ""}"></span>`)
    .join("");
  return `<div class="progress" aria-hidden="true">${bars}</div>
    <p class="progress-label">Question ${session.index + 1} of ${domain.items.length}</p>`;
}

function showQuestion() {
  const item = domain.items[session.index];
  const last = session.index === domain.items.length - 1;
  const nextLabel = last ? "Finish and see your map" : "Next question";

  if (item.type === "mc") {
    const previous = session.responses[item.id] || {};
    const options = session.optionOrder[item.id].map((id) => item.options.find((o) => o.id === id));
    show(
      `<form class="column" id="question">
        ${progressHtml()}
        <fieldset>
          <legend class="prompt">${esc(item.prompt)}</legend>
          <div class="options">
            ${options
              .map(
                (o) => `<label class="option">
                  <input type="radio" name="option" value="${o.id}" ${previous.optionId === o.id ? "checked" : ""}>
                  <span>${esc(o.text)}</span>
                </label>`,
              )
              .join("")}
          </div>
        </fieldset>
        <fieldset class="confidence">
          <legend>How sure are you?</legend>
          <div class="confidence-options">
            ${[1, 2, 3]
              .map(
                (level) => `<label class="confidence-option">
                  <input type="radio" name="confidence" value="${level}" ${previous.confidence === level ? "checked" : ""}>
                  ${CONFIDENCE_LABEL[level]}
                </label>`,
              )
              .join("")}
          </div>
        </fieldset>
        <div class="actions">
          <button type="submit" id="next" disabled>${nextLabel}</button>
          ${session.index > 0 ? `<button type="button" class="quiet" id="back">Previous question</button>` : ""}
          <button type="button" class="quiet" id="exit">Exit the test</button>
        </div>
      </form>`,
      "test",
    );
    const form = document.getElementById("question");
    const next = document.getElementById("next");
    const refresh = () => {
      next.disabled = !(form.option.value && form.confidence.value);
    };
    form.onchange = refresh;
    refresh();
    form.onsubmit = (event) => {
      event.preventDefault();
      session.responses[item.id] = { optionId: form.option.value, confidence: Number(form.confidence.value) };
      advance();
    };
  } else {
    show(
      `<form class="column" id="question">
        ${progressHtml()}
        <label class="prompt" for="answer" style="display:block">${esc(item.prompt)}</label>
        <textarea id="answer" name="answer" maxlength="4000">${esc(session.written[item.id] || "")}</textarea>
        <p class="hint">Write what you actually know, in your own words. A few sentences is enough. Leave it empty to skip the question.</p>
        <div class="actions">
          <button type="submit">${nextLabel}</button>
          ${session.index > 0 ? `<button type="button" class="quiet" id="back">Previous question</button>` : ""}
          <button type="button" class="quiet" id="exit">Exit the test</button>
        </div>
      </form>`,
      "test",
    );
    document.getElementById("question").onsubmit = (event) => {
      event.preventDefault();
      const answer = event.target.answer.value.trim();
      if (answer) session.written[item.id] = answer;
      else delete session.written[item.id];
      advance();
    };
  }

  // Leaving keeps the answers so far; the start screen offers to continue.
  document.getElementById("exit").onclick = () => go("home");

  const back = document.getElementById("back");
  if (back) {
    back.onclick = () => {
      session.index -= 1;
      showQuestion();
    };
  }
}

function advance() {
  if (session.index < domain.items.length - 1) {
    session.index += 1;
    showQuestion();
  } else {
    gradeWritten();
  }
}

async function gradeWritten() {
  const toGrade = Object.entries(session.written);
  session.grades = {};
  session.gradeErrors = {};
  if (toGrade.length) {
    show(
      `<div class="column waiting" role="status">
        <h2>Reading your written answers</h2>
        <p class="lede" style="margin:0 auto">This usually takes under a minute.</p>
      </div>`,
      "test",
    );
    await Promise.all(
      toGrade.map(async ([itemId, answer]) => {
        try {
          const response = await fetch("api/grade", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId, answer }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "Grading failed.");
          session.grades[itemId] = body;
        } catch (error) {
          session.gradeErrors[itemId] = error.message;
        }
      }),
    );
  }
  session.finished = true;
  save();
  go("map");
}

/* ---------- Map ---------- */

const chip = (state) => `<span class="chip ${state}">${STATE_LABEL[state]}</span>`;
const nodeById = (id) => domain.nodes.find((n) => n.id === id);
const nodeButton = (id) => `<button class="linklike" data-node="${id}">${esc(nodeById(id).label)}</button>`;

function showMap() {
  const model = buildModel(domain, session.responses, session.grades);
  const errors = Object.values(session.gradeErrors);
  const nextNodes = domain.nodes.filter((n) => model.nodes[n.id].next);

  show(
    `<div class="map-screen">
      <aside class="side left" aria-label="Summary">
        <h2>${session.sample ? "A sample learner" : "Where you stand"}</h2>
        ${
          errors.length
            ? `<p class="notice">${errors.length} written answer${errors.length > 1 ? "s were" : " was"} not graded and ${errors.length > 1 ? "are" : "is"} left out of this map. ${esc(errors[0])}</p>`
            : ""
        }
        <div class="counts">
          ${STATES.map(
            (s) => `<span class="swatch ${s}"></span><span>${STATE_LABEL[s]}</span><span class="count">${model.counts[s]}</span>`,
          ).join("")}
        </div>
        <p class="hint">Counts are concepts, out of ${domain.nodes.length}.</p>

        <h3>Learn next</h3>
        ${
          nextNodes.length
            ? `<p class="hint">You already know what these build on.</p>
               <ul>${nextNodes.map((n) => `<li>${nodeButton(n.id)}</li>`).join("")}</ul>`
            : `<p class="empty">Nothing is ready to learn next. ${model.counts.known === domain.nodes.length ? "You know every concept on the map." : "Start with any concept marked as a gap."}</p>`
        }

        <h3>Beliefs to correct</h3>
        ${
          model.misconceptions.length
            ? `<ul>${model.misconceptions.map((m) => `<li><button class="linklike" data-node="${m.nodes[0]}">${esc(m.label)}</button></li>`).join("")}</ul>`
            : `<p class="empty">No misconceptions showed up in your answers.</p>`
        }

        <div class="actions"><button class="quiet small" id="retake">Back to the start</button></div>
      </aside>

      <section class="canvas-wrap" aria-label="Concept map">
        <div class="tools">
          <div class="segmented" role="group" aria-label="Map view">
            <button id="view-mine" aria-pressed="true">${session.sample ? "Learner's knowledge" : "Your knowledge"}</button>
            <button id="view-expert" aria-pressed="false">Full map</button>
          </div>
          <label><input type="checkbox" id="labels" checked> Show link labels</label>
          <span class="reading-hint">Read left to right: each column builds on the ones before it.</span>
          <span class="spacer"></span>
          <button class="quiet small" id="fit">Fit to window</button>
        </div>
        <div id="cy"></div>
        <div class="legend">
          ${STATES.map((s) => `<span><i class="swatch ${s}"></i>${STATE_LABEL[s]}</span>`).join("")}
          <span><i class="swatch next"></i>Learn next</span>
        </div>
      </section>

      <aside class="side right" id="detail" aria-label="Details" aria-live="polite"></aside>
    </div>`,
    "map",
  );

  const detail = document.getElementById("detail");
  const showHelp = () => {
    detail.innerHTML = `<h2>Select a concept</h2>
      <p class="empty">Select any box or link on the map to see why it has its status, which answers it came from, and what it connects to.</p>
      <p class="empty">Drag boxes to rearrange the map. Scroll to zoom. Press Escape or Close to put a selection away.</p>`;
  };
  showHelp();

  // On a narrow screen the details sit below the map, so bring them into view.
  const stacked = () => window.matchMedia("(max-width: 1000px)").matches;
  const revealDetail = () => {
    if (stacked()) detail.scrollIntoView({ block: "start" });
  };

  drawGraph(model, {
    onNode: (id) => {
      detail.innerHTML = nodeDetailHtml(id, model);
      revealDetail();
    },
    onEdge: (id) => {
      detail.innerHTML = edgeDetailHtml(id, model);
      revealDetail();
    },
    onNothing: showHelp,
  });

  // Any "data-node" button, in either side panel, selects that concept on the map.
  app.querySelector(".map-screen").addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) {
      cy.elements().unselect();
      if (stacked()) document.querySelector(".canvas-wrap").scrollIntoView({ block: "start" });
      return;
    }
    const button = event.target.closest("[data-node]");
    if (!button || !cy) return;
    const node = cy.getElementById(button.dataset.node);
    cy.elements().unselect();
    node.select();
    cy.animate({ center: { eles: node }, duration: 250 });
  });

  document.getElementById("retake").onclick = () => go("home");
  document.getElementById("fit").onclick = () => cy.fit(undefined, 40);
  document.getElementById("labels").onchange = (event) => cy.edges().toggleClass("nolabel", !event.target.checked);
  const mine = document.getElementById("view-mine");
  const expert = document.getElementById("view-expert");
  const setView = (isExpert) => {
    mine.setAttribute("aria-pressed", String(!isExpert));
    expert.setAttribute("aria-pressed", String(isExpert));
    cy.elements().not(".heading").toggleClass("expert", isExpert);
  };
  mine.onclick = () => setView(false);
  expert.onclick = () => setView(true);
}

function drawGraph(model, handlers) {
  const layout = layoutByLevel(domain);
  const elements = [
    // One heading per column. They are part of the picture, not something to select.
    ...Array.from({ length: layout.columnCount }, (_, column) => ({
      group: "nodes",
      data: { id: `heading-${column}`, label: column === 0 ? "Step 1: start here" : `Step ${column + 1}`, width: 150 },
      position: { x: column * COLUMN_GAP, y: layout.headingY },
      classes: "heading",
      selectable: false,
      grabbable: false,
    })),
    ...domain.nodes.map((n) => ({
      group: "nodes",
      data: { id: n.id, label: n.label, width: Math.max(72, n.label.length * 7.4 + 26) },
      position: { x: layout.positions[n.id].x, y: layout.positions[n.id].y },
      classes: `${model.nodes[n.id].state} ${model.nodes[n.id].next ? "next" : ""}`,
    })),
    ...domain.edges.map((e) => {
      const from = layout.positions[e.source];
      const to = layout.positions[e.target];
      // A link between two concepts in the same column would run straight through
      // the boxes between them, so bow it out to the side.
      const rowsApart = Math.round(Math.abs(from.y - to.y) / ROW_GAP);
      const bowed = from.column === to.column && rowsApart > 1;
      return {
        group: "edges",
        data: { id: e.id, source: e.source, target: e.target, label: e.label, bow: 50 + 22 * rowsApart },
        classes: `${model.edges[e.id].state} ${bowed ? "bowed" : ""}`,
      };
    }),
  ];

  const font = '"Bricolage Grotesque", "Segoe UI", sans-serif';
  cy = cytoscape({
    container: document.getElementById("cy"),
    elements,
    layout: { name: "preset" },
    minZoom: 0.3,
    maxZoom: 2.5,
    style: [
      {
        selector: "node",
        style: {
          shape: "round-rectangle", width: "data(width)", height: 34,
          label: "data(label)", "text-valign": "center", "text-halign": "center",
          "font-family": font, "font-size": 12.5, "font-weight": 600,
          "background-color": COLOR.surface, color: COLOR.ink,
          "border-width": 2, "border-color": COLOR.ink, "border-style": "solid",
        },
      },
      {
        selector: "node.heading",
        style: {
          "background-opacity": 0, "border-width": 0, events: "no",
          "font-size": 13.5, "font-weight": 700, color: COLOR.muted,
        },
      },
      { selector: "node.known", style: { "background-color": COLOR.known, "border-color": COLOR.known, color: "#fff" } },
      { selector: "node.shaky", style: { "background-color": COLOR.shakySoft, "border-color": COLOR.shaky } },
      { selector: "node.gap", style: { "border-style": "dashed" } },
      { selector: "node.misconception", style: { "background-color": COLOR.misconception, "border-color": COLOR.misconception, color: "#fff" } },
      { selector: "node.untested", style: { "background-opacity": 0, "border-style": "dotted", "border-color": COLOR.muted, color: COLOR.muted } },
      { selector: "node.next", style: { "underlay-color": COLOR.halo, "underlay-opacity": 0.9, "underlay-padding": 6, "underlay-shape": "round-rectangle" } },
      {
        selector: "edge",
        style: {
          "curve-style": "bezier", width: 2, "line-color": COLOR.ink,
          "target-arrow-shape": "triangle", "target-arrow-color": COLOR.ink, "arrow-scale": 0.9,
          label: "data(label)", "font-family": font, "font-size": 9.5, color: COLOR.muted,
          "text-rotation": "autorotate", "text-background-color": COLOR.paper,
          "text-background-opacity": 0.92, "text-background-padding": 2,
        },
      },
      {
        selector: "edge.bowed",
        style: { "curve-style": "unbundled-bezier", "control-point-distances": "data(bow)", "control-point-weights": 0.5 },
      },
      { selector: "edge.known", style: { "line-color": COLOR.known, "target-arrow-color": COLOR.known, width: 2.5 } },
      { selector: "edge.shaky", style: { "line-color": COLOR.shaky, "target-arrow-color": COLOR.shaky } },
      { selector: "edge.gap", style: { "line-style": "dashed", width: 1.5 } },
      { selector: "edge.misconception", style: { "line-color": COLOR.misconception, "target-arrow-color": COLOR.misconception, width: 3 } },
      { selector: "edge.untested", style: { "line-color": COLOR.line, "target-arrow-color": COLOR.line, "line-style": "dotted", width: 1.5 } },
      { selector: "edge.nolabel", style: { label: "" } },
      // Full map: every concept and link drawn the same, with no learner overlay.
      {
        selector: "node.expert",
        style: {
          "background-color": COLOR.surface, "background-opacity": 1, "border-color": COLOR.ink,
          "border-style": "solid", color: COLOR.ink, "underlay-opacity": 0,
        },
      },
      { selector: "edge.expert", style: { "line-color": COLOR.ink, "target-arrow-color": COLOR.ink, "line-style": "solid", width: 1.5 } },
      { selector: ".dim", style: { opacity: 0.18, "underlay-opacity": 0 } },
      { selector: "node:selected", style: { "overlay-color": COLOR.ink, "overlay-opacity": 0.12, "overlay-padding": 5 } },
      { selector: "edge:selected", style: { "overlay-color": COLOR.ink, "overlay-opacity": 0.15, "overlay-padding": 4 } },
    ],
  });
  cy.fit(undefined, 40);

  const focusOn = (element) => {
    cy.elements().not(".heading").addClass("dim");
    (element.isNode() ? element.closedNeighborhood() : element.union(element.connectedNodes())).removeClass("dim");
  };
  cy.on("select", "node", (event) => {
    focusOn(event.target);
    handlers.onNode(event.target.id());
  });
  cy.on("select", "edge", (event) => {
    focusOn(event.target);
    handlers.onEdge(event.target.id());
  });
  cy.on("unselect", () => {
    if (cy.$(":selected").empty()) {
      cy.elements().removeClass("dim");
      handlers.onNothing();
    }
  });

  // Node labels are drawn on a canvas, so redraw once the web font has arrived.
  document.fonts?.ready.then(() => cy && cy.style().update());
}

/* ---------- Detail panel ---------- */

function evidenceHtml(itemIds, edgeId) {
  if (!itemIds.length) return `<p class="empty">No question in the test covered this.</p>`;
  return itemIds
    .map((itemId) => {
      const item = domain.items.find((i) => i.id === itemId);
      if (item.type === "mc") {
        const response = session.responses[itemId];
        const chosen = item.options.find((o) => o.id === response.optionId);
        const correct = item.options.find((o) => o.correct);
        return `<div class="evidence">
          <p class="q">${esc(item.prompt)}</p>
          <p><span class="mark ${chosen.correct ? "right" : "wrong"}">${chosen.correct ? "Correct" : "Incorrect"}, ${CONFIDENCE_LABEL[response.confidence].toLowerCase()}.</span>
          <span class="a">You answered: ${esc(chosen.text)}.${chosen.correct ? "" : ` The answer is: ${esc(correct.text)}.`}</span></p>
        </div>`;
      }
      const grade = session.grades[itemId];
      const verdictText = { demonstrated: "Shown in your answer", contradicted: "Contradicted by your answer", not_addressed: "Left out of your answer" };
      const verdict = edgeId ? grade.verdicts[edgeId] : null;
      return `<div class="evidence">
        <p class="q">${esc(item.prompt)}</p>
        ${verdict ? `<p><span class="mark ${verdict === "demonstrated" ? "right" : "wrong"}">${verdictText[verdict]}.</span></p>` : ""}
        <p class="a">You wrote: ${esc(session.written[itemId] || "")}</p>
        <p>${esc(grade.feedback)}</p>
      </div>`;
    })
    .join("");
}

function misconceptionsHtml(ids, model) {
  return ids
    .map((id) => {
      const m = model.misconceptions.find((x) => x.id === id);
      return `<div class="belief"><p><strong>${esc(m.label)}.</strong> Your answers suggest you believe: ${esc(m.belief.toLowerCase())}</p><p>${esc(m.correction)}</p></div>`;
    })
    .join("");
}

function nodeDetailHtml(id, model) {
  const node = nodeById(id);
  const status = model.nodes[id];
  const links = domain.edges.filter((e) => e.source === id || e.target === id);
  return `<div class="detail-head"><h2>${esc(node.label)}</h2><button class="quiet small" data-close>Close</button></div>
    <p>${chip(status.state)}${status.next ? ` <span class="chip untested">Learn next</span>` : ""}</p>
    <p>${esc(node.desc)}</p>
    ${misconceptionsHtml(status.misconceptions, model)}
    <h3>What connects to it</h3>
    <ul>${links
      .map((e) => `<li class="statement"><span>${esc(e.statement)}</span>${chip(model.edges[e.id].state)}</li>`)
      .join("")}</ul>
    ${
      node.prereqs.length
        ? `<h3>Builds on</h3><ul>${node.prereqs
            .map((p) => `<li class="statement">${nodeButton(p)}${chip(model.nodes[p].state)}</li>`)
            .join("")}</ul>`
        : ""
    }
    <h3>Answers behind this status</h3>
    ${evidenceHtml(status.itemIds)}
    ${node.anchor ? `<p class="anchor">VR scene anchor: ${esc(node.anchor)}</p>` : ""}`;
}

function edgeDetailHtml(id, model) {
  const edge = domain.edges.find((e) => e.id === id);
  const status = model.edges[id];
  const itemIds = [...new Set(status.evidence.map((e) => e.itemId))];
  return `<div class="detail-head"><h2>${esc(nodeById(edge.source).label)} and ${esc(nodeById(edge.target).label)}</h2><button class="quiet small" data-close>Close</button></div>
    <p>${chip(status.state)}</p>
    <p>${esc(edge.statement)}</p>
    ${misconceptionsHtml(status.misconceptions, model)}
    <h3>Concepts</h3>
    <ul><li>${nodeButton(edge.source)}</li><li>${nodeButton(edge.target)}</li></ul>
    <h3>Answers behind this status</h3>
    ${evidenceHtml(itemIds, id)}`;
}

/* ---------- Start ---------- */

try {
  const response = await fetch("data/heart.json");
  if (!response.ok) throw new Error(`The server answered ${response.status}.`);
  domain = await response.json();

  // Written answers need the grading server. On a static host there is none,
  // so the test is multiple choice only.
  let canGrade = false;
  try {
    const health = await fetch("api/health");
    canGrade = health.ok && (await health.json()).grader === true;
  } catch {
    canGrade = false;
  }
  if (!canGrade) domain.items = domain.items.filter((item) => item.type === "mc");

  // Reloading on the map address reopens the last finished map.
  if (location.hash === "#map") session = loadSaved() || session;
  render();
} catch (error) {
  show(
    `<div class="column"><h2>The test could not be loaded</h2><p>${esc(error.message)} Reload this page to try again.</p></div>`,
    "test",
  );
}
