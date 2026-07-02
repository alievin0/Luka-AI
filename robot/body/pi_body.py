"""جسم حقيقي — Raspberry Pi + شاسيه بعجلات (المرحلة 1 من README).

التوصيلات الافتراضية (عدّلها حسب تركيبك):

  درايفر المحركات L298N / TB6612:
    المحرك الأيسر : IN1=GPIO17, IN2=GPIO27, EN=GPIO12 (PWM)
    المحرك الأيمن : IN1=GPIO23, IN2=GPIO24, EN=GPIO13 (PWM)
  حساس المسافة HC-SR04: TRIG=GPIO5, ECHO=GPIO6
  سيرفو الرأس: pan=GPIO18, tilt=GPIO19
  الصوت: أي سماعة USB/جاك + espeak-ng أو Piper للنطق العربي
  الكاميرا: Raspberry Pi Camera (عبر picamera2)

كل قطعة غير موصولة يتم تجاهلها بأمان — يمكنك البدء بالمحركات فقط.
التثبيت على الـ Pi:
  sudo apt install espeak-ng
  pip install gpiozero picamera2
"""

from __future__ import annotations

import io
import shutil
import subprocess
import time

from .interface import Perception, RobotBody

SAFETY_STOP_CM = 20.0  # ردّ فعل الطبقة 1: توقف تلقائي قبل الاصطدام


class PiBody(RobotBody):
    def __init__(self) -> None:
        self._init_motors()
        self._init_distance_sensor()
        self._init_head_servos()
        self._init_camera()
        print("[جسم Pi] جاهز. القطع الفعالة:",
              ", ".join(k for k, v in {
                  "محركات": self.motors, "حساس مسافة": self.sonar,
                  "سيرفو رأس": self.pan_servo, "كاميرا": self.camera,
              }.items() if v) or "لا شيء (وضع تجريبي)")

    # ---- تهيئة القطع (كل قطعة اختيارية) ----

    def _init_motors(self):
        self.motors = None
        try:
            from gpiozero import Robot
            self.motors = Robot(left=(17, 27), right=(23, 24))
        except Exception as e:
            print(f"[جسم Pi] المحركات غير متاحة: {e}")

    def _init_distance_sensor(self):
        self.sonar = None
        try:
            from gpiozero import DistanceSensor
            self.sonar = DistanceSensor(echo=6, trigger=5, max_distance=4)
        except Exception as e:
            print(f"[جسم Pi] حساس المسافة غير متاح: {e}")

    def _init_head_servos(self):
        self.pan_servo = self.tilt_servo = None
        try:
            from gpiozero import AngularServo
            self.pan_servo = AngularServo(18, min_angle=-90, max_angle=90)
            self.tilt_servo = AngularServo(19, min_angle=-45, max_angle=45)
        except Exception as e:
            print(f"[جسم Pi] سيرفو الرأس غير متاح: {e}")

    def _init_camera(self):
        self.camera = None
        try:
            from picamera2 import Picamera2
            self.camera = Picamera2()
            self.camera.configure(self.camera.create_still_configuration(
                main={"size": (1024, 768)}))
            self.camera.start()
        except Exception as e:
            print(f"[جسم Pi] الكاميرا غير متاحة: {e}")

    # ---- الحساسات ----

    def _distance_cm(self) -> float | None:
        if not self.sonar:
            return None
        return round(self.sonar.distance * 100, 1)

    def perceive(self) -> Perception:
        jpeg = None
        if self.camera:
            buf = io.BytesIO()
            self.camera.capture_file(buf, format="jpeg")
            jpeg = buf.getvalue()
        return Perception(
            obstacle_distance_cm=self._distance_cm(),
            battery_percent=None,  # أضف قارئ جهد ADC لاحقاً (مثل INA219)
            heard_speech=None,     # أضف whisper + مايك USB لاحقاً
            camera_jpeg=jpeg,
        )

    # ---- الأفعال ----

    def move(self, direction: str, duration_s: float) -> str:
        if not self.motors:
            return "لا توجد محركات موصولة"
        duration_s = min(duration_s, 5.0)  # سقف أمان لكل أمر
        go = self.motors.forward if direction == "forward" else self.motors.backward
        go(speed=0.6)
        start = time.monotonic()
        stopped_early = False
        while time.monotonic() - start < duration_s:
            # ردّ فعل الطبقة 1: راقب العائق أثناء الحركة بدون سؤال العقل
            d = self._distance_cm()
            if direction == "forward" and d is not None and d < SAFETY_STOP_CM:
                stopped_early = True
                break
            time.sleep(0.02)
        self.motors.stop()
        elapsed = time.monotonic() - start
        msg = f"تحركت {'للأمام' if direction == 'forward' else 'للخلف'} لمدة {elapsed:.1f} ثانية"
        if stopped_early:
            msg += f" ثم توقفت تلقائياً — عائق على بعد {self._distance_cm()} سم"
        return msg

    def rotate(self, direction: str, degrees: float) -> str:
        if not self.motors:
            return "لا توجد محركات موصولة"
        # بدون IMU نقدّر الزمن: عاير SECONDS_PER_90_DEG على أرضيتك
        SECONDS_PER_90_DEG = 0.8
        spin = self.motors.left if direction == "left" else self.motors.right
        spin(speed=0.6)
        time.sleep(min(degrees, 360) / 90 * SECONDS_PER_90_DEG)
        self.motors.stop()
        return f"درت تقريباً {degrees:.0f}° {'يساراً' if direction == 'left' else 'يميناً'}"

    def look(self, pan_degrees: float, tilt_degrees: float) -> str:
        if not self.pan_servo:
            return "لا يوجد سيرفو رأس موصول"
        self.pan_servo.angle = max(-90, min(90, pan_degrees))
        if self.tilt_servo:
            self.tilt_servo.angle = max(-45, min(45, tilt_degrees))
        time.sleep(0.4)
        return f"وجهت الرأس pan={pan_degrees:.0f}° tilt={tilt_degrees:.0f}°"

    def speak(self, text: str) -> str:
        if shutil.which("espeak-ng"):
            subprocess.run(["espeak-ng", "-v", "ar", text], check=False)
            return "تم النطق"
        print(f"🔊 (لا يوجد espeak-ng): {text}")
        return "لا يوجد نظام نطق — طبعت النص فقط"

    def emergency_stop(self) -> None:
        if self.motors:
            self.motors.stop()
        print("[جسم Pi] 🛑 توقف طارئ")
