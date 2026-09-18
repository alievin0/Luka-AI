/**
 * Picks the storage adapter once per process.
 *
 * Supabase when it is configured, memory otherwise. The choice is reported
 * through `repoHealth()` and surfaced in the UI, because running a real
 * business on the memory adapter would silently lose every booking on the next
 * deploy — that has to be visible, not discovered.
 */

import type { Repo, RepoHealth } from "./repo";
import { createMemoryRepo } from "./memory";
import { createSupabaseRepo, getSupabaseConfig } from "./supabase";

let cached: Repo | null = null;

export function getRepo(): Repo {
  if (cached) return cached;
  const cfg = getSupabaseConfig();
  cached = cfg ? createSupabaseRepo(cfg) : createMemoryRepo();
  return cached;
}

/** Test seam: force the next getRepo() to re-read the environment. */
export function resetRepo(): void {
  cached = null;
}

export async function repoHealth(): Promise<RepoHealth> {
  return getRepo().health();
}

export type { Repo, RepoHealth, CreateBookingInput, CreateBookingResult } from "./repo";
export * from "./types";
