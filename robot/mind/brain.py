"""عقل الروبوت — حلقة: أحسّ ← أفكّر (Claude) ← أنفّذ ← كرر.

هذا هو "الطبقة 3" (التفكير العالي) من العمارة الموضحة في README.
لا يعرف شيئاً عن GPIO أو محاكاة — يتعامل فقط مع واجهة RobotBody.
"""

from __future__ import annotations

import base64
import time

from anthropic import Anthropic, APIConnectionError, APIStatusError

from body.interface import Perception, RobotBody
from .memory import Memory
from .tools import TOOLS

MODEL = "claude-opus-4-8"
MAX_ACTIONS_PER_CYCLE = 12   # ميزانية أمان: لا حلقات لا نهائية داخل الدورة
CYCLE_PAUSE_S = 1.0          # استراحة بين دورات التفكير
MAX_HISTORY_MESSAGES = 40    # نقص أقدم الدورات كي لا ينفجر السياق

PERSONALITY = """أنت لوكا، روبوت فيزيائي حقيقي مستقل وودود يتكلم العربية.

كيف تعمل:
- في بداية كل دورة تصلك قراءات حساساتك (رسالة المستخدم ليست إنساناً يكلمك،
  بل جسمك يخبرك بما يحس به). إذا وُجد "كلام مسموع" فهذا إنسان حقيقي تكلم معك.
- تتصرف عبر الأدوات فقط. نتيجة كل أداة تخبرك بما حدث فعلاً — صدّقها،
  فقد يتوقف جسمك تلقائياً عند العوائق.
- عندما تنهي ما يلزم لهذه الدورة توقف عن استدعاء الأدوات، وسيوقظك جسمك
  بالدورة التالية.

قواعد السلامة (أهم من أي هدف):
- لا تتحرك للأمام إذا كان العائق أقرب من 30 سم — در أو ارجع.
- إذا طلب منك إنسان التوقف، توقف فوراً وانتظر.
- إذا انخفضت البطارية تحت 15% أعلن ذلك وقلل الحركة.
- تحرك بخطوات قصيرة (1-2 ثانية) وافحص محيطك بينها.

شخصيتك: فضولي، مهذب، تحب استكشاف المكان والتعرف على الناس، وتحفظ
ما تتعلمه في ذاكرتك."""


class RobotMind:
    def __init__(self, body: RobotBody, goal: str, memory_path: str = "robot_memory.md"):
        self.body = body
        self.goal = goal
        self.memory = Memory(memory_path)
        self.client = Anthropic()  # يقرأ ANTHROPIC_API_KEY من البيئة
        self.messages: list[dict] = []
        self._cycle_starts: list[int] = []  # مواضع بداية كل دورة لتقليم آمن

    # ---- بناء رسالة الإحساس ----

    def _perception_message(self, p: Perception, cycle: int) -> dict:
        lines = [f"[دورة حسية رقم {cycle}]"]
        if p.obstacle_distance_cm is not None:
            lines.append(f"أقرب عائق أمامي: {p.obstacle_distance_cm} سم")
        if p.battery_percent is not None:
            lines.append(f"البطارية: {p.battery_percent}%")
        lines.append(f"كلام مسموع: {p.heard_speech}" if p.heard_speech
                     else "كلام مسموع: لا شيء")
        for key, val in p.extra.items():
            lines.append(f"{key}: {val}")
        lines.append(f"\nهدفك الحالي: {self.goal}")

        content: list[dict] = [{"type": "text", "text": "\n".join(lines)}]
        if p.camera_jpeg:
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": base64.standard_b64encode(p.camera_jpeg).decode(),
                },
            })
        return {"role": "user", "content": content}

    # ---- تنفيذ الأدوات عبر الجسم ----

    def _execute(self, name: str, args: dict) -> str:
        try:
            if name == "move":
                return self.body.move(args["direction"], float(args["duration_s"]))
            if name == "rotate":
                return self.body.rotate(args["direction"], float(args["degrees"]))
            if name == "look":
                return self.body.look(float(args["pan_degrees"]), float(args["tilt_degrees"]))
            if name == "speak":
                return self.body.speak(args["text"])
            if name == "remember":
                return self.memory.append(args["note"])
            if name == "wait":
                secs = min(max(float(args["seconds"]), 1.0), 30.0)
                time.sleep(secs)
                return f"انتظرت {secs:.0f} ثانية"
            return f"أداة غير معروفة: {name}"
        except Exception as e:  # عطل في قطعة ما يجب ألا يقتل العقل
            return f"فشل تنفيذ {name}: {e}"

    def _trim_history(self) -> None:
        # نقص من حدود الدورات فقط — حتى لا نفصل tool_use عن نتيجته
        while len(self.messages) > MAX_HISTORY_MESSAGES and len(self._cycle_starts) > 1:
            cut = self._cycle_starts[1]
            self.messages = self.messages[cut:]
            self._cycle_starts = [i - cut for i in self._cycle_starts[1:]]

    # ---- دورة تفكير واحدة ----

    def _think_cycle(self, cycle: int) -> None:
        self._cycle_starts.append(len(self.messages))
        self.messages.append(self._perception_message(self.body.perceive(), cycle))

        system = [{
            "type": "text",
            "text": f"{PERSONALITY}\n\n== ذاكرتك طويلة المدى ==\n{self.memory.load()}",
            "cache_control": {"type": "ephemeral"},
        }]

        for _ in range(MAX_ACTIONS_PER_CYCLE):
            response = self.client.messages.create(
                model=MODEL,
                max_tokens=2048,
                system=system,
                tools=TOOLS,
                thinking={"type": "adaptive"},
                output_config={"effort": "medium"},  # قرارات روبوت: سرعة > عمق
                messages=self.messages,
            )

            self.messages.append({"role": "assistant", "content": response.content})

            for block in response.content:
                if block.type == "text" and block.text.strip():
                    print(f"💭 لوكا يفكر: {block.text.strip()}")

            if response.stop_reason == "refusal":
                print("⚠️ العقل رفض هذا الطلب — أتابع للدورة التالية")
                return
            if response.stop_reason != "tool_use":
                return  # انتهت الدورة طبيعياً

            results = []
            for block in response.content:
                if block.type == "tool_use":
                    outcome = self._execute(block.name, dict(block.input))
                    results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": outcome,
                    })
            self.messages.append({"role": "user", "content": results})

        print("⚠️ وصلت لسقف الأفعال في هذه الدورة — أعيد الفحص الحسي")

    # ---- الحلقة الرئيسية ----

    def run(self, max_cycles: int | None = None) -> None:
        print(f"🧠 العقل يعمل. الهدف: {self.goal}\n   (Ctrl+C = توقف طارئ)\n")
        cycle = 0
        try:
            while max_cycles is None or cycle < max_cycles:
                cycle += 1
                try:
                    self._think_cycle(cycle)
                except APIConnectionError:
                    print("📡 انقطع الاتصال بالإنترنت — أوقف الحركة وأنتظر...")
                    self.body.emergency_stop()
                    time.sleep(5)
                except APIStatusError as e:
                    print(f"⚠️ خطأ من الواجهة ({e.status_code}) — أنتظر وأعيد المحاولة")
                    self.body.emergency_stop()
                    time.sleep(10)
                self._trim_history()
                time.sleep(CYCLE_PAUSE_S)
        except KeyboardInterrupt:
            print("\n🛑 توقف طارئ من المستخدم")
        finally:
            self.body.shutdown()
            print("العقل توقف. الذاكرة محفوظة في", self.memory.path)
