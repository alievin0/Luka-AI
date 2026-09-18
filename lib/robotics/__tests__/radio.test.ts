// A message sent is not a message received.
//
// The radio used to be a shared log: every frame reached every reader,
// instantly, in order, always. That is not a radio, it is a variable. The
// proof record for `swarm.auction` said as much — "the simulated radio does
// not drop, duplicate or reorder; a real one does all three" — which was a
// defect written down and never tested, exactly like the odometry drift that
// `explore.frontier` listed among its failure modes and the simulator could
// not produce.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSimRig } from "../index.ts";

const TASKS = [
  { id: "job-north", x: 18, y: 2 },
  { id: "job-south", x: 3, y: 12 },
  { id: "job-mid", x: 10, y: 7 },
];

type AuctionReport = {
  awards: Array<{ taskId: string; robot: string }>;
  unassigned: string[];
  unconfirmed: string[];
};

/** Run one auction over a fleet and report what each side believes. */
async function auction(seed: number, radioLoss: number) {
  const rig = createSimRig({ scenario: "warehouse-fleet", seed, wholeFleet: true, radioLoss });
  const [auctioneerId, ...bidderIds] = [...rig.fleet.keys()];
  const bidders = bidderIds.map((id) =>
    rig.fleet.get(id)!.runtime.start("swarm.auction", { role: "bidder", listenMs: 9000 }),
  );
  const result = await rig.fleet
    .get(auctioneerId)!
    .runtime.run<{ role: string; tasks: typeof TASKS }, AuctionReport>("swarm.auction", {
      role: "auctioneer",
      tasks: TASKS,
    });
  const outcomes = await Promise.all(bidders.map((b) => b.wait()));
  for (const member of rig.fleet.values()) await member.runtime.stopDaemons("test over");

  const claimed = new Set<string>();
  for (const outcome of outcomes) {
    for (const won of (outcome.data as { won?: string[] } | undefined)?.won ?? []) claimed.add(won);
  }
  const report = result.data!;
  // Jobs the books call awarded whose winner never heard. The auctioneer's own
  // wins do not need a frame to arrive — it wrote them down itself.
  const orphaned = report.awards.filter(
    (award) => award.robot !== auctioneerId && !claimed.has(award.taskId),
  );
  return { report, orphaned: orphaned.map((a) => a.taskId) };
}

test("frames are lost per receiver, not per message", () => {
  // The failure that breaks agreement between robots is one of them hearing an
  // announcement that another missed. Uniform loss would be a much easier
  // problem and is not the one radios have.
  const rig = createSimRig({ scenario: "warehouse-fleet", seed: 1, wholeFleet: true, radioLoss: 0.4 });
  const [speaker, ...listeners] = [...rig.fleet.values()];
  for (let i = 0; i < 40; i += 1) speaker.robot.broadcast("test", { i });

  const heard = listeners.map((l) => l.robot.receive("test").length);
  assert.ok(heard.every((n) => n < 40), "a listener heard every frame at 40% loss");
  assert.ok(heard.some((n) => n > 0), "no listener heard anything, which is not loss, it is silence");
  assert.ok(
    new Set(heard).size > 1,
    `every listener heard exactly ${heard[0]} frames, so the loss is shared rather than per receiver`,
  );
});

test("a lost frame stays lost however many times it is asked for", () => {
  // Otherwise a caller polls its way out of packet loss, which is not a thing
  // radios let you do, and every protocol built on top would be tested against
  // a link that heals when observed.
  const rig = createSimRig({ scenario: "warehouse-fleet", seed: 2, wholeFleet: true, radioLoss: 0.5 });
  const [speaker, listener] = [...rig.fleet.values()];
  for (let i = 0; i < 30; i += 1) speaker.robot.broadcast("stable", { i });

  const first = listener.robot.receive("stable").length;
  const second = listener.robot.receive("stable").length;
  assert.ok(first < 30, "this test needs frames to have been lost");
  assert.equal(second, 0, "asking again delivered frames that had been dropped");
});

test("a job the winner never heard about is reported, not booked as done", async () => {
  // The finding. At ten per cent frame loss — an ordinary indoor mesh — one job
  // in six was awarded to a robot that never learned it had won, while
  // `unassigned` stayed empty and the auction reported complete success. The
  // books said the work was allocated and nobody was doing it.
  //
  // The award is acknowledged now, so an orphan becomes a number somebody can
  // act on rather than a silence.
  let orphansMissed = 0;
  let orphansSeen = 0;

  for (const loss of [0.1, 0.2, 0.4]) {
    for (let seed = 1; seed <= 6; seed += 1) {
      const { report, orphaned } = await auction(seed, loss);
      orphansSeen += orphaned.length;
      for (const id of orphaned) {
        if (!report.unconfirmed.includes(id)) orphansMissed += 1;
      }
    }
  }

  assert.ok(orphansSeen > 0, "no job was ever orphaned, so this proves nothing about catching them");
  assert.equal(
    orphansMissed,
    0,
    `${orphansMissed} job(s) were awarded to a robot that never heard, and the auction did not say so`,
  );
});

test("a healthy radio allocates everything and confirms everything", async () => {
  // The other half: the acknowledgement must not invent a problem when there is
  // none, or nobody will believe it when there is.
  const { report, orphaned } = await auction(1, 0);
  assert.equal(orphaned.length, 0);
  assert.deepEqual(report.unconfirmed, []);
  assert.deepEqual(report.unassigned, []);
  assert.equal(report.awards.length, TASKS.length);
});

test("the auction never awards one job to two robots", async () => {
  // The failure that would be worse than losing a job: two robots driving to
  // the same place, each believing it is theirs. Loss can make the fleet do
  // less work than it thinks; it must not make it collide over the same work.
  for (const loss of [0, 0.1, 0.3]) {
    for (let seed = 1; seed <= 4; seed += 1) {
      const { report } = await auction(seed, loss);
      const seen = new Set<string>();
      for (const award of report.awards) {
        assert.ok(!seen.has(award.taskId), `${award.taskId} was awarded twice at ${loss} loss`);
        seen.add(award.taskId);
      }
    }
  }
});
