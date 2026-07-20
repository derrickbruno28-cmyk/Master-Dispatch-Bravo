/* Editable dropdown option lists. Defaults ship in code; the user can add more
   options (truck type, home terminal, team status) and they persist. */

import { TRUCK_TYPES } from './fleetStore';
import { TERMINALS } from './fleet';

export type OptionKind = 'type' | 'terminal' | 'status';

const DEFAULTS: Record<OptionKind, string[]> = {
  type: [...TRUCK_TYPES],
  terminal: [...TERMINALS],
  status: ['available', 'dispatched', 'en route', 'delivering', 'on 34hr reset', 'shutdown'],
};

const KEY = 'asset-options-v1';

function readCustom(): Record<string, string[]> {
  try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r) as Record<string, string[]>; } catch { /* ignore */ }
  return {};
}
function writeCustom(v: Record<string, string[]>) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ } }

export function getOptions(kind: OptionKind): string[] {
  const custom = readCustom()[kind] ?? [];
  const seen = new Set<string>();
  return [...DEFAULTS[kind], ...custom].filter((o) => { const k = o.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

export function addOption(kind: OptionKind, value: string): string[] {
  const v = value.trim();
  if (!v) return getOptions(kind);
  const all = readCustom();
  const list = all[kind] ?? [];
  if (![...DEFAULTS[kind], ...list].some((o) => o.toLowerCase() === v.toLowerCase())) {
    all[kind] = [...list, v];
    writeCustom(all);
  }
  return getOptions(kind);
}
