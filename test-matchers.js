const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync("hide-usage-alert.js", "utf8");
const API_KEY = "__codexPlusHideUsageAlert";
const STYLE_ID = "codex-plus-hide-usage-alert-style";
const HIDDEN_ATTR = "data-codex-plus-hidden-usage-alert";
const HIDDEN_KIND_ATTR = `${HIDDEN_ATTR}-kind`;

const newOutOfMessagesAlert = [
  "You’re out of Codex messages",
  "Your rate limit resets on Jul 1, 2026, 4:45 PM.",
  "To continue using Codex and get access to GPT-5.3-Codex, start your free trial of Plus today.",
].join(" ");

const subagentQuotaCard = [
  "你的 Codex 消息限额已用尽",
  "你的额度将于 2026年6月11日 08:25重置。",
  "请增加额度以继续使用 Codex。",
  "增加额度",
].join(" ");

const mergedQuotaAlert = "你的 Codex 和工作使用额度已用完 升级至 Pro 重置使用量";
const legacyUsageCard = "剩余 0% 使用量 重置频率 每周 下次重置时间 2026年7月20日 08:00 升级";

function descendantsOf(root) {
  return (root?.children || []).flatMap((child) =>
    child.nodeType === 1 ? [child, ...descendantsOf(child)] : []
  );
}

function subtreeAccessReads(root) {
  return [root, ...descendantsOf(root)].reduce((total, node) => total + node.accessReads, 0);
}

function styleCount(document) {
  return document.querySelectorAll("style").filter((style) => style.id === STYLE_ID).length;
}

function matchesAttribute(element, selector) {
  const match = selector.match(
    /^\[([^\s~|^$*=\]]+)\s*(?:(\*=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))\s*(i)?)?\]$/
  );
  if (!match) return false;

  const [, name, operator, doubleQuoted, singleQuoted, bare, caseInsensitive] = match;
  if (!element.hasAttribute(name)) return false;
  if (!operator) return true;

  const expected = doubleQuoted ?? singleQuoted ?? bare ?? "";
  let actual = element.getAttribute(name);
  if (caseInsensitive) {
    actual = actual.toLowerCase();
    return operator === "="
      ? actual === expected.toLowerCase()
      : actual.includes(expected.toLowerCase());
  }
  return operator === "=" ? actual === expected : actual.includes(expected);
}

function matchesSelector(element, selector) {
  return selector.split(",").some((part) => {
    const simple = part.trim();
    if (!simple) return false;
    if (simple.startsWith("[")) return matchesAttribute(element, simple);
    return element.tagName === simple.toUpperCase();
  });
}

class FakeElement {
  constructor(tagName = "div", { text = "", attrs = {}, rect = {}, children = [] } = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.parentElement = null;
    this.attributes = new Map(Object.entries(attrs).map(([key, value]) => [key, String(value)]));
    this.rect = {
      width: 360,
      height: 120,
      top: 600,
      bottom: 720,
      left: 700,
      right: 1060,
      ...rect,
    };
    this.children = [];
    this._text = String(text);
    this.layoutReads = 0;
    this.matchesReads = 0;
    this.queryReads = 0;
    this.textReads = 0;
    this.attributeReads = 0;
    children.forEach((child) => this.appendChild(child));
  }

  get id() {
    return this.getAttribute("id") || "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get innerText() {
    return this.textContent;
  }

  set innerText(value) {
    this._text = String(value || "");
  }

  get textContent() {
    this.textReads += 1;
    return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(" ");
  }

  set textContent(value) {
    this._text = String(value || "");
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  contains(node) {
    for (let current = node; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }

  get isConnected() {
    let root = this;
    while (root.parentElement) root = root.parentElement;
    return root.tagName === "HTML";
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  getBoundingClientRect() {
    this.layoutReads += 1;
    return this.rect;
  }

  getAttribute(name) {
    this.attributeReads += 1;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    this.attributeReads += 1;
    return this.attributes.has(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  matches(selector) {
    this.matchesReads += 1;
    return matchesSelector(this, selector);
  }

  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (node.matches(selector)) return node;
    }
    return null;
  }

  querySelector(selector) {
    this.queryReads += 1;
    return descendantsOf(this).find((node) => node.matches(selector)) || null;
  }

  querySelectorAll(selector) {
    this.queryReads += 1;
    return descendantsOf(this).filter((node) => node.matches(selector));
  }

  resetAccessCounts({ subtree = false } = {}) {
    this.matchesReads = 0;
    this.queryReads = 0;
    this.layoutReads = 0;
    this.textReads = 0;
    this.attributeReads = 0;
    if (subtree) descendantsOf(this).forEach((node) => node.resetAccessCounts());
  }

  get accessReads() {
    return (
      this.matchesReads +
      this.queryReads +
      this.textReads +
      this.attributeReads +
      this.layoutReads
    );
  }
}

class FakeText {
  constructor(text = "") {
    this.nodeType = 3;
    this.parentElement = null;
    this._text = String(text);
  }

  get textContent() {
    return this._text;
  }

  set textContent(value) {
    this._text = String(value || "");
  }
}

function createFakeDocument(documentElement = null, body = null) {
  const listeners = new Map();
  const document = {
    body,
    documentElement,
    readyState: documentElement ? "complete" : "loading",
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return allElements().find((element) => element.id === id) || null;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      return allElements().filter((element) => element.matches(selector));
    },
    addEventListener(event, callback, options = {}) {
      const callbacks = listeners.get(event) || [];
      callbacks.push({ callback, once: !!options.once });
      listeners.set(event, callbacks);
    },
    removeEventListener(event, callback) {
      listeners.set(
        event,
        (listeners.get(event) || []).filter((item) => item.callback !== callback)
      );
    },
    fire(event) {
      if (event === "DOMContentLoaded") this.readyState = "interactive";
      for (const item of [...(listeners.get(event) || [])]) {
        if (item.once) this.removeEventListener(event, item.callback);
        item.callback();
      }
    },
    listenerCount(event) {
      return (listeners.get(event) || []).length;
    },
  };
  const allElements = () =>
    document.documentElement
      ? [document.documentElement, ...descendantsOf(document.documentElement)]
      : [];

  return document;
}

function createFakeWindow() {
  let nextTimerId = 1;
  const timers = new Map();

  return {
    innerHeight: 900,
    innerWidth: 1200,
    setTimeout(callback) {
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    get pendingTimerCount() {
      return timers.size;
    },
    flushTimers() {
      let rounds = 0;
      while (timers.size) {
        if (++rounds > 100) throw new Error("Fake timer queue did not settle");
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach((callback) => callback());
      }
    },
  };
}

function createEnvironment(
  body = null,
  { autoRun = true, documentElementReady = false, topLevel = true } = {}
) {
  const observers = [];

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      observers.push(this);
    }

    observe(target, options) {
      if (!target || typeof target.nodeType !== "number") {
        throw new TypeError("MutationObserver target must be a Node");
      }
      if (!options || !(options.childList || options.attributes || options.characterData)) {
        throw new TypeError("MutationObserver options must observe at least one mutation type");
      }
      this.target = target;
      this.options = { ...options };
      this.connected = true;
    }

    disconnect() {
      this.connected = false;
    }

    emit(mutations) {
      if (this.connected) this.callback(mutations);
    }
  }

  const documentElement = body || documentElementReady
    ? new FakeElement("html", { children: body ? [body] : [] })
    : null;
  const document = createFakeDocument(documentElement, body);
  const window = createFakeWindow();
  window.window = window;
  window.self = window;
  window.top = topLevel ? window : {};

  const context = {
    Node: { ELEMENT_NODE: 1 },
    MutationObserver: FakeMutationObserver,
    document,
    window,
  };

  function runScript() {
    return vm.runInNewContext(source, context);
  }

  function attachBody(nextBody) {
    const nextDocumentElement = new FakeElement("html", { children: [nextBody] });
    document.body = nextBody;
    document.documentElement = nextDocumentElement;
    return nextDocumentElement;
  }

  function mountBody(nextBody) {
    if (!document.documentElement || document.body) {
      throw new Error("mountBody requires an existing documentElement without a body");
    }
    document.documentElement.appendChild(nextBody);
    document.body = nextBody;
    for (const observer of observers) {
      observer.emit([
        { type: "childList", target: document.documentElement, addedNodes: [nextBody] },
      ]);
    }
    return document.documentElement;
  }

  const environment = { attachBody, context, document, mountBody, observers, runScript, window };
  Object.defineProperty(environment, "activeObserverCount", {
    get() {
      return observers.filter((observer) => observer.connected).length;
    },
  });

  if (autoRun) {
    runScript();
    window.flushTimers();
  }
  return environment;
}

function quotaAlert(text, { tagName = "aside", attrs = {}, children = [] } = {}) {
  const button = new FakeElement("button", { text: "增加额度", rect: { width: 80, height: 32 } });
  return new FakeElement(tagName, {
    text,
    attrs,
    rect: { width: 720, height: 80 },
    children: [...children, button],
  });
}

const protectedSurfaces = [
  { selector: "[data-codex-composer-root]", tagName: "div", attrs: { "data-codex-composer-root": "true" } },
  { selector: "[data-codex-composer]", tagName: "div", attrs: { "data-codex-composer": "true" } },
  { selector: "[contenteditable]", tagName: "div", attrs: { contenteditable: "true" } },
  { selector: "textarea", tagName: "textarea", attrs: {} },
  { selector: "input", tagName: "input", attrs: {} },
  { selector: "form", tagName: "form", attrs: {} },
];

test("hides the English role=alert out-of-messages banner", () => {
  const alert = quotaAlert(newOutOfMessagesAlert, { attrs: { role: "alert" } });

  createEnvironment(new FakeElement("body", { children: [alert] }));

  assert.equal(alert.getAttribute(HIDDEN_ATTR), "true");
  assert.equal(alert.getAttribute(HIDDEN_KIND_ATTR), "quota-banner");
});

test("hides the legacy bottom div quota banner", () => {
  const banner = quotaAlert(newOutOfMessagesAlert, { tagName: "div" });

  createEnvironment(new FakeElement("body", { children: [banner] }));

  assert.equal(banner.getAttribute(HIDDEN_ATTR), "true");
  assert.equal(banner.getAttribute(HIDDEN_KIND_ATTR), "quota-banner");
});

test("hides the smallest nested legacy quota card", () => {
  const copy = new FakeElement("div", { text: newOutOfMessagesAlert });
  const action = new FakeElement("button", { text: "Upgrade", rect: { width: 80, height: 32 } });
  const card = new FakeElement("div", {
    rect: { width: 720, height: 100 },
    children: [copy, action],
  });
  const sibling = new FakeElement("div", { text: "Unrelated controls" });
  const wrapper = new FakeElement("div", {
    rect: { width: 760, height: 180 },
    children: [card, sibling],
  });

  createEnvironment(new FakeElement("body", { children: [wrapper] }));

  assert.equal(wrapper.getAttribute(HIDDEN_ATTR), null, "outer wrapper must remain visible");
  assert.equal(card.getAttribute(HIDDEN_ATTR), "true", "the complete quota card should be hidden");
  assert.equal(copy.getAttribute(HIDDEN_ATTR), null, "copy alone is not the complete alert surface");
  assert.equal(sibling.getAttribute(HIDDEN_ATTR), null, "unrelated sibling must remain visible");
});

test("hides the legacy role=status usage card", () => {
  const upgrade = new FakeElement("button", { text: "升级", rect: { width: 80, height: 32 } });
  const card = new FakeElement("div", {
    text: legacyUsageCard,
    attrs: { role: "status" },
    rect: { width: 360, height: 160 },
    children: [upgrade],
  });

  createEnvironment(new FakeElement("body", { children: [card] }));

  assert.equal(card.getAttribute(HIDDEN_ATTR), "true");
  assert.equal(card.getAttribute(HIDDEN_KIND_ATTR), "usage-card");
});

test("hides the subagent quota card", () => {
  const button = new FakeElement("button", { text: "增加额度", rect: { width: 80, height: 32 } });
  const quotaCard = new FakeElement("div", {
    text: subagentQuotaCard,
    rect: { width: 360, height: 160 },
    children: [button],
  });
  createEnvironment(new FakeElement("body", { children: [quotaCard] }));
  assert.equal(quotaCard.getAttribute(HIDDEN_ATTR), "true");
});

for (const container of [
  { name: "data-message-author-role", tagName: "div", attrs: { "data-message-author-role": "assistant" } },
  { name: "article", tagName: "article", attrs: {} },
]) {
  test(`does not hide quoted quota copy inside ${container.name}`, () => {
    const quote = quotaAlert(newOutOfMessagesAlert, { attrs: { role: "alert" } });
    const message = new FakeElement(container.tagName, {
      attrs: container.attrs,
      children: [quote],
    });

    createEnvironment(new FakeElement("body", { children: [message] }));

    assert.equal(message.getAttribute(HIDDEN_ATTR), null);
    assert.equal(quote.getAttribute(HIDDEN_ATTR), null);
  });
}

test("does not hide ancestors containing quoted quota copy", () => {
  const quote = quotaAlert(newOutOfMessagesAlert, { attrs: { role: "alert" } });
  const article = new FakeElement("article", { children: [quote] });
  const section = new FakeElement("section", { children: [article] });
  const outer = new FakeElement("div", { children: [section] });

  createEnvironment(new FakeElement("body", { children: [outer] }));

  for (const node of [outer, section, article, quote]) {
    assert.equal(node.getAttribute(HIDDEN_ATTR), null);
  }
});

test("hides the quota aside without hiding its composer sibling or shared layout", () => {
  const alert = quotaAlert(subagentQuotaCard);
  const composer = new FakeElement("div", {
    attrs: { "data-codex-composer": "true", contenteditable: "true" },
    rect: { width: 720, height: 110 },
  });
  const layout = new FakeElement("div", {
    children: [alert, composer],
    rect: { width: 760, height: 210 },
  });
  const composerRoot = new FakeElement("div", {
    attrs: { "data-codex-composer-root": "true" },
    children: [layout],
    rect: { width: 800, height: 240 },
  });

  createEnvironment(new FakeElement("body", { children: [composerRoot] }));

  assert.equal(layout.getAttribute(HIDDEN_ATTR), null, "shared layout must not be hidden");
  assert.equal(composerRoot.getAttribute(HIDDEN_ATTR), null, "composer root must not be hidden");
  assert.equal(composer.getAttribute(HIDDEN_ATTR), null, "composer must not be hidden");
  assert.equal(alert.getAttribute(HIDDEN_ATTR), "true", "quota aside should be hidden directly");
});

test("hides the merged Codex and work usage quota copy", () => {
  const alert = quotaAlert(mergedQuotaAlert);

  createEnvironment(new FakeElement("body", { children: [alert] }));

  assert.equal(alert.getAttribute(HIDDEN_ATTR), "true");
});

for (const surface of protectedSurfaces) {
  test(`does not hide a quota candidate that is ${surface.selector}`, () => {
    const candidate = quotaAlert(subagentQuotaCard, {
      tagName: surface.tagName,
      attrs: { role: "alert", ...surface.attrs },
    });

    createEnvironment(new FakeElement("body", { children: [candidate] }));

    assert.equal(candidate.getAttribute(HIDDEN_ATTR), null);
  });

  test(`does not hide a quota candidate containing ${surface.selector}`, () => {
    const protectedChild = new FakeElement(surface.tagName, { attrs: surface.attrs });
    const candidate = quotaAlert(subagentQuotaCard, { children: [protectedChild] });

    createEnvironment(new FakeElement("body", { children: [candidate] }));

    assert.equal(candidate.getAttribute(HIDDEN_ATTR), null);
  });
}

test("does not read layout for non-quota text", () => {
  const candidate = new FakeElement("aside", {
    text: "Project activity is available and the editor is ready.",
    rect: { width: 720, height: 80 },
  });

  createEnvironment(new FakeElement("body", { children: [candidate] }));

  assert.equal(candidate.layoutReads, 0);
});

test("scans only the added childList subtree", () => {
  const unrelated = new FakeElement("section", {
    children: [new FakeElement("div", { text: "Existing project activity" })],
  });
  const body = new FakeElement("body", { children: [unrelated] });
  const environment = createEnvironment(body);
  unrelated.resetAccessCounts({ subtree: true });

  const alert = quotaAlert(newOutOfMessagesAlert, { attrs: { role: "alert" } });
  body.appendChild(alert);
  environment.observers.find((observer) => observer.connected).emit([
    { type: "childList", target: body, addedNodes: [alert] },
  ]);
  environment.window.flushTimers();

  assert.equal(alert.getAttribute(HIDDEN_ATTR), "true");
  assert.equal(subtreeAccessReads(unrelated), 0, "unrelated existing DOM must not be rescanned");
});

test("does not hide outer ancestors when a quoted message is added", () => {
  const outer = new FakeElement("div");
  const body = new FakeElement("body", { children: [outer] });
  const environment = createEnvironment(body);
  const quote = quotaAlert(newOutOfMessagesAlert, { attrs: { role: "alert" } });
  const article = new FakeElement("article", { children: [quote] });

  outer.appendChild(article);
  environment.observers.find((observer) => observer.connected).emit([
    { type: "childList", target: outer, addedNodes: [article] },
  ]);
  environment.window.flushTimers();

  for (const node of [outer, article, quote]) {
    assert.equal(node.getAttribute(HIDDEN_ATTR), null);
  }
});

test("does not cross an added message boundary to revalidate an outer marker", () => {
  const outer = new FakeElement("div");
  const body = new FakeElement("body", { children: [outer] });
  const environment = createEnvironment(body);
  outer.setAttribute(HIDDEN_ATTR, "true");
  outer.setAttribute(HIDDEN_KIND_ATTR, "quota-banner");
  const quote = quotaAlert(newOutOfMessagesAlert, { attrs: { role: "alert" } });
  const article = new FakeElement("article", { children: [quote] });

  outer.appendChild(article);
  environment.observers.find((observer) => observer.connected).emit([
    { type: "childList", target: outer, addedNodes: [article] },
  ]);
  environment.window.flushTimers();

  assert.equal(outer.getAttribute(HIDDEN_ATTR), "true");
  assert.equal(quote.getAttribute(HIDDEN_ATTR), null);
});

test("drops a detached pending mutation root", () => {
  const body = new FakeElement("body");
  const environment = createEnvironment(body);
  const alert = quotaAlert(newOutOfMessagesAlert, { attrs: { role: "alert" } });

  body.appendChild(alert);
  environment.observers.find((observer) => observer.connected).emit([
    { type: "childList", target: body, addedNodes: [alert] },
  ]);
  alert.remove();
  assert.equal(alert.isConnected, false);
  environment.window.flushTimers();

  assert.equal(alert.getAttribute(HIDDEN_ATTR), null);
});

test("rescans a characterData parent and coalesces mutation timers", () => {
  const text = new FakeText("Project activity is available.");
  const button = new FakeElement("button", { text: "升级至 Plus" });
  const alert = new FakeElement("aside", {
    attrs: { role: "alert" },
    rect: { width: 720, height: 80 },
    children: [text, button],
  });
  const environment = createEnvironment(new FakeElement("body", { children: [alert] }));
  assert.equal(alert.getAttribute(HIDDEN_ATTR), null);

  text.textContent = newOutOfMessagesAlert;
  environment.observers.find((observer) => observer.connected).emit([
    { type: "characterData", target: text, addedNodes: [] },
    { type: "characterData", target: text, addedNodes: [] },
  ]);

  assert.equal(environment.window.pendingTimerCount, 1);
  environment.window.flushTimers();
  assert.equal(alert.getAttribute(HIDDEN_ATTR), "true");
});

test("revalidates a hidden alert when nested text stops matching", () => {
  const text = new FakeText(newOutOfMessagesAlert);
  const copy = new FakeElement("div", { children: [text] });
  const button = new FakeElement("button", { text: "Upgrade" });
  const alert = new FakeElement("aside", {
    rect: { width: 720, height: 80 },
    children: [copy, button],
  });
  const environment = createEnvironment(new FakeElement("body", { children: [alert] }));
  assert.equal(alert.getAttribute(HIDDEN_ATTR), "true");

  text.textContent = "Project activity is available and the editor is ready.";
  environment.observers.find((observer) => observer.connected).emit([
    { type: "characterData", target: text, addedNodes: [] },
  ]);
  environment.window.flushTimers();

  assert.equal(alert.getAttribute(HIDDEN_ATTR), null);
  assert.equal(alert.getAttribute(HIDDEN_KIND_ATTR), null);
});

test("reinjects with one active observer and one style", () => {
  const environment = createEnvironment(new FakeElement("body"));

  environment.runScript();
  environment.window.flushTimers();

  assert.equal(environment.activeObserverCount, 1);
  assert.equal(styleCount(environment.document), 1);
});

test("scans a populated body mounted after documentElement", () => {
  const environment = createEnvironment(null, { documentElementReady: true });
  const alert = quotaAlert(newOutOfMessagesAlert);
  const body = new FakeElement("body", { children: [alert] });

  environment.mountBody(body);
  environment.window.flushTimers();

  assert.equal(alert.getAttribute(HIDDEN_ATTR), "true");
});

test("a stale API cannot destroy the current instance effects", () => {
  const alert = quotaAlert(newOutOfMessagesAlert);
  const environment = createEnvironment(new FakeElement("body", { children: [alert] }));
  const staleApi = environment.window[API_KEY];

  environment.runScript();
  environment.window.flushTimers();
  const currentApi = environment.window[API_KEY];
  staleApi.destroy();

  assert.equal(environment.window[API_KEY], currentApi);
  assert.equal(environment.activeObserverCount, 1);
  assert.equal(styleCount(environment.document), 1);
  assert.equal(alert.getAttribute(HIDDEN_ATTR), "true");
});

test("manual scan is idempotent", () => {
  const alert = quotaAlert(newOutOfMessagesAlert);
  const environment = createEnvironment(new FakeElement("body", { children: [alert] }));
  const api = environment.window[API_KEY];
  const matches = api.state.matches;

  api.scan();
  api.scan();

  assert.equal(api.state.matches, matches);
  assert.equal(environment.document.querySelectorAll(`[${HIDDEN_ATTR}="true"]`).length, 1);
  assert.equal(styleCount(environment.document), 1);
});

test("destroy removes hidden and kind markers, including stale markers", () => {
  const tracked = quotaAlert(newOutOfMessagesAlert);
  const body = new FakeElement("body", { children: [tracked] });
  const environment = createEnvironment(body);
  const stale = new FakeElement("div", {
    attrs: { [HIDDEN_ATTR]: "true", [HIDDEN_KIND_ATTR]: "quota-banner" },
  });
  const kindOnly = new FakeElement("div", {
    attrs: { [HIDDEN_KIND_ATTR]: "usage-card" },
  });
  body.appendChild(stale);
  body.appendChild(kindOnly);

  environment.window[API_KEY].destroy();

  const markerState = [tracked, stale, kindOnly].map((node) => ({
    hidden: node.getAttribute(HIDDEN_ATTR),
    kind: node.getAttribute(HIDDEN_KIND_ATTR),
  }));
  assert.deepEqual(markerState, [
    { hidden: null, kind: null },
    { hidden: null, kind: null },
    { hidden: null, kind: null },
  ]);
});

test("revalidates a detached stale marker when the node is reattached", () => {
  const alert = quotaAlert(newOutOfMessagesAlert);
  const body = new FakeElement("body", { children: [alert] });
  const environment = createEnvironment(body);
  const firstApi = environment.window[API_KEY];

  alert.remove();
  firstApi.destroy();
  alert.textContent = "Project activity is available and the editor is ready.";
  environment.runScript();
  body.appendChild(alert);
  environment.observers.find((observer) => observer.connected).emit([
    { type: "childList", target: body, addedNodes: [alert] },
  ]);
  environment.window.flushTimers();

  assert.equal(alert.getAttribute(HIDDEN_ATTR), null);
  assert.equal(alert.getAttribute(HIDDEN_KIND_ATTR), null);
});

test("destroy stops the runtime and remains safe when called twice", () => {
  const body = new FakeElement("body");
  const environment = createEnvironment(body);
  const api = environment.window[API_KEY];
  const destroy = api.destroy;
  const added = quotaAlert(newOutOfMessagesAlert);
  body.appendChild(added);
  environment.observers.find((observer) => observer.connected).emit([
    { type: "childList", target: body, addedNodes: [added] },
  ]);
  assert.equal(environment.window.pendingTimerCount, 1);

  destroy();

  assert.deepEqual(
    {
      activeObservers: environment.activeObserverCount,
      apiPresent: Object.hasOwn(environment.window, API_KEY),
      pendingTimers: environment.window.pendingTimerCount,
      styles: styleCount(environment.document),
    },
    { activeObservers: 0, apiPresent: false, pendingTimers: 0, styles: 0 }
  );
  assert.doesNotThrow(() => destroy());
});

test("does not retain persistent DOM Sets in public API state", () => {
  const environment = createEnvironment(new FakeElement("body"));
  const state = environment.window[API_KEY].state;
  const persistentSetKeys = Object.entries(state)
    .filter(
      ([key, value]) =>
        key !== "pendingRoots" && Object.prototype.toString.call(value) === "[object Set]"
    )
    .map(([key]) => key);

  assert.deepEqual(persistentSetKeys, []);
  if (Object.hasOwn(state, "pendingRoots")) assert.equal(state.pendingRoots.size, 0);
});

test("defers initialization until document roots exist and starts once", () => {
  const environment = createEnvironment(null, { autoRun: false });

  assert.doesNotThrow(() => environment.runScript());
  assert.ok(environment.window[API_KEY]);
  assert.equal(environment.activeObserverCount, 0);
  assert.equal(styleCount(environment.document), 0);

  environment.attachBody(new FakeElement("body"));
  environment.document.fire("DOMContentLoaded");
  environment.document.fire("DOMContentLoaded");
  environment.window.flushTimers();

  assert.equal(environment.activeObserverCount, 1);
  assert.equal(styleCount(environment.document), 1);
  assert.equal(environment.document.listenerCount("DOMContentLoaded"), 0);
});

test("destroy before DOMContentLoaded cancels deferred startup", () => {
  const environment = createEnvironment(null, { autoRun: false });
  assert.doesNotThrow(() => environment.runScript());
  const destroy = environment.window[API_KEY].destroy;

  destroy();
  environment.attachBody(new FakeElement("body"));
  environment.document.fire("DOMContentLoaded");
  environment.window.flushTimers();

  assert.deepEqual(
    {
      activeObservers: environment.activeObserverCount,
      apiPresent: Object.hasOwn(environment.window, API_KEY),
      pendingTimers: environment.window.pendingTimerCount,
      styles: styleCount(environment.document),
    },
    { activeObservers: 0, apiPresent: false, pendingTimers: 0, styles: 0 }
  );
});

test("does not initialize inside a child frame", () => {
  const environment = createEnvironment(new FakeElement("body"), {
    autoRun: false,
    topLevel: false,
  });

  environment.runScript();
  environment.window.flushTimers();

  assert.deepEqual(
    {
      activeObservers: environment.activeObserverCount,
      apiPresent: Object.hasOwn(environment.window, API_KEY),
      styles: styleCount(environment.document),
    },
    { activeObservers: 0, apiPresent: false, styles: 0 }
  );
});
