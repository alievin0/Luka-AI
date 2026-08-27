import type { Profile } from "./storage";
import { fill, t } from "./i18n";
import { ui } from "./i18n/ui";

/**
 * The driver's own car, in words.
 *
 * Composed here from what onboarding collected rather than asked of the
 * model, for two reasons. It is free and instant, and — the one that matters —
 * a model can get a car wrong. "For your 2019 Toyota Camry" printed above a
 * repair estimate is a claim about the reader's own property; it has to come
 * from what they typed, not from a guess.
 *
 * Returns null unless there is enough to say something true. A line reading
 * "for your car" adds nothing, and half a line — a year with no make — reads
 * as a bug.
 */
export function carLabel(profile: Profile): string | null {
  const make = clean(profile.brand);
  const model = clean(profile.model);
  const year = year4(profile.year);

  // The brand step offers pairs like "Toyota / Lexus"; printing both back at
  // someone who drives one of them is worse than printing neither.
  const brand = make && make.includes("/") ? null : make;

  const name = [brand, model].filter(Boolean).join(" ");
  if (!name) return null;

  return year ? fill(ui.forYourCarYear, { year, car: name }) : fill(ui.forYourCar, { car: name });
}

const clean = (value?: string) => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 && trimmed.length <= 40 ? trimmed : null;
};

/** A plausible model year, or nothing. Anything else is a typo, and a typo
 *  printed back as fact makes the whole estimate look careless. */
const year4 = (value?: string) => {
  const digits = (value ?? "").trim();
  if (!/^\d{4}$/.test(digits)) return null;
  const n = Number(digits);
  return n >= 1970 && n <= 2100 ? digits : null;
};

/** The same facts as one line for the vision prompt. */
export const carForPrompt = (profile: Profile) =>
  [clean(profile.brand), clean(profile.model), year4(profile.year), clean(profile.fuel)]
    .filter(Boolean)
    .join(" ");
