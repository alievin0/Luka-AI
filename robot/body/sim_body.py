"""جسم محاكاة — روبوت وهمي في غرفة افتراضية 2D.

يتيح تجربة العقل كاملاً على اللابتوب بدون أي قطع إلكترونية.
الغرفة شبكة بسيطة فيها جدران وأشياء، والروبوت له موقع واتجاه.
"""

from __future__ import annotations

import math
import random

from .interface import Perception, RobotBody

ROOM_W, ROOM_H = 500, 400  # سم
OBJECTS = {
    "طاولة": (120, 300),
    "كرسي": (400, 100),
    "باب": (250, 395),
    "نبتة": (30, 30),
}
MOVE_SPEED_CM_S = 25.0


class SimBody(RobotBody):
    def __init__(self) -> None:
        self.x, self.y = ROOM_W / 2, ROOM_H / 2
        self.heading_deg = 0.0  # 0 = شمال الغرفة
        self.pan, self.tilt = 0.0, 0.0
        self.battery = 87.0
        self._pending_speech: str | None = "مرحبا يا روبوت، شو تشوف حولك؟"
        print(f"[محاكاة] روبوت في غرفة {ROOM_W}x{ROOM_H} سم، يبدأ من المنتصف.")

    # ---- الحساسات ----

    def _distance_to_wall_ahead(self) -> float:
        rad = math.radians(self.heading_deg)
        dx, dy = math.sin(rad), math.cos(rad)
        dist = 0.0
        x, y = self.x, self.y
        while 0 < x < ROOM_W and 0 < y < ROOM_H and dist < 400:
            x += dx * 5
            y += dy * 5
            dist += 5
        return dist

    def _visible_objects(self) -> str:
        seen = []
        cam_heading = math.radians(self.heading_deg + self.pan)
        for name, (ox, oy) in OBJECTS.items():
            angle = math.atan2(ox - self.x, oy - self.y)
            diff = math.degrees(angle - cam_heading) % 360
            if diff > 180:
                diff -= 360
            dist = math.hypot(ox - self.x, oy - self.y)
            if abs(diff) < 40 and dist < 300:
                seen.append(f"{name} على بعد ~{dist:.0f} سم")
        return "، ".join(seen) if seen else "لا شيء مميز في مجال الرؤية"

    def perceive(self) -> Perception:
        self.battery = max(0.0, self.battery - random.uniform(0.05, 0.2))
        speech, self._pending_speech = self._pending_speech, None
        return Perception(
            obstacle_distance_cm=round(self._distance_to_wall_ahead(), 1),
            battery_percent=round(self.battery, 1),
            heard_speech=speech,
            camera_jpeg=None,
            extra={
                "وصف_الكاميرا_المحاكاة": self._visible_objects(),
                "الموقع": f"x={self.x:.0f} y={self.y:.0f} اتجاه={self.heading_deg:.0f}°",
            },
        )

    # ---- الأفعال ----

    def move(self, direction: str, duration_s: float) -> str:
        sign = 1 if direction == "forward" else -1
        rad = math.radians(self.heading_deg)
        dist = MOVE_SPEED_CM_S * duration_s * sign
        # ردّ فعل السلامة (الطبقة 1): لا تعبر الجدران
        nx = min(max(self.x + math.sin(rad) * dist, 10), ROOM_W - 10)
        ny = min(max(self.y + math.cos(rad) * dist, 10), ROOM_H - 10)
        actual = math.hypot(nx - self.x, ny - self.y)
        blocked = actual < abs(dist) - 1
        self.x, self.y = nx, ny
        msg = f"تحركت {actual:.0f} سم {'للأمام' if sign > 0 else 'للخلف'}"
        if blocked:
            msg += " ثم توقفت — جدار أمامي (رد فعل سلامة تلقائي)"
        print(f"[محاكاة] {msg}")
        return msg

    def rotate(self, direction: str, degrees: float) -> str:
        sign = -1 if direction == "left" else 1
        self.heading_deg = (self.heading_deg + sign * degrees) % 360
        msg = f"درت {degrees:.0f}° {'يساراً' if sign < 0 else 'يميناً'}، الاتجاه الآن {self.heading_deg:.0f}°"
        print(f"[محاكاة] {msg}")
        return msg

    def look(self, pan_degrees: float, tilt_degrees: float) -> str:
        self.pan = max(-90.0, min(90.0, pan_degrees))
        self.tilt = max(-45.0, min(45.0, tilt_degrees))
        msg = f"وجهت الرأس pan={self.pan:.0f}° tilt={self.tilt:.0f}°. أرى: {self._visible_objects()}"
        print(f"[محاكاة] {msg}")
        return msg

    def speak(self, text: str) -> str:
        print(f"\n🔊 الروبوت يقول: «{text}»\n")
        return "تم نطق الجملة"

    def emergency_stop(self) -> None:
        print("[محاكاة] 🛑 توقف طارئ — كل المحركات متوقفة")
