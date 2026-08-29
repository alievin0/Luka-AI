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
// Apple grants one introductory offer per subscription group. A trial line
// computed from the selected row describes one offer per plan — two offers
// that do not exist — and changes as someone taps between them.
ok("and not from whichever plan is selected", !/\bselected\b/.test(source));

/* ------------------------------------------------------- the price's origin

   The pack's own prices are the App Store's US ones. RevenueCat returns the
   reader's storefront price, and where it has not answered the paywall falls
   back to the pack — correct in Ohio and wrong everywhere else. A dollar sign
   in front of a buyer in Kuwait is a price they will not be charged, so the
   fallback has to be labelled. `fromStore` is what remembers which it is. */

const priceNote = [...nodes(paywall)].find(
  (n) =>
    ts.isJsxExpression(n) &&
    /styles\.priceNote/.test(n.getText(paywall)) &&
    /fromStore/.test(n.getText(paywall)),
);
ok("the paywall says which currency a fallback price is in", Boolean(priceNote));

const row = [...nodes(paywall)].find(
  (n) => ts.isPropertyAssignment(n) && n.name.getText(paywall) === "fromStore",
);
ok(
  "and decides it from whether the store answered, not from a guess",
  Boolean(row) && /\boffer\b/.test(row.initializer.getText(paywall)),
);

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

/* --------------------------------------------------- value before the queue

   A scanner's onboarding is language and the AI disclosure, and nothing else.
   The car questions moved to the first result, where the driver has an answer
   in front of them and is being offered a sharper one. Putting them back in
   front of the camera is a one-line edit that no test would otherwise catch,
   and it costs the thing this app is for: someone on the hard shoulder gets
   seven questions instead of a verdict. */

const onboarding = fs.readFileSync(path.join(ROOT, "app/onboarding.tsx"), "utf8");
ok(
  "a scanner asks nothing before the first scan",
  /const asksUpFront = !isScanner\(pack\);/.test(onboarding) &&
    /questions = asksUpFront \? pack\.onboarding : \[\]/.test(onboarding),
);
ok(
  "and the language is offered on that first screen",
  /languageChoices\(\)/.test(onboarding) && /switchLanguage\(/.test(onboarding),
);


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

/* Where the notice lands.

   Every other notification in this app is an invitation — miss it and you
   have missed nothing. This one is a deadline, and it is the only screen in
   Dash Light where being dropped in the wrong place costs the reader money:
   told a charge is coming tomorrow, and left on the camera with the setting
   that stops it unnamed and two taps away.

   The route rides in the notification's payload, so nothing but the payload
   proves it is there — a `data` block is easy to drop in an edit that looks
   like it is only changing wording, and the loss is invisible until the day
   someone taps. */

const trialRoute = sync.match(/route:\s*"([^"]+)"/)?.[1] ?? null;
ok(
  `the trial notice carries the screen it is about (${trialRoute ?? "no route"})`,
  trialRoute === "/settings",
);

const layout = fs.readFileSync(path.join(ROOT, "app/_layout.tsx"), "utf8");
ok(
  "and a tap on it is heard, warm and cold",
  layout.includes("addNotificationResponseReceivedListener") &&
    layout.includes("getLastNotificationResponseAsync"),
);
// A route out of a notification payload is data. Handing it to the router
// unread would make any process that can post a notification a navigator.
ok(
  "and the route is matched against a list, not handed to the router",
  /\brouteOfNotification\(/.test(layout) &&
    /const ROUTES = \[/.test(reminders) &&
    /ROUTES as readonly string\[\]\)\.includes\(route\)/.test(reminders),
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

// Two free scans, verdict-only. The number is set against Signal's free tier;
// the depth is what keeps it from being the product.
const storage = fs.readFileSync(path.join(ROOT, "src/storage.ts"), "utf8");
const free = storage.match(/export const FREE_SCANS = (\d+);/);
ok(`FREE_SCANS is 2 (found ${free?.[1] ?? "nothing"})`, free?.[1] === "2");

/* ------------------------------------------------------------- the archive

   The history gate sells the archive and never the answer. Two ways in — the
   list, and a `?id=` route straight to one entry — so both are asserted; a
   lock on one with the other left open is not a gate. */

const freeHistory = storage.match(/export const FREE_HISTORY = (\d+);/);
ok(`FREE_HISTORY is 2 (found ${freeHistory?.[1] ?? "nothing"})`, freeHistory?.[1] === "2");

const historySrc = fs.readFileSync(path.join(ROOT, "app/(tabs)/history.tsx"), "utf8");
ok(
  "the history list slices to FREE_HISTORY for a free reader",
  /pro \? filtered : filtered\.slice\(0, FREE_HISTORY\)/.test(historySrc),
);
// isPro() read once on mount leaves a buyer looking at the lock they just
// paid to remove; every other gated screen here re-reads on focus.
ok(
  "and re-reads the entitlement on focus, not once on mount",
  /useFocusEffect\([\s\S]{0,200}isPro\(\)/.test(historySrc),
);

const resultSrc = fs.readFileSync(path.join(ROOT, "app/result.tsx"), "utf8");
ok(
  "opening an entry by id applies the same rule",
  /subscribed \|\| index < FREE_HISTORY/.test(resultSrc),
);
// An older scan is saved and real. Reporting it missing would be untrue as
// well as unhelpful, so it gets its own answer.
ok(
  "and a locked entry offers the way in rather than reporting it missing",
  /lockedByHistory/.test(resultSrc) && /ui\.unlockHistory/.test(resultSrc),
);

/* The roadside decision is the safety half of the answer and the reason the
   app is not another symbol reader. It goes free for the same reason the
   verdict does, and it is one `locked` away from not being. */
// `safePlaceQuestion` appears exactly once and only inside the roadside card,
// so it locates the block without matching the paid panels — `Step` does not,
// because the paid "what to do" list renders Steps too.
const safeQ = resultNodes.filter(
  (n) => ts.isPropertyAccessExpression(n) && n.name.text === "safePlaceQuestion",
);
ok(`result.tsx renders the roadside decision (${safeQ.length} anchor)`, safeQ.length === 1);
ok("and it is never behind the paywall", safeQ.length === 1 && !behindTheGate(safeQ[0]));

// The symptom override is the strongest safety statement the app makes, and
// the only one informed by something the photo could not show. It is asked on
// every result, including the reassuring ones — a driver told "no need to
// stop" who can smell burning is who this app could most easily get hurt.
const symptom = resultNodes.filter(
  (n) => ts.isPropertyAccessExpression(n) && n.name.text === "symptomStopTitle",
);
ok(`result.tsx asks about symptoms (${symptom.length} anchor)`, symptom.length === 1);
ok(
  "and the override is never behind the paywall",
  symptom.length === 1 && !behindTheGate(symptom[0]),
);

// The questions are worth asking only because the answer is already free.
const sharpen = resultNodes.filter(
  (n) => ts.isPropertyAccessExpression(n) && n.name.text === "sharpenTitle",
);
ok(`the result asks for the car (${sharpen.length} anchor)`, sharpen.length === 1);
ok("and does not ask from behind the paywall", sharpen.length === 1 && !behindTheGate(sharpen[0]));


/* The decision hierarchy. A reported symptom outranks the photo, and the model
   never saw it — so the override is the screen's job, and it has to reach the
   band at the top, not just add a card at the bottom. The first version of this
   feature did the latter: green "no need to stop" above red "stop the car now".

   The guard is that nothing rendered may read result.verdictLevel or
   result.severity raw. Both are only correct once `overridden` has been
   consulted, so every reference has to sit inside a conditional that does. */
ok(
  "result.tsx delegates the decision to decide()",
  resultNodes.some(
    (n) => ts.isCallExpression(n) && n.expression.getText(result) === "decide",
  ),
);

const insideOverride = (node) => {
  for (let n = node; n; n = n.parent) {
    if (ts.isConditionalExpression(n) && /\boverridden\b/.test(n.condition.getText(result))) return true;
  }
  return false;
};
for (const field of ["verdictLevel", "severity"]) {
  const raw = resultNodes.filter(
    (n) =>
      ts.isPropertyAccessExpression(n) &&
      n.name.text === field &&
      n.expression.getText(result) === "result" &&
      !insideOverride(n),
  );
  ok(`nothing renders result.${field} without consulting the override`, raw.length === 0);
  for (const n of raw) console.log(`     raw: ${n.parent.getText(result).slice(0, 70)}`);
}

// The clamp is a colour change unless it takes the sentence with it.
const api = fs.readFileSync(path.join(ROOT, "app/api/scan+api.ts"), "utf8");
const clamp = api.slice(api.indexOf("function clampForSafety"), api.indexOf("MAX_IMAGE_BYTES"));
// Both raises, not either: an earlier version of this check matched one and
// passed while the other silently kept the model's sentence.
for (const level of ["stop", "caution"]) {
  ok(
    `a clamp to "${level}" loses the model's words too`,
    new RegExp(`verdict:\\s*clampedVerdict\\.${level}\\b`).test(clamp),
  );
}
ok("and a critical light can never say the journey continues", /roadside:\s*"move-to-safety"/.test(clamp));

// The app looked at a lamp; the driver is in a car.
ok(
  "no screen states the car is safe",
  !/يمكنك المتابعة بأمان|Safe to keep driving/.test(
    fs.readFileSync(path.join(ROOT, "src/i18n/ui.ts"), "utf8"),
  ),
);

/* --------------------------------------------------------------- report */

console.log(
  `\n${problems.length ? `${problems.length} problems.` : "The trial is only promised to someone who can have it, and the verdict is never sold."}`,
);
if (problems.length) process.exit(1);
