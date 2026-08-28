"""ذاكرة الروبوت طويلة المدى — ملف markdown بسيط على القرص.

تبقى بين الجلسات: ما يتعلمه الروبوت اليوم يعرفه غداً.
"""

from __future__ import annotations

import time
from pathlib import Path

MAX_MEMORY_CHARS = 8000  # نحقن آخر جزء فقط حتى لا تنتفخ التكلفة


class Memory:
    def __init__(self, path: str | Path = "robot_memory.md") -> None:
        self.path = Path(path)

    def load(self) -> str:
        if not self.path.exists():
            return "(الذاكرة فارغة — هذه أول جلسة)"
        text = self.path.read_text(encoding="utf-8")
        return text[-MAX_MEMORY_CHARS:]

    def append(self, note: str) -> str:
        stamp = time.strftime("%Y-%m-%d %H:%M")
        with self.path.open("a", encoding="utf-8") as f:
            f.write(f"- [{stamp}] {note.strip()}\n")
        return f"حفظت في الذاكرة: {note.strip()}"
