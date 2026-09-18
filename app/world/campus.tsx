"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLACES, TONE_HEX, placeFor, type Place } from "./city";
import type { CityHandle } from "./city3d";
import { stateLabel, type Agent, type Edge, type Escalation } from "./model";
import { IconChat, IconWhatsapp } from "./icons";

/**
 * The campus, as a model you can walk around.
 *
 * Everything in the picture is built from geometry at runtime — there is no
 * artwork behind it and nothing here is a photograph. What that buys is the
 * half a picture can never have: the building that is working right now is the
 * one that is lit, the lines between them thicken with the traffic that
 * actually crossed, and the whole thing can be turned to look behind a roof.
 *
 * The text is deliberately not part of the model. Every Arabic name on screen
 * is a DOM node carried along by projecting its building's position each frame,
 * so it stays sharp at any zoom, reads right-to-left, follows the business
 * rather than the scenery, and can be read out by a screen reader.
 */

/** A pin is lit only while the agent is genuinely doing something. */
const BUSY = new Set(["working", "processing", "using_tool", "waiting", "deploying"]);

const PULSE_TONE: Record<string, string> = {
  message_received: TONE_HEX.blue,
  policy_passed: TONE_HEX.green,
  policy_blocked: TONE_HEX.red,
  escalation_created: TONE_HEX.red,
  human_notified: TONE_HEX.red,
  booking_confirmed: TONE_HEX.green,
  create_booking: TONE_HEX.amber,
  get_availability: TONE_HEX.amber,
  reply_sent: TONE_HEX.blue,
  pipeline_error: TONE_HEX.red,
};

/** The small fixtures get a quieter label than the buildings. */
const MINOR = new Set(["channel-whatsapp", "channel-web", "channel-instagram", "voice", "workshop"]);

export type CampusProps = {
  agents: Agent[];
  edges: Edge[];
  /** The newest customer message, or null before anyone has written in. */
  inbound: { text: string; at: string; channel: string } | null;
  escalation: Escalation | null;
  selected: string | null;
  onSelect: (code: string | null) => void;
  /** One entry per event that should cross the map; ids are never reused. */
  pulseQueue: Array<{ id: number; from: string; to: string; kind: string }>;
};

function toneOf(state: string): string {
  if (state === "escalated" || state === "error") return TONE_HEX.red;
  if (state === "waiting") return TONE_HEX.amber;
  if (state === "using_tool") return TONE_HEX.violet;
  if (BUSY.has(state)) return TONE_HEX.blue;
  return TONE_HEX.green;
}

export default function Campus({
  agents,
  edges,
  inbound,
  escalation,
  selected,
  onSelect,
  pulseQueue,
}: CampusProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const city = useRef<CityHandle | null>(null);
  const parked = useRef(new Map<string, { code: string; lift: number; el: HTMLElement }>());
  const fired = useRef<Set<number>>(new Set());
  const select = useRef(onSelect);
  select.current = onSelect;

  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);

  /**
   * Anchoring a DOM node to a building.
   *
   * The scene is built after the first paint, so labels that mount before it
   * are parked here and handed over once it exists — otherwise every label
   * would have to wait a frame and the board would flash empty on load.
   */
  const anchor = useCallback((id: string, code: string, lift: number, el: HTMLElement | null) => {
    if (el) parked.current.set(id, { code, lift, el });
    else parked.current.delete(id);
    city.current?.anchor(id, code, lift, el);
  }, []);

  useEffect(() => {
    let alive = true;
    const canvasEl = canvas.current;
    const hostEl = host.current;
    if (!canvasEl || !hostEl) return;

    // A machine without WebGL gets told so rather than shown a blank panel.
    let ok = false;
    try {
      const probe = document.createElement("canvas");
      ok = Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
    } catch {
      ok = false;
    }
    setSupported(ok);
    if (!ok) return;

    import("./city3d")
      .then(({ createCity }) => {
        if (!alive) return;
        const handle = createCity(canvasEl, hostEl);
        handle.onPick((code) => select.current(code));
        for (const [id, item] of parked.current) handle.anchor(id, item.code, item.lift, item.el);
        city.current = handle;
        setReady(true);
      })
      .catch(() => {
        if (alive) setSupported(false);
      });

    return () => {
      alive = false;
      city.current?.dispose();
      city.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    city.current?.update({
      agents: agents.map((a) => ({
        code: a.code,
        zone: a.zone,
        name: a.name,
        state: a.state,
        lifecycle: a.lifecycle,
      })),
      edges,
      selected,
    });
  }, [ready, agents, edges, selected]);

  useEffect(() => {
    if (!ready) return;
    for (const item of pulseQueue) {
      if (fired.current.has(item.id)) continue;
      fired.current.add(item.id);
      city.current?.pulse(item.from, item.to, PULSE_TONE[item.kind] ?? TONE_HEX.blue);
    }
  }, [ready, pulseQueue]);

  /** What is lit where, so a label can carry its building's state. */
  const tones = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      if (agent.lifecycle === "planned") continue;
      const place = placeFor(agent.code) ?? placeFor(agent.zone);
      if (place) map.set(place.code, toneOf(agent.state));
    }
    return map;
  }, [agents]);

  const chosen = selected ? (agents.find((a) => a.code === selected) ?? null) : null;
  const chosenPlace = chosen ? (placeFor(chosen.code) ?? placeFor(chosen.zone)) : null;

  return (
    <div
      ref={host}
      data-campus=""
      className="relative h-full w-full overflow-hidden rounded-[18px] bg-[#eef1f8]"
      // The page clears the selection when the area around the model is
      // clicked. Picking a building is a click too, and it reaches that
      // handler a moment after the model has already selected something — so
      // the model keeps its own clicks. Clicking bare ground still deselects,
      // because the raycast returns nothing and the model reports that.
      onClick={(e) => e.stopPropagation()}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />

      {supported === false && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/world/campus.webp"
            alt="نموذج عالم الوكلاء"
            className="absolute inset-0 h-full w-full select-none object-cover opacity-40"
            draggable={false}
          />
          <p className="relative text-[14px] font-semibold text-[#16203c]">
            المتصفح ما بيدعم WebGL
          </p>
          <p className="relative max-w-[42ch] text-[12.5px] leading-relaxed text-[#5a6480]">
            العالم مبني ثلاثي الأبعاد، وبيحتاج WebGL حتى يشتغل. الأرقام والوكلاء والأحداث كلها
            شغّالة بالجداول على يسار الشاشة.
          </p>
        </div>
      )}

      {/* ── the names, carried by the model but drawn as text ───────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {PLACES.map((place) => (
          <Label
            key={place.code}
            place={place}
            tone={tones.get(place.code) ?? null}
            selected={selected != null && chosenPlace?.code === place.code}
            anchor={anchor}
          />
        ))}

        <Anchored id="card:inbound" code="customer" lift={6} anchor={anchor}>
          <InboundCard inbound={inbound} />
        </Anchored>

        <Anchored id="card:escalation" code="policy" lift={14.5} anchor={anchor}>
          <EscalationCard escalation={escalation} />
        </Anchored>

        {chosen && chosenPlace && (
          <Anchored
            id="card:agent"
            code={chosenPlace.code}
            lift={chosenPlace.crown + 2.4}
            anchor={anchor}
          >
            <AgentCard agent={chosen} onClose={() => onSelect(null)} />
          </Anchored>
        )}
      </div>

      {/* ── how to drive it ─────────────────────────────────────────────── */}
      {supported !== false && (
        <div className="absolute bottom-3 left-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => city.current?.resetView()}
            className="pointer-events-auto rounded-full px-3 py-1.5 text-[11.5px] font-semibold shadow-[0_1px_6px_rgba(20,30,60,0.10)]"
            style={{ background: "rgba(255,255,255,0.92)", color: "#3b4666" }}
          >
            إعادة الزاوية
          </button>
          <span
            className="rounded-full px-3 py-1.5 text-[11px]"
            style={{ background: "rgba(255,255,255,0.75)", color: "#6b7590" }}
          >
            اسحب للف · عجلة الفأرة للتقريب
          </span>
        </div>
      )}
    </div>
  );
}

/* ── the anchored overlays ──────────────────────────────────────────────── */

type AnchorFn = (id: string, code: string, lift: number, el: HTMLElement | null) => void;

/**
 * A zero-sized box pinned to a point in the model.
 *
 * Its own origin lands exactly on the projected point, so whatever sits inside
 * can be positioned against that point with ordinary CSS.
 */
function Anchored({
  id,
  code,
  lift,
  anchor,
  children,
}: {
  id: string;
  code: string;
  lift: number;
  anchor: AnchorFn;
  children: React.ReactNode;
}) {
  const ref = useCallback(
    (el: HTMLDivElement | null) => anchor(id, code, lift, el),
    [anchor, id, code, lift],
  );
  return (
    <div ref={ref} className="absolute left-0 top-0 h-0 w-0" style={{ opacity: 0 }}>
      {children}
    </div>
  );
}

function Label({
  place,
  tone,
  selected,
  anchor,
}: {
  place: Place;
  tone: string | null;
  selected: boolean;
  anchor: AnchorFn;
}) {
  const minor = MINOR.has(place.code);
  return (
    <Anchored id={`label:${place.code}`} code={place.code} lift={place.crown} anchor={anchor}>
      <span
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full shadow-[0_1px_6px_rgba(20,30,60,0.12)]"
        style={{
          background: selected ? "#16203c" : "rgba(255,255,255,0.94)",
          color: selected ? "#ffffff" : minor ? "#6b7590" : "#16203c",
          padding: minor ? "2px 8px" : "3px 10px",
          fontSize: minor ? 10.5 : 12,
          fontWeight: minor ? 600 : 700,
        }}
      >
        {tone && (
          <span
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ background: tone, boxShadow: `0 0 6px ${tone}` }}
          />
        )}
        {place.label}
      </span>
    </Anchored>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const min = Math.round(diff / 60000);
  if (min < 1) return "الآن";
  if (min < 60) return `قبل ${min} د`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `قبل ${hr} س`;
  return `قبل ${Math.round(hr / 24)} ي`;
}

/** The message a real customer sent, floating over the plaza they sent it from. */
function InboundCard({ inbound }: { inbound: CampusProps["inbound"] }) {
  return (
    <div
      dir="rtl"
      className="absolute bottom-0 left-1/2 w-[172px] -translate-x-1/2 rounded-[12px] px-2.5 py-2 shadow-[0_6px_20px_rgba(20,30,60,0.14)]"
      style={{ background: "#ffffff" }}
    >
      <div className="flex flex-row-reverse items-center gap-1.5">
        {/* The badge names the channel the message actually arrived on. */}
        <span
          className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-[6px] text-white"
          style={{ background: inbound?.channel === "channel-whatsapp" ? "#25d366" : "#3b5bf6" }}
        >
          {inbound?.channel === "channel-whatsapp" ? (
            <IconWhatsapp className="h-3 w-3" />
          ) : (
            <IconChat className="h-[11px] w-[11px]" strokeWidth={2.2} />
          )}
        </span>
        <span className="truncate text-[11.5px] font-bold text-[#2b3550]">
          {inbound ? "عميل جديد" : "ما في رسائل"}
        </span>
      </div>
      <p
        className="mt-1 overflow-hidden text-right text-[11.5px] leading-[1.45] text-[#4a5470]"
        style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
      >
        {inbound ? inbound.text : "افتح لوحة التجربة وابعث رسالة، وبتوصل لهون."}
      </p>
      <span className="mt-0.5 block text-right text-[10px] text-[#98a1b6]">
        {inbound ? relativeTime(inbound.at) : "—"}
      </span>
      <span
        className="absolute -bottom-[7px] left-1/2 h-3.5 w-3.5 -translate-x-1/2 rotate-45"
        style={{ background: "#ffffff" }}
      />
    </div>
  );
}

function EscalationCard({ escalation }: { escalation: Escalation | null }) {
  const open = Boolean(escalation);
  return (
    <div
      dir="rtl"
      className="absolute bottom-0 left-1/2 flex w-[172px] -translate-x-1/2 flex-row-reverse items-center gap-2 rounded-[12px] px-2.5 py-1.5 shadow-[0_6px_20px_rgba(20,30,60,0.14)]"
      style={{ background: open ? "#fff0f1" : "#f1fbf7" }}
    >
      <span
        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-white"
        style={{ background: open ? "#f4525a" : "#12b981" }}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {open ? <path d="M12 7v6M12 16.5v.01" /> : <path d="m5 12.5 4.5 4.5L19 7.5" />}
        </svg>
      </span>
      <div className="min-w-0 flex-1 text-right leading-[1.35]">
        <p className="truncate text-[11.5px] font-bold" style={{ color: open ? "#c0353d" : "#0d8a63" }}>
          {open ? "طلب حسّاس" : "ما في تصعيدات"}
        </p>
        <p className="truncate text-[10px] text-[#5a6480]">
          {open ? "يتم تحويله للإنسان" : "كل الرسائل انحلّت"}
        </p>
      </div>
      <span
        className="absolute -bottom-[6px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45"
        style={{ background: open ? "#fff0f1" : "#f1fbf7" }}
      />
    </div>
  );
}

/** What is behind a building, opened by clicking it. */
function AgentCard({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      dir="rtl"
      className="pointer-events-auto absolute bottom-0 left-1/2 w-[216px] -translate-x-1/2 rounded-[14px] p-3 shadow-[0_10px_34px_rgba(20,30,60,0.22)] ring-1 ring-black/5"
      style={{ background: "#ffffff" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-row-reverse items-start justify-between gap-2">
        <div className="min-w-0 text-right">
          <p className="truncate text-[12.5px] font-semibold text-[#16203c]">{agent.name}</p>
          <p className="truncate text-[10.5px] text-[#7b8499]">{agent.role}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="-m-1 shrink-0 rounded-full p-1 text-[#98a1b6] hover:text-[#16203c]"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m7 7 10 10M17 7 7 17" />
          </svg>
        </button>
      </div>

      <p
        className="mt-2 text-right text-[10.5px] font-medium"
        style={{ color: agent.lifecycle === "planned" ? "#7b8499" : "#0d8a63" }}
      >
        {agent.lifecycle === "planned" ? "مصمَّم، لسه ما انبنى" : stateLabel(agent.state)}
      </p>

      {agent.capabilities.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {agent.capabilities.slice(0, 4).map((c) => (
            <li
              key={c}
              className="flex flex-row-reverse gap-1.5 text-right text-[10.5px] leading-[1.45] text-[#4a5470]"
            >
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#c3cbdd]" />
              <span className="truncate">{c}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
