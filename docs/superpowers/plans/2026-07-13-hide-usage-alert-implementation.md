# Hide Usage Alert 0.1.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 ChatGPT/Codex 合并后额度横幅与 composer 共处时输入框被误隐藏的问题，并把相同的 0.1.4 脚本交付到独立仓库、Script Market 和本机安装目录。

**Architecture:** 脚本只隐藏经过文本、语义和尺寸共同确认的最小提醒表面；任何候选只要自身是 composer/form/input/editable，或包含这些保护节点，就 fail closed。首次运行做一次完整候选扫描，后续 observer 只把变更节点放进待扫描集合，`destroy()` 通过 DOM marker 清理全部副作用，不保存已隐藏节点的强引用。

**Tech Stack:** 原生 JavaScript IIFE、Node.js `vm` 测试、手写最小 Fake DOM、MutationObserver、SHA-256、Chrome DevTools Protocol。

---

## File Map

- Modify: `hide-usage-alert.js` - 0.1.4 唯一源脚本，负责候选识别、保护边界、局部扫描和生命周期。
- Modify: `test-matchers.js` - 无第三方依赖的行为测试，真实执行完整 IIFE。
- Modify: `README.md` - 记录 0.1.4 的 composer 保护、测试命令和实施计划入口。
- Create: `docs/superpowers/plans/2026-07-13-hide-usage-alert-implementation.md` - 本实施计划。
- Modify: sibling repo `../CodexPlusPlusScriptMarket/scripts/hide-usage-alert.js` - 与独立仓库脚本逐字节一致。
- Modify: sibling repo `../CodexPlusPlusScriptMarket/index.json` - 将 Market 条目升级到 0.1.4 并写入真实 SHA-256。
- Replace after backup: `/Users/Totoro/.config/Codex++/user_scripts/market-hide-usage-alert.js` - 本机安装副本。
- Modify: `/Users/Totoro/Documents/Codex/runbooks/README.md` - 加入本问题的 runbook 入口。
- Create: `/Users/Totoro/Documents/Codex/runbooks/codexplusplus-hide-usage-alert.md` - 后续重复回归的诊断、发布和验收手册。

### Task 1: Add the merged composer regression in RED

**Files:**
- Modify: `test-matchers.js`
- Test: `test-matchers.js`

- [ ] **Step 1: Replace the one-off DOM fixture with a reusable Fake DOM harness**

Keep the existing regex cases, then add a selector-aware element and environment factory. The harness must execute the production IIFE, not copied matcher logic:

```js
class FakeElement {
  constructor(tagName = "div", { text = "", attrs = {}, rect = {}, children = [] } = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.textContent = text;
    this.innerText = text;
    this.parentElement = null;
    this.attributes = new Map(Object.entries(attrs).map(([key, value]) => [key, String(value)]));
    this.rect = {
      width: 360, height: 120, top: 600, bottom: 720, left: 700, right: 1060,
      ...rect,
    };
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  getBoundingClientRect() { return this.rect; }
  getAttribute(name) { return this.attributes.get(name) || null; }
  hasAttribute(name) { return this.attributes.has(name); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }

  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (node.matches(selector)) return node;
    }
    return null;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    return descendantsOf(this).filter((node) => node.matches(selector));
  }
}

function createEnvironment(body) {
  const observers = [];
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
    emit(mutations) { if (this.connected) this.callback(mutations); }
  }

  const documentElement = new FakeElement("html", { children: [body] });
  const document = createFakeDocument(documentElement, body);
  const window = createFakeWindow();
  const context = { Node: { ELEMENT_NODE: 1 }, MutationObserver: FakeMutationObserver, document, window };
  window.window = window;
  window.self = window;
  window.top = window;
  vm.runInNewContext(source, context);
  return { context, document, window, observers };
}
```

`matchesSelector`, `descendantsOf`, `createFakeDocument` and `createFakeWindow` must support only selectors and timer/event behavior used by this script. Do not introduce jsdom or a package manifest for this single-file project.

- [ ] **Step 2: Add the exact ChatGPT/Codex merged-layout regression**

```js
test("hides the quota aside without hiding its composer sibling or shared layout", () => {
  const alert = quotaAlert("你的 Codex 和工作使用额度已用完 升级至 Pro 重置使用量");
  const composer = new FakeElement("div", {
    attrs: { "data-codex-composer": "true", contenteditable: "true" },
    rect: { width: 720, height: 110 },
  });
  const layout = new FakeElement("div", { children: [alert, composer], rect: { width: 760, height: 210 } });
  const composerRoot = new FakeElement("div", {
    attrs: { "data-codex-composer-root": "true" },
    children: [layout],
    rect: { width: 800, height: 240 },
  });

  createEnvironment(new FakeElement("body", { children: [composerRoot] }));

  assert.equal(alert.getAttribute(HIDDEN_ATTR), "true");
  assert.equal(layout.getAttribute(HIDDEN_ATTR), null);
  assert.equal(composerRoot.getAttribute(HIDDEN_ATTR), null);
  assert.equal(composer.getAttribute(HIDDEN_ATTR), null);
});
```

- [ ] **Step 3: Run the test and verify the old implementation fails for the right reason**

Run:

```bash
node test-matchers.js
```

Expected: `FAIL hides the quota aside without hiding its composer sibling or shared layout`; the old 0.1.3 implementation marks `layout` or `composerRoot`, proving the test catches the reported regression rather than a harness error.

- [ ] **Step 4: Commit only the RED test**

```bash
git add test-matchers.js
git commit -m "test: reproduce composer quota banner regression"
```

### Task 2: Protect composer surfaces and hide only the alert surface

**Files:**
- Modify: `hide-usage-alert.js`
- Test: `test-matchers.js`

- [ ] **Step 1: Add table-driven protection tests before implementation**

```js
for (const fixture of [
  ["composer root", "div", { "data-codex-composer-root": "true" }],
  ["composer", "div", { "data-codex-composer": "true" }],
  ["editable", "div", { contenteditable: "true" }],
  ["textarea", "textarea", {}],
  ["input", "input", {}],
  ["form", "form", {}],
]) {
  test(`never hides a quota candidate containing ${fixture[0]}`, () => {
    const protectedNode = new FakeElement(fixture[1], { attrs: fixture[2] });
    const candidate = quotaCandidateWith(protectedNode);
    createEnvironment(new FakeElement("body", { children: [candidate] }));
    assert.equal(candidate.getAttribute(HIDDEN_ATTR), null);
  });
}
```

Run `node test-matchers.js` and expect these new cases to fail on 0.1.3 because the broad candidate text includes protected descendants.

- [ ] **Step 2: Implement the minimal protection boundary and delete parent promotion**

In `hide-usage-alert.js`, use these exact boundaries:

```js
const SCRIPT_VERSION = "0.1.4";
const PROTECTED_SELECTOR = [
  "[data-codex-composer-root]",
  "[data-codex-composer]",
  "[contenteditable]",
  "textarea",
  "input",
  "form",
].join(",");

function isProtectedSurface(node) {
  if (!isElement(node)) return false;
  return node.matches(PROTECTED_SELECTOR) || !!node.querySelector(PROTECTED_SELECTOR);
}

function hideNode(node, kind) {
  if (!isElement(node) || node === document.body || node === document.documentElement) return false;
  if (isProtectedSurface(node) || insideConversationContent(node)) return false;
  node.setAttribute(HIDDEN_ATTR, "true");
  node.setAttribute(`${HIDDEN_ATTR}-kind`, kind);
  state.matches += 1;
  return true;
}
```

Remove `quotaBannerRoot()` and the generic `parentElement` promotion. Keep the protection check both in `looksLikeQuotaBanner` / `looksLikeUsageCard` and in `hideNode` so a future matcher cannot bypass it. Update `quotaBannerRe` to match the merged Chinese copy `你的 Codex 和工作使用额度已用完`.

- [ ] **Step 3: Put text checks before geometry reads**

```js
function candidateText(node) {
  return isElement(node) ? normalizeText(node.textContent || "") : "";
}

function looksLikeQuotaBanner(node) {
  if (isProtectedSurface(node) || insideConversationContent(node)) return false;
  const text = candidateText(node);
  if (text.length < 20 || text.length > 420) return false;
  if (!quotaBannerRe.test(text) || !quotaResetRe.test(text)) return false;
  if (!hasAction(node, text)) return false;
  return bannerBox(node);
}
```

Apply the same cheap-text-first order to usage cards.

- [ ] **Step 4: Run the focused suite and verify GREEN**

Run:

```bash
node test-matchers.js
node --check hide-usage-alert.js
```

Expected: all matcher, merged-layout and protected-surface cases pass; syntax check exits 0.

- [ ] **Step 5: Commit the minimal fix**

```bash
git add hide-usage-alert.js test-matchers.js
git commit -m "fix: protect composer from usage alert hiding"
```

### Task 3: Preserve legacy behavior and reject quoted messages

**Files:**
- Modify: `test-matchers.js`
- Modify: `hide-usage-alert.js` only if a RED case requires it
- Test: `test-matchers.js`

- [ ] **Step 1: Add compatibility cases before changing production code**

```js
test("hides a legacy bottom quota banner", () => {
  const banner = quotaBanner("You’re out of Codex messages Your rate limit resets on Jul 1 Upgrade to Plus");
  createEnvironment(new FakeElement("body", { children: [banner] }));
  assert.equal(banner.getAttribute(HIDDEN_ATTR), "true");
});

test("hides a legacy usage status card", () => {
  const card = usageCard("剩余 0% 使用量 重置频率 下次重置时间 升级");
  createEnvironment(new FakeElement("body", { children: [card] }));
  assert.equal(card.getAttribute(HIDDEN_ATTR), "true");
});

test("hides a bare subagent quota card", () => {
  const card = quotaCard("你的 Codex 消息限额已用尽 你的额度将于 08:25 重置 增加额度");
  createEnvironment(new FakeElement("body", { children: [card] }));
  assert.equal(card.getAttribute(HIDDEN_ATTR), "true");
});

test("does not hide a message quoting quota copy", () => {
  const message = quotaCandidate("You’re out of Codex messages Your rate limit resets on Jul 1 Upgrade to Plus", {
    "data-message-author-role": "user",
  });
  createEnvironment(new FakeElement("body", { children: [message] }));
  assert.equal(message.getAttribute(HIDDEN_ATTR), null);
});
```

- [ ] **Step 2: Run RED/GREEN honestly**

Run `node test-matchers.js`. Existing preserved behavior may already be GREEN; any failing compatibility case must be fixed with the smallest matcher/candidate-selector change, then rerun. Do not weaken `isProtectedSurface()` or the message-content guard to make compatibility pass.

- [ ] **Step 3: Commit compatibility coverage**

```bash
git add hide-usage-alert.js test-matchers.js
git commit -m "test: preserve legacy usage alert matching"
```

### Task 4: Make scanning incremental and lifecycle cleanup complete

**Files:**
- Modify: `test-matchers.js`
- Modify: `hide-usage-alert.js`
- Test: `test-matchers.js`

- [ ] **Step 1: Add lifecycle and mutation tests in RED**

Add tests that instrument `querySelectorAll`, observer instances and event listeners:

```js
test("scans only the added subtree after initial scan", () => {
  const body = new FakeElement("body");
  const env = createEnvironment(body);
  const untouched = new FakeElement("section");
  body.appendChild(untouched);
  untouched.queryCount = 0;
  const added = quotaAlert("你的 Codex 和工作使用额度已用完 升级至 Pro 重置使用量");
  body.appendChild(added);
  env.observers[0].emit([{ type: "childList", target: body, addedNodes: [added] }]);
  env.window.flushTimers();
  assert.equal(added.getAttribute(HIDDEN_ATTR), "true");
  assert.equal(untouched.queryCount, 0);
});

test("reinjects with one connected observer", () => {
  const env = createEnvironment(new FakeElement("body"));
  vm.runInNewContext(source, env.context);
  assert.equal(env.observers.filter((observer) => observer.connected).length, 1);
});

test("destroy restores all markers, style, timer, observer and API", () => {
  const banner = quotaAlert("你的 Codex 和工作使用额度已用完 升级至 Pro 重置使用量");
  const env = createEnvironment(new FakeElement("body", { children: [banner] }));
  env.window.__codexPlusHideUsageAlert.destroy();
  assert.equal(banner.getAttribute(HIDDEN_ATTR), null);
  assert.equal(banner.getAttribute(`${HIDDEN_ATTR}-kind`), null);
  assert.equal(env.document.getElementById(STYLE_ID), null);
  assert.equal(env.observers.filter((observer) => observer.connected).length, 0);
  assert.equal(env.window.__codexPlusHideUsageAlert, undefined);
});

test("waits for DOMContentLoaded when documentElement is absent", () => {
  const env = createEnvironmentWithoutDocumentRoot();
  assert.doesNotThrow(() => vm.runInNewContext(source, env.context));
  env.attachDocument(new FakeElement("body"));
  env.fire("DOMContentLoaded");
  assert.equal(env.observers.filter((observer) => observer.connected).length, 1);
});

test("does nothing in a child frame", () => {
  const env = createEnvironment(new FakeElement("body"), { childFrame: true });
  assert.equal(env.observers.length, 0);
  assert.equal(env.window.__codexPlusHideUsageAlert, undefined);
});
```

Run `node test-matchers.js`; verify at least the local-scan, complete destroy and early-injection tests fail on the pre-lifecycle implementation for the expected assertions.

- [ ] **Step 2: Implement local pending-root scanning**

```js
const state = {
  observer: null,
  timer: 0,
  readyHandler: null,
  pendingRoots: new Set(),
  scans: 0,
  matches: 0,
};

function queueRoot(node) {
  const root = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  if (root) state.pendingRoots.add(root);
}

function flushPending() {
  state.timer = 0;
  const roots = Array.from(state.pendingRoots);
  state.pendingRoots.clear();
  roots.forEach(scanRoot);
}

function observeMutations(mutations) {
  for (const mutation of mutations) {
    if (mutation.type === "characterData") queueRoot(mutation.target);
    for (const node of mutation.addedNodes || []) queueRoot(node);
  }
  if (state.pendingRoots.size) scheduleFlush();
}
```

`scanRoot(root)` must collect candidates only from `root` and its descendants, in this order: `aside`; semantic alert/status/live nodes; legacy `header, section, div` nodes. Initial startup calls `scanRoot(document.body || document.documentElement)` exactly once; observer callbacks never call a full-document `scan()`.

- [ ] **Step 3: Implement top-frame, early DOM, reinjection and destroy semantics**

```js
if (window.top && window.self && window.top !== window.self) return;

function destroy() {
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = 0;
  state.observer?.disconnect();
  state.observer = null;
  state.pendingRoots.clear();
  if (state.readyHandler) document.removeEventListener("DOMContentLoaded", state.readyHandler);
  state.readyHandler = null;
  document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((node) => {
    node.removeAttribute(HIDDEN_ATTR);
    node.removeAttribute(`${HIDDEN_ATTR}-kind`);
  });
  document.getElementById(STYLE_ID)?.remove();
  if (window[API_KEY]?.version === SCRIPT_VERSION) delete window[API_KEY];
}

function start() {
  const root = document.body || document.documentElement;
  if (!root || !document.documentElement) return false;
  installStyle();
  scanRoot(root);
  installObserver(root);
  return true;
}

if (!start()) {
  state.readyHandler = () => {
    state.readyHandler = null;
    start();
  };
  document.addEventListener("DOMContentLoaded", state.readyHandler, { once: true });
}
```

The public `scan(root = document.body || document.documentElement)` calls `scanRoot(root)` explicitly for diagnostics; it must not change observer behavior.

- [ ] **Step 4: Verify GREEN and syntax**

```bash
node test-matchers.js
node --check hide-usage-alert.js
```

Expected: all matcher, protection, compatibility, mutation and lifecycle cases pass with no warnings.

- [ ] **Step 5: Update README and commit 0.1.4**

Document that 0.1.4 protects composer/form/editable surfaces, performs local mutation scans, and can be tested with `node test-matchers.js`.

```bash
git add hide-usage-alert.js test-matchers.js README.md
git commit -m "perf: scan usage alerts incrementally"
```

### Task 5: Sync Script Market 0.1.4 and verify the digest

**Files:**
- Modify: `../CodexPlusPlusScriptMarket/scripts/hide-usage-alert.js`
- Modify: `../CodexPlusPlusScriptMarket/index.json`

- [ ] **Step 1: Copy the verified source into the Market worktree**

```bash
cp hide-usage-alert.js ../CodexPlusPlusScriptMarket/scripts/hide-usage-alert.js
```

- [ ] **Step 2: Calculate the digest from the copied bytes**

```bash
shasum -a 256 hide-usage-alert.js ../CodexPlusPlusScriptMarket/scripts/hide-usage-alert.js
```

Expected: both lines have the same digest. Record that exact lowercase digest; never precompute or hand-type a guessed hash.

- [ ] **Step 3: Update only the `hide-usage-alert` Market object**

Store the digest in a shell variable and update the matching object with `jq`, including the Market's top-level timestamp convention:

```bash
market=../CodexPlusPlusScriptMarket
digest="$(shasum -a 256 "$market/scripts/hide-usage-alert.js" | awk '{print $1}')"
updated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq --arg digest "$digest" --arg updated_at "$updated_at" '
  .updated_at = $updated_at
  | (.scripts[] | select(.id == "hide-usage-alert") | .version) = "0.1.4"
  | (.scripts[] | select(.id == "hide-usage-alert") | .sha256) = $digest
' "$market/index.json" > "$market/index.json.tmp"
mv "$market/index.json.tmp" "$market/index.json"
```

Preserve every other field and entry in `index.json`; do not change another script's metadata.

- [ ] **Step 4: Validate script, JSON and metadata-to-file hash**

```bash
node --check ../CodexPlusPlusScriptMarket/scripts/hide-usage-alert.js
jq empty ../CodexPlusPlusScriptMarket/index.json
test "$(jq -r '.scripts[] | select(.id == "hide-usage-alert") | .version' ../CodexPlusPlusScriptMarket/index.json)" = "0.1.4"
test "$(jq -r '.scripts[] | select(.id == "hide-usage-alert") | .sha256' ../CodexPlusPlusScriptMarket/index.json)" = "$(shasum -a 256 ../CodexPlusPlusScriptMarket/scripts/hide-usage-alert.js | awk '{print $1}')"
cmp -s hide-usage-alert.js ../CodexPlusPlusScriptMarket/scripts/hide-usage-alert.js
```

Expected: every command exits 0.

- [ ] **Step 5: Commit the Market update locally**

```bash
git -C ../CodexPlusPlusScriptMarket add scripts/hide-usage-alert.js index.json
git -C ../CodexPlusPlusScriptMarket commit -m "fix(hide-usage-alert): protect merged composer"
```

Do not push either repository without separate user authorization.

### Task 6: Install locally, verify in ChatGPT, and document the runbook

**Files:**
- Replace after backup: `/Users/Totoro/.config/Codex++/user_scripts/market-hide-usage-alert.js`
- Preserve/temporarily edit: `/Users/Totoro/.config/Codex++/user_scripts.json`
- Create: `/Users/Totoro/Documents/Codex/runbooks/codexplusplus-hide-usage-alert.md`
- Modify: `/Users/Totoro/Documents/Codex/runbooks/README.md`

- [ ] **Step 1: Recheck the live source of truth before mutation**

```bash
shasum -a 256 /Users/Totoro/.config/Codex++/user_scripts/market-hide-usage-alert.js
jq '{enabled, hide_usage_alert: .scripts["user:market-hide-usage-alert.js"]}' /Users/Totoro/.config/Codex++/user_scripts.json
curl --noproxy '*' -sS --max-time 3 http://127.0.0.1:57321/backend/status
curl --noproxy '*' -sS --max-time 3 http://127.0.0.1:9229/json/list | jq '[.[] | select(.type == "page") | {id,title,url,webSocketDebuggerUrl}]'
```

Require a unique main target with exact URL `app://-/index.html`. If it is absent, stop live injection and follow `codexplusplus-userscript-reload.md`; do not inject into avatar overlay or quick-chat prewarm.

- [ ] **Step 2: Make timestamped backups and install the verified bytes while disabled**

```bash
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
cp -p /Users/Totoro/.config/Codex++/user_scripts/market-hide-usage-alert.js "/Users/Totoro/.config/Codex++/user_scripts/market-hide-usage-alert.js.bak-v0.1.3-a120c224-${stamp}"
cp -p /Users/Totoro/.config/Codex++/user_scripts.json "/Users/Totoro/.config/Codex++/user_scripts.json.bak-before-hide-usage-alert-0.1.4-${stamp}"
cp hide-usage-alert.js /Users/Totoro/.config/Codex++/user_scripts/market-hide-usage-alert.js
chmod 0644 /Users/Totoro/.config/Codex++/user_scripts/market-hide-usage-alert.js
```

Do not enable the persistent script before the temporary injection passes.

- [ ] **Step 3: Verify all three delivered scripts are byte-identical**

```bash
cmp -s hide-usage-alert.js ../CodexPlusPlusScriptMarket/scripts/hide-usage-alert.js
cmp -s hide-usage-alert.js /Users/Totoro/.config/Codex++/user_scripts/market-hide-usage-alert.js
shasum -a 256 hide-usage-alert.js ../CodexPlusPlusScriptMarket/scripts/hide-usage-alert.js /Users/Totoro/.config/Codex++/user_scripts/market-hide-usage-alert.js
```

Expected: `cmp` exits 0 and all three hashes are identical to the Market metadata.

- [ ] **Step 4: Temporarily inject into only the exact CDP main target**

Use a short Node WebSocket CDP helper or the existing verified CDP client. First destroy any prior API, then evaluate the exact contents of `hide-usage-alert.js`. Collect this structured result:

```js
(() => {
  const api = window.__codexPlusHideUsageAlert;
  const composer = document.querySelector("[data-codex-composer]");
  const composerRect = composer?.getBoundingClientRect();
  const hidden = [...document.querySelectorAll("[data-codex-plus-hidden-usage-alert='true']")];
  return {
    version: api?.version,
    hiddenCount: hidden.length,
    hiddenKinds: hidden.map((node) => node.getAttribute("data-codex-plus-hidden-usage-alert-kind")),
    hiddenContainsComposer: hidden.some((node) => !!node.querySelector("[data-codex-composer], [contenteditable], textarea, input, form")),
    composer: {
      exists: !!composer,
      contenteditable: composer?.getAttribute("contenteditable"),
      display: composer ? getComputedStyle(composer).display : null,
      visibility: composer ? getComputedStyle(composer).visibility : null,
      width: composerRect?.width || 0,
      height: composerRect?.height || 0,
    },
  };
})()
```

Require: version `0.1.4`; at least one live quota alert hidden when the banner is present; `hiddenContainsComposer=false`; composer exists, remains contenteditable, is not `display:none`/`visibility:hidden`, and has non-zero width/height.

- [ ] **Step 5: Verify `destroy()` restores the page completely**

Evaluate `window.__codexPlusHideUsageAlert.destroy()` and then require:

```js
({
  apiGone: !window.__codexPlusHideUsageAlert,
  markerCount: document.querySelectorAll("[data-codex-plus-hidden-usage-alert]").length,
  kindCount: document.querySelectorAll("[data-codex-plus-hidden-usage-alert-kind]").length,
  styleGone: !document.getElementById("codex-plus-hide-usage-alert-style"),
  composerVisible: (() => {
    const node = document.querySelector("[data-codex-composer]");
    const rect = node?.getBoundingClientRect();
    return !!node && getComputedStyle(node).display !== "none" && rect.width > 0 && rect.height > 0;
  })(),
})
```

Require: `apiGone=true`, both marker counts 0, `styleGone=true`, `composerVisible=true`.

- [ ] **Step 6: Enable the local script only after temporary verification passes**

Set only `.scripts["user:market-hide-usage-alert.js"] = true` with a structured JSON editor, preserve the global `enabled` value, then call Codex++ user-script reload rather than `Page.reload`. Re-run the Step 4 assertions against the persistent instance.

If any assertion fails: call `destroy()`, restore both timestamped backups, keep the per-script key false, and report the failing assertion.

- [ ] **Step 7: Write and index the repeatable runbook**

The new runbook must capture: symptom, exact DOM root cause, source/Market/local paths, RED regression command, protection selectors, byte/hash sync, unique CDP target selection, temporary injection, persistent reload, rollback and no-push boundary. Add one concise index line to `/Users/Totoro/Documents/Codex/runbooks/README.md`.

- [ ] **Step 8: Final verification and review**

```bash
node test-matchers.js
node --check hide-usage-alert.js
node --check ../CodexPlusPlusScriptMarket/scripts/hide-usage-alert.js
jq empty ../CodexPlusPlusScriptMarket/index.json
git status --short --branch
git -C ../CodexPlusPlusScriptMarket status --short --branch
```

Run a final spec-compliance review, then a code-quality review. Confirm no unrelated files changed and no remote push occurred.
