// The mission view renderer.
//
// One pure function of the latest scene state, called from a single
// requestAnimationFrame loop. Nothing here touches React, so frames arriving at
// 16 Hz never cause a re-render — the canvas just draws whatever is in the ref.

import type { Frame, Layers, SceneState, WorldSetup } from "./types.ts";

const COLORS = {
  floor: "#0b1220",
  grid: "rgba(148,163,184,0.08)",
  wall: "#1e293b",
  obstacle: "#334155",
  mapFree: "rgba(56,189,248,0.10)",
  mapOccupied: "rgba(148,163,184,0.55)",
  lidar: "rgba(250,204,21,0.035)",
  lidarEdge: "rgba(250,204,21,0.35)",
  trail: "rgba(56,189,248,0.5)",
  human: "#f87171",
  envelope: "rgba(248,113,113,0.13)",
  object: "#fbbf24",
  objectHeld: "#c084fc",
  objectDamaged: "#f43f5e",
  robot: "#e2e8f0",
  text: "#94a3b8",
  dock: "#34d399",
};

export type Projection = {
  scale: number;
  sx: (x: number) => number;
  sy: (y: number) => number;
};

export function project(
  canvas: HTMLCanvasElement,
  setup: WorldSetup,
  pad = 28,
): Projection {
  const width = canvas.width / dpr();
  const height = canvas.height / dpr();
  const scale = Math.min(
    (width - pad * 2) / setup.width,
    (height - pad * 2) / setup.height,
  );
  const offsetX = (width - setup.width * scale) / 2;
  const offsetY = (height - setup.height * scale) / 2;
  return {
    scale,
    sx: (x) => offsetX + x * scale,
    // Screen y grows downward; the world's does not.
    sy: (y) => offsetY + (setup.height - y) * scale,
  };
}

function dpr(): number {
  return typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
}

/** Size the backing store for the display density, once per resize. */
export function resizeCanvas(canvas: HTMLCanvasElement): void {
  const ratio = dpr();
  const rect = canvas.getBoundingClientRect();
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
}

export function drawScene(
  canvas: HTMLCanvasElement | null,
  scene: SceneState,
  layers: Layers,
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  resizeCanvas(canvas);
  const width = canvas.width / dpr();
  const height = canvas.height / dpr();

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = COLORS.floor;
  ctx.fillRect(0, 0, width, height);

  const { setup, frame } = scene;
  if (!setup) {
    ctx.fillStyle = "#475569";
    ctx.font = "15px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.fillText("اختر عرضاً أو قدرة وشغّلها", width / 2, height / 2);
    return;
  }

  const p = project(canvas, setup);
  drawFloor(ctx, setup, p);
  if (layers.map) drawMap(ctx, scene, p);
  drawObstacles(ctx, setup, p);
  drawDock(ctx, setup, p, layers);

  if (!frame) return;

  if (layers.lidar) drawLidar(ctx, frame, p);
  if (layers.trail) drawTrail(ctx, scene, p);
  if (layers.labels) drawMarks(ctx, scene, p);
  drawObjects(ctx, frame, p, layers);
  drawHumans(ctx, frame, p, layers);
  drawRobots(ctx, frame, p, layers);
  if (layers.envelope) drawEnvelope(ctx, frame, p);
  drawArm(ctx, frame, p);
}

function drawFloor(
  ctx: CanvasRenderingContext2D,
  setup: WorldSetup,
  p: Projection,
): void {
  ctx.fillStyle = "#0d1526";
  ctx.fillRect(p.sx(0), p.sy(setup.height), setup.width * p.scale, setup.height * p.scale);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= setup.width; x += 1) {
    ctx.moveTo(p.sx(x), p.sy(0));
    ctx.lineTo(p.sx(x), p.sy(setup.height));
  }
  for (let y = 0; y <= setup.height; y += 1) {
    ctx.moveTo(p.sx(0), p.sy(y));
    ctx.lineTo(p.sx(setup.width), p.sy(y));
  }
  ctx.stroke();

  ctx.strokeStyle = COLORS.wall;
  ctx.lineWidth = 3;
  ctx.strokeRect(p.sx(0), p.sy(setup.height), setup.width * p.scale, setup.height * p.scale);
}

/** The robot's own map, under everything else it can see. */
function drawMap(ctx: CanvasRenderingContext2D, scene: SceneState, p: Projection): void {
  const map = scene.map;
  if (!map) return;
  const { meta, decoded } = map;
  const cell = meta.resolution * p.scale;

  for (let y = 0; y < meta.height; y += 1) {
    for (let x = 0; x < meta.width; x += 1) {
      const value = decoded[y * meta.width + x];
      if (value === 0) continue;
      ctx.fillStyle = value === 2 ? COLORS.mapOccupied : COLORS.mapFree;
      ctx.fillRect(
        p.sx(meta.origin.x + x * meta.resolution),
        p.sy(meta.origin.y + (y + 1) * meta.resolution),
        Math.ceil(cell),
        Math.ceil(cell),
      );
    }
  }
}

function drawObstacles(
  ctx: CanvasRenderingContext2D,
  setup: WorldSetup,
  p: Projection,
): void {
  ctx.fillStyle = COLORS.obstacle;
  for (const obstacle of setup.obstacles) {
    if (obstacle.kind === "circle") {
      ctx.beginPath();
      ctx.arc(p.sx(obstacle.at.x), p.sy(obstacle.at.y), obstacle.radius * p.scale, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(
        p.sx(obstacle.at.x - obstacle.width / 2),
        p.sy(obstacle.at.y + obstacle.height / 2),
        obstacle.width * p.scale,
        obstacle.height * p.scale,
      );
    }
  }
}

function drawDock(
  ctx: CanvasRenderingContext2D,
  setup: WorldSetup,
  p: Projection,
  layers: Layers,
): void {
  const size = 11;
  ctx.strokeStyle = COLORS.dock;
  ctx.lineWidth = 2;
  ctx.strokeRect(p.sx(setup.dock.x) - size, p.sy(setup.dock.y) - size, size * 2, size * 2);
  if (!layers.labels) return;
  ctx.fillStyle = COLORS.dock;
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("dock", p.sx(setup.dock.x), p.sy(setup.dock.y) + size + 12);
}

/** The lidar fan, so you can see what the robot can actually see. */
function drawLidar(ctx: CanvasRenderingContext2D, frame: Frame, p: Projection): void {
  const robot = frame.robots[0];
  if (!robot || frame.lidar.ranges.length === 0) return;

  const { ranges, fov, stride } = frame.lidar;
  const beams = (ranges.length - 1) * stride;
  const step = fov / Math.max(beams, 1);

  ctx.beginPath();
  ctx.moveTo(p.sx(robot.x), p.sy(robot.y));
  for (let i = 0; i < ranges.length; i += 1) {
    const angle = robot.theta - fov / 2 + i * stride * step;
    ctx.lineTo(
      p.sx(robot.x + Math.cos(angle) * ranges[i]),
      p.sy(robot.y + Math.sin(angle) * ranges[i]),
    );
  }
  ctx.closePath();
  ctx.fillStyle = COLORS.lidar;
  ctx.fill();

  // The rim is where the beams actually landed — the informative part. The
  // filled wedge alone reads as a smear over the map underneath it.
  ctx.strokeStyle = COLORS.lidarEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < ranges.length; i += 1) {
    const angle = robot.theta - fov / 2 + i * stride * step;
    const x = p.sx(robot.x + Math.cos(angle) * ranges[i]);
    const y = p.sy(robot.y + Math.sin(angle) * ranges[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawTrail(ctx: CanvasRenderingContext2D, scene: SceneState, p: Projection): void {
  const trail = scene.trail;
  if (trail.length < 2) return;
  ctx.strokeStyle = COLORS.trail;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(p.sx(trail[0].x), p.sy(trail[0].y));
  for (const point of trail) ctx.lineTo(p.sx(point.x), p.sy(point.y));
  ctx.stroke();
}

function drawMarks(ctx: CanvasRenderingContext2D, scene: SceneState, p: Projection): void {
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (const mark of scene.marks) {
    ctx.strokeStyle = "rgba(167,139,250,0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.sx(mark.at.x) - 6, p.sy(mark.at.y));
    ctx.lineTo(p.sx(mark.at.x) + 6, p.sy(mark.at.y));
    ctx.moveTo(p.sx(mark.at.x), p.sy(mark.at.y) - 6);
    ctx.lineTo(p.sx(mark.at.x), p.sy(mark.at.y) + 6);
    ctx.stroke();
    ctx.fillStyle = "rgba(196,181,253,0.9)";
    ctx.fillText(mark.label, p.sx(mark.at.x), p.sy(mark.at.y) - 10);
  }
}

function drawObjects(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  p: Projection,
  layers: Layers,
): void {
  for (const object of frame.objects) {
    ctx.fillStyle = object.damaged
      ? COLORS.objectDamaged
      : object.held
        ? COLORS.objectHeld
        : COLORS.object;
    ctx.beginPath();
    ctx.arc(p.sx(object.x), p.sy(object.y), 5, 0, Math.PI * 2);
    ctx.fill();
    if (!layers.labels) continue;
    ctx.fillStyle = COLORS.text;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(object.label, p.sx(object.x), p.sy(object.y) - 9);
  }
}

function drawHumans(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  p: Projection,
  layers: Layers,
): void {
  for (const human of frame.humans) {
    // The distance the governor will not let the robot inside of — it covers
    // both bodies, so it is a touch line, not a comfort zone.
    ctx.strokeStyle = "rgba(248,113,113,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.sx(human.x), p.sy(human.y), 0.55 * p.scale, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = human.attentive ? COLORS.human : "rgba(248,113,113,0.62)";
    ctx.beginPath();
    ctx.arc(p.sx(human.x), p.sy(human.y), 0.25 * p.scale, 0, Math.PI * 2);
    ctx.fill();

    if (human.attentive) {
      ctx.strokeStyle = "#fecaca";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.sx(human.x), p.sy(human.y), 0.25 * p.scale + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (!layers.labels) continue;
    ctx.fillStyle = "#fca5a5";
    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.fillText(human.id, p.sx(human.x), p.sy(human.y) - 0.35 * p.scale - 5);
  }
}

/**
 * The protective separation distance for the robot's current speed — how far
 * away a person has to be for this speed to be safe. Watching it shrink as the
 * robot slows down is the clearest picture of what the governor does.
 */
function drawEnvelope(ctx: CanvasRenderingContext2D, frame: Frame, p: Projection): void {
  const robot = frame.robots[0];
  if (!robot || frame.envelope <= 0.05) return;
  ctx.fillStyle = COLORS.envelope;
  ctx.beginPath();
  ctx.arc(p.sx(robot.x), p.sy(robot.y), frame.envelope * p.scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(248,113,113,0.35)";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(252,165,165,0.8)";
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(
    `safe stop ${frame.envelope.toFixed(1)} m`,
    p.sx(robot.x),
    p.sy(robot.y) - frame.envelope * p.scale - 5,
  );
}

function drawRobots(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  p: Projection,
  layers: Layers,
): void {
  for (const robot of frame.robots) {
    const radius = 0.28 * p.scale;
    const x = p.sx(robot.x);
    const y = p.sy(robot.y);

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = robot.lights.color;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = COLORS.robot;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = robot.lights.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-robot.theta);
    ctx.strokeStyle = robot.lights.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radius * 1.5, 0);
    ctx.stroke();
    ctx.restore();

    // Lean, drawn as the body leaning off the wheels.
    if (Math.abs(robot.tilt) > 0.02) {
      ctx.strokeStyle = Math.abs(robot.tilt) > 0.2 ? "#ef4444" : "#f59e0b";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(
        x + Math.sin(robot.tilt) * radius * 2.4,
        y - Math.cos(robot.tilt) * radius * 2.4,
      );
      ctx.stroke();
    }

    if (!layers.labels) continue;
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(robot.id, x, y + radius + 13);

    if (robot.utterance) {
      ctx.fillStyle = "rgba(226,232,240,0.9)";
      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.fillText(robot.utterance.slice(0, 54), x, y - radius - 9);
    }
  }
}

/** The arm, and how hard the hand is squeezing. */
function drawArm(ctx: CanvasRenderingContext2D, frame: Frame, p: Projection): void {
  const robot = frame.robots[0];
  if (!robot) return;
  const tip = frame.arm.tip;

  ctx.strokeStyle = "rgba(226,232,240,0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p.sx(robot.x), p.sy(robot.y));
  ctx.lineTo(p.sx(tip.x), p.sy(tip.y));
  ctx.stroke();

  // Fingers open and shut with the closure; they glow when force is applied.
  const spread = (1 - frame.arm.closure) * 7 + 2;
  ctx.strokeStyle =
    frame.arm.force > 0.5 ? "#facc15" : "rgba(226,232,240,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.sx(tip.x) - spread, p.sy(tip.y) - spread);
  ctx.lineTo(p.sx(tip.x) + spread, p.sy(tip.y) + spread);
  ctx.moveTo(p.sx(tip.x) + spread, p.sy(tip.y) - spread);
  ctx.lineTo(p.sx(tip.x) - spread, p.sy(tip.y) + spread);
  ctx.stroke();

  if (frame.arm.pull > 0.4) {
    ctx.fillStyle = "#38bdf8";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`pull ${frame.arm.pull.toFixed(1)}N`, p.sx(tip.x), p.sy(tip.y) - 14);
  }
}

/** A tiny line chart, drawn into its own canvas. */
export function drawSparkline(
  canvas: HTMLCanvasElement | null,
  values: number[],
  options: { color: string; min?: number; max?: number },
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  resizeCanvas(canvas);

  const width = canvas.width / dpr();
  const height = canvas.height / dpr();
  ctx.clearRect(0, 0, width, height);

  if (values.length < 2) return;

  const min = options.min ?? Math.min(...values);
  const max = options.max ?? Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  ctx.beginPath();
  values.forEach((value, i) => {
    const x = i * step;
    const y = height - ((value - min) / span) * (height - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = options.color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = `${options.color}22`;
  ctx.fill();
}
