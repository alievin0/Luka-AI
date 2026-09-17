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
