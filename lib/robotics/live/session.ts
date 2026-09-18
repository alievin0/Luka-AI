// A robot you can keep talking to.
//
// The demos each stand up a world, run, and throw it away. A conversation needs
// the opposite: one robot that persists between messages, keeps its memory, and
// carries on existing while nobody is instructing it — people keep walking, the
// battery keeps draining, the daemons keep watching.
//
// In-process and per-session, the same trade-off as `lib/cart.ts`. A fleet of
// these belongs behind a real process supervisor, not a module-level Map.
//
// This needs a server that stays alive: `npm start`, a container, a VM. On a
// serverless platform each request can land on a fresh instance, so the robot
// you were talking to may not be there next message, and the ambient clock
// stops when the invocation ends. The rest of the app is fine there; this part
// wants a process.

import { createSimRig, type SimRig } from "../index.ts";
import { createInMemoryBackend, type MemoryBackend } from "../core/memory.ts";
import type { AbilityEvent } from "../core/types.ts";
import type { ScenarioName } from "../sim/scenarios.ts";

export type SessionOptions = {
  scenario?: ScenarioName;
  seed?: number;
  /** 1 = wall clock. Higher makes the robot live faster than you talk. */
  realtimeFactor?: number;
  /** Bring up the safety daemons at start, as any real deployment would. */
  guardians?: boolean;
};

export type LiveEvent = AbilityEvent & { seq: number };

export class RobotSession {
  readonly id: string;
  readonly rig: SimRig;
  readonly createdAt = Date.now();
  readonly memory: MemoryBackend;

  private readonly events: LiveEvent[] = [];
  private readonly listeners = new Set<(event: LiveEvent) => void>();
  private readonly stopClock: () => void;
  private seq = 0;
  private lastTouched = Date.now();
  private busy = false;

  constructor(id: string, options: SessionOptions = {}) {
    this.id = id;
    this.memory = createInMemoryBackend();
    this.rig = createSimRig({
      scenario: options.scenario ?? "cluttered-office",
      seed: options.seed,
      realtimeFactor: 0,
      memoryBackend: this.memory,
    });

    this.rig.runtime.on((event) => {
      const live = { ...event, seq: (this.seq += 1) } as LiveEvent;
      this.events.push(live);
      if (this.events.length > 600) this.events.splice(0, this.events.length - 600);
      for (const listener of this.listeners) listener(live);
    });

    // The guardians come up first, exactly as they would on a real robot: you
    // do not attach a conversation to a machine and then decide about safety.
    if (options.guardians !== false) {
      this.rig.runtime.startDaemon("reflex.shield", {});
      this.rig.runtime.startDaemon("safety.stoppable", {});
      // The fly circuit runs alongside the geometric reflex rather than instead
      // of it. They answer different questions — one computes time-to-collision
      // from the robot's own speed, the other responds to something growing in
      // the scan whoever is moving — and measured on the same approach, the
      // looming circuit reacts about 0.4 m earlier.
      this.rig.runtime.startDaemon("reflex.looming", {});
    }

    this.stopClock = this.rig.runtime.startAmbientClock(options.realtimeFactor ?? 1);
  }

  touch(): void {
    this.lastTouched = Date.now();
  }

  get idleMs(): number {
    return Date.now() - this.lastTouched;
  }

  /** True while an ability is running — the robot can only do one thing at a time. */
  get isBusy(): boolean {
    return this.busy;
  }

  async withLock<T>(work: () => Promise<T>): Promise<T> {
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }

  subscribe(listener: (event: LiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Events the client has not seen yet. */
  since(seq: number): LiveEvent[] {
    return this.events.filter((event) => event.seq > seq);
  }

  /** A compact description of what the robot can see right now, for the model. */
  situation(): string {
    const robot = this.rig.world.robot(this.rig.robot.id);
    const humans = this.rig.robot.trackHumans();
    const objects = this.rig.robot.detectObjects();
    const battery = this.rig.robot.battery();
    const verdict = this.rig.governor.verdict();

    const lines = [
      `Position: (${robot.pose.x.toFixed(1)}, ${robot.pose.y.toFixed(1)}), facing ${((robot.pose.theta * 180) / Math.PI).toFixed(0)}°, moving at ${robot.linear.toFixed(2)} m/s.`,
      `World: ${this.rig.world.width} × ${this.rig.world.height} m, dock at (${this.rig.world.dock.x}, ${this.rig.world.dock.y}).`,
      `Battery: ${(battery.charge * 100).toFixed(0)}%.`,
      `Safety: ${verdict.level} — ${verdict.reason}.`,
      robot.holding ? `Holding: ${robot.holding}.` : "Hands empty.",
    ];

    lines.push(
      humans.length === 0
        ? "Nobody in sight."
        : `People: ${humans
            .map((h) => `${h.id} ${h.distance.toFixed(1)} m away${h.attentive ? " (looking at me)" : ""}`)
            .join(", ")}.`,
    );
    lines.push(
      objects.length === 0
        ? "No objects in view."
        : `In view: ${objects.map((o) => `${o.label} at (${o.at.x.toFixed(1)}, ${o.at.y.toFixed(1)})`).join(", ")}.`,
    );

    return lines.join("\n");
  }

  close(): void {
    this.stopClock();
    void this.rig.runtime.stopDaemons("session closed");
  }
}

const sessions = new Map<string, RobotSession>();
/** Sessions hold a running clock, so they cannot be left lying around. */
const IDLE_TIMEOUT_MS = 20 * 60 * 1000;

export function getSession(id: string, options?: SessionOptions): RobotSession {
  sweepIdle();
  let session = sessions.get(id);
  if (!session) {
    session = new RobotSession(id, options);
    sessions.set(id, session);
  }
  session.touch();
  return session;
}

export function endSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.close();
  sessions.delete(id);
}

export function activeSessions(): number {
  return sessions.size;
}

function sweepIdle(): void {
  for (const [id, session] of sessions) {
    if (session.idleMs > IDLE_TIMEOUT_MS) {
      session.close();
      sessions.delete(id);
    }
  }
}
