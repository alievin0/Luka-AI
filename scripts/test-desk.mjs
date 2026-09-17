#!/usr/bin/env node
/**
 * Checks for every hard gate in the receptionist.
 *
 * Each case here is something that, if wrong, costs a real client a real
 * customer: an appointment on a closed day, a double booking, a medical
 * question the agent answered by itself, or a retried webhook replying twice.
 * The model is never called — these are the deterministic rules that bound it.
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

/* A fixed clinic, configured before anything loads so the memory store sees it.
   2026-09-17 is a Thursday; Friday is the closed day. */
const BUSINESS = {
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
process.env.DESK_TENANTS = JSON.stringify([BUSINESS]);
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const outDir = mkdtempSync(join(tmpdir(), "desk-check-"));
try {
  execFileSync(
    "npx",
    ["tsc",
     "lib/desk/time.ts", "lib/desk/tenants.ts", "lib/desk/escalation.ts",
     "lib/desk/bookings.ts", "lib/desk/whatsapp.ts", "lib/desk/agents.ts",
     "lib/desk/db/index.ts", "lib/desk/db/memory.ts", "lib/desk/tts.ts",
     "--outDir", outDir, "--rootDir", "lib", "--module", "commonjs",
     "--target", "es2020", "--moduleResolution", "node",
     "--esModuleInterop", "--skipLibCheck", "--strict"],
    { stdio: "inherit" },
  );
} catch {
  console.error("✗ Could not compile the desk modules.");
  process.exit(1);
}

const load = (n) => import(pathToFileURL(join(outDir, "desk", n)).href);
const time = await load("time.js");
const esc = await load("escalation.js");
const bk = await load("bookings.js");
const wa = await load("whatsapp.js");
const dbmod = await load("db/index.js");
const mem = await load("db/memory.js");
const tts = await load("tts.js");

const repo = dbmod.getRepo();
const B = await repo.getBusiness("t");
assert(B, "test business did not load");
const CHECK = B.services.find((s) => s.code === "check");
const LONG = B.services.find((s) => s.code === "long");
const at = (iso) => new Date(iso);

let passed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1; }
}

console.log("\n── storage ──");
await check("the fallback store declares itself non-persistent", async () => {
  const h = await repo.health();
  assert.strictEqual(repo.kind, "memory");
  assert.strictEqual(h.persistent, false, "memory must never claim persistence");
});
await check("the business profile loads with services and hours", () => {
  assert.strictEqual(B.services.length, 2);
  assert.strictEqual(B.hours.fri, null);
  assert.strictEqual(CHECK.durationMin, 30);
});

console.log("\n── clock and calendar ──");
await check("HH:MM parses and round-trips", () => {
  assert.strictEqual(time.parseHHMM("09:30"), 570);
  assert.strictEqual(time.formatHHMM(570), "09:30");
  assert.strictEqual(time.parseHHMM("25:00"), null);
});
await check("an impossible date is rejected, not rolled forward", () => {
  assert.strictEqual(time.isValidDate("2026-02-31"), false);
  assert.strictEqual(time.isValidDate("2026-09-17"), true);
});
await check("weekday is correct and zone-stable", () => {
  assert.strictEqual(time.weekdayOf("2026-09-17"), "thu");
  assert.strictEqual(time.weekdayOf("2026-09-18"), "fri");
});
await check("date arithmetic crosses a month boundary", () => {
  assert.strictEqual(time.addDays("2026-09-30", 1), "2026-10-01");
  assert.strictEqual(time.addDays("2026-01-01", -1), "2025-12-31");
});
await check("a local wall clock converts to the right absolute instant", () => {
  // Amman is UTC+3 in September, so 12:00 local is 09:00Z.
  const d = time.zonedToUtc("2026-09-20", "12:00", "Asia/Amman");
  assert.ok(d, "conversion returned null");
  assert.strictEqual(d.toISOString(), "2026-09-20T09:00:00.000Z");
});
await check("the conversion round-trips back to the same wall clock", () => {
  const d = time.zonedToUtc("2026-09-20", "12:00", "Asia/Amman");
  assert.strictEqual(time.zonedNow("Asia/Amman", d).time, "12:00");
});

console.log("\n── the policy gate ──");
await check("a medical question never reaches the model", () => {
  const v = esc.screen("عندي وجع شديد بضرسي شو الدوا؟", B);
  assert.strictEqual(v.escalate, true);
  assert.strictEqual(v.reason, "medical");
});
await check("diacritics and alef spellings don't slip past a rule", () => {
  assert.strictEqual(esc.screen("بِدّي أسْتِرْجاع فلوسي", B).reason, "refund");
  assert.strictEqual(esc.screen("إستحقاق خصم؟", B).reason, "discount");
});
await check("a complaint escalates", () => {
  assert.strictEqual(esc.screen("بدي اشتكي، تعامل سيء", B).reason, "complaint");
});
await check("card details are refused", () => {
  assert.strictEqual(esc.screen("بعطيك رقم الفيزا؟", B).reason, "payment");
});
await check("asking for a person is honoured", () => {
  assert.strictEqual(esc.screen("بدي احكي مع حدا حقيقي", B).reason, "human_requested");
});
await check("a threat escalates", () => {
  assert.strictEqual(esc.screen("رح اجي اضربك", B).reason, "threat");
});
await check("an emergency outranks everything else", () => {
  assert.strictEqual(esc.screen("في نزيف، حالة طارئة وبدي خصم", B).reason, "emergency");
});
await check("the owner's own topic escalates", () => {
  assert.strictEqual(esc.screen("عندكم تأمين خاص؟", B).reason, "tenant_topic");
});
await check("an ordinary question does NOT escalate", () => {
  assert.strictEqual(esc.screen("قديش سعر الكشفية؟", B).escalate, false);
  assert.strictEqual(esc.screen("بتفتحوا بكرا؟", B).escalate, false);
});

console.log("\n── availability ──");
mem.resetMemory();
await check("a closed day offers nothing", async () => {
  const a = await bk.availability({ business: B, date: "2026-09-18", service: CHECK, now: at("2026-09-17T06:00:00Z") });
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.reason, "closed");
});
await check("a past date is refused", async () => {
  const a = await bk.availability({ business: B, date: "2026-09-16", service: CHECK, now: at("2026-09-17T06:00:00Z") });
  assert.strictEqual(a.reason, "past");
});
await check("a malformed date is refused", async () => {
  const a = await bk.availability({ business: B, date: "18/09/2026", service: CHECK });
  assert.strictEqual(a.reason, "bad_date");
});
await check("beyond the booking horizon is refused", async () => {
  const a = await bk.availability({ business: B, date: "2026-12-01", service: CHECK, now: at("2026-09-17T06:00:00Z") });
  assert.strictEqual(a.reason, "beyond_horizon");
});
await check("a service longer than the day is refused, not squeezed in", async () => {
  const a = await bk.availability({ business: B, date: "2026-09-17", service: LONG, now: at("2026-09-16T06:00:00Z") });
  assert.strictEqual(a.reason, "too_long");
});
await check("slots stop early enough for the service to finish", async () => {
  const a = await bk.availability({ business: B, date: "2026-09-19", service: CHECK, now: at("2026-09-17T06:00:00Z") });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.slots[0], "10:00");
  assert.strictEqual(a.slots[a.slots.length - 1], "13:30"); // closes 14:00, 30-min service
});
await check("lead time hides slots that are too soon today", async () => {
  // 08:00Z is 11:00 in Amman; with 60 min lead the first slot is 12:00.
  const a = await bk.availability({ business: B, date: "2026-09-20", service: CHECK, now: at("2026-09-20T08:00:00Z") });
  assert.ok(!a.slots.includes("11:00"), "11:00 is inside the lead time");
  assert.ok(a.slots.includes("12:00"), "12:00 should be offered");
});

console.log("\n── booking ──");
mem.resetMemory();
await check("an available slot books", async () => {
  const r = await bk.book({ business: B, serviceRef: "check", date: "2026-09-20", time: "12:00", now: at("2026-09-20T06:00:00Z") });
  assert.strictEqual(r.ok, true, r.message);
  assert.strictEqual(r.booking.time, "12:00");
});
await check("the same slot cannot be booked twice", async () => {
  const r = await bk.book({ business: B, serviceRef: "check", date: "2026-09-20", time: "12:00", now: at("2026-09-20T06:00:00Z") });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "unavailable");
});
await check("an overlapping start is refused, the next clear slot is not", async () => {
  const a = await bk.availability({ business: B, date: "2026-09-20", service: CHECK, now: at("2026-09-20T06:00:00Z") });
  assert.ok(!a.slots.includes("12:00"));
  assert.ok(a.slots.includes("12:30"));
});
await check("a closed day cannot be booked", async () => {
  const r = await bk.book({ business: B, serviceRef: "check", date: "2026-09-18", time: "10:00", now: at("2026-09-17T06:00:00Z") });
  assert.strictEqual(r.reason, "closed");
});
await check("an unknown service is refused and lists the real ones", async () => {
  const r = await bk.book({ business: B, serviceRef: "قص شعر", date: "2026-09-20", time: "12:30" });
  assert.strictEqual(r.reason, "unknown_service");
  assert.ok(r.message.includes("كشفية"));
});
await check("a malformed time is refused", async () => {
  const r = await bk.book({ business: B, serviceRef: "check", date: "2026-09-20", time: "noon" });
  assert.strictEqual(r.reason, "bad_time");
});
await check("an unknown staff member is refused", async () => {
  const r = await bk.book({ business: B, serviceRef: "check", date: "2026-09-20", time: "13:00", staffId: "nobody" });
  assert.strictEqual(r.reason, "unknown_staff");
});
await check("cancelling frees the slot again", async () => {
  const list = await bk.listBookings(B.id);
  const r = await bk.cancel(B.id, list[0].id);
  assert.strictEqual(r.ok, true);
  const a = await bk.availability({ business: B, date: "2026-09-20", service: CHECK, now: at("2026-09-20T06:00:00Z") });
  assert.ok(a.slots.includes("12:00"), "the freed slot should come back");
});
await check("a whole-day block closes the day", async () => {
  mem.resetMemory();
  const t = await repo.listBlockedTimes(B.id, "2026-09-20");
  assert.strictEqual(t.length, 0, "no blocks by default");
});

console.log("\n── conversations and idempotency ──");
mem.resetMemory();
await check("a retried delivery does not store a second message", async () => {
  const cust = await repo.upsertCustomer({ businessId: B.id, channel: "whatsapp", contact: "962700" });
  const conv = await repo.openConversation({ businessId: B.id, customerId: cust.id, channel: "whatsapp" });
  const first = await repo.appendMessage({ businessId: B.id, conversationId: conv.id, role: "customer", body: "مرحبا", externalId: "wamid.1" });
  const again = await repo.appendMessage({ businessId: B.id, conversationId: conv.id, role: "customer", body: "مرحبا", externalId: "wamid.1" });
  assert.strictEqual(first.duplicate, false);
  assert.strictEqual(again.duplicate, true, "a retried webhook must be a no-op");
  assert.strictEqual((await repo.listMessages(conv.id)).length, 1);
});
await check("the same customer reuses their open conversation", async () => {
  const cust = await repo.upsertCustomer({ businessId: B.id, channel: "whatsapp", contact: "962700" });
  const a = await repo.openConversation({ businessId: B.id, customerId: cust.id, channel: "whatsapp" });
  const b = await repo.openConversation({ businessId: B.id, customerId: cust.id, channel: "whatsapp" });
  assert.strictEqual(a.id, b.id);
});
await check("an escalation is recorded and listed as open", async () => {
  const e = await repo.createEscalation({ businessId: B.id, reason: "medical", customerMessage: "وجع" });
  const open = await repo.listEscalations(B.id, { openOnly: true });
  assert.ok(open.some((x) => x.id === e.id));
});

console.log("\n── agents, tasks and events ──");
mem.resetMemory();
await check("the roster separates built agents from planned ones", async () => {
  const agents = await repo.listAgents(B.id);
  const live = agents.filter((a) => a.lifecycle === "live");
  const planned = agents.filter((a) => a.lifecycle === "planned");
  assert.ok(live.length >= 4, "expected several live agents");
  assert.ok(planned.length >= 2, "expected planned agents to be present");
  assert.ok(planned.every((a) => a.state === "offline"), "a planned agent is offline, not idle");
});
await check("a planned agent cannot be switched to working", async () => {
  await repo.setAgentState(B.id, "voice", "working");
  const voice = (await repo.listAgents(B.id)).find((a) => a.code === "voice");
  assert.strictEqual(voice.state, "offline", "an unbuilt agent must not report working");
});
await check("a live agent's state does change", async () => {
  await repo.setAgentState(B.id, "reception", "working");
  const r = (await repo.listAgents(B.id)).find((a) => a.code === "reception");
  assert.strictEqual(r.state, "working");
});
await check("a task records ordered steps and an outcome", async () => {
  const task = await repo.createTask({ businessId: B.id, agentCode: "reception", title: "حجز" });
  await repo.addTaskStep(task.id, { seq: 1, label: "policy_passed", status: "done" });
  await repo.addTaskStep(task.id, { seq: 2, label: "create_booking", status: "done" });
  await repo.endTask(task.id, "completed");
  const stored = await repo.getTask(B.id, task.id);
  assert.strictEqual(stored.steps.length, 2);
  assert.strictEqual(stored.steps[0].seq, 1);
  assert.strictEqual(stored.status, "completed");
});
await check("events carry the edge the world draws", async () => {
  await repo.emitEvent({ businessId: B.id, kind: "reply_sent", from: "reception", to: "customer", summary: "رد" });
  const events = await repo.listEvents(B.id, 5);
  assert.ok(events.length >= 1);
  assert.strictEqual(events[0].from, "reception");
  assert.strictEqual(events[0].to, "customer");
});

console.log("\n── WhatsApp adapter ──");
await check("a signed payload is accepted and a tampered one is not", () => {
  const body = '{"a":1}';
  const sig = "sha256=" + createHmac("sha256", "secret").update(body, "utf8").digest("hex");
  assert.strictEqual(wa.verifySignature(body, sig, "secret"), true);
  assert.strictEqual(wa.verifySignature('{"a":2}', sig, "secret"), false);
  assert.strictEqual(wa.verifySignature(body, null, "secret"), false);
});
await check("only real text messages are picked out of a webhook", () => {
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
  assert.strictEqual(msgs[0].messageId, "m1");
});
await check("a junk payload yields nothing rather than throwing", () => {
  assert.strictEqual(wa.parseIncoming(null).length, 0);
  assert.strictEqual(wa.parseIncoming({ entry: "nope" }).length, 0);
});


/* ── voice provider selection ─────────────────────────────────────────
   Which provider speaks is a business decision, not a detail: Azure is the
   only one with a Jordanian accent, and a client paying to sound local must
   not silently get Modern Standard Arabic because two keys were present. */
console.log("\n── voice provider selection ──");

const VOICE_KEYS = [
  "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "AZURE_SPEECH_VOICE",
  "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID",
  "OPENAI_API_KEY", "OPENAI_TTS_VOICE", "TTS_PROVIDER",
];
const clearVoiceEnv = () => { for (const k of VOICE_KEYS) delete process.env[k]; };

await check("with no key at all the console is told it is the robot voice", () => {
  clearVoiceEnv();
  const st = tts.status();
  assert.strictEqual(st.configured, false);
  assert.strictEqual(st.provider, null);
  assert.deepStrictEqual(st.available, []);
  assert.match(st.note, /المتصفح/);
});

await check("an Azure key selects the Jordanian voice by default", () => {
  clearVoiceEnv();
  process.env.AZURE_SPEECH_KEY = "k";
  process.env.AZURE_SPEECH_REGION = "uaenorth";
  const st = tts.status();
  assert.strictEqual(st.provider, "azure");
  assert.strictEqual(st.voice, "ar-JO-TaimNeural");
  assert.strictEqual(st.configured, true);
});

await check("Azure without its region is not usable", () => {
  clearVoiceEnv();
  process.env.AZURE_SPEECH_KEY = "k";
  assert.strictEqual(tts.status().configured, false);
});

await check("Azure wins over ElevenLabs when both are configured", () => {
  clearVoiceEnv();
  process.env.AZURE_SPEECH_KEY = "k";
  process.env.AZURE_SPEECH_REGION = "uaenorth";
  process.env.ELEVENLABS_API_KEY = "e";
  const st = tts.status();
  assert.strictEqual(st.provider, "azure");
  assert.deepStrictEqual(st.available, ["azure", "elevenlabs"]);
});

await check("an explicit TTS_PROVIDER overrides the preference order", () => {
  clearVoiceEnv();
  process.env.AZURE_SPEECH_KEY = "k";
  process.env.AZURE_SPEECH_REGION = "uaenorth";
  process.env.ELEVENLABS_API_KEY = "e";
  process.env.TTS_PROVIDER = "elevenlabs";
  assert.strictEqual(tts.status().provider, "elevenlabs");
});

await check("naming a provider with no key does not silence the voice", () => {
  clearVoiceEnv();
  process.env.AZURE_SPEECH_KEY = "k";
  process.env.AZURE_SPEECH_REGION = "uaenorth";
  process.env.TTS_PROVIDER = "elevenlabs";
  // The typo'd choice is ignored and the configured provider still speaks.
  assert.strictEqual(tts.status().provider, "azure");
});

await check("a chosen voice name replaces the default", () => {
  clearVoiceEnv();
  process.env.AZURE_SPEECH_KEY = "k";
  process.env.AZURE_SPEECH_REGION = "uaenorth";
  process.env.AZURE_SPEECH_VOICE = "ar-SA-ZariyahNeural";
  assert.strictEqual(tts.status().voice, "ar-SA-ZariyahNeural");
});

await check("with no provider, synthesis says so instead of throwing", async () => {
  clearVoiceEnv();
  const r = await tts.synthesize("مرحبا");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "unconfigured");
});

await check("an over-long text is refused before any provider is billed", async () => {
  clearVoiceEnv();
  process.env.AZURE_SPEECH_KEY = "k";
  process.env.AZURE_SPEECH_REGION = "uaenorth";
  const r = await tts.synthesize("ا".repeat(tts.MAX_CHARS + 1));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "too_long");
});

await check("empty text is refused", async () => {
  clearVoiceEnv();
  process.env.AZURE_SPEECH_KEY = "k";
  process.env.AZURE_SPEECH_REGION = "uaenorth";
  const r = await tts.synthesize("   ");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "empty");
});

clearVoiceEnv();

console.log(`\n${process.exitCode ? "✗ FAILURES ABOVE" : "✓ all"} — ${passed} checks passed\n`);
rmSync(outDir, { recursive: true, force: true });
