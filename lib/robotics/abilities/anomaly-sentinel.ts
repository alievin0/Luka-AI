// ── sense.anomaly · الحارس الحسّي ───────────────────────────────────────────
// Learning what "normal" sounds like, so "wrong" becomes obvious.
//
// Nobody writes a threshold for the vibration of a bearing that has not started
// failing yet. So this ability does not use thresholds: it spends its first
// minute learning the mean and spread of every health channel the robot
// exposes, then watches for sustained departures from that baseline. Because it
// learns per robot, a machine with a slightly noisy motor is not permanently
// alarming — it is just that machine's normal.

import { RunningStats } from "../core/math.ts";
import type { Ability, AbilityResult } from "../core/types.ts";

export type AnomalyInput = {
  /** How long to watch before judging anything, ms. */
  baselineMs?: number;
  /** Standard deviations away from baseline that count as odd. */
  zThreshold?: number;
  /** How long a channel must stay odd before it is reported, ms. */
  persistenceMs?: number;
  periodMs?: number;
  /** Escalate (stop the mission) when a channel exceeds this z-score. */
  escalateZ?: number;
};

export type AnomalyFinding = {
  channel: string;
  z: number;
  value: number;
  baseline: number;
  spread: number;
  firstSeenMs: number;
  /** Rising, falling or erratic relative to the baseline. */
  direction: "above" | "below";
};

export type AnomalyReport = {
  findings: AnomalyFinding[];
  channelsWatched: string[];
  baselineSamples: number;
  escalated: boolean;
};

export const anomalySentinel: Ability<AnomalyInput, AnomalyReport> = {
  manifest: {
    id: "sense.anomaly",
    version: "1.0.0",
    name: { en: "Anomaly Sentinel", ar: "الحارس الحسّي" },
    summary: {
      en: "Learns this robot's own normal across every health channel, then reports sustained departures from it — before they become failures.",
      ar: "بيتعلّم شو الوضع الطبيعي لهالروبوت بالذات بكل قنوات صحته، وبعدين بيبلّغ عن أي انحراف مستمر قبل ما يصير عطل.",
    },
    rationale:
      "Machines announce their failures long before they fail, in vibration, current " +
      "draw and temperature — but only relative to their own history. A fixed alarm " +
      "threshold is either deaf on a quiet robot or screaming on a noisy one. Learning " +
      "the baseline in situ, and demanding that an anomaly persist before it is " +
      "reported, gives you the early warning without the false alarms that make people " +
      "start ignoring the alerts.",
    tags: ["diagnostics", "maintenance", "daemon", "learning"],
    risk: "passive",
    requires: ["battery"],
    // It learns this robot's own baseline and reports sustained departures, which
    // means it must not learn a baseline out of a channel that has stopped
    // reporting — a dead channel is extremely consistent.
    evidence: [
      {
        source: "battery" as const,
        because: "draw against the learned baseline is the main thing it watches",
      },
      { source: "velocity" as const, because: "power draw only means something next to what the robot is doing" },
    ],
    proof: {
      status: "SIMULATED" as const,
      basis:
        "Detects injected health-channel faults in the simulator after they persist, against a " +
        "baseline it learned rather than a fixed threshold. Injected faults are not real ones.",
      verification:
        "Run a real robot long enough to establish a baseline, then degrade something physical " +
        "and measurable — a dragging brake, an under-inflated tyre — and check both that it " +
        "reports and how long it took.",
      failureModes: [
        "A fault present during baseline learning becomes the baseline.",
        "Slow degradation is exactly the case a learned baseline follows rather than reports.",
        "A frozen channel has zero variance and reads as a very healthy one.",
      ],
      degradedModes: [
        "It reports on the channels that are reporting and says which those are, rather than " +
          "treating a silent channel as a quiet one.",
      ],
      safetyBoundary:
        "Reports only. It escalates to the operator and never commands the robot.",
    },
    typicalDurationMs: 0,
    daemon: true,
    inputSchema: {
      type: "object",
      properties: {
        baselineMs: { type: "number", description: "Learning window, ms.", default: 20000 },
        zThreshold: { type: "number", description: "Sigmas that count as odd.", default: 4 },
        persistenceMs: { type: "number", description: "How long it must persist.", default: 3000 },
        periodMs: { type: "number", description: "Sample interval, ms.", default: 200 },
        escalateZ: { type: "number", description: "Sigmas that stop the mission.", default: 12 },
      },
      required: [],
    },
  },

  async run(input, ctx): Promise<AbilityResult<AnomalyReport>> {
    const baselineMs = input.baselineMs ?? 20_000;
    const zThreshold = input.zThreshold ?? 4;
    const persistenceMs = input.persistenceMs ?? 3000;
    const periodMs = input.periodMs ?? 200;
    const escalateZ = input.escalateZ ?? 12;

    const started = ctx.now();
    const stats = new Map<string, RunningStats>();
    const oddSince = new Map<string, number>();
    const findings = new Map<string, AnomalyFinding>();
    let baselineSamples = 0;
    let escalated = false;

    while (!ctx.signal.aborted) {
      const health = ctx.robot.health();
      const learning = ctx.now() - started < baselineMs;

      for (const [channel, value] of Object.entries(health)) {
        let channelStats = stats.get(channel);
        if (!channelStats) {
          channelStats = new RunningStats();
          stats.set(channel, channelStats);
        }

        if (learning) {
          channelStats.push(value);
          continue;
        }

        const z = channelStats.zScore(value);
        if (Math.abs(z) < zThreshold) {
          oddSince.delete(channel);
          continue;
        }

        const since = oddSince.get(channel);
        if (since === undefined) {
          oddSince.set(channel, ctx.now());
          continue;
        }

        if (ctx.now() - since < persistenceMs) continue;

        const existing = findings.get(channel);
        const finding: AnomalyFinding = {
          channel,
          z,
          value,
          baseline: channelStats.mean,
          spread: channelStats.stdDev,
          firstSeenMs: existing?.firstSeenMs ?? since,
          direction: z > 0 ? "above" : "below",
        };
        // Keep the worst reading seen for each channel.
        if (!existing || Math.abs(z) > Math.abs(existing.z)) findings.set(channel, finding);

        if (!existing) {
          ctx.robot.setLights("warning", "#f59e0b");
          ctx.emit({
            kind: "warn",
            message: `${channel} is ${Math.abs(z).toFixed(1)}σ ${finding.direction} its baseline (${value.toFixed(2)} vs ${channelStats.mean.toFixed(2)}±${channelStats.stdDev.toFixed(2)}) and has stayed there.`,
          });
          ctx.emit({ kind: "metric", name: `anomaly.${channel}`, value: z, unit: "σ" });
        }

        if (Math.abs(z) > escalateZ && !escalated) {
          escalated = true;
          ctx.robot.say(`Fault developing on ${channel}. في عطل عم يكبر.`);
          ctx.escalate(`anomaly sentinel: ${channel} at ${Math.abs(z).toFixed(1)}σ`);
        }
      }

      if (learning) baselineSamples += 1;
      await ctx.sleep(periodMs);
    }

    const report: AnomalyReport = {
      findings: [...findings.values()].sort((a, b) => Math.abs(b.z) - Math.abs(a.z)),
      channelsWatched: [...stats.keys()],
      baselineSamples,
      escalated,
    };

    const worst = report.findings[0];
    return {
      ok: report.findings.length === 0,
      summary: worst
        ? `${report.findings.length} channel(s) drifted from baseline — worst is ${worst.channel} at ${Math.abs(worst.z).toFixed(1)}σ ${worst.direction} normal (${worst.value.toFixed(2)} vs ${worst.baseline.toFixed(2)}). Have it looked at.`
        : `Nothing unusual across ${report.channelsWatched.length} channel(s) after ${baselineSamples} baseline samples.`,
      data: report,
      metrics: { findings: report.findings.length, worstZ: worst ? Math.abs(worst.z) : 0 },
    };
  },
};
