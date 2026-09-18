"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Campus from "./campus";
import { KpiRow, Rail, ReplayBar, Sidebar, TopBar } from "./chrome";
import {
  deriveEdges,
  deriveKpis,
  eventLabel,
  reachedStage,
  stageOf,
  zoned,
  type Agent,
  type Booking,
  type Business,
  type Conversation,
  type Escalation,
  type ModelStatus,
  type Storage,
  type Task,
  type WorldEvent,
} from "./model";

/**
 * عالم الوكلاء — the operator's view of the running system.
 *
 * The picture at the centre is the client's own design, shipped as the floor
 * of the page rather than reinterpreted: what sat on top of it in the mockup
 * now comes from `/api/desk`. Agents light up because they are working, the
 * pulses crossing between buildings are messages that actually crossed, the
 * stat cards count records, and the strip along the bottom replays a real
 * conversation step by step.
 *
 * The discipline that matters here is that nothing is decorative. A metric
 * with no baseline shows a dash; an agent with no code behind it is drawn as
 * a dashed, unlit pin and labelled "قيد التطوير"; a nav item that leads
 * nowhere is not a link. The design survives being honest.
 */

type Snapshot = {
  business?: Business;
  agents?: Agent[];
  events?: WorldEvent[];
  bookings?: Booking[];
  escalations?: Escalation[];
  tasks?: Task[];
  conversations?: Conversation[];
  storage?: Storage;
  model?: ModelStatus;
};

type QueuedPulse = { id: number; from: string; to: string; kind: string };

/** How long a replayed step is held on screen when the real gap was instant. */
const MIN_STEP_SECONDS = 0.9;

export default function WorldPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [snap, setSnap] = useState<Snapshot>({});
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [clock, setClock] = useState("");

  const [mode, setMode] = useState<"live" | "replay">("live");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [replayStage, setReplayStage] = useState(-1);

  const [pulses, setPulses] = useState<QueuedPulse[]>([]);
  const nextPulseId = useRef(1);
  const seenEvents = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const agents = useMemo(() => snap.agents ?? [], [snap.agents]);
  const events = useMemo(() => snap.events ?? [], [snap.events]);
  const tasks = useMemo(() => snap.tasks ?? [], [snap.tasks]);
  const conversations = useMemo(() => snap.conversations ?? [], [snap.conversations]);
  const escalations = useMemo(() => snap.escalations ?? [], [snap.escalations]);
  const bookings = useMemo(() => snap.bookings ?? [], [snap.bookings]);
  const business = snap.business ?? businesses.find((b) => b.id === businessId) ?? null;
  const timezone = business?.timezone ?? "Asia/Amman";

  const queuePulse = useCallback((from: string, to: string, kind: string) => {
    const id = nextPulseId.current++;
    setPulses((list) => [...list.slice(-24), { id, from, to, kind }]);
  }, []);

  /* ── data ────────────────────────────────────────────────────────────── */

  useEffect(() => {
    fetch("/api/desk")
      .then((r) => r.json())
      .then((d) => {
        setBusinesses(d.businesses ?? []);
        setStorage(d.storage ?? null);
        setModel(d.model ?? null);
        if (d.businesses?.length) setBusinessId(d.businesses[0].id);
      })
      .catch(() => setError("ما قدرت أجيب قائمة الأنشطة."));
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let alive = true;

    const pull = async () => {
      try {
        const res = await fetch(`/api/desk?business=${encodeURIComponent(businessId)}`);
        const d = (await res.json()) as Snapshot;
        if (!alive || !res.ok) return;
        setSnap(d);
        if (d.storage) setStorage(d.storage);
        if (d.model) setModel(d.model);
        setError(null);
      } catch {
        if (alive) setError("تعذّر تحديث حالة العالم.");
      }
    };

    // Polling, not a socket: the stream is low-volume and this keeps the
    // deployment free of a stateful connection.
    pull();
    const timer = setInterval(pull, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [businessId]);

  // Switching business swaps the whole world; nothing from the old one may
  // survive into the new one's animation or selection.
  useEffect(() => {
    seenEvents.current = new Set();
    primed.current = false;
    setPulses([]);
    setSelected(null);
    setMode("live");
    setPlaying(false);
    setElapsed(0);
    setReplayStage(-1);
  }, [businessId]);

  useEffect(() => {
    const tick = () => {
      const z = zoned(Date.now(), timezone);
      setClock(z ? `${z.hhmm}` : "");
    };
    tick();
    const t = setInterval(tick, 20_000);
    return () => clearInterval(t);
  }, [timezone]);

  /* ── live traffic ────────────────────────────────────────────────────── */

  useEffect(() => {
    const fresh = events.filter((e) => !seenEvents.current.has(e.id));
    // The first response is history, not news: adopt it silently, or opening
    // the page replays every event ever recorded in one burst. Events that
    // land while a replay is running are adopted the same way, so returning
    // to live does not fire everything that happened in the meantime at once.
    const announce = primed.current && mode === "live";
    primed.current = true;
    for (const e of [...fresh].reverse()) {
      seenEvents.current.add(e.id);
      if (announce && e.from && e.to) queuePulse(e.from, e.to, e.kind);
    }
  }, [events, mode, queuePulse]);

  /* ── replay ──────────────────────────────────────────────────────────── */

  const replayTask = tasks[0] ?? null;

  /** The task's own events, in order, with the offset each one plays at. */
  const timeline = useMemo(() => {
    if (!replayTask) return [] as Array<{ at: number; event: WorldEvent }>;
    const mine = events
      .filter((e) => e.taskId === replayTask.id)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!mine.length) return [];

    const base = new Date(mine[0].createdAt).getTime();
    let previous = -Infinity;
    return mine.map((event, i) => {
      const real = (new Date(event.createdAt).getTime() - base) / 1000;
      // Steps written in the same millisecond would all fire at once; hold
      // each one long enough to be seen without stretching a genuine gap.
      const at = Math.max(Number.isFinite(real) ? real : i * MIN_STEP_SECONDS, previous + MIN_STEP_SECONDS);
      previous = at;
      return { at, event };
    });
  }, [events, replayTask]);

  const replayTotal = timeline.length ? timeline[timeline.length - 1].at + 1 : 0;

  const startReplay = useCallback(() => {
    setPulses([]);
    setElapsed(0);
    setReplayStage(-1);
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (mode !== "replay" || !playing) return;
    const step = 0.1;
    const timer = setInterval(() => {
      setElapsed((e) => e + step * speed);
    }, step * 1000);
    return () => clearInterval(timer);
  }, [mode, playing, speed]);

  const playedTo = useRef(-1);
  useEffect(() => {
    if (mode !== "replay") return;
    for (let i = 0; i < timeline.length; i++) {
      if (i <= playedTo.current) continue;
      if (timeline[i].at > elapsed) break;
      playedTo.current = i;
      const e = timeline[i].event;
      if (e.from && e.to) queuePulse(e.from, e.to, e.kind);
      const st = stageOf(e.kind);
      if (st >= 0) setReplayStage((s) => Math.max(s, st));
    }
    if (replayTotal > 0 && elapsed >= replayTotal) {
      setPlaying(false);
      if (replayTask?.status === "completed") setReplayStage(5);
    }
  }, [elapsed, mode, timeline, replayTotal, replayTask, queuePulse]);

  const changeMode = useCallback(
    (next: "live" | "replay") => {
      setMode(next);
      playedTo.current = -1;
      if (next === "replay") startReplay();
      else {
        setPlaying(false);
        setElapsed(0);
        setPulses([]);
      }
    },
    [startReplay],
  );

  const toggle = useCallback(() => {
    if (mode !== "replay") return;
    // Pressing play at the end starts the conversation over rather than
    // sitting on a finished bar.
    if (!playing && elapsed >= replayTotal) {
      playedTo.current = -1;
      startReplay();
      return;
    }
    setPlaying((p) => !p);
  }, [mode, playing, elapsed, replayTotal, startReplay]);

  /* ── derived view state ──────────────────────────────────────────────── */

  const kpis = useMemo(
    () =>
      deriveKpis({
        business: business ?? undefined,
        agents,
        events,
        bookings,
        escalations,
        tasks,
        conversations,
      }),
    [business, agents, events, bookings, escalations, tasks, conversations],
  );

  const edges = useMemo(() => deriveEdges(events), [events]);

  const inbound = useMemo(() => {
    const hit = events.find((e) => e.kind === "message_received");
    if (!hit) return null;
    return { text: hit.summary, at: hit.createdAt, channel: hit.to ?? "channel-web" };
  }, [events]);

  const needle = query.trim().toLowerCase();
  const filteredEvents = useMemo(() => {
    if (!needle) return events;
    return events.filter((e) =>
      [eventLabel(e.kind), e.kind, e.summary, e.agentCode ?? ""].some((v) =>
        v.toLowerCase().includes(needle),
      ),
    );
  }, [events, needle]);

  const filteredAgents = useMemo(() => {
    if (!needle) return agents;
    return agents.filter((a) =>
      [a.name, a.role, a.code, a.zone].some((v) => v.toLowerCase().includes(needle)),
    );
  }, [agents, needle]);

  const liveStage = reachedStage(replayTask);
  const liveElapsed = replayTask
    ? Math.max(
        0,
        ((replayTask.endedAt ? new Date(replayTask.endedAt).getTime() : Date.now()) -
          new Date(replayTask.startedAt).getTime()) /
          1000,
      )
    : 0;

  const openConversations = conversations.filter((c) => c.status !== "closed").length;

  return (
    <div
      dir="rtl"
      // The design puts the nav on the left and the rail on the right; RTL flow
      // alone would mirror both, so the two page-level rows are reversed and
      // only the text inside the panels follows the document direction.
      className="flex h-screen flex-row-reverse gap-2.5 bg-[#eef1f8] p-2.5 text-[#16203c]"
    >
      <Sidebar
        business={business}
        openConversations={openConversations}
        openEscalations={escalations.length}
      />

      <main className="flex min-w-0 flex-1 flex-col gap-2.5">
        <TopBar
          business={business}
          businesses={businesses}
          onBusiness={setBusinessId}
          query={query}
          onQuery={setQuery}
          healthy={Boolean(model?.configured)}
          healthNote={
            [
              model?.configured ? "النموذج موصول." : "مفتاح النموذج ناقص.",
              storage?.message ?? "",
            ]
              .filter(Boolean)
              .join(" ")
          }
          clock={clock}
        />

        <KpiRow kpis={kpis} />

        <div className="flex min-h-0 flex-1 flex-row-reverse gap-2.5">
          <section className="flex min-w-0 flex-1 items-center justify-center" onClick={() => setSelected(null)}>
            <Campus
              agents={agents}
              edges={edges}
              inbound={inbound}
              escalation={escalations[0] ?? null}
              selected={selected}
              onSelect={setSelected}
              pulseQueue={pulses}
            />
          </section>

          <Rail
            agents={filteredAgents}
            events={filteredEvents}
            showAll={showAllEvents}
            onShowAll={() => setShowAllEvents((v) => !v)}
            selected={selected}
            onSelect={setSelected}
            timezone={timezone}
          />
        </div>

        <ReplayBar
          task={replayTask}
          mode={mode}
          playing={playing}
          speed={speed}
          elapsed={mode === "replay" ? Math.min(elapsed, replayTotal) : liveElapsed}
          total={mode === "replay" ? replayTotal : liveElapsed}
          stage={mode === "replay" ? replayStage : liveStage}
          onMode={changeMode}
          onSpeed={setSpeed}
          onToggle={toggle}
        />
      </main>

      {error && (
        <p
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-[#16203c] px-4 py-2 text-[12.5px] text-white shadow-lg"
        >
          {error}
        </p>
      )}
    </div>
  );
}
