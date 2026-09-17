# نواة لوكا للروبوتات — Luka Robotics Kernel

قدرات روبوتية مبرمجة، مختبَرة، وجاهزة للاستخدام. كل قدرة بتشتغل على محاكي فيه
فيزياء حقيقية (عزم، بطارية، انزلاق، ناس بتمشي) — ونفس الكود بيشتغل على روبوت
حقيقي عبر ROS 2 بدون ما تغيّر سطر بالقدرة نفسها.

```bash
npm test                     # ٥٣ اختبار للنواة والقدرات والقياس
npm run demo                 # ١١ عرض كامل بالطرفية
npm run dev                  # بعدين افتح /robots للعرض المرئي
npm run robo -- list         # كل القدرات
npm run robo -- run navigate.to '{"x":12,"y":8}'
```

## ⚠️ حدود لازم تنقال أول — limits, stated first

هالقسم فوق مو تحت، لأنه أهم من أي رقم بالملف.

- **المحاكي ثنائي الأبعاد.** الحتمية هون **خاصية قابلية إعادة إنتاج، مو ادّعاء
  دقّة فيزيائية**. أفضل محرّكات الفيزياء الموجودة بتنحرف بشكل كبير عند لحظة
  التلامس — وهاد بالضبط المكان اللي المناورة فيه بتصير مهمة.
- **حارس الأمان و`safety.stoppable` أدوات تصميم، مو وظائف أمان معتمدة.** الأنظمة
  اللي عم تشتغل فعلياً بدون أسوار حوالين الناس بتستعمل متحكّم أمان مستقل على
  عتاد منفصل. الطبقة اللي هالمكتبة فيها مو هي.
- **حلقة تحكّم ٥٠ هرتز بـ TypeScript فوق WebSocket مو طبقة زمن حقيقي.** على عتاد
  حقيقي لازم يكون تحتها مراقب على عتاد أو خيط بأولوية حقيقية.
- **أمان الروبوت عم يعتمد على تعاون الإنسان.** شوف عرض `measured-crossing`:
  ٢٠/٢٠ عبور نظيف مع ناس بينتبهوا، ٠/٢٠ مع ناس ما بيرفعوا راسهم.

> The simulator is 2-D and determinism is a reproducibility property, not a
> fidelity claim. The safety governor and the stoppability monitor are design
> aids, not certified safety functions. A 50 Hz loop in TypeScript over a
> WebSocket is not a real-time layer. And the robot's safety record depends on
> people cooperating — `measured-crossing` measures exactly how much.

## احكي معه — talk to it

```bash
cp .env.example .env.local     # وحط ANTHROPIC_API_KEY
npm run dev                    # بعدين افتح /robots/talk
```

الروبوت بيضلّ عايش بين رسائلك: الناس بتمشي، البطارية بتنقص، الحرّاس شغّالين.
بتحكيله بالعربي أو بالإنجليزي — كتابة أو بصوتك — وهو بينفّذ قدراته وبيرجّعلك
الأرقام الحقيقية اللي طلعت معه، مو وصف.

> `/robots/talk` puts Claude behind the wheel with the abilities as its tools and
> the robot's own sensor readings as its context. The world keeps running between
> your messages, which is the whole point — a robot that only exists while you
> are typing at it is a demo, not a robot. Voice in and out where the browser
> supports it; typing everywhere.

The abilities and the `/robots` page need no API key. Only the conversation does.

**ملاحظة نشر:** صفحة الكلام بدها سيرفر بيضل شغّال (`npm start`، حاوية، أو خادم).
على منصة serverless كل طلب ممكن ينزل على نسخة جديدة — يعني الروبوت اللي كنت
تحكي معه ممكن ما يكون موجود بالرسالة الجاية، والساعة بتوقف لما ينتهي الطلب. باقي
التطبيق شغّال عادي هناك.

> The conversation needs a process that stays alive. On serverless each request
> can land on a fresh instance, so the robot you were talking to may not be
> there next message. Everything else in the app is fine on serverless.

---

## القدرات — The abilities

| # | القدرة | ما بتعمله | الفكرة اللي وراها |
|---|--------|-----------|-------------------|
| 1 | `reflex.shield` · درع الانعكاس | حلقة حماية ٥٠ هرتز بتحسب الوقت للاصطدام وبتاخد المقود قبل ما ينتبه غيرها | معظم الإصابات بتصير بالفجوة بين ما يشوف الخطر وما يخلص تفكير فيه |
| 2 | `motion.telegraph` · إشارة النيّة | بيعلن حركته الجاية بحركة تمهيدية بتستبعد الأهداف اللي مو رايح عليها | الناس بتنصاب لأن الروبوت غير مفهوم، مو لأنه سريع |
| 3 | `balance.recover` · استرداد التوازن | بيحسب نقطة الالتقاط وبيرجّع القاعدة تحت مركز الثقل، أو بيستعد للارتطام | «هل أنا عم بوقع؟» بتصير عملية حسابية مو تخمين |
| 4 | `memory.spatial` · الذاكرة المكانية | بيتذكر وين شاف كل غرض، وبيتعلّم لكل غرض كم بتضل معلومته صالحة | الفنجان بينتقل، الكنباية لأ — والروبوت لازم يعرف الفرق لحاله |
| 5 | `learn.demo` · التعلّم بالتقليد | بيشوف الحركة مرة، بيحفظ شكلها، وبينفّذها لأي هدف جديد وبأي سرعة | البرمجة بالإحداثيات ما بتتوسّع؛ التعليم بالعرض بيتوسّع |
| 6 | `grasp.adaptive` · القبضة المتكيّفة | بيقيس صلابة الغرض بالعصر، وبيمسكه بأقل قوة بتمنع الانزلاق — أو بيرفض | الرؤية بتقولك وين الغرض، بتضل ما بتقولك قديش تعصره |
| 7 | `power.lifeline` · حبل النجاة | بيتعلّم كلفة كل متر فعلياً وبيوقف المهمة عند نقطة اللاعودة | نسبة البطارية رقم بلا معنى؛ السؤال هو: بقدر أرجع؟ |
| 8 | `swarm.auction` · مزاد السرب | روبوتات بتوزّع الشغل بينها بالمزاد بدون موزّع مركزي | التقدير الصح موجود عند الروبوت نفسه، مو عند مخطط بعيد |
| 9 | `sense.anomaly` · الحارس الحسّي | بيتعلّم الوضع الطبيعي لهالروبوت بالذات وبيبلّغ عن الانحراف المستمر | العتبة الثابتة إما طرشا على روبوت هادي أو بتزعّق على روبوت شوي مزعج |
| 10 | `plan.rehearse` · البروفة الذهنية | بيجرّب الخطة مئات المرات بنسخة من العالم قبل ما يحرّك محرك | الوقت بالمحاكاة شبه مجاني؛ الوقت الحقيقي والضرر لأ |
| 11 | `hri.handover` · التسليم لليد | بيقدّم الغرض وبيفلته لما يحس بشدّ إيد الشخص، مو على مؤقّت | التسليم أكتر تفاعل جسدي شائع بين الروبوت والإنسان |
| 12 | `explore.frontier` · المستكشف | بيرسم خريطة مكان مجهول بالمشي على الحدود بين المعروف والمجهول | شرط التوقف واضح: ما ضل حدود يعني خلص المكان |
| 13 | `navigate.to` · التنقل | بيوصل لنقطة ويتفادى كل شي بيظهر بالطريق | الأساس اللي بتبني عليه الباقي |
| 14 | `safety.stoppable` · مراقب التوقف | بيجاوب باستمرار: لو وقف هلق، بيوصل لوضع ثابت بدون ما يوقع أو يصطدم؟ | حدّ السرعة بيجاوب «قديش بسرعة»، مو «هل التوقف لسا ممكن» — والاتنين بينفصلوا بالضبط وين بيهمّوا |

كل قدرة بتشتغل هيك:

```ts
import { createSimRig } from "@/lib/robotics";

const rig = createSimRig({ scenario: "cluttered-office" });
rig.runtime.startDaemon("reflex.shield", {});           // الحماية أولاً
const result = await rig.runtime.run("navigate.to", { x: 12, y: 8 });

console.log(result.summary);
// Arrived at (12.0, 8.0) — 10.7 m travelled, 1.02× the straight line.
```

---

## What is actually in here

```
lib/robotics/
  core/       the ability contract, registry, runtime, memory, DMP maths
  safety/     the speed-and-separation governor every command passes through
  sim/        a seeded 2-D world: physics, sensors, six scenarios
  hal/        ROS 2 bridge — the same RobotIO interface, real hardware behind it
  abilities/  the thirteen abilities
  claude/     ability manifests as Anthropic tool definitions
  demos.ts    nine scripted demonstrations that check their own outcomes
```

### The ability contract

An ability is a manifest plus a `run` function. Nothing else.

```ts
export const myAbility: Ability<MyInput, MyReport> = {
  manifest: {
    id: "my.ability",
    version: "1.0.0",
    name: { en: "…", ar: "…" },
    summary: { en: "…", ar: "…" },
    rationale: "Why this is worth having.",
    tags: ["…"],
    risk: "motion",              // passive | motion | contact | critical
    requires: ["drive", "lidar"],
    typicalDurationMs: 8000,
    inputSchema: { /* JSON schema — also the Claude tool schema */ },
  },

  async run(input, ctx) {
    ctx.emit({ kind: "status", message: "…", ar: "…" });
    ctx.robot.drive(0.5, 0);      // routed through the safety governor
    await ctx.sleep(100);         // the robot's clock, not the wall clock
    return { ok: true, summary: "…", data: {}, metrics: {} };
  },
};
```

Register it in `abilities/index.ts` and it immediately appears in the CLI, in the
web UI, and as a Claude tool. `core.test.ts` enforces that every manifest is
complete — bilingual names, a real rationale, a coherent schema.

### The rules the runtime enforces for you

- **Hardware gating** — an ability needing an `arm` is refused on a robot without one.
- **Input validation** — bad input is rejected before anything moves.
- **Risk gating** — `contact` abilities are refused while anyone is inside the
  separation envelope or an emergency stop is latched.
- **The governor** — every `drive()` is clamped to the speed that keeps the
  protective separation distance inside the real distance to the nearest person.
  Only `critical` abilities bypass it.
- **Abort** — `ctx.signal` is honoured everywhere, and `ctx.sleep` wakes
  immediately on abort so nothing can hang.
- **Escalation** — a daemon that finds something disqualifying calls
  `ctx.escalate(reason)`, which aborts the foreground mission.

### The safety governor

Modelled on ISO/TS 15066 speed-and-separation monitoring:

```
S(v) = v_human·(T_react + v/a_brake) + v·T_react + v²/(2·a_brake) + uncertainty
```

The governor inverts it in closed form: given the distance to the nearest
person, what is the fastest this robot may travel? Full speed at 4 m, 0.9 m/s at
2 m, 0.27 m/s at 1 m, stopped inside 0.6 m. A test asserts the model is
self-consistent — whatever speed it permits at a distance, the protective
distance that speed demands fits inside it.

This is a working model for simulation and prototyping. Certifying a real
machine is a different job involving rated safety hardware.

### The simulator

Seeded end to end, so a failing run replays exactly. It models what the
abilities actually depend on:

- differential drive with acceleration limits, and a linear inverted pendulum
  with a saturating ankle — so a robot really can be pushed over, and really can
  catch itself by driving back under its centre of mass;
- gripper contact: fingers stop at the object, deform it under force, and creep
  at constant force once past its yield point — which is what
  `grasp.adaptive` listens for;
- battery drawn against real motion, recharging at the dock;
- lidar by raycast, IMU, noisy perception, health channels with injectable faults;
- people who walk routes and step around robots.

`world.snapshot()` / `SimWorld.restore()` are what make `plan.rehearse` possible:
a fork of the live world, with its own seed, that shares nothing with the
original — including memory, so a rehearsal cannot teach the robot something
that never happened.

### Going to real hardware

`hal/ros2-bridge.ts` implements the same `RobotIO` interface over
`rosbridge_suite` — JSON over a WebSocket, no native dependencies.

```bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

```ts
const robot = new Ros2Bridge({ url: "ws://robot.local:9090", robotId: "luka-1" });
await robot.connect();
const runtime = new RobotRuntime({ registry, robot, governor });   // no `world`
await runtime.run("navigate.to", { x: 4, y: 2 });
```

Without a `world` the runtime uses the wall clock and `ctx.twin` is undefined, so
`plan.rehearse` reports honestly that it has nothing to rehearse in. Everything
else behaves identically. Check `robot.healthy()` before trusting a reading:
sensor topics are served from the last message received, and a stale reading is
more dangerous than no reading.

### Driving it from Claude

```ts
import { abilityTools, executeAbilityTool, describeRobot } from "@/lib/robotics/claude/tools.ts";

const tools = abilityTools(rig.registry);        // 13 tool definitions
const system = describeRobot(rig.registry, "luka-1");
// …then on a tool_use block:
const { resultText } = await executeAbilityTool(rig.runtime, toolName, input);
```

Tool definitions are generated from the manifests, so they cannot drift.

---

## Measuring things honestly

`lib/robotics/eval/` exists because the field's own complaint about itself in
2026 is not that models are bad — it is that nobody can prove they got better.
A bare percentage over ten episodes is not evidence, and this module makes it
awkward to publish one.

```ts
import { runSuite, compare, report, type Protocol } from "@/lib/robotics/eval";

const protocol: Protocol = {
  name: "corridor crossing",
  scenario: "busy-corridor",
  seeds: [1000, 1007, 1014, /* … */],
  timeLimitMs: 120_000,
  criterion: { id: "arrived-without-contact", version: "1.0.0", description: "…" },
  conditions: { shield: "on" },
};

const result = await runSuite(protocol, runOneEpisode);
console.log(report(result));
```

```
corridor crossing · busy-corridor  [919f8ef350b08551]
  world busy-corridor · 20 episodes · 120s limit each
  success: 20/20 = 100.0%
  95% CI:  83.9% – 100.0%   (Wilson)
  this many episodes can only resolve differences above 40 points
  criterion: arrived-without-contact@1.0.0 — reached the goal and never touched a person
  humanContacts: mean 0.000 ± 0.000 · median 0.000 · range 0.000–0.000
```

What it enforces:

- **Every rate carries a Wilson interval.** Nine out of ten is 60–98%, not 90%.
- **Every protocol has a fingerprint** over its seeds, limits, success criterion
  and conditions. `compare()` throws on mismatched fingerprints rather than
  subtracting two numbers that were never measuring the same thing.
- **Comparisons are paired** (exact McNemar on the episodes where the two
  variants disagreed), which needs far fewer episodes than comparing two
  independent rates.
- **Sample size before the experiment.** At a 50% baseline and 80% power:
  93 episodes to detect 20 points, 388 for 10, about 9,800 for 2. `runSuite`
  reports what its own episode count could actually have resolved.
- **`sweep()` reports a curve**, not a number — one success rate on nominal
  conditions is the statistic that made everyone stop trusting robot benchmarks.

## Testing

```bash
npm test                        # 53 tests: kernel, safety model, statistics, every ability
npm run demo                    # 11 demonstrations, each checking its own result
npm run demo -- push-sweep      # just one
```

The tests are behavioural, not smoke tests. They assert things like:

- a 1.6 rad/s shove topples the robot **unless** `balance.recover` catches it —
  the control case is run first, so the test proves something;
- a 12–4 win is reported as *unresolved* (p = 0.077), because it is;
- `grasp.adaptive` recovers an unknown object's stiffness to within 20% by
  squeezing it, and refuses the one object that cannot be held without damage —
  leaving it undamaged;
- crossing a corridor with two people never brings the robot inside the
  separation envelope, measured against ground truth rather than the robot's own
  noisy estimate;
- a rehearsal of a hundred imagined missions leaves the real robot where it was,
  to within a micrometre.

## Known limits

- The simulator is 2-D. Arm motions are planar plus height; there is no
  manipulation in full 6-DOF, and no dynamics for the arm itself.
- `explore.frontier` is reactive: it has no global planner, so it can take a
  long way round. It reports cells mapped per metre driven so you can see when
  that is happening.
- Coverage is measured against the region the robot has reason to believe
  exists. Early in a mission that number is low and honest, not wrong.
- The safety governor models separation monitoring. It is not a certified
  safety controller, and nothing here should be the only thing between a machine
  and a person.
