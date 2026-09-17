#!/usr/bin/env node
/**
 * Checks for the receptionist's hard gates.
 *
 * Everything covered here is something that, if wrong, costs a real client a
 * real customer: an appointment confirmed on a closed day, a double booking,
 * or a medical question the agent answered by itself. The model is not
 * exercised — these are the deterministic rules that bound it.
 *
 *   npm run test:desk
 */

import assert from "node:assert";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const outDir = mkdtempSync(join(tmpdir(), "desk-check-"));

try {
  execFileSync(
    "npx",
    ["tsc", "lib/desk/time.ts", "lib/desk/tenants.ts", "lib/desk/escalation.ts",
     "lib/desk/bookings.ts", "lib/desk/whatsapp.ts",
     "--outDir", outDir, "--rootDir", "lib", "--module", "commonjs", "--target", "es2020",
     "--moduleResolution", "node", "--esModuleInterop", "--skipLibCheck", "--strict"],
    { stdio: "inherit" },
  );
} catch {
  console.error("✗ Could not compile the desk modules.");
  process.exit(1);
}

const load = (n) => import(pathToFileURL(join(outDir, "desk", n)).href);
const time = await load("time.js");
const tenants = await load("tenants.js");
const esc = await load("escalation.js");
const bk = await load("bookings.js");
const wa = await load("whatsapp.js");

let passed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1; }
}

/* A fixed clinic so every assertion below is deterministic.
   2026-09-17 is a Thursday; Friday is the closed day. */
const T = {
  id: "t", name: "عيادة الفحص", kind: "clinic", timezone: "Asia/Amman",
  hours: {
    sun: { open: "09:00", close: "17:00" }, mon: { open: "09:00", close: "17:00" },
    tue: { open: "09:00", close: "17:00" }, wed: { open: "09:00", close: "17:00" },
    thu: { open: "09:00", close: "12:00" }, fri: null,
    sat: { open: "10:00", close: "14:00" },
  },
  services: [
    { id: "check", name: "كشفية", durationMin: 30, price: 20, currency: "JOD" },
    { id: "long", name: "عملية طويلة", durationMin: 240 },
  ],
  escalation: { topics: ["تأمين خاص"] },
  leadTimeMin: 60, slotStepMin: 30, horizonDays: 30,
};
const CHECK = T.services[0];
const LONG = T.services[1];
const at = (iso) => new Date(iso);

console.log("\n── clock and calendar ──");
check("HH:MM parses and round-trips", () => {
  assert.strictEqual(time.parseHHMM("09:30"), 570);
  assert.strictEqual(time.formatHHMM(570), "09:30");
  assert.strictEqual(time.parseHHMM("25:00"), null);
  assert.strictEqual(time.parseHHMM("9:5"), null);
});
check("an impossible date is rejected, not rolled forward", () => {
  assert.strictEqual(time.isValidDate("2026-02-31"), false);
  assert.strictEqual(time.isValidDate("2026-09-17"), true);
});
check("weekday is correct and zone-stable", () => {
  assert.strictEqual(time.weekdayOf("2026-09-17"), "thu");
  assert.strictEqual(time.weekdayOf("2026-09-18"), "fri");
});
check("date arithmetic crosses a month boundary", () => {
  assert.strictEqual(time.addDays("2026-09-30", 1), "2026-10-01");
  assert.strictEqual(time.addDays("2026-01-01", -1), "2025-12-31");
});
check("Arabic 12-hour rendering", () => {
  assert.strictEqual(time.formatArabicTime(0), "12 ص");
  assert.strictEqual(time.formatArabicTime(13 * 60 + 30), "1:30 م");
});
check("zonedNow reports the tenant's local clock", () => {
  const n = time.zonedNow("Asia/Amman", at("2026-09-17T09:00:00Z"));
  assert.strictEqual(n.date, "2026-09-17");
  assert.ok(/^\d{2}:\d{2}$/.test(n.time));
});

console.log("\n── the supervisor ──");
check("a medical question never reaches the model", () => {
  const v = esc.screen("عندي وجع شديد بضرسي شو الدوا؟", T);
  assert.strictEqual(v.escalate, true);
  assert.strictEqual(v.reason, "medical");
});
check("diacritics and alef spellings don't slip past a rule", () => {
  assert.strictEqual(esc.screen("بِدّي أسْتِرْجاع فلوسي", T).reason, "refund");
  assert.strictEqual(esc.screen("إستحقاق خصم؟", T).reason, "discount");
});
check("a complaint escalates", () => {
  assert.strictEqual(esc.screen("بدي اشتكي، تعامل سيء", T).reason, "complaint");
});
check("card details are refused", () => {
  assert.strictEqual(esc.screen("بعطيك رقم الفيزا؟", T).reason, "payment");
});
check("asking for a person is honoured", () => {
  assert.strictEqual(esc.screen("بدي احكي مع حدا حقيقي", T).reason, "human_requested");
});
check("an emergency outranks everything else", () => {
  assert.strictEqual(esc.screen("في نزيف، حالة طارئة وبدي خصم", T).reason, "emergency");
});
check("the owner's own topic escalates", () => {
  assert.strictEqual(esc.screen("عندكم تأمين خاص؟", T).reason, "tenant_topic");
});
check("an ordinary question does NOT escalate", () => {
  assert.strictEqual(esc.screen("قديش سعر الكشفية؟", T).escalate, false);
  assert.strictEqual(esc.screen("بتفتحوا بكرا؟", T).escalate, false);
});

console.log("\n── tenant configuration ──");
check("a valid tenant reports no issues", () => {
  assert.strictEqual(tenants.validateTenant(T).length, 0);
});
check("closing before opening is caught", () => {
  const bad = { ...T, hours: { ...T.hours, sun: { open: "17:00", close: "09:00" } } };
  assert.ok(tenants.validateTenant(bad).some((i) => i.field === "hours.sun"));
});
check("an unknown timezone is caught", () => {
  assert.ok(tenants.validateTenant({ ...T, timezone: "Mars/Olympus" })
    .some((i) => i.field === "timezone"));
});
check("duplicate service ids are caught", () => {
  const bad = { ...T, services: [CHECK, { ...CHECK }] };
  assert.ok(tenants.validateTenant(bad).some((i) => i.problem === "معرّف مكرّر"));
});
check("services resolve by id, exact name and partial name", () => {
  assert.strictEqual(tenants.findService(T, "check")?.id, "check");
  assert.strictEqual(tenants.findService(T, "كشفية")?.id, "check");
  assert.strictEqual(tenants.findService(T, "كشف")?.id, "check");
  assert.strictEqual(tenants.findService(T, "قص شعر"), null);
});

console.log("\n── availability ──");
bk.clearBookings();
check("a closed day offers nothing", () => {
  const a = bk.availability({ tenant: T, date: "2026-09-18", service: CHECK, now: at("2026-09-17T06:00:00Z") });
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.reason, "closed");
});
check("a past date is refused", () => {
  const a = bk.availability({ tenant: T, date: "2026-09-16", service: CHECK, now: at("2026-09-17T06:00:00Z") });
  assert.strictEqual(a.reason, "past");
});
check("a malformed date is refused", () => {
  assert.strictEqual(bk.availability({ tenant: T, date: "18/09/2026", service: CHECK }).reason, "bad_date");
});
check("beyond the booking horizon is refused", () => {
  const a = bk.availability({ tenant: T, date: "2026-12-01", service: CHECK, now: at("2026-09-17T06:00:00Z") });
  assert.strictEqual(a.reason, "beyond_horizon");
});
check("a service longer than the day is refused, not squeezed in", () => {
  const a = bk.availability({ tenant: T, date: "2026-09-17", service: LONG, now: at("2026-09-16T06:00:00Z") });
  assert.strictEqual(a.reason, "closed");
});
check("slots stop early enough for the service to finish", () => {
  const a = bk.availability({ tenant: T, date: "2026-09-19", service: CHECK, now: at("2026-09-17T06:00:00Z") });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.slots[0], "10:00");
  assert.strictEqual(a.slots[a.slots.length - 1], "13:30"); // closes 14:00, 30-min service
});
check("lead time hides slots that are too soon today", () => {
  // 08:00 UTC is 11:00 in Amman; with 60 min lead the first slot is 12:00.
  const a = bk.availability({ tenant: T, date: "2026-09-20", service: CHECK, now: at("2026-09-20T08:00:00Z") });
  assert.strictEqual(a.ok, true);
  assert.ok(!a.slots.includes("11:00"), "11:00 is inside the lead time");
  assert.ok(a.slots.includes("12:00"), "12:00 should be offered");
});

console.log("\n── booking ──");
bk.clearBookings();
check("an available slot books", () => {
  const r = bk.book({ tenant: T, serviceRef: "check", date: "2026-09-20", time: "12:00",
    customerName: "سامر", now: at("2026-09-20T06:00:00Z") });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.booking.time, "12:00");
});
check("the same slot cannot be booked twice", () => {
  const r = bk.book({ tenant: T, serviceRef: "check", date: "2026-09-20", time: "12:00",
    now: at("2026-09-20T06:00:00Z") });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "unavailable");
});
check("an overlapping start is refused, not just an identical one", () => {
  const a = bk.availability({ tenant: T, date: "2026-09-20", service: CHECK, now: at("2026-09-20T06:00:00Z") });
  assert.ok(!a.slots.includes("12:00"));
  assert.ok(a.slots.includes("12:30"), "the next clear slot should still be offered");
});
check("a closed day cannot be booked", () => {
  const r = bk.book({ tenant: T, serviceRef: "check", date: "2026-09-18", time: "10:00",
    now: at("2026-09-17T06:00:00Z") });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "closed");
});
check("an unknown service is refused and lists the real ones", () => {
  const r = bk.book({ tenant: T, serviceRef: "قص شعر", date: "2026-09-20", time: "12:30" });
  assert.strictEqual(r.reason, "unknown_service");
  assert.ok(r.message.includes("كشفية"));
});
check("a malformed time is refused", () => {
  assert.strictEqual(bk.book({ tenant: T, serviceRef: "check", date: "2026-09-20", time: "noon" }).reason, "bad_time");
});
check("cancelling frees the slot again", () => {
  const list = bk.listBookings(T.id);
  const r = bk.cancel(T.id, list[0].id);
  assert.strictEqual(r.ok, true);
  const a = bk.availability({ tenant: T, date: "2026-09-20", service: CHECK, now: at("2026-09-20T06:00:00Z") });
  assert.ok(a.slots.includes("12:00"), "the freed slot should come back");
});

console.log("\n── WhatsApp adapter ──");
check("a signed payload is accepted and a tampered one is not", () => {
  const body = '{"a":1}';
  const sig = "sha256=" + createHmac("sha256", "secret").update(body, "utf8").digest("hex");
  assert.strictEqual(wa.verifySignature(body, sig, "secret"), true);
  assert.strictEqual(wa.verifySignature('{"a":2}', sig, "secret"), false);
  assert.strictEqual(wa.verifySignature(body, null, "secret"), false);
});
check("only real text messages are picked out of a webhook", () => {
  const msgs = wa.parseIncoming({
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "P1" },
      contacts: [{ wa_id: "962700", profile: { name: "سامر" } }],
      messages: [
        { id: "m1", from: "962700", type: "text", text: { body: "مرحبا" } },
        { id: "m2", from: "962700", type: "image" },
      ],
      statuses: [{ id: "s1", status: "delivered" }],
    } }] }],
  });
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].text, "مرحبا");
  assert.strictEqual(msgs[0].profileName, "سامر");
});
check("a junk payload yields nothing rather than throwing", () => {
  assert.strictEqual(wa.parseIncoming(null).length, 0);
  assert.strictEqual(wa.parseIncoming({ entry: "nope" }).length, 0);
});

console.log(`\n${process.exitCode ? "✗ FAILURES ABOVE" : "✓ all"} — ${passed} checks passed\n`);
rmSync(outDir, { recursive: true, force: true });
