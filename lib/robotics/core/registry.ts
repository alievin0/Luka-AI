// The ability registry: one place that knows every ability the robot can do,
// what it needs, and how dangerous it is.

import type { Ability, AbilityManifest, HardwareCapability, RiskClass } from "./types.ts";

export class AbilityRegistry {
  private readonly abilities = new Map<string, Ability<never, unknown>>();

  register<I, O>(ability: Ability<I, O>): this {
    const { id } = ability.manifest;
    if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/.test(id)) {
      throw new Error(
        `Ability id "${id}" must be dotted lowercase, e.g. "grasp.adaptive".`,
      );
    }
    if (this.abilities.has(id)) {
      throw new Error(`Ability "${id}" is already registered.`);
    }
    this.abilities.set(id, ability as unknown as Ability<never, unknown>);
    return this;
  }

  registerAll(abilities: Array<Ability<never, never>>): this {
    for (const ability of abilities) this.register(ability as never);
    return this;
  }

  get<I, O>(id: string): Ability<I, O> | undefined {
    return this.abilities.get(id) as Ability<I, O> | undefined;
  }

  require<I, O>(id: string): Ability<I, O> {
    const ability = this.get<I, O>(id);
    if (!ability) {
      const known = this.ids().join(", ");
      throw new Error(`Unknown ability "${id}". Registered: ${known}`);
    }
    return ability;
  }

  has(id: string): boolean {
    return this.abilities.has(id);
  }

  ids(): string[] {
    return Array.from(this.abilities.keys()).sort();
  }

  manifests(): AbilityManifest[] {
    return Array.from(this.abilities.values())
      .map((a) => a.manifest)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Abilities this particular robot's hardware can actually run. */
  runnableOn(capabilities: HardwareCapability[]): AbilityManifest[] {
    const owned = new Set(capabilities);
    return this.manifests().filter((m) => m.requires.every((r) => owned.has(r)));
  }

  /** Hardware the robot is missing for a given ability. */
  missingFor(id: string, capabilities: HardwareCapability[]): HardwareCapability[] {
    const owned = new Set(capabilities);
    return this.require(id).manifest.requires.filter((r) => !owned.has(r));
  }

  byTag(tag: string): AbilityManifest[] {
    return this.manifests().filter((m) => m.tags.includes(tag));
  }

  byRisk(risk: RiskClass): AbilityManifest[] {
    return this.manifests().filter((m) => m.risk === risk);
  }

  daemons(): AbilityManifest[] {
    return this.manifests().filter((m) => m.daemon === true);
  }

  /** A compact catalogue for docs, the UI, and prompts. */
  catalogue(): Array<{
    id: string;
    name: string;
    nameAr: string;
    risk: RiskClass;
    requires: HardwareCapability[];
    summary: string;
  }> {
    return this.manifests().map((m) => ({
      id: m.id,
      name: m.name.en,
      nameAr: m.name.ar,
      risk: m.risk,
      requires: m.requires,
      summary: m.summary.en,
    }));
  }
}
