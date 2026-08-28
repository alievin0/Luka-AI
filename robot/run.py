"""نقطة التشغيل — اختر الجسم وحدد الهدف.

  python run.py --body sim --goal "استكشف الغرفة وقدّم نفسك"
  python run.py --body pi  --goal "استكشف المكان وتجنب العوائق"
"""

import argparse
import os
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="عقل الروبوت لوكا")
    parser.add_argument("--body", choices=["sim", "pi"], default="sim",
                        help="sim = محاكاة على اللابتوب، pi = روبوت Raspberry Pi حقيقي")
    parser.add_argument("--goal", default="استكشف المكان من حولك، وتعرف على من تقابله، واحفظ ما تتعلمه",
                        help="هدف الروبوت الحالي")
    parser.add_argument("--cycles", type=int, default=None,
                        help="عدد دورات التفكير (افتراضياً: بلا حدود حتى Ctrl+C)")
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ضع مفتاحك أولاً: export ANTHROPIC_API_KEY=sk-ant-...")

    if args.body == "pi":
        from body.pi_body import PiBody
        body = PiBody()
    else:
        from body.sim_body import SimBody
        body = SimBody()

    from mind.brain import RobotMind
    RobotMind(body, goal=args.goal).run(max_cycles=args.cycles)


if __name__ == "__main__":
    main()
