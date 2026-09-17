# من المحاكي لروبوت حقيقي — bring-up

دليل مرتّب للوصول من هالمستودع لروبوت بيتحرّك. كل خطوة إلها طريقة تتأكد إنها
اشتغلت، وكل خطوة رح تفشل بطريقة معيّنة — مكتوب شو هي.

> **اقرا أول:** الفحص اللي بهالمكتبة أداة تصميم، مو وظيفة أمان معتمدة. لازم يكون
> بإيدك **زر طوارئ فيزيائي موصول على خط تغذية المحركات** — مو زر برمجي. الزر
> البرمجي بيمرق من نفس العملية اللي ممكن تكون هي اللي وقعت.

---

## ٠. قبل ما تشتري شي

الكود بيوصل للروبوت عبر **rosbridge** (WebSocket). يعني المطلوب من المنصّة:

| لازم | ليش |
|---|---|
| ROS 2 شغّال عليها | الجسر بيتكلّم ROS 2 |
| ليدار ثنائي الأبعاد | **كل** نموذج الأمان مبني عليه |
| `/cmd_vel` و`/odom` | القيادة والموقع |
| **مهلة أوامر بالـfirmware** | الشي الوحيد اللي بينجو لما تموت هالعملية |

آخر وحدة أهم مما بتبيّن — إقرا القسم ٤.

**ما منرشّح منصّة باسمها.** البحث اللي عملناه رشّح منصّات بأسعار محدّدة، بس كل
سعر إجا من ملخّص محرّك بحث مو من صفحة انفتحت — فما منكتبهم هون كأنهم معلومة.

---

## ١. شغّله بالمحاكي أول

```bash
npm install
npm test          # ١١٤ اختبار
npm run demo      # ١٢ عرض
npm run dev       # بعدين /robots و /robots/talk
```

إذا هاد ما اشتغل، ما في داعي تكمّل. المحاكي بينفّذ **نفس الواجهة** اللي بينفّذها
الجسر، فأي قدرة بتشتغل هون بتشتغل هناك — والعكس مو صحيح.

---

## ٢. اكتب ملف تعريف الروبوت

```ts
import type { RobotProfile } from "@/lib/robotics/hal/profile.ts";

export const MY_ROVER: RobotProfile = {
  id: "my-rover",
  name: { en: "My rover", ar: "مركبتي" },
  base: "differential",

  // قيسهم. بالمتر، وشامل أي شي مركّب فوق — هاد اللي بيخبط بإطار الباب.
  footprintRadius: 0.25,
  comHeight: 0.30,
  footHalf: 0.15,

  // ابدا تحت اللي المنصّة بتقدر عليه. فيك ترفعهم بعد أول ساعة.
  maxLinear: 0.3,
  maxAngular: 1.0,
  maxAccel: 0.5,
  maxDecel: 0.5,

  capabilities: ["drive", "lidar", "imu", "battery"],
  reactionTimeMs: 250,

  link: {
    kind: "wireless",
    controlPeriodMs: 50,
    maxRoundTripP99Ms: 40,
    robotSideWatchdogMs: 100,   // null إذا ما في — إقرا القسم ٤
  },

  kinematics: { wheelRadius: 0.0, trackWidth: 0.0, source: "assumed" },
  lidarHeight: 0.15,
  groundClearance: 0.02,
  batteryScale: "unknown",      // إقرا القسم ٥

  verified: "unverified",
};
```

**`verified: "unverified"` اتركها هيك لحد ما تقيس فعلاً.** الفحص بيحذّر منها،
وهاد مقصود.

منصّة مجهولة تماماً؟ استعمل `CRAWL_PROFILE`: ٠٫٠٥ م/ث، قيادة بس. مو افتراضي
متساهل — افتراضي بيخلّي الغلط كدمة.

---

## ٣. وصّل الجسر

على الروبوت:

```bash
sudo apt install ros-$ROS_DISTRO-rosbridge-suite
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

من هون:

```ts
import { Ros2Bridge } from "@/lib/robotics/hal/ros2-bridge.ts";

const robot = new Ros2Bridge({
  robotId: "my-rover",
  url: "ws://<robot-ip>:9090",
  capabilities: MY_ROVER.capabilities,
  batteryScale: MY_ROVER.batteryScale,
  onProblem: (message) => console.error("[transport]", message),
});
await robot.connect();
```

**حطّ `onProblem` من أول لحظة.** الجسر بيبلّغ عن حالتين ما بينفع تكتشفهم لحالك:
رسائل بتوصل وما بتنفك، وأوامر بتنبعت بدون اتصال. الاتنين بيخلّوا الروبوت يبيّن
«مطيع وساكن».

> ⚠️ **الضغط:** الجسر بيفك JSON بس. إذا طلبت `compression: "cbor"` رح توصلك
> رسائل binary وما رح ينفك ولا وحدة — المواضيع كلها بتقرا ساكتة للأبد. هلق
> بينعدّوا وبينبلّغوا بدل ما ينرموا بصمت، بس لسا ما في decoder. خلّي JSON.

---

## ٤. مهلة الأوامر — أهم فقرة بالملف

أمر السرعة **أمر دائم، مو حدث**. بيضل شغّال لحد ما شي يستبدله. يعني:

1. شي بيأمر ٠٫٤ م/ث.
2. الوصلة بتتقطّع، أو العملية بتقع، أو اللابتوب بينام.
3. ما بينبعت شي تاني.
4. **الأمر الأخير لسا نافذ، والروبوت بيكمّل.**

المكتبة عندها `Deadman` وبينشتغل تلقائياً لما الملف بيقول إنه الوصلة بتقدر تقع.
بس **هو شغّال جوّا هالعملية** — فالحالة اللي ما بيغطّيها هي بالضبط **موت العملية
نفسها**.

لهيك لازم تكون **القاعدة عندها مهلة أوامر خاصة فيها**. لاقي اسمها بالمنصّة
(بعضهم `cmd_vel_timeout`)، وحطّها بـ`robotSideWatchdogMs`.

**ما في وحدة؟** الفحص بيرفض أي سرعة فوق الزحف على وصلة لاسلكية بدون مهلة. هاد
مقصود، ومو شي تلتفّ عليه.

---

## ٥. اقرا موضوع البطارية مرة وحدة

رسالة البطارية بـROS **محدّدة ٠–١**، وسوّاقات كتير بتنشر ٠–١٠٠. والرقمين ما
بينميّزوا من قراءة وحدة: `0.8` يا ٨٠٪ يا ٠٫٨٪.

```bash
ros2 topic echo /battery_state --once
```

شوف الرقم لما تكون البطارية مليانة. مليانة وبتقول ~`1.0` → `"fraction"`. مليانة
وبتقول ~`100` → `"percent"`.

**ما تخمّن.** التخمين البديهي (أي شي فوق ١ لازم يكون نسبة) بيغلط بالضبط بالحالة
اللي بتهم: بطارية شبه فاضية على سوّاقة ٠–١٠٠ بتقرا `0.8`، والتخمين بيقول
«كسر» → **٨٠٪**. والروبوت بينطلق عبر المبنى وهو فاضي.

تركتها `"unknown"`؟ المكتبة بتاخد **الأسوأ** من الاحتمالين وبتعلّمها
`confident: false`. آمن، بس الروبوت رح يرجع عالشاحن بدري.

---

## ٦. شغّل الفحص — وهو على بلوك

**ارفع الروبوت عن الأرض** أول مرة.

```ts
const rig = { /* runtime بالـprofile والجسر */ };
const report = await rig.runtime.run("hardware.checkout", { staticOnly: true });
console.log(report.summary);
```

`staticOnly` بيشغّل كل شي ما بيحرّك الروبوت. **١٢ بوابة**، بترتيب ما بيتحرّك فيه
شي قبل ما يثبت اللي رح يوقفه:

| # | البوابة | بترفض لما |
|---|---|---|
| ١ | `profile` | الملف بيوصف آلة متناقضة |
| ٢ | `capabilities` | الملف بيدّعي عتاد الواجهة ما بتعرضه |
| ٣ | `posture` | التركيبة خطرة (مثلاً: سريع + لاسلكي + بدون مهلة) |
| ٤ | `lidar` | المسح فاضي، أو متجمّد (نفس القراءة **ونفس الطابع الزمني**) |
| ٥ | `imu` | الطابع الزمني واقف، أو مايل وهو ساكن |
| ٦ | `battery` | تحت الأرضية |
| ٧ | `transport` | ما في اتصال، أو في رسائل/أوامر ضايعة |
| ٨ | `clock` | الساعات مختلفة >٥٠م.ث أو **بتزحف** |
| ٩ | `link` | ذيل التأخير أطول من دورة التحكّم |
| ١٠ | `emergency-stop` | ما بيتقفّل |
| ١١ | `drive` | أمرت بحركة وما تحرّك |
| ١٢ | `brakes` + `deadman` | ما بيوقف، أو الأمر المهجور ما بينقفل |

آخر وحدة **بتنقاس مو بتنقال**: بتحرّك الروبوت، بتتخلّى عن الأمر، وبتسجّل شو صار.

بوابة `clock` تستاهل وقفة: أكتر عطل بينحكى عنه كـ«التنقّل ما بيشتغل» بيطلع
ساعات مو متزامنة. والفحص **بيفرّق بين إزاحة ثابتة** (غلط، بس ثابت) **وزحف**
(غلط بمعدّل — بيشتغل الصبح وبيوقف بعد الضهر). الزحف بينبلّغ أول، لأنه هو السبب.

---

## ٧. أول حركة

نزّله عالأرض، بمساحة فاضية، **وزر الطوارئ بإيدك**.

```ts
await rig.runtime.run("hardware.checkout", {});   // بدون staticOnly
```

هلق بيجرّب القيادة والفرامل وقاطع الأوامر الميتة فعلياً. إذا عدّى:

```ts
rig.runtime.startDaemon("reflex.shield", {});
rig.runtime.startDaemon("safety.stoppable", {});
rig.runtime.startDaemon("reflex.looming", {});
await rig.runtime.run("navigate.to", { x: 2, y: 0 });
```

---

## ٨. قيس بدل ما تخمّن

الملف اللي كتبته بالقسم ٢ **فرضية**. خلّيه قياس:

- **الحركيات** — سيّر مسافة معروفة مستقيمة، قارن مع `/odom`. لفّ ٣٦٠° بمكانك،
  قارن. عدّل `wheelRadius` و`trackWidth`، وبعدين حطّ `source: "measured"`.
  لحد ما تعملها، `"assumed"` بيمنع كل شغل بدّه دقّة مترية — والسبب إنه العرض
  المخمّن **بيعطي خريطة بمقياس غلط، مو خطأ**.
- **التوقف** — سيّر بأقصى سرعة، اضغط إيقاف، قيس. إذا أطول من `maxDecel` بتوعد
  فيه، نزّل الرقم.
- **البصمة** — قيس شامل أي شي مركّب.
- بعدين بس: `verified: "measured"`.

---

## ٩. اللي ما بيغيّره ولا شي من هاد

- **مستوى الليدار فوق الأرض بعشرات السنتيمترات.** ما بيشوف قدم، ولا قطة، ولا شخص
  مستلقي، ولا حافّة درجة.
- **`reflex.looming` انعكاس فزع مو تفادي اصطدام.** ما بيشتعل تحت ~٠٫٤ م/ث اقتراب
  بالتصميم، وعنده إنذارات كاذبة وقت المناورة.
- **أمان الروبوت بيعتمد على تعاون الناس.** عرض `measured-crossing`: ٢٠/٢٠ عبور
  نظيف مع ناس بينتبهوا، **٠/٢٠ مع ناس ما بيرفعوا راسهم**. ولا تحديد سرعة بيغيّر
  هاد.
- **زر الطوارئ الفيزيائي.** على خط تغذية المحركات. بإيد حدا.

> **In English, briefly.** Run it in the simulator first; write a profile and
> leave it marked unverified until you have measured it; connect the bridge with
> an `onProblem` handler from the first line; find the base's own command
> timeout, because the deadman in this library runs in the process that might be
> the thing that died; read the battery topic once rather than guessing its
> units; run the checkout on blocks, then on the floor with a physical stop
> button in your hand; and replace every guessed number with a measured one. The
> lidar cannot see a foot, the looming reflex is a startle rather than collision
> avoidance, and the safety record depends on people looking where they are
> going — `measured-crossing` measures exactly how much.
