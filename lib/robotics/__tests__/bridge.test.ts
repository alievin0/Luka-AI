// The bridge is the only code in this kernel that would touch a real robot,
// and until these tests it was the least exercised thing in it. Everything else
// is checked against a simulator that implements the same interface; the bridge
// is where that interface meets a message format, a socket, and a driver with
// opinions of its own.
//
// These tests drive it through a fake socket rather than a live rosbridge. That
// catches the translation bugs — wrong field, wrong units, wrong shape — which
// is most of what goes wrong. It does not catch anything about the network, and
// nothing here should be read as evidence that the transport works.

import { test } from "node:test";
import assert from "node:assert/strict";

import { Ros2Bridge, type Ros2BridgeOptions, type WebSocketLike } from "../hal/ros2-bridge.ts";
import { nearestObstacle, scanQuality } from "../safety/governor.ts";

/** A socket that records what was sent and lets a test push messages back. */
function fakeSocket() {
  const sent: Array<Record<string, unknown>> = [];
  const handlers = new Map<string, (event: unknown) => void>();

  const socket: WebSocketLike = {
    send(data: string) {
      sent.push(JSON.parse(data) as Record<string, unknown>);
    },
    close() {},
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
  };

  return {
    socket,
    sent,
    open: () => handlers.get("open")?.(undefined),
    deliver: (topic: string, msg: unknown) =>
      handlers.get("message")?.({ data: JSON.stringify({ op: "publish", topic, msg }) }),
    /** Deliver something that is not a string, as a CBOR server would. */
    deliverRaw: (data: unknown) => handlers.get("message")?.({ data }),
    /** Answer a service call the bridge made. */
    reply: (id: string, values: unknown) =>
      handlers.get("message")?.({ data: JSON.stringify({ op: "service_response", id, values }) }),
  };
}

/**
 * Connect a bridge to a fake socket. The open handler has to fire before
 * `connect` resolves, so it is scheduled rather than called inline.
 */
async function connected(options: Partial<Ros2BridgeOptions> = {}) {
  const fake = fakeSocket();
  const bridge = new Ros2Bridge({
    robotId: "r1",
    url: "ws://localhost:9090",
    socketFactory: () => fake.socket,
    ...options,
  });
  const opening = bridge.connect();
  fake.open();
  await opening;
  return { bridge, fake };
}

test("a dead lidar does not read as a clear path through the bridge", async () => {
  // The distinction this protects is the difference between a robot that can
  // see an empty room and a robot that cannot see. Both produce a scan full of
  // non-measurements, and only the kind of non-measurement tells them apart.
  const { bridge, fake } = await connected();

  const scanTopic = "/scan";
  const base = { angle_min: -1.5, angle_max: 1.5, range_max: 12 };

  // A driver returning nothing: no beam carries data. That is not an answer,
  // and it must not be laundered into one.
  fake.deliver(scanTopic, { ...base, ranges: new Array(60).fill(null) });
  const dead = bridge.lidar();
  assert.equal(scanQuality(dead), 0, "a dead lidar was read as fully valid");

  fake.deliver(scanTopic, { ...base, ranges: new Array(60).fill(Number.NaN) });
  assert.equal(scanQuality(bridge.lidar()), 0, "a NaN scan was read as fully valid");

  // A real measurement still survives the trip unchanged.
  const ranges = new Array(60).fill(4.2);
  fake.deliver(scanTopic, { ...base, ranges });
  const measured = bridge.lidar();
  assert.equal(scanQuality(measured), 1);
  assert.ok(nearestObstacle(measured) < 5, "a 4.2 m wall did not come through as an obstacle");
});

test("a topic that goes silent fails closed", async () => {
  // Staleness is the bridge's version of the same question. A cached scan from
  // ten seconds ago describes a room the robot has driven out of, so the bridge
  // drops it — and what it returns instead has to be unusable rather than
  // reassuring.
  const { bridge, fake } = await connected({ maxStalenessMs: 1 });

  fake.deliver("/scan", {
    angle_min: -1.5,
    angle_max: 1.5,
    range_max: 12,
    ranges: new Array(60).fill(6),
  });

  const fresh = bridge.lidar();
  assert.equal(fresh.ranges.length, 60);

  // Let it go stale. Real time, because the bridge stamps arrivals with it.
  const until = Date.now() + 12;
  while (Date.now() < until) {
    /* spin briefly */
  }

  const stale = bridge.lidar();
  assert.equal(stale.ranges.length, 0, "a stale scan was served as though it were current");
  // Empty is the safe reading: no beams answered, so the robot is blind rather
  // than clear, and both the obstacle distance and the quality say so.
  assert.equal(scanQuality(stale), 0);
  assert.equal(nearestObstacle(stale), 0, "a stale scan reported open space ahead");
});

test("velocity commands go out in the shape ROS expects", async () => {
  const { bridge, fake } = await connected();
  fake.sent.length = 0;

  bridge.drive(0.35, -0.8);

  const published = fake.sent.find((f) => f.op === "publish");
  assert.ok(published, "driving published nothing");
  assert.equal(published.topic, "/cmd_vel");

  const msg = published.msg as { linear: { x: number }; angular: { z: number } };
  assert.equal(msg.linear.x, 0.35);
  assert.equal(msg.angular.z, -0.8);
});

test("the bridge subscribes to every sensing topic, throttled and shallow", async () => {
  const { fake } = await connected();

  const subscriptions = fake.sent.filter((f) => f.op === "subscribe");
  const topics = subscriptions.map((f) => String(f.topic));

  for (const expected of ["/scan", "/imu/data", "/odom", "/battery_state"]) {
    assert.ok(topics.includes(expected), `no subscription to ${expected}: ${topics.join(", ")}`);
  }

  // Queue length one on every control-relevant topic. A deeper queue does not
  // buy reliability here, it buys a backlog: the robot ends up acting on the
  // oldest scan in the buffer rather than the newest, which is the opposite of
  // what a control loop wants.
  for (const subscription of subscriptions) {
    assert.equal(subscription.queue_length, 1, `${subscription.topic} subscribed with a queue`);
    assert.ok(
      typeof subscription.throttle_rate === "number",
      `${subscription.topic} subscribed without a throttle`,
    );
  }
});

test("JSON cannot carry an out-of-range beam, so the safe reading wins", () => {
  // Worth knowing before trusting a scan over the default transport: JSON has
  // no way to write infinity, so a beam that reached nothing is serialised as
  // null — the same token a beam with no data produces. The two cases are
  // genuinely indistinguishable on this wire.
  assert.equal(JSON.stringify(Number.POSITIVE_INFINITY), "null");

  // Since they cannot be told apart, the bridge takes the reading that does not
  // put a robot at speed on the strength of a sensor that may be dead. The cost
  // is a robot in a genuinely open field reading as blind and crawling; the
  // alternative cost is a robot with a failed lidar reading as clear.
  //
  // CBOR encodes infinity properly and is the right answer for a real
  // deployment. It needs a decoder in this client first.
  assert.equal(JSON.parse("null"), null);
});

test("binary frames are reported rather than silently dropped", async () => {
  // The bridge used to request CBOR and parse JSON, so on a server that
  // honoured the request every frame failed to parse inside a catch that
  // discarded it. Nothing arrived, nothing complained, and every topic read as
  // silent forever — which is indistinguishable from a robot with no sensors.
  const problems: string[] = [];
  const fake = fakeSocket();
  const bridge = new Ros2Bridge({
    robotId: "r1",
    url: "ws://localhost:9090",
    socketFactory: () => fake.socket,
    onProblem: (message) => problems.push(message),
  });
  const opening = bridge.connect();
  fake.open();
  await opening;

  fake.deliverRaw(new Uint8Array([0xa1, 0x62, 0x6f, 0x70]));
  fake.deliverRaw(new Uint8Array([0xa1, 0x62, 0x6f, 0x70]));

  assert.equal(bridge.transportProblems(), 2, "undecodable frames were not counted");
  assert.equal(problems.length, 1, "the problem was reported either never or every time");
  assert.match(problems[0], /binary frames/);
});

test("silent odometry does not read as stopped at the origin", async () => {
  // Both halves of this were the same mistake in the channel everything else
  // is built on. A stale pose returned the origin, which is a perfectly
  // plausible place to be — so an ability would navigate confidently from
  // somewhere the robot is not. And a stale velocity returned zero, which the
  // safety model reads as a stationary robot and sizes its stopping distance
  // accordingly, while the robot is still rolling.
  const { bridge, fake } = await connected({ maxStalenessMs: 1 });

  fake.deliver("/odom", {
    pose: { pose: { position: { x: 3, y: 4 }, orientation: { z: 0, w: 1 } } },
    twist: { twist: { linear: { x: 0.9 }, angular: { z: 0.2 } } },
  });

  const fresh = bridge.pose();
  assert.equal(fresh.x, 3);
  assert.equal(fresh.y, 4);
  assert.equal(bridge.velocity().linear, 0.9);

  const until = Date.now() + 12;
  while (Date.now() < until) {
    /* let it go stale */
  }

  // No safe guess exists for a position, so the reading is unusable and
  // anything derived from it fails instead of succeeding somewhere wrong.
  const stale = bridge.pose();
  assert.ok(Number.isNaN(stale.x), `stale pose reported x=${stale.x}`);
  assert.ok(Number.isNaN(stale.y), `stale pose reported y=${stale.y}`);
  assert.ok(Number.isNaN(Math.hypot(stale.x - 10, stale.y - 10)));

  // A safe assumption does exist for speed: whatever it was last doing.
  const coasting = bridge.velocity();
  assert.equal(coasting.linear, 0.9, "a silent odometry read as a stopped robot");
  assert.equal(coasting.angular, 0.2);
});

test("yaw comes out of the quaternion the way ROS means it", async () => {
  const { bridge, fake } = await connected();

  for (const degrees of [0, 90, -90, 180]) {
    const yaw = (degrees * Math.PI) / 180;
    fake.deliver("/odom", {
      pose: {
        pose: {
          position: { x: 0, y: 0 },
          // A planar rotation about z: (0, 0, sin(yaw/2), cos(yaw/2)).
          orientation: { z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) },
        },
      },
      twist: { twist: { linear: { x: 0 }, angular: { z: 0 } } },
    });

    const read = bridge.pose().theta;
    const error = Math.abs(Math.atan2(Math.sin(read - yaw), Math.cos(read - yaw)));
    assert.ok(error < 1e-9, `${degrees}° came back as ${((read * 180) / Math.PI).toFixed(1)}°`);
  }
});

test("a stalled IMU stops advancing its timestamp", async () => {
  // This one defeats a safety check elsewhere if it is wrong. balance.recover
  // decides whether it can trust a tilt reading by watching the IMU timestamp
  // move; a bridge that stamps fabricated zeros with the current time keeps
  // that timestamp advancing forever, and the check never fires. The robot then
  // gets told it is perfectly level while lying on the floor.
  const { bridge, fake } = await connected({ maxStalenessMs: 1 });

  fake.deliver("/imu/data", {
    orientation: { x: 0, y: 0.2, z: 0, w: 0.98 },
    angular_velocity: { y: 0.4, z: 0.1 },
    linear_acceleration: { x: 1.1 },
  });

  const fresh = bridge.imu();
  assert.ok(fresh.tilt > 0.1, `tilt came through as ${fresh.tilt}`);
  assert.ok(fresh.t > 0);

  const until = Date.now() + 12;
  while (Date.now() < until) {
    /* let it go stale */
  }

  const first = bridge.imu();
  const second = bridge.imu();
  assert.equal(first.t, fresh.t, "a stale IMU invented a fresh timestamp");
  assert.equal(second.t, first.t, "the timestamp kept moving with no new data");
  // And it reports the last thing it actually saw rather than a level robot.
  assert.equal(first.tilt, fresh.tilt);
});

test("an unreported gripper does not claim zero force", async () => {
  const { bridge } = await connected({ maxStalenessMs: 1 });
  const grip = bridge.gripper();
  assert.equal(grip.forceSensed, false);
  assert.ok(Number.isNaN(grip.force), `reported ${grip.force} N with nothing published`);
  assert.equal(grip.holding, null);
});

test("a command with nowhere to go is not reported as delivered", async () => {
  // The dangerous half of this is stop. A caller asking a disconnected robot to
  // halt was told it had halted — the call returned normally, nothing was sent,
  // and nothing on the robot changed. A robot silently ignoring instructions
  // looks exactly like one obeying them and not moving.
  const problems: string[] = [];
  const bridge = new Ros2Bridge({
    robotId: "r1",
    url: "ws://localhost:9090",
    onProblem: (message) => problems.push(message),
  });

  assert.equal(bridge.isConnected(), false);
  assert.equal(bridge.transportProblems(), 0);

  bridge.drive(0.8, 0);
  bridge.stop();

  assert.ok(bridge.transportProblems() >= 2, "undelivered commands were not counted");
  assert.equal(problems.length, 1, "the problem was reported either never or on every command");
  assert.match(problems[0], /including any stop/);

  // Once connected, commands land and nothing further is reported.
  const fake = fakeSocket();
  const connecting = new Ros2Bridge({
    robotId: "r2",
    url: "ws://localhost:9090",
    socketFactory: () => fake.socket,
  });
  const opening = connecting.connect();
  fake.open();
  await opening;

  assert.equal(connecting.isConnected(), true);
  fake.sent.length = 0;
  connecting.stop();
  assert.equal(fake.sent.length, 1, "a connected bridge dropped a stop");
  assert.equal(connecting.transportProblems(), 0);
});

test("sensor time comes from the robot's clock, not from this one", async () => {
  // The bug this pins was invisible to a green test suite, which is the reason
  // it is worth pinning.
  //
  // The bridge never read `header.stamp`, so every sensor timestamp was
  // Date.now() taken as the reader was called. hardware.checkout's clock gate
  // compares that against this machine's clock — this machine's clock on both
  // sides — and so measured zero skew on a robot five minutes out and reported
  // the clocks as fine. The gate's own tests passed the whole time, because
  // they injected skew into the simulator directly and never went near the
  // hardware path.
  const { bridge, fake } = await connected();

  const robotBehindBySeconds = 300;
  const robotSec = Math.floor(Date.now() / 1000) - robotBehindBySeconds;

  fake.deliver("/imu/data", {
    header: { stamp: { sec: robotSec, nanosec: 0 } },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    angular_velocity: { y: 0, z: 0 },
    linear_acceleration: { x: 0 },
  });

  const imu = bridge.imu();
  assert.equal(imu.stamp, "sensor");
  const skewSeconds = (Date.now() - imu.t) / 1000;
  assert.ok(
    Math.abs(skewSeconds - robotBehindBySeconds) < 5,
    `a ${robotBehindBySeconds} s clock offset came through as ${skewSeconds.toFixed(1)} s`,
  );

  // Nanoseconds are not ignored.
  fake.deliver("/imu/data", {
    header: { stamp: { sec: 1000, nanosec: 500_000_000 } },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    angular_velocity: { y: 0, z: 0 },
    linear_acceleration: { x: 0 },
  });
  assert.equal(bridge.imu().t, 1_000_500);
});

test("an unstamped reading says so rather than borrowing this machine's clock", async () => {
  // Plenty of drivers publish without a header. Silently falling back to
  // arrival time would put the clock question beyond asking while appearing to
  // answer it, so the fallback is flagged and the checkout refuses on it.
  const { bridge, fake } = await connected();

  fake.deliver("/imu/data", {
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    angular_velocity: { y: 0, z: 0 },
    linear_acceleration: { x: 0 },
  });
  assert.equal(bridge.imu().stamp, "arrival");

  fake.deliver("/scan", {
    ranges: new Array(20).fill(3),
    angle_min: -1.5,
    angle_max: 1.5,
    range_max: 12,
  });
  assert.equal(bridge.lidar().stamp, "arrival");
});

test("a driver republishing one frame repeats its stamp", async () => {
  // This is what makes a frozen sensor detectable. With arrival-time stamping
  // the timestamp advanced on every read, so a driver stuck on one frame
  // looked alive — and whether the check caught it depended on whether two
  // reads happened to straddle a millisecond, which is worse than broken.
  const { bridge, fake } = await connected();
  const frozen = {
    header: { stamp: { sec: 5000, nanosec: 0 } },
    ranges: new Array(20).fill(3),
    angle_min: -1.5,
    angle_max: 1.5,
    range_max: 12,
  };

  fake.deliver("/scan", frozen);
  const first = bridge.lidar();
  fake.deliver("/scan", frozen);
  const second = bridge.lidar();

  assert.equal(first.t, second.t, "a repeated frame produced a moving timestamp");
  assert.equal(first.t, 5_000_000);
});

test("a message the driver shaped differently does not take the safety loop down", async () => {
  // This is the worst failure found in the bridge, and it was not subtle once
  // looked for. Every reader indexed straight into the payload, so a driver on
  // a different ROS version, or one that renamed a field, threw out of the
  // reader. Seven of the nine malformed frames below did.
  //
  // That matters far more than a bad reading, because the safety governor
  // calls lidar() on every control tick. One badly shaped frame took the whole
  // safety loop down with it.
  const { bridge, fake } = await connected();

  const malformed: Array<[string, unknown, () => unknown]> = [
    ["/scan", { angle_min: -1, angle_max: 1, range_max: 12 }, () => bridge.lidar()],
    ["/scan", { ranges: "nope", angle_min: -1, angle_max: 1, range_max: 12 }, () => bridge.lidar()],
    ["/scan", {}, () => bridge.lidar()],
    ["/scan", null, () => bridge.lidar()],
    ["/odom", { twist: { twist: { linear: { x: 0 }, angular: { z: 0 } } } }, () => bridge.pose()],
    [
      "/odom",
      { pose: { pose: { position: { x: 1, y: 2 }, orientation: { z: 0, w: 1 } } } },
      () => bridge.velocity(),
    ],
    [
      "/imu/data",
      { angular_velocity: { y: 0, z: 0 }, linear_acceleration: { x: 0 } },
      () => bridge.imu(),
    ],
    ["/battery_state", {}, () => bridge.battery()],
    ["/perception/people", { people: "many" }, () => bridge.trackHumans()],
  ];

  for (const [topic, msg, read] of malformed) {
    fake.deliver(topic, msg);
    assert.doesNotThrow(read, `a malformed message on ${topic} threw out of the reader`);
  }

  // And the failure is observable rather than swallowed: it is the same
  // counter the checkout's transport gate refuses on.
  assert.ok(
    bridge.transportProblems() >= malformed.length - 1,
    `malformed frames were not counted: ${bridge.transportProblems()}`,
  );

  // The degraded readings are the ones a silent topic produces, which already
  // fail closed — a blind scan rather than a clear path.
  const scan = bridge.lidar();
  assert.equal(scan.ranges.length, 0);
  assert.equal(scanQuality(scan), 0);
  assert.equal(nearestObstacle(scan), 0);
});

test("a well-formed message still gets through after a malformed one", async () => {
  // A driver that publishes one bad frame is not a driver to give up on.
  const { bridge, fake } = await connected();

  fake.deliver("/scan", { ranges: "broken" });
  assert.equal(bridge.lidar().ranges.length, 0);

  fake.deliver("/scan", {
    header: { stamp: { sec: 10, nanosec: 0 } },
    ranges: new Array(30).fill(4),
    angle_min: -1.5,
    angle_max: 1.5,
    range_max: 12,
  });
  const good = bridge.lidar();
  assert.equal(good.ranges.length, 30);
  assert.equal(good.stamp, "sensor");
  assert.equal(scanQuality(good), 1);
});

test("an open socket that has never delivered anything is not a working link", async () => {
  // TCP half-open: the connection accepts sends locally, delivers nothing, and
  // never errors. Measured before this existed — a link that had never carried
  // one message reported itself healthy with zero problems, so a robot that
  // died the instant after connecting looked like a robot that was quiet.
  const { bridge } = await connected();

  const cold = bridge.inbound();
  assert.equal(cold.everReceived, false, "claimed to have received something");
  assert.ok(bridge.isConnected(), "the socket is open — that is the point");

  // One readable frame is enough to prove the inbound direction works.
  const { bridge: live, fake } = await connected();
  fake.deliver("/scan", {
    ranges: new Array(10).fill(3),
    angle_min: -1,
    angle_max: 1,
    range_max: 12,
  });
  assert.equal(live.inbound().everReceived, true);
});

test("a topic the robot does not publish is told apart from a sensor that is dead", async () => {
  // rosbridge accepts a subscription to any name at all, so a typo produces
  // exactly the silence a dead sensor produces — and gets debugged as a dead
  // sensor, which costs an afternoon and sometimes a replacement part.
  const { bridge, fake } = await connected();

  // Before asking, the honest answer is "nobody told us", not "all present".
  assert.equal(bridge.missingTopics(), null);

  const asking = bridge.advertisedTopics(1000);
  const call = fake.sent.find((f) => f.op === "call_service");
  assert.ok(call, "no service call was made");
  assert.equal(call.service, "/rosapi/topics");

  // The robot answers with a list that is missing the scan topic.
  fake.reply(String(call.id), { topics: ["/odom", "/imu/data", "/battery_state"] });
  const advertised = await asking;
  assert.ok(advertised?.has("/odom"));

  const missing = bridge.missingTopics();
  assert.ok(missing, "missingTopics stayed unknown after a successful answer");
  assert.ok(missing.includes("/scan"), `expected /scan among ${missing.join(", ")}`);
  assert.ok(!missing.includes("/odom"));
});

test("a robot that never answers leaves the topics unverified, not verified", async () => {
  const { bridge, fake } = await connected();
  const asking = bridge.advertisedTopics(30);
  void fake;
  assert.equal(await asking, null, "silence was read as a successful answer");
  assert.equal(bridge.missingTopics(), null, "silence was read as nothing missing");
});

test("nothing published yet is not a robot sitting quietly at its origin", async () => {
  // The standing guard, pointed at the implementation that would touch a real
  // machine.
  //
  // There was one of these already and it ran against the simulator, so it
  // could not have caught a defect that exists only here — and one did. The
  // arm reported `{ tip: (0, 0), height: 0, moving: false }` when its topic had
  // never published: an arm parked at the origin of the body frame, having
  // finished moving. Twenty lines above it, the gripper gets the identical
  // question right and says so in a comment.
  //
  // `grasp.adaptive` waits for the arm to settle and then closes the fingers,
  // so a silent arm topic meant closing them on whatever happened to be there.
  const { bridge } = await connected();

  const arm = bridge.arm();
  assert.ok(Number.isNaN(arm.tip.x), `reported a tip at x=${arm.tip.x} with no arm topic`);
  assert.ok(Number.isNaN(arm.tip.y));
  assert.ok(Number.isNaN(arm.height));
  assert.equal(
    arm.moving,
    true,
    "an arm that has never reported anything was described as having stopped, which is what " +
      "a caller waiting for it to settle acts on",
  );
  assert.equal(arm.reachable, undefined, "claimed to know whether an unheard-from arm can reach");

  // The channels that were already right, asserted here so this file guards the
  // whole surface rather than the one that was wrong.
  const grip = bridge.gripper();
  assert.equal(grip.forceSensed, false);
  assert.ok(Number.isNaN(grip.force), "reported newtons from a gripper that has said nothing");
  assert.ok(Number.isNaN(grip.closure));

  assert.deepEqual(bridge.detectObjects(), [], "invented detections from a silent camera");
  assert.deepEqual(bridge.trackHumans(), [], "invented person tracks from a silent camera");
  assert.deepEqual(bridge.health(), {}, "invented diagnostics");

  const scan = bridge.lidar();
  assert.equal(scanQuality(scan), 0, "a lidar that has published nothing looked usable");

  // A pose with nothing behind it must not read as the origin either: the
  // origin is a perfectly plausible place for a robot to be.
  const pose = bridge.pose();
  assert.ok(
    Number.isNaN(pose.x) || Number.isNaN(pose.y) || Number.isNaN(pose.theta),
    `reported a pose of (${pose.x}, ${pose.y}) with no odometry`,
  );
});
