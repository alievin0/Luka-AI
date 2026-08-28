"""العقد بين العقل وأي جسم — محاكاة، Raspberry Pi، أو ROS 2 لاحقاً.

العقل (mind/brain.py) لا يتعامل إلا مع هذه الواجهة. أي جسم جديد
(روبوت حقيقي، محاكي Gazebo، إنسان آلي InMoov...) يكفي أن يطبّق
هذه الدوال ليعمل عليه نفس العقل بدون تعديل.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class Perception:
    """لقطة حسية واحدة يقرأها العقل في بداية كل دورة تفكير."""

    obstacle_distance_cm: float | None = None  # أقرب عائق أمامي، None = لا حساس
    battery_percent: float | None = None
    heard_speech: str | None = None            # آخر كلام سمعه المايك (إن وجد)
    camera_jpeg: bytes | None = None           # لقطة كاميرا، None = لا كاميرا
    extra: dict[str, str] = field(default_factory=dict)  # أي حساسات إضافية


class RobotBody(ABC):
    """كل الدوال يجب أن تكون آمنة: الجسم مسؤول عن ردود الفعل الفورية
    (مثل التوقف عند اقتراب عائق) بدون انتظار العقل — طبقة السلامة رقم 1.
    """

    @abstractmethod
    def perceive(self) -> Perception:
        """اقرأ كل الحساسات وأرجع لقطة حسية."""

    @abstractmethod
    def move(self, direction: str, duration_s: float) -> str:
        """تحرك: direction من forward/backward. أرجع وصف ما حدث فعلاً."""

    @abstractmethod
    def rotate(self, direction: str, degrees: float) -> str:
        """دوران في المكان: direction من left/right."""

    @abstractmethod
    def look(self, pan_degrees: float, tilt_degrees: float) -> str:
        """حرّك رأس/كاميرا الروبوت. 0,0 = للأمام مباشرة."""

    @abstractmethod
    def speak(self, text: str) -> str:
        """انطق النص بصوت مسموع."""

    @abstractmethod
    def emergency_stop(self) -> None:
        """أوقف كل المحركات فوراً. يجب أن تعمل دائماً مهما حدث."""

    def shutdown(self) -> None:
        """تنظيف عند إنهاء التشغيل (اختياري للأجسام)."""
        self.emergency_stop()
