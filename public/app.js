import { buildModel, buildPath, STATES, STATE_LABEL, CONFIDENCE_LABEL } from "./model.js?v=4";
import { layoutGrid, BOX_WIDTH, BOX_HEIGHT } from "./layout.js?v=4";

const app = document.getElementById("app");
const SAVE_KEY = "concept-map-session-v1";

const COLOR = {
  paper: "#edf1f3", surface: "#ffffff", ink: "#1a2238", muted: "#5c667a", line: "#c9d1da",
  known: "#1e7b6e", shaky: "#e0a526", shakySoft: "#f6dfa0", misconception: "#be2a4f", halo: "#8fa4f3", next: "#3b5bdb",
};

let domain;
let session = newSession();
let cy = null;

function newSession() {
  return { index: 0, responses: {}, written: {}, grades: {}, gradeErrors: {}, optionOrder: {}, learned: [] };
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

function loadSampleLearner() {
  session = newSession();
  session.sample = true;
  for (const [itemId, [optionId, confidence]] of Object.entries(domain.sampleLearner)) {
    session.responses[itemId] = { optionId, confidence };
  }
}

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
    loadSampleLearner();
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

const PATH_MARK = {
  done: `<span class="mark right">Done</span>`,
  next: `<span class="chip next">Up next</span>`,
  locked: `<span class="lock">Locked</span>`,
};

// What a concept is drawn as: the test result, or "known" once the learner marks it learned.
const shownState = (id, model, path) => (path.steps[id].learned ? "known" : model.nodes[id].state);

function showMap(selectId) {
  session.learned ||= [];
  const model = buildModel(domain, session.responses, session.grades);
  const path = buildPath(domain, model, session.learned);
  const errors = Object.values(session.gradeErrors);

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

        <h3>Learning path</h3>
        <p class="hint">${path.doneCount} of ${path.order.length} concepts done. ${path.upNext ? "Finishing the one that is up next unlocks the one after it." : "The whole path is complete."}</p>
        ${domain.sequence
          .map(
            (unit) => `<h4>${esc(unit.title)}</h4>
              <ol class="path">${unit.concepts
                .map(
                  (id) => `<li value="${path.steps[id].number}" class="${path.steps[id].status}"><span class="path-row">${nodeButton(id)}${PATH_MARK[path.steps[id].status]}</span></li>`,
                )
                .join("")}</ol>`,
          )
          .join("")}
        ${session.learned.length ? `<div class="actions"><button class="quiet small" id="reset-path">Undo the concepts marked as learned</button></div>` : ""}

        <h3>Beliefs to correct</h3>
        ${
          model.misconceptions.length
            ? `<ul>${model.misconceptions.map((m) => `<li><button class="linklike" data-node="${m.nodes[0]}">${esc(m.label)}</button></li>`).join("")}</ul>`
            : `<p class="empty">No misconceptions showed up in your answers.</p>`
        }

        <div class="actions"><button class="quiet small" id="retake">Back to the start</button></div>
        <p class="hint">The lungs and the body tissues each appear twice on the map: at the end of one path and the start of the next.</p>
      </aside>

      <section class="canvas-wrap" aria-label="Concept map">
        <div class="tools">
          <div class="segmented" role="group" aria-label="Map view">
            <button id="view-path" aria-pressed="true">Learning path</button>
            <button id="view-mine" aria-pressed="false">${session.sample ? "Learner's knowledge" : "Your knowledge"}</button>
            <button id="view-expert" aria-pressed="false">Full map</button>
          </div>
          <label><input type="checkbox" id="labels"> Show link labels</label>
          <span class="reading-hint">The numbers give the order to learn in. Select a box for details.</span>
          <span class="spacer"></span>
          <button class="quiet small" id="fit">Fit to window</button>
        </div>
        <div id="cy"></div>
        <div class="legend">
          ${STATES.map((s) => `<span><i class="swatch ${s}"></i>${STATE_LABEL[s]}</span>`).join("")}
          <span><i class="swatch next"></i>Up next</span>
          <span><i class="swatch locked"></i>Locked</span>
        </div>
      </section>

      <aside class="side right" id="detail" aria-label="Details" aria-live="polite"></aside>
    </div>`,
    "map",
  );

  const detail = document.getElementById("detail");
  const closeDetail = () => {
    detail.hidden = true;
    detail.innerHTML = "";
  };
  closeDetail();

  // On a narrow screen the details sit below the map, so bring them into view.
  const stacked = () => window.matchMedia("(max-width: 1000px)").matches;
  const revealDetail = () => {
    detail.hidden = false;
    detail.scrollTop = 0;
    if (stacked()) {
      detail.scrollIntoView({ block: "start" });
      return;
    }
    // The drawer covers the right of the map; slide the map over if the selection is under it.
    const selected = cy.$(":selected");
    if (selected.empty()) return;
    const box = selected.renderedBoundingBox();
    const visibleRight = cy.width() - detail.offsetWidth - 30;
    if (box.x2 > visibleRight) cy.animate({ panBy: { x: visibleRight - box.x2, y: 0 }, duration: 200 });
  };

  drawGraph(model, path, {
    onNode: (id) => {
      detail.innerHTML = nodeDetailHtml(id, model, path);
      revealDetail();
    },
    onEdge: (id) => {
      detail.innerHTML = edgeDetailHtml(id, model);
      revealDetail();
    },
    onNothing: closeDetail,
  });

  // Any "data-node" button, in either side panel, selects that concept on the map.
  app.querySelector(".map-screen").addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) {
      cy.elements().unselect();
      if (stacked()) document.querySelector(".canvas-wrap").scrollIntoView({ block: "start" });
      return;
    }
    // Marking the concept that is up next as learned unlocks the one after it.
    const learn = event.target.closest("[data-learn]");
    if (learn) {
      session.learned.push(learn.dataset.learn);
      if (session.finished) save();
      const after = buildPath(domain, model, session.learned).upNext;
      showMap(after || learn.dataset.learn);
      return;
    }
    const button = event.target.closest("[data-node]");
    if (!button || !cy) return;
    const node = cy.nodes(`[concept = "${button.dataset.node}"]`).first();
    cy.elements().unselect();
    node.select();
    cy.animate({ center: { eles: node }, duration: 250 });
  });

  document.getElementById("retake").onclick = () => go("home");
  document.getElementById("fit").onclick = () => cy.fit(undefined, 24);
  document.getElementById("labels").onchange = (event) => cy.edges().toggleClass("labelled", event.target.checked);
  const resetPath = document.getElementById("reset-path");
  if (resetPath) {
    resetPath.onclick = () => {
      session.learned = [];
      if (session.finished) save();
      showMap();
    };
  }

  // Three ways to look at the same map:
  //   path    the learner's knowledge, with everything still locked faded back
  //   mine    the learner's knowledge, nothing faded
  //   expert  every concept and link drawn the same, with no learner overlay
  const views = ["path", "mine", "expert"];
  const setView = (view) => {
    for (const name of views) {
      document.getElementById(`view-${name}`).setAttribute("aria-pressed", String(name === view));
    }
    cy.elements().not(".band").toggleClass("unlocked-view", view !== "path").toggleClass("expert", view === "expert");
  };
  for (const name of views) document.getElementById(`view-${name}`).onclick = () => setView(name);

  if (selectId) cy.nodes(`[concept = "${selectId}"]`).first().select();
}

function drawGraph(model, path, handlers) {
  const layout = layoutGrid(domain);
  const elements = [
    // A band behind each path. Part of the picture, not something to select.
    ...layout.bands.map((band) => ({
      group: "nodes",
      // "shift" moves the centred label to the band's left end (7.3px is the average letter width).
      data: { id: band.id, label: band.label, width: band.width, height: band.height, shift: (band.label.length * 7.3 - band.width) / 2 + 6 },
      position: { x: band.x, y: band.y },
      classes: "band",
      selectable: false,
      grabbable: false,
    })),
    ...layout.boxes.map((box) => ({
      group: "nodes",
      data: { id: box.id, concept: box.concept, label: nodeById(box.concept).label },
      position: { x: box.x, y: box.y },
      classes: `concept ${shownState(box.concept, model, path)} step-${path.steps[box.concept].status}`,
      grabbable: false, // boxes stay on the grid so every link stays straight
    })),
    // The concept's place in the learning order, on the corner of its box.
    ...layout.boxes.map((box) => ({
      group: "nodes",
      data: { id: `${box.id}#`, concept: box.concept, label: String(path.steps[box.concept].number) },
      position: { x: box.x - BOX_WIDTH / 2 + 3, y: box.y - BOX_HEIGHT / 2 + 1 },
      classes: `badge step-${path.steps[box.concept].status}`,
      selectable: false,
      grabbable: false,
    })),
    ...layout.links.map((link) => {
      const locked = [link.source, link.target].some((id) => path.steps[id.split("~")[0]].status === "locked");
      return {
        group: "edges",
        data: { id: link.id, source: link.source, target: link.target, label: link.label },
        classes: `${model.edges[link.id].state} ${locked ? "step-locked" : ""}`,
      };
    }),
  ];

  const font = '"Bricolage Grotesque", "Segoe UI", sans-serif';
  // Drawing order is fixed: bands at the back, then links, then boxes.
  const layer = (z) => ({ "z-index-compare": "manual", "z-index": z });
  cy = cytoscape({
    container: document.getElementById("cy"),
    elements,
    layout: { name: "preset" },
    minZoom: 0.3,
    maxZoom: 2.5,
    style: [
      {
        selector: "node.band",
        style: {
          ...layer(0), shape: "round-rectangle", width: "data(width)", height: "data(height)", events: "no",
          "background-color": COLOR.surface, "background-opacity": 0.75, "border-width": 1, "border-color": COLOR.line,
          // The name of the path sits above the band at its left end, clear of every link.
          label: "data(label)", "text-valign": "top", "text-halign": "center",
          "text-margin-x": "data(shift)", "text-margin-y": -5,
          "font-family": font, "font-size": 14, "font-weight": 700, color: COLOR.ink,
        },
      },
      {
        selector: "node.concept",
        style: {
          ...layer(2), shape: "round-rectangle", width: BOX_WIDTH, height: BOX_HEIGHT,
          label: "data(label)", "text-valign": "center", "text-halign": "center",
          "text-wrap": "wrap", "text-max-width": BOX_WIDTH - 14,
          "font-family": font, "font-size": 15, "font-weight": 600, "line-height": 1.2,
          "background-color": COLOR.surface, color: COLOR.ink,
          "border-width": 2, "border-color": COLOR.ink, "border-style": "solid",
        },
      },
      { selector: "node.known", style: { "background-color": COLOR.known, "border-color": COLOR.known, color: "#fff" } },
      { selector: "node.shaky", style: { "background-color": COLOR.shakySoft, "border-color": COLOR.shaky } },
      { selector: "node.gap", style: { "border-style": "dashed" } },
      { selector: "node.misconception", style: { "background-color": COLOR.misconception, "border-color": COLOR.misconception, color: "#fff" } },
      { selector: "node.untested", style: { "background-color": COLOR.paper, "border-style": "dotted", "border-color": COLOR.muted, color: COLOR.muted } },
      { selector: "node.concept.step-next", style: { "underlay-color": COLOR.next, "underlay-opacity": 1, "underlay-padding": 7, "underlay-shape": "round-rectangle" } },
      {
        selector: "node.badge",
        style: {
          ...layer(4), shape: "ellipse", width: 24, height: 24, events: "no",
          "background-color": COLOR.ink, "border-width": 2, "border-color": COLOR.surface,
          label: "data(label)", "text-valign": "center", "text-halign": "center",
          "font-family": font, "font-size": 12, "font-weight": 700, color: "#fff",
        },
      },
      { selector: "node.badge.step-next", style: { "background-color": COLOR.next } },
      // Locked: still to come on the learning path, so faded back.
      { selector: ".step-locked", style: { opacity: 0.32 } },
      // The number stays legible on a locked box, so the order can still be read.
      { selector: "node.badge.step-locked", style: { opacity: 0.8, "background-color": COLOR.muted } },
      { selector: ".step-locked.unlocked-view", style: { opacity: 1 } },
      {
        selector: "edge",
        style: {
          ...layer(1), "curve-style": "straight", width: 2.5, "line-color": COLOR.ink,
          "target-arrow-shape": "triangle", "target-arrow-color": COLOR.ink, "arrow-scale": 1,
          "font-family": font, "font-size": 11, color: COLOR.ink,
          "text-background-color": COLOR.surface, "text-background-opacity": 1, "text-background-padding": 3,
          "text-background-shape": "roundrectangle", "text-border-width": 1, "text-border-color": COLOR.line, "text-border-opacity": 1,
        },
      },
      // Link labels stay out of the way until asked for, or until a link is in focus.
      { selector: "edge.labelled, edge.focus", style: { label: "data(label)", ...layer(3) } },
      { selector: "edge.known", style: { "line-color": COLOR.known, "target-arrow-color": COLOR.known, width: 3 } },
      { selector: "edge.shaky", style: { "line-color": COLOR.shaky, "target-arrow-color": COLOR.shaky } },
      { selector: "edge.gap", style: { "line-style": "dashed", width: 2 } },
      { selector: "edge.misconception", style: { "line-color": COLOR.misconception, "target-arrow-color": COLOR.misconception, width: 3.5 } },
      { selector: "edge.untested", style: { "line-color": COLOR.muted, "target-arrow-color": COLOR.muted, "line-style": "dotted", width: 2 } },
      // Full map: every concept and link drawn the same, with no learner overlay.
      {
        selector: "node.expert",
        style: {
          "background-color": COLOR.surface, "border-color": COLOR.ink,
          "border-style": "solid", color: COLOR.ink, "underlay-opacity": 0,
        },
      },
      { selector: "edge.expert", style: { "line-color": COLOR.ink, "target-arrow-color": COLOR.ink, "line-style": "solid", width: 2 } },
      { selector: ".dim", style: { opacity: 0.2, "underlay-opacity": 0 } },
      { selector: "node:selected", style: { "overlay-color": COLOR.ink, "overlay-opacity": 0.12, "overlay-padding": 5 } },
      { selector: "edge:selected", style: { "overlay-color": COLOR.ink, "overlay-opacity": 0.15, "overlay-padding": 4 } },
    ],
  });
  cy.fit(undefined, 24);

  const clearFocus = () => {
    cy.elements().removeClass("dim");
    cy.edges().removeClass("focus");
  };
  const focusOn = (element) => {
    clearFocus();
    // A concept drawn in two places is focused in both.
    const boxes = element.isNode()
      ? cy.nodes(`.concept[concept = "${element.data("concept")}"]`).closedNeighborhood()
      : element.union(element.connectedNodes());
    // Keep the number badges of the boxes that stay lit.
    const kept = boxes.union(boxes.nodes().map((box) => cy.getElementById(`${box.id()}#`)));
    cy.elements().not(".band").not(kept).addClass("dim");
    kept.edges().addClass("focus");
  };
  cy.on("select", "node", (event) => {
    focusOn(event.target);
    handlers.onNode(event.target.data("concept"));
  });
  cy.on("select", "edge", (event) => {
    focusOn(event.target);
    handlers.onEdge(event.target.id());
  });
  cy.on("unselect", () => {
    if (cy.$(":selected").empty()) {
      clearFocus();
      handlers.onNothing();
    }
  });

  // Labels are drawn on a canvas, so redraw once the web font has arrived.
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

function nodeDetailHtml(id, model, path) {
  const node = nodeById(id);
  const status = model.nodes[id];
  const step = path.steps[id];
  const links = domain.edges.filter((e) => e.source === id || e.target === id);
  const isLast = step.number === path.order.length;
  const stepHtml = {
    done: step.learned ? `<p class="step-note">You marked this as learned. The test had it as: ${STATE_LABEL[status.state].toLowerCase()}.</p>` : "",
    next: `<div class="step-note next">
        <p><strong>This is the concept to learn now.</strong> Read the explanation and the links below.</p>
        <button data-learn="${id}">${isLast ? "Mark as learned and finish the path" : "Mark as learned and unlock the next concept"}</button>
      </div>`,
    locked: `<p class="step-note locked">Locked. It opens once you reach it on the learning path. Up next is ${path.upNext ? nodeButton(path.upNext) : ""}.</p>`,
  }[step.status];
  return `<div class="detail-head"><h2>${esc(node.label)}</h2><button class="quiet small" data-close>Close</button></div>
    <p class="step-line">Concept ${step.number} of ${path.order.length}, in ${esc(step.unit)}</p>
    <p>${chip(shownState(id, model, path))} ${step.status === "done" ? "" : PATH_MARK[step.status]}</p>
    ${stepHtml}
    <p>${esc(node.desc)}</p>
    ${misconceptionsHtml(status.misconceptions, model)}
    <h3>What connects to it</h3>
    <ul>${links
      .map((e) => `<li class="statement"><span>${esc(e.statement)}</span>${chip(model.edges[e.id].state)}</li>`)
      .join("")}</ul>
    ${
      node.prereqs.length
        ? `<h3>Builds on</h3><ul>${node.prereqs
            .map((p) => `<li class="statement">${nodeButton(p)}${chip(shownState(p, model, path))}</li>`)
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
  const response = await fetch("data/heart.json", { cache: "no-cache" });
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

  // A link ending in ?sample opens straight onto the sample learner's map.
  if (new URLSearchParams(location.search).has("sample")) {
    loadSampleLearner();
    history.replaceState(null, "", "#map");
  }
  render();
} catch (error) {
  show(
    `<div class="column"><h2>The test could not be loaded</h2><p>${esc(error.message)} Reload this page to try again.</p></div>`,
    "test",
  );
}
