"use client";

import {
  CAMPUS_H,
  CAMPUS_W,
  NODES,
  nodeForAgent,
  routePath,
  tracedRoutes,
  type Agent,
  type Edge,
} from "./model";
import {
  PLACES,
  PODS,
  POD_DROP,
  POD_W,
  hasPod,
  podFor,
  spriteBox,
  spriteUrl,
  type SpriteSource,
} from "./sprites";

/**
 * The world, composed from the generated art rather than from one flat render.
 *
 * Every building and every character is a separate Soul 2.0 asset placed on
 * the isometric grid, which is what lets a single building light up, a pod
 * change with its agent's state, and the routes between them carry real
 * traffic. The alternative — one baked picture — can do none of that.
 *
 * Two details that matter:
 *
 *   - The art is rendered on white and composited with `mix-blend-mode:
 *     multiply`. Against the pale plaza the white simply vanishes while the
 *     contact shadows survive, so no alpha channel, cutout pass or build step
 *     is needed for the sprites to sit in the scene.
 *   - Nothing is drawn with text in it. Every label is markup, so the world
 *     reads correctly in Arabic, stays sharp at any size, and follows the
 *     business rather than the image.
 */

export default function Scene({
  agents,
  edges,
  selected,
  onSelect,
  from,
  onArtMissing,
  onArtReady,
}: {
  agents: Agent[];
  edges: Edge[];
  selected: string | null;
  onSelect: (code: string | null) => void;
  from: SpriteSource;
  /** Called when a building fails to load, so the page can fall back whole. */
  onArtMissing: () => void;
  /** Called by the first building that arrives, which cancels that deadline. */
  onArtReady: () => void;
}) {
  const traffic = new Map(edges.map((e) => [`${e.from}>${e.to}`, e.count]));
  const busiest = Math.max(1, ...edges.map((e) => e.count));

  // Back to front: in an isometric scene, further down the picture is nearer
  // the viewer, so painting in ascending y is the whole depth model.
  const places = [...PLACES].sort((a, b) => a.y - b.y);
  const pods = agents
    .filter((a) => a.lifecycle === "live" && hasPod(a.code))
    .map((a) => ({ agent: a, node: nodeForAgent(a) }))
    .filter((p): p is { agent: Agent; node: NonNullable<ReturnType<typeof nodeForAgent>> } =>
      Boolean(p.node),
    )
    .sort((a, b) => a.node.y - b.node.y);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* ground — a pool of light rather than a slab, because a rotated slab
          always cuts a hard diagonal across an otherwise empty corner */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(180deg,#f7fafd 0%,#eef2fa 55%,#e6ecf7 100%)" }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 62% 48% at 50% 58%, #ffffff 0%, rgba(255,255,255,0.72) 42%, rgba(255,255,255,0) 78%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 78% 62% at 50% 56%, rgba(255,255,255,0) 55%, rgba(206,217,235,0.30) 100%)",
        }}
      />

      {/* contact shadows — cutting a sprite out takes its shadow with it, and
          a building with nothing under it floats above the ground */}
      <svg
        viewBox={`0 0 ${CAMPUS_W} ${CAMPUS_H}`}
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <filter id="contact-shadow" x="-60%" y="-160%" width="220%" height="420%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        {places.map((p) => (
          <ellipse
            key={`shadow-${p.key}`}
            cx={p.x}
            cy={p.y + p.w * 0.3}
            rx={p.w * 0.31}
            ry={p.w * 0.085}
            fill="#2b3a57"
            opacity={0.16}
            filter="url(#contact-shadow)"
          />
        ))}
        {pods.map(({ agent, node }) => (
          <ellipse
            key={`shadow-${agent.code}`}
            cx={node.x}
            cy={node.y + POD_DROP + POD_W * 0.31}
            rx={POD_W * 0.3}
            ry={POD_W * 0.09}
            fill="#2b3a57"
            opacity={0.2}
            filter="url(#contact-shadow)"
          />
        ))}
      </svg>

      {/* routes: faint where the wiring exists, lit where messages crossed */}
      <svg
        viewBox={`0 0 ${CAMPUS_W} ${CAMPUS_H}`}
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <filter id="route-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        {tracedRoutes().map(({ from, to }) => {
          const d = routePath(from, to);
          if (!d) return null;
          const count = (traffic.get(`${from}>${to}`) ?? 0) + (traffic.get(`${to}>${from}`) ?? 0);
          const lit = count > 0;
          const width = lit ? 3 + (count / busiest) * 3.6 : 2.2;
          const color = from === "policy" || to === "policy" ? "#9b8bff" : "#4a9eff";
          return (
            <g key={`${from}>${to}`}>
              {lit && (
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={width + 5}
                  strokeLinecap="round"
                  opacity={0.32}
                  filter="url(#route-glow)"
                />
              )}
              <path
                d={d}
                fill="none"
                stroke={lit ? color : "#b9c7dd"}
                strokeWidth={width}
                strokeLinecap="round"
                opacity={lit ? 0.95 : 0.6}
              />
            </g>
          );
        })}
      </svg>

      {/* the places */}
      {places.map((p) => (
        <img
          key={p.key}
          src={spriteUrl(p, from)}
          alt=""
          aria-hidden="true"
          draggable={false}
          onError={onArtMissing}
          onLoad={onArtReady}
          className="absolute select-none object-contain"
          style={spriteBox(p)}
        />
      ))}

      {/* the characters */}
      {pods.map(({ agent, node }) => {
        const pod = PODS[podFor(agent.state)];
        const isSelected = selected === agent.code;
        return (
          <img
            key={agent.code}
            src={spriteUrl(pod, from)}
            alt=""
            aria-hidden="true"
            draggable={false}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(isSelected ? null : agent.code);
            }}
            className="absolute cursor-pointer select-none object-contain transition-transform"
            style={{
              ...spriteBox({ x: node.x, y: node.y + POD_DROP, w: POD_W }),
              transform: isSelected ? "scale(1.08)" : undefined,
            }}
          />
        );
      })}

      {/* the names, as markup — never baked into the art, and drawn last so
          no sprite can bury them */}
      {places
        .filter((p) => p.zone !== "channel")
        .map((p) => (
          <span
            key={`label-${p.key}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[0.7cqw] px-[0.75cqw] py-[0.3cqw] text-[1.05cqw] font-semibold leading-none text-white shadow-[0_0.15cqw_0.6cqw_rgba(20,30,60,0.28)]"
            style={{
              left: `${(p.x / CAMPUS_W) * 100}%`,
              top: `${((p.y + (p.zone === "customer" ? p.w * 0.46 : -p.w * 0.29)) / CAMPUS_H) * 100}%`,
              background: "rgba(36,42,56,0.94)",
            }}
          >
            {p.label}
          </span>
        ))}

    </div>
  );
}

/** Where a place's pin sits, for callers that need it outside the scene. */
export function placeNode(zone: string) {
  return NODES[zone] ?? null;
}
