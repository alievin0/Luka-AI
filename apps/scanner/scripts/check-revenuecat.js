/**
 * The RevenueCat dashboard is configuration this repository cannot see, and
 * every way of getting it wrong fails silently — differently each time:
 *
 *   entitlement not named `pro`      isPro() is false forever; a paying
 *                                    customer stays locked out
 *   no offering marked Current       offerings.current is null, getOffers()
 *                                    returns [], the paywall shows its
 *                                    fallback prices and never a real one
 *   packages named something else    the rows still render, but the trial
 *                                    line, the badge and the per-week note
 *                                    quietly disappear
 *   products not on the entitlement  the worst one: Apple charges,
 *                                    purchasePackage resolves, and the
 *                                    entitlement never turns on
 *
 * None of those raises. Every one of them is money or trust. So:
 *
 *   node scripts/check-revenuecat.js
 *     The half that needs no account — the invariants in this repo that the
 *     dashboard is configured against. Runs in `npm run check`.
 *
 *   node scripts/check-revenuecat.js --probe
 *     Reads REVENUECAT_SECRET_KEY from the environment and asks the live
 *     project whether the four things above are true.
 *
 * The probe's wire format is UNVERIFIED. api.revenuecat.com is blocked from
 * the container this was written in (the proxy refuses CONNECT), so the v2
 * shapes below come from the published API and not from a response anyone has
 * seen. When a field it expects is missing it prints what it actually got, so
 * the first real run tells you whether the script is wrong or the dashboard
 * is. Correct it and delete this paragraph — that is what happened to the
 * Upstash probe in check-ratelimit.js.
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

const PACKS = ["dashlight", "goldscan", "bugscan", "womensfit", "dogtrain", "mahdar"];

/* ------------------------------------------------- what the app asks the store

   Read as syntax rather than mirrored as constants. A checker that keeps its
   own copy of RC_ALIASES asserts that its copy agrees with itself. */

const purchases = parse("src/purchases.ts");
const purchaseNodes = [...nodes(purchases)];

const aliasDecl = purchaseNodes.find(
  (n) => ts.isVariableDeclaration(n) && n.name.getText(purchases) === "RC_ALIASES",
);

/** The pack-side ids RevenueCat's reserved package names can arrive as. */
const aliasTargets = new Set(
  aliasDecl && ts.isObjectLiteralExpression(aliasDecl.initializer)
    ? aliasDecl.initializer.properties
        .filter((p) => ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer))
        .map((p) => p.initializer.text)
    : [],
);

/* ------------------------------------------------------- what the packs declare */

/** The `pricing` block of one pack, read out of its source. */
function pricingOf(name) {
  const file = `src/packs/${name}.ts`;
  const source = parse(file);
  const block = [...nodes(source)].find(
    (n) =>
      ts.isPropertyAssignment(n) &&
      n.name.getText(source) === "pricing" &&
      ts.isObjectLiteralExpression(n.initializer),
  );
  if (!block) return null;

  const prop = (key) =>
    block.initializer.properties.find(
      (p) => ts.isPropertyAssignment(p) && p.name.getText(source) === key,
    );

  const entitlement = prop("entitlement");
  const products = prop("products");

  return {
    file,
    entitlement:
      entitlement && ts.isStringLiteral(entitlement.initializer)
        ? entitlement.initializer.text
        : null,
    productIds:
      products && ts.isArrayLiteralExpression(products.initializer)
        ? products.initializer.elements
            .filter(ts.isObjectLiteralExpression)
            .map((el) =>
              el.properties.find(
                (p) => ts.isPropertyAssignment(p) && p.name.getText(source) === "id",
              ),
            )
            .filter((p) => p && ts.isStringLiteral(p.initializer))
            .map((p) => p.initializer.text)
        : [],
  };
}

const pricing = PACKS.map(pricingOf);

/* ------------------------------------------------------------ the two key kinds

   `appl_…` is the public SDK key. It is meant to ship, and EXPO_PUBLIC_ is
   what ships it. `sk_…` is the secret key this script's probe uses, and the
   same prefix would put it in the bundle of a public repository's app. The
   two are one underscore apart, so the boundary is asserted rather than
   remembered. */

/** Everything that can be known without an account. Not run under --probe: a
 *  usage message buried under seventeen passing lines is one nobody reads. */
function checkRepo() {
  ok("purchases.ts declares RC_ALIASES", Boolean(aliasDecl));

  // One entitlement, six apps, one place it is written down. A literal here
  // would be a second source of truth that no build error could catch.
  const entitlementDecl = purchaseNodes.find(
    (n) => ts.isVariableDeclaration(n) && n.name.getText(purchases) === "ENTITLEMENT",
  );
  ok(
    "and reads the entitlement off the pack rather than naming one",
    Boolean(entitlementDecl) &&
      /pack\.pricing\.entitlement/.test(entitlementDecl.initializer.getText(purchases)),
  );

  // Three call sites read `offerings.current`. That is the whole reason the
  // runbook says the offering must be marked Current: an offering that exists
  // but is not current is invisible to every one of them.
  const currentReads = purchaseNodes.filter(
    (n) =>
      ts.isPropertyAccessExpression(n) &&
      n.name.text === "current" &&
      /offerings$/.test(n.expression.getText(purchases)),
  );
  ok(
    `the offering has to be the current one (${currentReads.length} call sites)`,
    currentReads.length >= 3,
  );

  ok(`every pack declares a pricing block (${PACKS.length})`, pricing.every(Boolean));

  const entitlements = new Set(pricing.filter(Boolean).map((p) => p.entitlement));
  ok(
    `all six packs sell one entitlement (${[...entitlements].join(", ") || "none"})`,
    entitlements.size === 1 && [...entitlements][0],
  );
  // Lowercase because RevenueCat's identifiers are case-sensitive and "Pro"
  // typed into the dashboard against "pro" in the code is a mismatch that looks
  // right in both places.
  ok(
    "and it is lowercase, as the dashboard field is case-sensitive",
    [...entitlements].every((e) => typeof e === "string" && e === e.toLowerCase() && e.length > 0),
  );

  /* A product id RC_ALIASES cannot produce is the silent-degradation case: an
     offering built from RevenueCat's standard durations comes back as
     `$rc_two_month`, nothing maps it, and the plan loses its trial and its badge
     with no error anywhere. Adding a plan to a pack has to add its alias too. */
  for (const pack of pricing.filter(Boolean)) {
    const orphans = pack.productIds.filter((id) => !aliasTargets.has(id));
    ok(
      `${path.basename(pack.file)}: RC_ALIASES can produce every plan id ` +
        `(${pack.productIds.join(", ")})${orphans.length ? ` — missing: ${orphans.join(", ")}` : ""}`,
      orphans.length === 0,
    );
  }

  const envExample = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  for (const name of ["EXPO_PUBLIC_RC_IOS_KEY", "EXPO_PUBLIC_RC_ANDROID_KEY"]) {
    ok(`.env.example documents ${name}`, envExample.includes(name));
    ok(
      `  and purchases.ts is what reads it`,
      new RegExp(`process\\.env\\.${name}\\b`).test(purchases.getFullText()),
    );
  }

  const shipped = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name)) shipped.push(rel);
    }
  };
  walk("src");
  walk("app");

  const secretInBundle = shipped.filter((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    return src.includes("REVENUECAT_SECRET_KEY") || /EXPO_PUBLIC_\w*SECRET/i.test(src);
  });
  ok(
    `no shipped file carries a secret key (${shipped.length} files)`,
    secretInBundle.length === 0,
  );
  if (secretInBundle.length) console.log(`     in: ${secretInBundle.join(", ")}`);
}
/* --------------------------------------------------------------------- probe */

const API = "https://api.revenuecat.com/v2";

/** GET one v2 collection, following nothing — these lists are small. */
async function get(key, url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) {
    console.log(`\n✗ HTTP ${response.status} from ${url.replace(API, "/v2")}`);
    console.log(text.slice(0, 600));
    if (response.status === 401) {
      console.log(
        "\n   That key was rejected. The probe needs the *secret* key (sk_…) from\n" +
          "   RevenueCat → Project settings → API keys, not the appl_… SDK key.",
      );
    } else if (/allowlist|egress|proxy/i.test(text)) {
      // Not RevenueCat answering — the development container refusing to let
      // the request out. Nothing about the project is known either way.
      console.log(
        "\n   That is this container's network policy, not RevenueCat. Run the\n" +
          "   probe from your own machine.",
      );
    }
    process.exit(1);
  }
  try {
    return JSON.parse(text);
  } catch {
    console.log(`\n✗ Not JSON from ${url.replace(API, "/v2")}:\n${text.slice(0, 600)}`);
    process.exit(1);
  }
}

/** What the script expected to find, and what was actually there. Printed
 *  instead of a bare failure, because until someone runs this the script is
 *  as likely to be wrong as the dashboard. */
function shapeMismatch(what, got) {
  console.log(`\n✗ ${what}`);
  console.log("   This is what came back — if the fields are there under other");
  console.log("   names, the script is wrong and not your project:\n");
  console.log(JSON.stringify(got, null, 2).slice(0, 1200));
  process.exit(1);
}

async function probe(key) {
  const wanted = pricing.find((p) => p && p.file.includes("dashlight"));
  const entitlementId = wanted.entitlement;

  const projects = await get(key, `${API}/projects`);
  if (!Array.isArray(projects?.items)) shapeMismatch("No `items` array on /v2/projects.", projects);
  if (projects.items.length === 0) {
    console.log("\n✗ That key sees no projects. Is it from the right account?");
    process.exit(1);
  }
  const project = projects.items[0];
  console.log(`project: ${project.name ?? "(unnamed)"}  id=${project.id}\n`);

  /* 1. the entitlement */
  const entitlements = await get(key, `${API}/projects/${project.id}/entitlements`);
  if (!Array.isArray(entitlements?.items))
    shapeMismatch("No `items` array on /entitlements.", entitlements);
  const ids = entitlements.items.map((e) => e.lookup_key ?? e.id);
  const entitlement = entitlements.items.find((e) => (e.lookup_key ?? e.id) === entitlementId);
  ok(
    `an entitlement named "${entitlementId}" exists (found: ${ids.join(", ") || "none"})`,
    Boolean(entitlement),
  );

  /* 2. an offering, marked current */
  const offerings = await get(key, `${API}/projects/${project.id}/offerings`);
  if (!Array.isArray(offerings?.items))
    shapeMismatch("No `items` array on /offerings.", offerings);
  const current = offerings.items.find((o) => o.is_current_offering === true);
  ok(
    `one offering is marked current (of ${offerings.items.length})`,
    Boolean(current),
  );
  if (!current) {
    console.log(
      "\n   Without it `offerings.current` is null in src/purchases.ts and the\n" +
        "   paywall never shows a store price. Mark one Current and re-run.",
    );
    process.exit(1);
  }

  /* 3. package identifiers the app can map */
  const packages = await get(
    key,
    `${API}/projects/${project.id}/offerings/${current.id}/packages`,
  );
  if (!Array.isArray(packages?.items)) shapeMismatch("No `items` array on /packages.", packages);

  // The keys are written unquoted (`$rc_weekly` is a valid identifier), but a
  // future edit could quote them, so both spellings are read.
  const RC_ALIASES = Object.fromEntries(
    aliasDecl.initializer.properties
      .filter((p) => ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer))
      .map((p) => [
        ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(purchases),
        p.initializer.text,
      ]),
  );
  const mapped = packages.items.map((p) => ({
    identifier: p.lookup_key ?? p.id,
    resolves: RC_ALIASES[p.lookup_key ?? p.id] ?? (p.lookup_key ?? p.id),
  }));
  console.log(
    `\npackages: ${mapped.map((m) => `${m.identifier} → ${m.resolves}`).join(", ")}\n`,
  );

  for (const id of wanted.productIds) {
    ok(
      `a package resolves to "${id}"`,
      mapped.some((m) => m.resolves === id),
    );
  }

  /* 4. the products behind them are attached to the entitlement — the failure
        that takes the money and grants nothing */
  if (entitlement) {
    const attached = await get(
      key,
      `${API}/projects/${project.id}/entitlements/${entitlement.id}/products`,
    );
    if (!Array.isArray(attached?.items))
      shapeMismatch("No `items` array on /entitlements/:id/products.", attached);
    const attachedIds = new Set(attached.items.map((p) => p.id));
    const storeIds = packages.items
      .flatMap((p) => p.products ?? [])
      .map((p) => p.product?.id ?? p.id)
      .filter(Boolean);
    if (storeIds.length === 0) {
      shapeMismatch(
        "No products found on the offering's packages, so nothing could be " +
          "checked against the entitlement.",
        packages.items[0] ?? packages,
      );
    }
    const loose = storeIds.filter((id) => !attachedIds.has(id));
    ok(
      `every product in the offering is attached to "${entitlementId}" (${storeIds.length})`,
      loose.length === 0,
    );
    if (loose.length) {
      console.log(
        `     not attached: ${loose.join(", ")}\n` +
          "     A purchase of one of these succeeds at Apple and never turns the\n" +
          "     entitlement on. The money moves; the app stays locked.",
      );
    }
  }
}

/* ---------------------------------------------------------------------- main */

const args = process.argv.slice(2);
if (args[0] === "--probe") {
  const key = process.env.REVENUECAT_SECRET_KEY;
  if (!key) {
    console.log(
      "usage: REVENUECAT_SECRET_KEY=sk_... node scripts/check-revenuecat.js --probe\n\n" +
        "  The secret key is in RevenueCat → Project settings → API keys.\n" +
        "  Put it in .env (which is git-ignored) as REVENUECAT_SECRET_KEY —\n" +
        "  never with an EXPO_PUBLIC_ prefix, which is what ships a value in\n" +
        "  the app bundle.",
    );
    process.exit(2);
  }
  if (/^appl_|^goog_/.test(key)) {
    console.log(
      "✗ That is a public SDK key. The probe reads the dashboard, which needs\n" +
        "  the secret key (sk_…) from Project settings → API keys.",
    );
    process.exit(1);
  }
  probe(key)
    .then(() => {
      console.log(
        `\n${problems.length ? `${problems.length} problems.` : "The dashboard matches what the app reads."}`,
      );
      process.exit(problems.length ? 1 : 0);
    })
    .catch((error) => {
      const why = String(error?.cause?.code ?? error?.message ?? error);
      console.log(`\n✗ Could not reach RevenueCat: ${why}`);
      if (/ENOTFOUND|EAI_AGAIN|UND_ERR|ECONNREFUSED|ETIMEDOUT|403/.test(why)) {
        console.log(
          "   Check your network. Note that this host is blocked from the\n" +
            "   development container, so run this from your own machine.",
        );
      }
      process.exit(1);
    });
} else {
  checkRepo();
  console.log(
    `\n${problems.length ? `${problems.length} problems.` : "The dashboard has one shape to match, and it is written down."}`,
  );
  if (problems.length) process.exit(1);
}
