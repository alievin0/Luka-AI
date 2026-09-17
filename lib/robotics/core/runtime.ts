// The runtime owns the clock, the event stream and the safety interlocks, and
// runs abilities against them. Under the simulator the clock is virtual: a
// sixty-second mission finishes in milliseconds and replays identically.

import { makeRng } from "./math.ts";
import { validate } from "./schema.ts";
import type { AbilityRegistry } from "./registry.ts";
import { createInMemoryBackend, createMemory, sharedBackend, type MemoryBackend } from "./memory.ts";
import { SafetyGovernor } from "../safety/governor.ts";
import { Deadman } from "../hal/deadman.ts";
import type { LinkProfile } from "../hal/profile.ts";
import { SimRobotAdapter } from "../sim/adapter.ts";
import { SimWorld } from "../sim/world.ts";
import type {
  Ability,
  AbilityContext,
  AbilityEvent,
  AbilityEventInput,
  AbilityResult,
  RobotIO,
  TwinRuntime,
} from "./types.ts";

export type RuntimeOptions = {
  registry: AbilityRegistry;
  robot: RobotIO;
  governor: SafetyGovernor;
  /** Present when running in simulation; absent on real hardware. */
  world?: SimWorld;
  seed?: number;
  memoryBackend?: MemoryBackend;
  /**
   * 0 = run as fast as the CPU allows (tests, rehearsals).
   * 1 = wall-clock pace (live UI). 2 = half speed, and so on.
   */
  realtimeFactor?: number;
  /** Physics/control period in seconds. */
  tickSeconds?: number;
  /** Abort a run that exceeds this much simulated time. */
  maxSimMs?: number;
  /**
   * What commands cross. Given a link that can drop, the runtime puts a deadman
   * between abilities and the motors, so a command that is not renewed stops the
   * robot instead of standing forever.
   */
  link?: LinkProfile;
};

export type RunHandle<O = unknown> = {
  abilityId: string;
  /**
   * The raw result. Awaiting this directly only works while something else is
   * driving the simulated clock — otherwise use `wait()`.
   */
  promise: Promise<AbilityResult<O>>;
  /** Await the result while advancing the world. This is almost always what you want. */
  wait: () => Promise<AbilityResult<O>>;
  abort: (reason?: string) => void;
};

export class RobotRuntime {
  readonly registry: AbilityRegistry;
  /**
   * What abilities drive. When the link can fail this is a guarded interface,
   * not the raw adapter, and it is the only path to the motors.
   */
  readonly robot: RobotIO;
  /** The raw adapter, for the parts of the runtime that must not be guarded. */
  readonly rawRobot: RobotIO;
  /**
   * Present when commands expire. A deadman that is not on the command path is
   * not a safety mechanism, so this is constructed here rather than left for a
   * caller to remember.
   */
  readonly deadman?: Deadman;
  readonly governor: SafetyGovernor;
  readonly world?: SimWorld;

  private readonly listeners = new Set<(event: AbilityEvent) => void>();
  private readonly timeline: AbilityEvent[] = [];
  private readonly memoryBackend: MemoryBackend;
  private readonly realtimeFactor: number;
  private readonly tickSeconds: number;
  private readonly maxSimMs: number;
  private readonly rng: () => number;
  private readonly daemons: Array<{ handle: RunHandle; controller: AbortController }> = [];
  private readonly foreground = new Set<AbortController>();
  private escalation: string | null = null;

  /** Wall-clock origin, used when there is no simulator to provide a clock. */
  private readonly wallStart = Date.now();
  /** Identity used to claim the shared simulated clock. */
  private readonly pumpToken = {};

  constructor(options: RuntimeOptions) {
    this.registry = options.registry;
    this.rawRobot = options.robot;
    this.governor = options.governor;

    // A link that cannot drop does not need commands to expire, and making an
    // in-process simulator behave as though it might introduces a failure the
    // real system does not have. Anything else gets the guard.
    const link = options.link;
    if (link && link.kind !== "loopback") {
      this.deadman = new Deadman(options.robot, {
        // Twice the control period, so an ordinary scheduling hiccup does not
        // trip it but a dead sender does.
        commandTimeoutMs: Math.max(link.controlPeriodMs * 2, 100),
        robotSideWatchdog: link.robotSideWatchdogMs !== null,
        now: () => this.now(),
        onEvent: (event) => {
          if (event.kind === "latched") {
            this.emit({ kind: "warn", message: `deadman: ${event.reason}` });
          } else if (event.kind === "refused") {
            this.emit({ kind: "warn", message: `deadman: ${event.reason}` });
          }
        },
      });
      this.robot = this.deadman.guard();
    } else {
      this.robot = options.robot;
    }

    this.world = options.world;
    this.memoryBackend = options.memoryBackend ?? sharedBackend;
    this.realtimeFactor = options.realtimeFactor ?? 0;
    this.tickSeconds = options.tickSeconds ?? 0.02;
    this.maxSimMs = options.maxSimMs ?? 10 * 60 * 1000;
    this.rng = makeRng(options.seed ?? 20260917);
  }

  /**
   * This robot's memory, for a caller outside an ability that needs to read
   * what one published — a viewer drawing the state of a circuit, say.
   */
  memory(): ReturnType<typeof createMemory> {
    return createMemory(`${this.rawRobot.id}`, this.memoryBackend);
  }

  // --- events --------------------------------------------------------------

  on(listener: (event: AbilityEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  events(): AbilityEvent[] {
    return [...this.timeline];
  }

  emit(event: AbilityEventInput): void {
    const full = { ...event, t: this.now() } as AbilityEvent;
    this.timeline.push(full);
    for (const listener of this.listeners) listener(full);
  }

  // --- clock ---------------------------------------------------------------

  now(): number {
    return this.world ? this.world.timeMs : Date.now() - this.wallStart;
  }

  /**
   * Wait on the robot's clock. An aborted ability wakes immediately — otherwise
   * a daemon sleeping on a virtual clock that has stopped advancing would hang
   * forever after its mission ended.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();

    if (!this.world) {
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, Math.max(0, ms));
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }

    if (ms <= 0) return Promise.resolve();

    const waiter = this.world.waitUntil(this.now() + ms);
    signal?.addEventListener("abort", waiter.cancel, { once: true });
    return waiter.promise;
  }

  // --- running abilities ---------------------------------------------------

  /** Start an ability without waiting for it — used for daemons and peers. */
  start<I, O>(abilityId: string, input: I): RunHandle<O> {
    const ability = this.registry.require<I, O>(abilityId);
    const controller = new AbortController();
    const context = this.makeContext(ability, controller.signal);

    if (!ability.manifest.daemon) this.foreground.add(controller);

    const promise = this.invoke(ability, input, context).finally(() => {
      this.foreground.delete(controller);
    });
    const handle: RunHandle<O> = {
      abilityId,
      promise,
      wait: () => this.settle(promise),
      abort: (reason = "aborted by runtime") => controller.abort(reason),
    };
    if (ability.manifest.daemon) {
      this.daemons.push({ handle: handle as RunHandle, controller });
    }
    return handle;
  }

  /**
   * Abort every foreground ability. Daemons stay up — the point of escalating
   * is usually that a guardian needs the robot to do something else instead.
   */
  escalate(reason: string): void {
    this.escalation = reason;
    this.emit({ kind: "warn", message: `Escalation — ${reason}` });
    for (const controller of this.foreground) controller.abort(reason);
    this.foreground.clear();
  }

  /** Why the last escalation happened, if there was one. */
  lastEscalation(): string | null {
    return this.escalation;
  }

  /**
   * A disposable copy of this robot and its world, for rehearsing a plan
   * without touching reality. The copy starts from the live world's current
   * state, gets its own seed, and shares nothing with the original — including
   * memory, so a rehearsal cannot teach the robot something that never
   * happened.
   */
  fork(options: { seed: number; noise?: number }): TwinRuntime | null {
    if (!this.world) return null;

    const snapshot = this.world.snapshot();
    if (options.noise !== undefined) snapshot.config.noise = options.noise;
    const twinWorld = SimWorld.restore(snapshot, options.seed);

    const governor = new SafetyGovernor({ limits: this.governor.limits });
    const twinRobot = new SimRobotAdapter(twinWorld, this.robot.id, governor, {
      capabilities: [...this.robot.capabilities],
    });
    const twinRuntime = new RobotRuntime({
      registry: this.registry,
      robot: twinRobot,
      governor,
      world: twinWorld,
      seed: options.seed,
      memoryBackend: createInMemoryBackend(),
      realtimeFactor: 0,
      tickSeconds: this.tickSeconds,
      maxSimMs: this.maxSimMs,
    });

    return {
      run: <I, O>(abilityId: string, input: I) =>
        twinRuntime.run<I, O>(abilityId, input),
      stopDaemons: (reason) => twinRuntime.stopDaemons(reason),
      state: () => {
        const self = twinWorld.robot(this.robot.id);
        return {
          x: self.pose.x,
          y: self.pose.y,
          charge: self.charge,
          collisions: self.collisions,
          timeMs: twinWorld.timeMs,
        };
      },
    };
  }

  /** Run an ability to completion, pumping the simulated clock as it waits. */
  async run<I, O>(abilityId: string, input: I): Promise<AbilityResult<O>> {
    const handle = this.start<I, O>(abilityId, input);
    return this.settle(handle.promise);
  }

  /** Start a background daemon (reflex shield, power lifeline, …). */
  startDaemon<I, O>(abilityId: string, input: I): RunHandle<O> {
    const ability = this.registry.require(abilityId);
    if (!ability.manifest.daemon) {
      throw new Error(`Ability "${abilityId}" is not a daemon.`);
    }
    return this.start<I, O>(abilityId, input);
  }

  /**
   * Keep the world running when no ability is doing it.
   *
   * Normally the clock only advances while something is awaiting a result. For
   * a robot you are talking to, that is wrong: between instructions the world
   * should keep existing — people keep walking, the battery keeps draining, the
   * daemons keep watching. This holds the pump and steps at wall-clock pace
   * until stopped.
   */
  startAmbientClock(realtimeFactor = 1): () => void {
    if (!this.world) return () => {};

    let running = true;
    const periodMs = Math.max((this.tickSeconds * 1000) / Math.max(realtimeFactor, 0.01), 1);

    const loop = async () => {
      while (running) {
        if (this.world?.acquirePump(this.pumpToken)) this.advance();
        else this.governor.assess(this.robot);
        await new Promise((resolve) => setTimeout(resolve, periodMs));
      }
      this.world?.releasePump(this.pumpToken);
    };
    void loop();

    return () => {
      running = false;
    };
  }

  /**
   * Stop every daemon and wait for them to wind down. Daemons own the safety
   * story, so a mission is not finished until they have actually stopped.
   */
  async stopDaemons(reason = "mission finished"): Promise<void> {
    const running = [...this.daemons];
    this.daemons.length = 0;
    for (const daemon of running) daemon.controller.abort(reason);
    await Promise.allSettled(running.map((d) => d.handle.promise));
  }

  /**
   * Advance the world until `promise` settles. Everything sleeping on the
   * virtual clock wakes in timestamp order, so daemons and the foreground
   * ability interleave deterministically.
   */
  async settle<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    let outcome: { ok: true; value: T } | { ok: false; error: unknown } | null = null;
    promise.then(
      (value) => {
        outcome = { ok: true, value };
        done = true;
      },
      (error) => {
        outcome = { ok: false, error };
        done = true;
      },
    );

    const deadline = this.now() + this.maxSimMs;
    while (!done) {
      await drainMicrotasks();
      if (done) break;
      if (!this.world) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        continue;
      }
      if (this.now() > deadline) {
        this.governor.emergencyStop("runtime deadline exceeded");
        throw new Error(`Ability run exceeded ${this.maxSimMs} ms of simulated time.`);
      }

      // Only one runtime drives the shared clock; the rest keep their own
      // safety picture fresh and wait for the owner to advance it.
      if (this.world.acquirePump(this.pumpToken)) {
        this.advance();
      } else {
        this.governor.assess(this.robot);
        await new Promise((resolve) => setImmediate(resolve));
      }

      if (this.realtimeFactor > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, (this.tickSeconds * 1000) / this.realtimeFactor),
        );
      }
    }
    this.world?.releasePump(this.pumpToken);

    const settled = outcome as
      | { ok: true; value: T }
      | { ok: false; error: unknown }
      | null;
    if (!settled) throw new Error("Runtime settled without an outcome.");
    if (settled.ok) return settled.value;
    throw settled.error;
  }

  /** One control period: step physics (which wakes sleepers), then re-assess. */
  private advance(): void {
    if (!this.world) return;
    const before = this.world.timeMs;
    this.world.step(this.tickSeconds);
    // Checked every control tick: an expiry that nothing looks at is just a
    // stale timestamp.
    this.deadman?.tick();
    // The control period is the floor on how fast the robot can react to
    // anything. Telling the governor keeps its separation model honest instead
    // of trusting a constant somebody typed once.
    this.governor.observeLatency((this.world.timeMs - before) / 1000);
    this.governor.assess(this.robot);
  }

  private makeContext(ability: Ability<never, unknown>, signal: AbortSignal): AbilityContext {
    const memory = createMemory(`${this.robot.id}`, this.memoryBackend);
    const runtime = this;
    return {
      robot: this.robot,
      safety: this.governor,
      memory,
      emit: (event) => runtime.emit(event),
      now: () => runtime.now(),
      sleep: (ms) => runtime.sleep(ms, signal),
      signal,
      random: this.rng,
      deadman: this.deadman
        ? {
            isLatched: () => this.deadman!.state().latched,
            expiries: () => this.deadman!.state().expiries,
            rearm: () => this.deadman!.rearm(),
          }
        : undefined,
      escalate: (reason) => runtime.escalate(reason),
      twin: this.world ? (options) => runtime.fork(options) : undefined,
      call: async <I, O>(abilityId: string, input: I): Promise<AbilityResult<O>> => {
        const sub = runtime.registry.require<I, O>(abilityId);
        const subContext = runtime.makeContext(
          sub as unknown as Ability<never, unknown>,
          signal,
        );
        return runtime.invoke<I, O>(sub, input, subContext);
      },
    };
  }

  /** Validate input, enforce the risk policy, then run — with failures contained. */
  private async invoke<I, O>(
    ability: Ability<I, O>,
    input: I,
    context: AbilityContext,
  ): Promise<AbilityResult<O>> {
    const { manifest } = ability;

    const missing = manifest.requires.filter(
      (cap) => !this.robot.capabilities.includes(cap),
    );
    if (missing.length > 0) {
      return fail(`${manifest.id} needs hardware this robot lacks: ${missing.join(", ")}`, "hardware");
    }

    const parsed = validate<I>(manifest.inputSchema, input ?? {});
    if (!parsed.ok) {
      return fail(`${manifest.id} input rejected — ${parsed.errors.join("; ")}`, "precondition");
    }

    if (manifest.risk === "contact" && !this.governor.permitContact(manifest.id)) {
      return fail(`${manifest.id} refused: contact is not permitted right now.`, "unsafe");
    }
    if (manifest.risk !== "critical" && this.governor.isStopped()) {
      return fail(`${manifest.id} refused: emergency stop is latched.`, "unsafe");
    }

    if (ability.precondition) {
      const check = ability.precondition(parsed.value, context);
      if (!check.ok) {
        return fail(`${manifest.id} precondition failed: ${check.reason ?? "unspecified"}`, "precondition");
      }
    }

    const privileged =
      manifest.risk === "critical" && isSimAdapter(this.robot) ? this.robot : null;
    if (privileged) privileged.privileged = true;

    this.emit({ kind: "status", message: `▶ ${manifest.name.en}`, ar: `▶ ${manifest.name.ar}` });

    try {
      const result = await ability.run(parsed.value, context);
      this.emit({ kind: "result", ok: result.ok, summary: result.summary });
      return result;
    } catch (error) {
      if (context.signal.aborted) {
        return fail(`${manifest.id} aborted.`, "aborted");
      }
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ kind: "warn", message: `${manifest.id} threw: ${message}` });
      return fail(`${manifest.id} failed: ${message}`, "hardware");
    } finally {
      if (privileged) privileged.privileged = false;
      if (manifest.risk !== "passive") this.robot.stop();
    }
  }
}

function fail<O>(summary: string, failure: AbilityResult["failure"]): AbilityResult<O> {
  return { ok: false, summary, failure };
}

function isSimAdapter(robot: RobotIO): robot is SimRobotAdapter {
  return "privileged" in robot;
}

/** Let every queued promise continuation run before touching the clock again. */
function drainMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
