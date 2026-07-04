const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("hide-usage-alert.js", "utf8");

function loadRegex(name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([\\s\\S]*?);`));
  if (!match) {
    throw new Error(`Cannot find ${name}`);
  }
  return vm.runInNewContext(match[1]);
}

const quotaBannerRe = loadRegex("quotaBannerRe");
const quotaResetRe = loadRegex("quotaResetRe");
const actionTextRe = loadRegex("actionTextRe");

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

const cases = [
  {
    name: "matches the new Codex out-of-messages alert",
    text: newOutOfMessagesAlert,
    banner: true,
    reset: true,
    action: true,
  },
  {
    name: "matches the subagent quota card",
    text: subagentQuotaCard,
    banner: true,
    reset: true,
    action: true,
  },
];

let failed = false;

for (const item of cases) {
  const banner = quotaBannerRe.test(item.text);
  const reset = quotaResetRe.test(item.text);
  const action = actionTextRe.test(item.text);

  if (banner !== item.banner || reset !== item.reset || action !== item.action) {
    failed = true;
    console.error(`FAIL ${item.name}`);
    console.error(`  expected banner=${item.banner}, reset=${item.reset}, action=${item.action}`);
    console.error(`  actual   banner=${banner}, reset=${reset}, action=${action}`);
  }
}

class FakeElement {
  constructor({ text = "", rect = {}, children = [] } = {}) {
    this.nodeType = 1;
    this.innerText = text;
    this.textContent = text;
    this.rect = {
      width: 360,
      height: 160,
      top: 600,
      bottom: 760,
      left: 700,
      right: 1060,
      ...rect,
    };
    this.children = children;
    this.parentElement = null;
    this.attributes = new Map();
    for (const child of children) {
      child.parentElement = this;
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  closest() {
    return null;
  }

  querySelector() {
    return null;
  }

  querySelectorAll(selector) {
    if (selector.includes("button")) {
      return this.children.filter((child) => child.tagName === "BUTTON" || child.getAttribute("role") === "button");
    }
    return [];
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

function assertSubagentQuotaCardHidden() {
  const button = new FakeElement({ text: "增加额度", rect: { width: 80, height: 32 } });
  button.tagName = "BUTTON";

  const quotaCard = new FakeElement({
    text: subagentQuotaCard,
    rect: { width: 360, height: 160 },
    children: [button],
  });
  const body = new FakeElement({ children: [quotaCard] });
  body.querySelectorAll = () => [quotaCard];

  const context = {
    Node: { ELEMENT_NODE: 1 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    document: {
      body,
      documentElement: new FakeElement(),
      createElement() {
        return new FakeElement();
      },
      getElementById() {
        return null;
      },
      addEventListener(_event, callback) {
        callback();
      },
    },
    window: {
      innerHeight: 900,
      innerWidth: 1200,
      setTimeout(callback) {
        callback();
        return 1;
      },
      clearTimeout() {},
    },
  };

  vm.runInNewContext(source, context);

  if (quotaCard.getAttribute("data-codex-plus-hidden-usage-alert") !== "true") {
    failed = true;
    console.error("FAIL hides the subagent quota card");
  }
}

assertSubagentQuotaCardHidden();

if (failed) {
  process.exit(1);
}

console.log(`PASS ${cases.length} matcher case(s) and 1 DOM scan case`);
