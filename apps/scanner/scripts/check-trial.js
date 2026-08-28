/**
 * The paywall's one promise that costs money to break.
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
 *   node scripts/check-trial.js
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

/* --------------------------------------------------------------- report */

console.log(
  `\n${problems.length ? `${problems.length} problems.` : "The trial is only ever promised to someone the store says can have it."}`,
);
if (problems.length) process.exit(1);
