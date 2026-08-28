/**
 * The two rules the purchase surface must not break: never promise a trial
 * the buyer cannot have, and never sell a safety judgement.
 *
 * ---- 1. the trial ----------------------------------------------------------
 *
 * "ابدأ تجربة ٣ أيام" is a claim about the person reading it, not about the
 * plan. Apple grants one introductory offer per *subscription group*, so
 * someone who took the weekly trial and cancelled is ineligible on the yearly
 * plan too — the plan this screen preselects, at $29.99. If the button says
 * "trial" and the store charges, the money moves before anyone notices.
 *
 * The screen therefore reads eligibility from the store, next to the price.
 * Nothing about that is visible in a screenshot or a passing build: strip the
 * eligibility call out and the paywall looks identical and lies to every
 * returning customer. So the chain is asserted here instead.
 *
 * The rename to `storeTrialDays` means the typecheck already catches a screen
 * reading the trial off the pack. These are the links it cannot see.
 *
 *   node scripts/check-paywall.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ts = require(path.join(ROOT, "node_modules/typescript"));

const problems = [];
const ok = (what, condition) => {
  if (condition) console.log(`ok   ${what}`);
  else {
    console.log(`FAIL ${what}`);
    problems.push(what);
  }
};

const parse = (file) => {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  return ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true);
};

/** Every node in the tree, so a search can be written as a filter. */
function* nodes(node) {
  yield node;
  for (const child of node.getChildren()) yield* nodes(child);
}

/* ----------------------------------------------------- src/purchases.ts */

const purchases = parse("src/purchases.ts");
const all = [...nodes(purchases)];

ok(
  "purchases.ts asks the store who is eligible",
  all.some(
    (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "checkTrialOrIntroductoryPriceEligibility",
  ),
);

// A first week at $0.99 is an introductory offer too. Calling it free is the
// same false claim in a smaller font, so the zero test has to survive.
const freeTrialFn = all.find(
  (n) => ts.isFunctionDeclaration(n) && n.name && n.name.text === "freeTrialDays",
);
ok("purchases.ts still has freeTrialDays()", Boolean(freeTrialFn));
ok(
  "and it separates a free trial from a discounted intro price",
  Boolean(freeTrialFn) &&
    [...nodes(freeTrialFn)].some(
      (n) =>
        ts.isBinaryExpression(n) &&
        (n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
          n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) &&
        /\bprice\b/.test(n.left.getText(purchases)) &&
        n.right.getText(purchases) === "0",
    ),
);

// Computing eligibility and then not consulting it is the failure that leaves
// no trace: the call is there, the promise is still unconditional.
const assignments = all.filter(
  (n) => ts.isPropertyAssignment(n) && n.name.getText(purchases) === "freeTrialDays",
);
ok("an Offer carries freeTrialDays", assignments.length > 0);
ok(
  "and every one of them is gated on the eligible set",
  assignments.length > 0 &&
    assignments.every((n) => /\beligible\b/.test(n.initializer.getText(purchases))),
);

/* ------------------------------------------------------- app/paywall.tsx */

const paywall = parse("app/paywall.tsx");
const trialBinding = [...nodes(paywall)].find(
  (n) => ts.isVariableDeclaration(n) && n.name.getText(paywall) === "trialDays",
);
ok("paywall.tsx binds trialDays", Boolean(trialBinding));

const source = trialBinding?.initializer?.getText(paywall) ?? "";
ok("and takes it from the store's answer", /freeTrialDays/.test(source));
ok("and not from the pack", !/\bpack\b/.test(source));

/* --------------------------------------------- the configuration boundary */

// storeTrialDays records what to create in App Store Connect. A screen that
// reads it is promising a trial nobody asked Apple about — which is the whole
// bug, wearing a new name.
const screens = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel);
    else if (/\.tsx?$/.test(entry.name)) screens.push(rel);
  }
};
walk("app");
walk("src/components");

const leaks = screens.filter((f) =>
  fs.readFileSync(path.join(ROOT, f), "utf8").includes("storeTrialDays"),
);
ok(`no screen reads storeTrialDays (${screens.length} files)`, leaks.length === 0);
if (leaks.length) console.log(`     read by: ${leaks.join(", ")}`);

/* ------------------------------------------------- the trial-ending notice

   The notice says a charge is coming tomorrow. For someone who has already
   turned auto-renewal off, that is false — and it is the same false claim as
   promising a trial nobody can have, pointed the other way. `willRenew` is
   what separates the two, and it is one condition deep inside a function
   whose removal changes nothing visible until a customer is told they are
   about to be billed for something they cancelled. */

const currentTrialFn = all.find(
  (n) => ts.isFunctionDeclaration(n) && n.name && n.name.text === "currentTrial",
);
ok("purchases.ts exposes currentTrial()", Boolean(currentTrialFn));
ok(
  "and it only reports a trial that is actually going to be charged",
  Boolean(currentTrialFn) && /\bwillRenew\b/.test(currentTrialFn.getText(purchases)),
);

// Scheduling without cancelling first leaves yesterday's notice in place after
// the facts under it have changed.
const reminders = fs.readFileSync(path.join(ROOT, "src/reminders.ts"), "utf8");
const sync = reminders.slice(reminders.indexOf("export async function syncTrialEndingReminder"));
ok(
  "the trial notice is re-synced, not scheduled once",
  sync.includes("cancelScheduledNotificationAsync") &&
    sync.indexOf("cancelScheduledNotificationAsync") < sync.indexOf("scheduleNotificationAsync"),
);

/* ------------------------------------------------- 2. the safety judgement

   A driver stopped on the hard shoulder is asking one question: can I keep
   driving? Dash Light answers it free, forever. The report behind it — the
   cause, the cost, what breaks if they carry on — is the subscription.

   The line between the two is a single `locked` flag in the JSX, and moving
   the verdict to the wrong side of it is a one-word edit that no test would
   notice and no screenshot would show, because the paid screen looks right.
   What it would mean is a red light and no verdict for someone who has not
   paid, which is the one thing this app must never do. */

const result = parse("app/result.tsx");
const resultNodes = [...nodes(result)];

/** Is this node rendered only when the report is unlocked? */
const behindTheGate = (node) => {
  for (let n = node; n; n = n.parent) {
    if (ts.isConditionalExpression(n) && /\blocked\b/.test(n.condition.getText(result))) return true;
  }
  return false;
};

const verdict = resultNodes.find(
  (n) =>
    (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) &&
    n.tagName.getText(result) === "VerdictBand",
);
ok("result.tsx renders the VerdictBand", Boolean(verdict));
ok("and the verdict is never behind the paywall", Boolean(verdict) && !behindTheGate(verdict));

// The other half: every report panel must be behind it.
const panels = resultNodes.filter(
  (n) => ts.isConditionalExpression(n) && /active === "/.test(n.condition.getText(result)),
);
ok(`every report panel is gated (${panels.length} found)`, panels.length >= 4);
const open = panels.filter((n) => !/\blocked\b/.test(n.condition.getText(result)));
ok("and none of them renders for a free reader", open.length === 0);
if (open.length) {
  for (const n of open) console.log(`     ungated: ${n.condition.getText(result)}`);
}

// One free scan. The number is the business model; a stray edit to it is the
// difference between selling a report and giving two away.
const storage = fs.readFileSync(path.join(ROOT, "src/storage.ts"), "utf8");
const free = storage.match(/export const FREE_SCANS = (\d+);/);
ok(`FREE_SCANS is 1 (found ${free?.[1] ?? "nothing"})`, free?.[1] === "1");

/* --------------------------------------------------------------- report */

console.log(
  `\n${problems.length ? `${problems.length} problems.` : "The trial is only promised to someone who can have it, and the verdict is never sold."}`,
);
if (problems.length) process.exit(1);
