"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAMPUS_H,
  CAMPUS_W,
  NODES,
  nodeForAgent,
  routePath,
  stateLabel,
  type Agent,
  type Edge,
  type Escalation,
  type Tone,
} from "./model";
import { IconChat, IconWhatsapp } from "./icons";
import Scene from "./scene";
import { POD_DROP, POD_W, SPRITE_DIR, hasPod, type SpriteSource } from "./sprites";

/**
 * The campus.
 *
 * The picture is the client's own render, shipped as-is: nothing here redraws
 * it, and nothing here is allowed to disagree with it. What this component
 * adds is the half the picture cannot have — the state of the agents right
 * now, the traffic actually crossing between them, and the message a real
 * customer just sent. Every overlay is positioned in the artwork's own pixel
 * space (1126 × 676), which is also the SVG viewBox, so the two layers scale
 * together and can never drift apart.
 */

const TONE_HEX: Record<Tone, string> = {
  blue: "#3b82f6",
  green: "#12b981",
  amber: "#f59e0b",
  red: "#f4525a",
  violet: "#8b7bff",
  grey: "#94a3b8",
};

/** A pin is lit only while the agent is genuinely doing something. */
const BUSY = new Set(["working", "processing", "using_tool", "waiting", "deploying"]);

type LivePulse = { id: number; d: string; color: string; dur: number };

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

const PULSE_TONE: Record<string, Tone> = {
  message_received: "blue",
  policy_passed: "green",
  policy_blocked: "red",
  escalation_created: "red",
  human_notified: "red",
  booking_confirmed: "green",
  create_booking: "amber",
  get_availability: "amber",
  reply_sent: "blue",
  pipeline_error: "red",
};

export default function Campus({
  agents,
  edges,
  inbound,
  escalation,
  selected,
  onSelect,
  pulseQueue,
}: CampusProps) {
  const { host, box } = useFittedBox(CAMPUS_W / CAMPUS_H);
  const { source: artSource, drop: dropArt, arrived: artArrived } = useSpriteSource();
  const [pulses, setPulses] = useState<LivePulse[]>([]);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const fired = useRef<Set<number>>(new Set());

  const drop = useCallback((id: number) => {
    setPulses((list) => list.filter((p) => p.id !== id));
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  useEffect(() => {
    for (const item of pulseQueue) {
      if (fired.current.has(item.id)) continue;
      fired.current.add(item.id);
      const d = routePath(item.from, item.to);
      if (!d) continue;
      const dur = 1.5;
      setPulses((list) => [
        ...list,
        { id: item.id, d, color: TONE_HEX[PULSE_TONE[item.kind] ?? "blue"], dur },
      ]);
      const t = setTimeout(() => {
        drop(item.id);
        timers.current.delete(t);
      }, dur * 1000 + 300);
      timers.current.add(t);
    }
  }, [pulseQueue, drop]);

  // The busiest handful of routes keep a slow dot running so the map reads as
  // a system under load rather than a diagram that only twitches on an event.
  const ambient = edges
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((e) => ({ key: `${e.from}>${e.to}`, d: routePath(e.from, e.to), count: e.count }))
    .filter((e): e is { key: string; d: string; count: number } => Boolean(e.d));

  return (
    <div ref={host} className="flex h-full w-full items-center justify-center">
    <div
      data-campus=""
      className="relative overflow-hidden rounded-[18px]"
      style={
        box
          ? { width: box.w, height: box.h, containerType: "inline-size" }
          : { width: "100%", aspectRatio: `${CAMPUS_W} / ${CAMPUS_H}`, containerType: "inline-size" }
      }
    >
      {artSource ? (
        <Scene
          agents={agents}
          edges={edges}
          selected={selected}
          onSelect={onSelect}
          from={artSource}
          onArtMissing={dropArt}
          onArtReady={artArrived}
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src="/world/campus.webp"
          alt="نموذج مصغّر لعالم الوكلاء: الاستقبال والمعرفة والحجوزات وبوابة السياسات والتحويل البشري"
          className="absolute inset-0 h-full w-full select-none object-cover"
          draggable={false}
        />
      )}

      <svg
        viewBox={`0 0 ${CAMPUS_W} ${CAMPUS_H}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="حالة الوكلاء الحيّة فوق نموذج العالم"
      >
        <defs>
          <filter id="pin-glow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {!artSource && ambient.map((a, i) => (
          <g key={a.key} opacity={0.5}>
            <circle r="3.4" fill="#ffffff">
              <animateMotion
                path={a.d}
                dur={`${Math.max(3.2, 7 - Math.min(a.count, 12) * 0.3)}s`}
                repeatCount="indefinite"
                begin={`${(i * 0.7).toFixed(1)}s`}
              />
            </circle>
          </g>
        ))}

        {pulses.map((p) => (
          <Pulse key={p.id} d={p.d} color={p.color} dur={p.dur} />
        ))}

        {agents.map((agent) => {
          // An agent with no code behind it is listed in the roster as
          // "قيد التطوير" and gets no pin: the map shows what is running, and
          // a marker on an empty roof would only read as noise.
          if (agent.lifecycle === "planned") return null;
          const node = nodeForAgent(agent);
          if (!node) return null;

          const tone: Tone =
            agent.state === "escalated" || agent.state === "error"
              ? "red"
              : agent.state === "waiting"
                ? "amber"
                : agent.state === "using_tool"
                  ? "violet"
                  : BUSY.has(agent.state)
                    ? "blue"
                    : "green";
          const color = TONE_HEX[tone];
          const busy = BUSY.has(agent.state);
          const isSelected = selected === agent.code;
          // With a character standing there the marker belongs under its feet
          // as a flattened puddle; on the flat render it rings the pod itself.
          const standing = Boolean(artSource) && hasPod(agent.code);
          const cx = node.x;
          const cy = standing ? node.y + POD_DROP + POD_W * 0.3 : node.y;
          const ring = standing ? POD_W * 0.34 : node.r + 6;
          const flatten = standing ? 0.42 : 1;
          // The LED rides the marker at 45°, clear of the model's own signage.
          const lx = cx + ring * 0.707;
          const ly = cy - ring * flatten * 0.707;

          return (
            <g
              key={agent.code}
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(isSelected ? null : agent.code);
              }}
            >
              <title>{`${agent.name} — ${stateLabel(agent.state)}`}</title>
              <circle cx={cx} cy={cy} r={ring + 10} fill="transparent" pointerEvents="all" />
              <ellipse
                cx={cx}
                cy={cy}
                rx={ring}
                ry={ring * flatten}
                fill="none"
                stroke={color}
                strokeWidth={isSelected ? 3 : 2}
                opacity={isSelected ? 1 : 0.82}
              />
              {busy && (
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={ring}
                  ry={ring * flatten}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                >
                  <animate
                    attributeName="rx"
                    values={`${ring};${ring + 16}`}
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="ry"
                    values={`${ring * flatten};${(ring + 16) * flatten}`}
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.55;0"
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                </ellipse>
              )}
              <circle
                cx={lx}
                cy={ly}
                r="6.2"
                fill={color}
                stroke="#ffffff"
                strokeWidth="2"
                filter="url(#pin-glow)"
              />
            </g>
          );
        })}

      </svg>

      <InboundCard inbound={inbound} />
      <EscalationCard escalation={escalation} />

      {selected && <AgentCard agent={agents.find((a) => a.code === selected) ?? null} onClose={() => onSelect(null)} />}
    </div>
    </div>
  );
}

/**
 * The artwork's box, to the pixel.
 *
 * `aspect-ratio` alone will not do this job: with an explicit height it keeps
 * that height and lets `max-width` squash the box, and `object-fit: cover`
 * then quietly crops the picture — which slides every overlay off the model it
 * is pointing at. Measuring the host and sizing the box ourselves is what
 * guarantees the two layers describe the same pixels.
 */
function useFittedBox(ratio: number) {
  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const w = Math.min(width, height * ratio);
      setBox({ w, h: w / ratio });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);

  return { host, box };
}

/**
 * Which copy of the generated art the scene should use, if any.
 *
 * A committed copy under `public/world/sprites/` is what a real deployment
 * wants, and a manifest there is how we know it exists. Without it the scene
 * still runs, reading the art from the generator's CDN, because this session's
 * network policy blocks that host and the files could not be committed from
 * here — so that is the only way the world can be seen before someone runs
 * `npm run world:assets` from a machine that can reach it.
 *
 * If the art cannot be loaded at all, `drop` puts the page back on the single
 * flat render. A half-drawn world is worse than an honest still.
 */
function useSpriteSource(): {
  source: SpriteSource | null;
  drop: () => void;
  arrived: () => void;
} {
  const [source, setSource] = useState<SpriteSource | null>(null);
  const settled = useRef(false);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drop = useCallback(() => {
    settled.current = true;
    if (deadline.current) clearTimeout(deadline.current);
    setSource(null);
  }, []);

  const arrived = useCallback(() => {
    if (deadline.current) {
      clearTimeout(deadline.current);
      deadline.current = null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`${SPRITE_DIR}/manifest.json`, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!alive || settled.current) return;
        setSource(m && Array.isArray(m.files) && m.files.length ? "local" : "remote");
      })
      .catch(() => {
        if (alive && !settled.current) setSource("remote");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // A host that is blocked rather than absent leaves the request hanging, so
    // `onError` may never fire and the world would sit empty indefinitely. The
    // first sprite that actually arrives cancels this.
    if (source !== "remote") return;
    deadline.current = setTimeout(() => {
      if (!settled.current) drop();
    }, 6000);
    return () => {
      if (deadline.current) clearTimeout(deadline.current);
    };
  }, [source, drop]);

  useEffect(() => {
    const pending = deadline.current;
    return () => {
      if (pending) clearTimeout(pending);
    };
  }, []);

  return { source, drop, arrived };
}

/**
 * SMIL measures `begin` from when the document started, so an element inserted
 * a minute in would be treated as already finished. Starting it by hand is
 * what makes a pulse added at runtime actually travel.
 */
function Pulse({ d, color, dur }: { d: string; color: string; dur: number }) {
  const motion = useRef<SVGElement | null>(null);
  const trail = useRef<SVGElement | null>(null);

  useEffect(() => {
    for (const ref of [motion, trail]) {
      const el = ref.current as (SVGElement & { beginElement?: () => void }) | null;
      if (el?.beginElement) {
        try {
          el.beginElement();
        } catch {
          /* SMIL unsupported — the dot simply sits at the start of the path. */
        }
      }
    }
  }, []);

  return (
    <g>
      <circle r="11" fill={color} opacity="0.28" filter="url(#pin-glow)">
        <animateMotion
          ref={trail as React.Ref<SVGAnimateMotionElement>}
          path={d}
          dur={`${dur}s`}
          begin="indefinite"
          fill="freeze"
        />
      </circle>
      <circle r="5.2" fill="#ffffff" stroke={color} strokeWidth="2.4">
        <animateMotion
          ref={motion as React.Ref<SVGAnimateMotionElement>}
          path={d}
          dur={`${dur}s`}
          begin="indefinite"
          fill="freeze"
        />
      </circle>
    </g>
  );
}

/* ── the two slots in the artwork that carry live text ──────────────────── */

/**
 * Both cards sit exactly over the speech bubbles drawn in the render, to the
 * pixel, so the artwork's own drop shadow still falls around them. Sizes are
 * in container-query units: the text then scales with the picture instead of
 * breaking the composition at a different viewport width.
 */
const SLOT = {
  inbound: { left: 89, top: 377, w: 164, h: 99 },
  escalation: { left: 630, top: 465, w: 156, h: 64 },
} as const;

function slotStyle(s: { left: number; top: number; w: number; h: number }) {
  return {
    left: `${(s.left / CAMPUS_W) * 100}%`,
    top: `${(s.top / CAMPUS_H) * 100}%`,
    width: `${(s.w / CAMPUS_W) * 100}%`,
    height: `${(s.h / CAMPUS_H) * 100}%`,
  };
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

function InboundCard({ inbound }: { inbound: CampusProps["inbound"] }) {
  return (
    <div
      dir="ltr"
      className="absolute flex flex-col justify-center gap-[0.45cqw] rounded-[1.15cqw] px-[0.95cqw] py-[0.6cqw] shadow-[0_0.15cqw_0.8cqw_rgba(20,30,60,0.10)]"
      style={{ ...slotStyle(SLOT.inbound), background: "#f7faff" }}
    >
      <div className="flex items-center gap-[0.55cqw]">
        {/* The badge names the channel the message actually arrived on, rather
            than always showing the one the artwork happens to draw. */}
        <span
          className="flex h-[2.1cqw] w-[2.1cqw] shrink-0 items-center justify-center rounded-[0.6cqw] text-white"
          style={{ background: inbound?.channel === "channel-whatsapp" ? "#25d366" : "#3b5bf6" }}
        >
          {inbound?.channel === "channel-whatsapp" ? (
            <IconWhatsapp className="h-[1.5cqw] w-[1.5cqw]" />
          ) : (
            <IconChat className="h-[1.4cqw] w-[1.4cqw]" strokeWidth={2.2} />
          )}
        </span>
        <span className="truncate text-[1.3cqw] font-bold text-[#2b3550]">
          {inbound ? "عميل جديد" : "ما في رسائل"}
        </span>
      </div>
      <p
        dir="rtl"
        className="overflow-hidden text-right text-[1.22cqw] leading-[1.4] text-[#4a5470]"
        style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
      >
        {inbound ? inbound.text : "افتح لوحة التجربة وابعث رسالة، وبتوصل لهون."}
      </p>
      <span className="text-right text-[1cqw] text-[#98a1b6]">
        {inbound ? relativeTime(inbound.at) : "—"}
      </span>
    </div>
  );
}

function EscalationCard({ escalation }: { escalation: Escalation | null }) {
  const open = Boolean(escalation);
  return (
    <div
      dir="ltr"
      className="absolute flex items-center gap-[0.7cqw] rounded-[1.15cqw] px-[0.9cqw] shadow-[0_0.15cqw_0.8cqw_rgba(20,30,60,0.10)]"
      style={{
        ...slotStyle(SLOT.escalation),
        background: open ? "#fff0f1" : "#f1fbf7",
      }}
    >
      <span
        className="flex h-[2.3cqw] w-[2.3cqw] shrink-0 items-center justify-center rounded-full text-white"
        style={{ background: open ? "#f4525a" : "#12b981" }}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-[1.4cqw] w-[1.4cqw]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {open ? <path d="M12 7v6M12 16.5v.01" /> : <path d="m5 12.5 4.5 4.5L19 7.5" />}
        </svg>
      </span>
      <div dir="rtl" className="min-w-0 flex-1 text-right leading-[1.35]">
        <p
          className="truncate text-[1.2cqw] font-bold"
          style={{ color: open ? "#c0353d" : "#0d8a63" }}
        >
          {open ? "طلب حسّاس" : "ما في تصعيدات"}
        </p>
        <p className="truncate text-[1.02cqw] text-[#5a6480]">
          {open ? "يتم تحويله للإنسان" : "كل الرسائل انحلّت"}
        </p>
      </div>
    </div>
  );
}

/** What is behind a pin, opened by clicking it. */
function AgentCard({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!agent) return null;
  const node = nodeForAgent(agent) ?? NODES.reception;
  // Flip to the other side near an edge so the card never leaves the picture.
  const onRight = node.x > CAMPUS_W * 0.55;
  const style: React.CSSProperties = {
    top: `${Math.min(Math.max((node.y / CAMPUS_H) * 100 - 4, 2), 62)}%`,
    width: "24%",
    ...(onRight
      ? { left: `${Math.max((node.x / CAMPUS_W) * 100 - 26, 2)}%` }
      : { left: `${Math.min((node.x / CAMPUS_W) * 100 + 4, 74)}%` }),
  };

  return (
    <div
      className="absolute z-10 rounded-[1.1cqw] p-[1.1cqw] shadow-[0_0.4cqw_1.8cqw_rgba(20,30,60,0.18)] ring-1 ring-black/5"
      style={{ ...style, background: "#ffffff" }}
    >
      <div className="flex items-start justify-between gap-[0.6cqw]">
        <div className="min-w-0">
          <p className="truncate text-[1.25cqw] font-semibold text-[#16203c]">{agent.name}</p>
          <p className="truncate text-[1cqw] text-[#7b8499]">{agent.role}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="-m-[0.4cqw] shrink-0 rounded-full p-[0.4cqw] text-[#98a1b6] hover:text-[#16203c]"
        >
          <svg viewBox="0 0 24 24" className="h-[1.2cqw] w-[1.2cqw]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m7 7 10 10M17 7 7 17" />
          </svg>
        </button>
      </div>

      <p className="mt-[0.7cqw] text-[0.95cqw] font-medium" style={{ color: agent.lifecycle === "planned" ? "#7b8499" : "#0d8a63" }}>
        {agent.lifecycle === "planned" ? "مصمَّم، لسه ما انبنى" : stateLabel(agent.state)}
      </p>

      {agent.capabilities.length > 0 && (
        <ul className="mt-[0.6cqw] space-y-[0.35cqw]">
          {agent.capabilities.slice(0, 4).map((c) => (
            <li key={c} className="flex gap-[0.45cqw] text-[0.95cqw] leading-[1.4] text-[#4a5470]">
              <span className="mt-[0.55cqw] h-[0.35cqw] w-[0.35cqw] shrink-0 rounded-full bg-[#c3cbdd]" />
              <span className="truncate">{c}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
