/**
 * One rule, from the review of 28 Aug 2026:
 *
 *   Never write a privacy claim stronger than the code and the partners
 *   actually prove.
 *
 * That rule is easy to agree with and easy to break, because the sentences
 * that break it are the ones that read best. "Nothing that identifies you is
 * sent" is a better sentence than the truth, and it shipped in the first draft
 * of this policy while `clientKey()` was reading the caller's IP address out of
 * the request headers and `checkRateLimit()` was writing it into a database.
 *
 * So the absolutes are banned by name, and the disclosures the code makes
 * necessary are required by name.
 *
 *   node scripts/check-privacy.js
 *
 * Run from apps/scanner; the pages live at the repository root.
 */
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..", "..");
const SCANNER = path.join(__dirname, "..");

const problems = [];
const ok = (what, condition) => {
  if (condition) console.log(`ok   ${what}`);
  else {
    console.log(`FAIL ${what}`);
    problems.push(what);
  }
};

const read = (p) => fs.readFileSync(p, "utf8");

/** The three pages plus the data they render from. Comments are stripped:
 *  this file argues about these phrases and must not trip its own check. */
const PAGES = [
  "app/privacy/apps.ts",
  "app/privacy/[app]/page.tsx",
  "app/terms/[app]/page.tsx",
  "app/support/[app]/page.tsx",
];

const prose = (file) =>
  read(path.join(REPO, file))
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

/* ------------------------------------------------------- the banned absolutes

   Each of these was in the shipped draft, and each is contradicted by
   something in this repository or by a partner's own documentation. */

const BANNED = [
  [/nothing that identifies you/i, "an IP address reaches the API on every request"],
  [/\bno tracking\b/i, "RevenueCat's SDK processes purchase and device data"],
  [/we keep no copy/i, "the limiter stores a key for an hour; the host keeps request logs"],
  [/nothing on our side to (delete|request)/i, "same — say what is not held, not that nothing is"],
  [/never receive the payment/i, "conflates payment processing with having no support role"],
  [/\bnot retained to train models\b/i, "a claim about a provider's retention, not ours to make"],
  [/\ban AI provider\b/i, "Apple expects the recipient named, not described"],
  // Scoped narrowly and truthfully — "reminders are local, no server is
  // involved" — this claim is fine. It is the unqualified form that is not,
  // because every app initialises the purchases SDK at launch.
  [/(contacts|there is|uses) no server/i, "every app initialises the purchases SDK"],
];

for (const file of PAGES) {
  const text = prose(file);
  for (const [pattern, why] of BANNED) {
    const hit = text.match(pattern);
    ok(
      `${path.basename(file)}: no "${pattern.source.replace(/\\b|\(|\)|\?:/g, "").slice(0, 34)}"` +
        (hit ? ` — found "${hit[0]}"; ${why}` : ""),
      !hit,
    );
  }
}

/* --------------------------------------------------- the required disclosures

   Read off the policy data rather than asserted about it: an app that gains a
   network feature or a paid plan has to gain the paragraph that describes it
   in the same edit. */

const apps = read(path.join(REPO, "app/privacy/apps.ts"));

/** The entry block for one app id, so a field can be found within it. */
const entryOf = (id) => {
  const start = apps.indexOf(`  ${id}: {`);
  if (start < 0) return null;
  const end = apps.indexOf("\n  },", start);
  return end < 0 ? null : apps.slice(start, end);
};

const IDS = ["dashlight", "goldscan", "bugscan", "womensfit", "dogtrain", "mahdar"];

// Every pack in the app declares a `pricing` block, so every policy needs the
// subscription paragraph — including the two that otherwise touch no network.
for (const id of IDS) {
  const entry = entryOf(id);
  ok(`${id}: policy exists`, Boolean(entry));
  if (!entry) continue;
  ok(`  ${id}: discloses the subscription processor`, /subscription:\s*SUBSCRIPTION/.test(entry));
  // Only the apps that call our API see a request; the two program apps do not.
  const callsApi = /kind:\s*"(scanner|audio)"/.test(entry);
  ok(
    `  ${id}: ${callsApi ? "discloses what the server sees" : "makes no server claim it does not need"}`,
    callsApi === /serverSide:\s*SERVER_SIDE/.test(entry),
  );
}

ok("the AI provider is named", /name:\s*"[A-Z]/.test(apps.slice(apps.indexOf("AI_PROVIDER"))));

/* ------------------------------------------------ the claim about the limiter

   The policy says the address is hashed. That is only true while the code
   hashes it, and the code is one edit away from not. */

const limiter = read(path.join(SCANNER, "src/rate-limit.ts"));
ok(
  "checkRateLimit hashes the caller before counting them",
  /async function digest\(/.test(limiter) &&
    /const hashed = await digest\(key\)/.test(limiter) &&
    /hitRedis\(hashed/.test(limiter) &&
    /hitMemory\(hashed/.test(limiter),
);
ok(
  "and the policy says so",
  /hashed and the hash is counted/.test(apps),
);

console.log(
  `\n${problems.length ? `${problems.length} problems.` : "Every claim on the legal pages is one the code supports."}`,
);
if (problems.length) process.exit(1);
