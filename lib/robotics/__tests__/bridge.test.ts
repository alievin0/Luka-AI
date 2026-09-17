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
