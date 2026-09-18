// The command that outlives the thing that sent it.
//
// This is the failure that hurts people, and it is boring:
//
//   1. Something commands 0.4 m/s forward.
//   2. The link spikes, the process throws, or the laptop sleeps.
//   3. Nothing else is sent.
//   4. The last command is still in effect, so the robot keeps going.
//
// Step 4 is the whole problem. A velocity command is a standing order, not an
// event, and on most platforms it stays in force until something replaces it.
// A timeout on the *sending* side does not help: the sender is the thing that
// died. What helps is the robot refusing to act on a stale order.
//
// So a command here carries an expiry. If no fresh command arrives before it,
// the base is driven to zero, repeatedly, and then latched — and it stays
// latched until somebody re-arms it deliberately. It never resumes on its own,
// because auto-resume means the robot starts moving again while nobody is
// watching, which is the same accident with extra steps.
//
// The guard is also the only path to the motors. Abilities hold a `RobotIO`
// that is really this wrapper, so there is no second route that skips it.

import type { RobotIO } from "../core/types.ts";

export type DeadmanOptions = {
  /**
   * How long a velocity command stays valid, ms. After this the base is
   * stopped. It should be a small multiple of the control period: long enough
   * that a normal scheduling hiccup does not trip it, short enough that the
   * robot does not travel far on a dead command.
   */
  commandTimeoutMs?: number;
  /**
   * How long to keep publishing zero after a timeout, ms. One zero can be the
   * message that gets dropped, and then the robot is still driving on the old
   * one. Repeating it for a burst is cheap insurance.
   */
  stopBurstMs?: number;
  /**
   * Whether the robot has its own command timeout in firmware. When it does,
   * this guard is a second line of defence. When it does not, this guard is
   * the only line of defence and it is running on the side of the link that
   * can fail — which is worth stating rather than assuming away.
   */
  robotSideWatchdog?: boolean;
  /** Clock, injectable so tests do not have to wait in real time. */
  now?: () => number;
  onEvent?: (event: DeadmanEvent) => void;
};

export type DeadmanEvent =
  | { kind: "expired"; ageMs: number; linear: number; angular: number }
  | { kind: "latched"; reason: string }
  | { kind: "rearmed" }
  | { kind: "refused"; reason: string };

export type DeadmanState = {
  armed: boolean;
  latched: boolean;
  reason: string;
  /** Age of the newest velocity command, ms. */
  commandAgeMs: number;
  /** Times the guard has stopped the base for a stale command. */
  expiries: number;
};

const DEFAULTS = {
  commandTimeoutMs: 300,
  stopBurstMs: 500,
};

/**
 * Wraps a `RobotIO` so velocity commands expire.
 *
 * Everything except `drive` and `stop` passes straight through: the guard has
 * an opinion about motion, not about sensing.
 */
export class Deadman {
  readonly commandTimeoutMs: number;
  readonly stopBurstMs: number;
  readonly robotSideWatchdog: boolean;

  private readonly io: RobotIO;
  private readonly now: () => number;
  private readonly onEvent?: (event: DeadmanEvent) => void;

  private lastCommandAt = 0;
  private lastCommand = { linear: 0, angular: 0 };
  private latched = false;
  private latchReason = "";
  private stopBurstUntil = 0;
  private expiries = 0;
  /** True once anything has asked for motion, so an idle robot is not "stale". */
  private commanded = false;

  constructor(io: RobotIO, options: DeadmanOptions = {}) {
    this.io = io;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULTS.commandTimeoutMs;
    this.stopBurstMs = options.stopBurstMs ?? DEFAULTS.stopBurstMs;
    this.robotSideWatchdog = options.robotSideWatchdog ?? false;
    this.now = options.now ?? (() => Date.now());
    this.onEvent = options.onEvent;
  }

  /**
   * The guarded interface. Hand this to abilities instead of the raw adapter.
   */
  guard(): RobotIO {
    const io = this.io;
    const self = this;
    // Delegate through the prototype chain so anything added to RobotIO later
    // keeps working without being listed here — only motion is intercepted.
    return Object.create(io, {
      drive: {
        value(linear: number, angular: number) {
          self.drive(linear, angular);
        },
      },
      stop: {
        value() {
          self.stop();
        },
      },
    }) as RobotIO;
  }

  /**
   * Called every control tick. This is what makes the expiry real — without
   * something checking, a stale command is just a stale timestamp.
   */
  tick(): void {
    const now = this.now();

    // Keep publishing zero for the burst window after a stop.
    if (now < this.stopBurstUntil) {
      this.io.drive(0, 0);
      return;
    }

    if (this.latched || !this.commanded) return;

    const age = now - this.lastCommandAt;
    if (age <= this.commandTimeoutMs) return;

    // Nothing has commanded the base recently. If it was asked to move, that
    // request is now old enough that whoever made it may be gone.
    // Keep the command before it is cleared. Reporting it afterwards describes
    // the zero the guard just wrote, not the order that went stale, and an
    // incident report that says "0.00 m/s went unrenewed" tells nobody anything.
    const stale = { ...this.lastCommand };
    const moving = stale.linear !== 0 || stale.angular !== 0;
    this.expiries += 1;
    this.onEvent?.({
      kind: "expired",
      ageMs: age,
      linear: stale.linear,
      angular: stale.angular,
    });

    this.io.drive(0, 0);
    this.io.stop();
    this.stopBurstUntil = now + this.stopBurstMs;
    this.lastCommand = { linear: 0, angular: 0 };
    this.commanded = false;

    if (moving) {
      // A command to move went stale. That is the dangerous case, and it
      // latches: the robot does not get to guess whether the sender is coming
      // back.
      this.latched = true;
      this.latchReason =
        `a velocity command (${this.lastCommandLabel(stale)}) went ${age.toFixed(0)} ms ` +
        `without renewal, past the ${this.commandTimeoutMs} ms limit. ` +
        "The base is stopped and stays stopped until something re-arms it deliberately.";
      this.onEvent?.({ kind: "latched", reason: this.latchReason });
    }
  }

  /**
   * Clear the latch. Deliberately not automatic, and deliberately not part of
   * `drive` — the whole point is that resuming motion is a decision somebody
   * makes, not a side effect of the next command arriving.
   */
  rearm(): { ok: boolean; reason?: string } {
    if (!this.latched) return { ok: true };

    const velocity = this.io.velocity();
    const moving = Math.abs(velocity.linear) > 0.02 || Math.abs(velocity.angular) > 0.05;
    if (moving) {
      // Re-arming a robot that is still rolling hands control back mid-motion.
      return {
        ok: false,
        reason:
          `the base is still moving at ${velocity.linear.toFixed(2)} m/s. ` +
          "Wait until it has stopped before re-arming.",
      };
    }

    this.latched = false;
    this.latchReason = "";
    this.lastCommandAt = this.now();
    this.onEvent?.({ kind: "rearmed" });
    return { ok: true };
  }

  state(): DeadmanState {
    return {
      armed: !this.latched,
      latched: this.latched,
      reason: this.latchReason,
      commandAgeMs: this.commanded ? this.now() - this.lastCommandAt : 0,
      expiries: this.expiries,
    };
  }

  /** Latch without waiting for an expiry — used when the link itself drops. */
  latch(reason: string): void {
    if (this.latched) return;
    this.io.drive(0, 0);
    this.io.stop();
    this.stopBurstUntil = this.now() + this.stopBurstMs;
    this.latched = true;
    this.latchReason = reason;
    this.commanded = false;
    this.onEvent?.({ kind: "latched", reason });
  }

  private drive(linear: number, angular: number): void {
    if (this.latched) {
      // A latched guard does not silently swallow motion: an ability that
      // thinks it is driving and is not will do something worse next.
      if (linear !== 0 || angular !== 0) {
        this.onEvent?.({
          kind: "refused",
          reason: `refused ${this.lastCommandLabel({ linear, angular })}: ${this.latchReason}`,
        });
      }
      this.io.drive(0, 0);
      return;
    }

    this.lastCommandAt = this.now();
    this.lastCommand = { linear, angular };
    this.commanded = linear !== 0 || angular !== 0;
    this.io.drive(linear, angular);
  }

  private stop(): void {
    this.lastCommandAt = this.now();
    this.lastCommand = { linear: 0, angular: 0 };
    this.commanded = false;
    this.io.stop();
  }

  private lastCommandLabel(command: { linear: number; angular: number }): string {
    return `${command.linear.toFixed(2)} m/s, ${command.angular.toFixed(2)} rad/s`;
  }
}
