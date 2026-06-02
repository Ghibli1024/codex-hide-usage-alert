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

const newOutOfMessagesAlert = [
  "You’re out of Codex messages",
  "Your rate limit resets on Jul 1, 2026, 4:45 PM.",
  "To continue using Codex and get access to GPT-5.3-Codex, start your free trial of Plus today.",
].join(" ");

const cases = [
  {
    name: "matches the new Codex out-of-messages alert",
    text: newOutOfMessagesAlert,
    banner: true,
    reset: true,
  },
];

let failed = false;

for (const item of cases) {
  const banner = quotaBannerRe.test(item.text);
  const reset = quotaResetRe.test(item.text);

  if (banner !== item.banner || reset !== item.reset) {
    failed = true;
    console.error(`FAIL ${item.name}`);
    console.error(`  expected banner=${item.banner}, reset=${item.reset}`);
    console.error(`  actual   banner=${banner}, reset=${reset}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`PASS ${cases.length} matcher case(s)`);
