/**
 * Local Solid path adapter.
 *
 * The pure algorithms live in this project's own path-core.ts. Angular keeps an
 * equivalent local path-core.ts file, but there is no shared package/folder at
 * runtime. This adapter owns Solid-specific root semantics and lightweight
 * bounded caches for hot proxy paths.
 */

import {
  cloneJsonCore,
  ensurePathInCore,
  enumerateAncestorPathsCore,
  getByPathCore,
  getBySegmentsCore,
  getParentPathCore,
  getParentSegmentsCore,
  isValidNormalizedPathCore,
  isValidPathCore,
  normalizePathCore,
  pathExistsCore,
  resolveParentAndKeyCore,
  resolveVersionPathCore,
  splitPathCore,
  type PathSegments,
  type ResolveVersionPathOptions,
} from './path-core';
import { writeJsonPathValue } from '@adsq/jsnq/core/data-engine';

export type { PathSegments, VersionDependencyMode } from './path-core';

const CACHE_MAX = 5000;
const normalizedCache = new Map<string, string>();
const segmentsCache = new Map<string, string[]>();

function cacheSet<K, V>(map: Map<K, V>, key: K, value: V, limit = CACHE_MAX): V {
  map.set(key, value);
  if (map.size > limit) {
    const first = map.keys().next().value as K | undefined;
    if (first !== undefined) map.delete(first);
  }
  return value;
}

export function clearPathCaches(): void {
  normalizedCache.clear();
  segmentsCache.clear();
}

export function normalizePath(path: string): string {
  if (!path) return '';
  const cached = normalizedCache.get(path);
  if (cached !== undefined) return cached;
  return cacheSet(normalizedCache, path, normalizePathCore(path));
}

export function splitPath(path: string): string[] {
  if (!path) return [];
  const normalized = normalizePath(path);
  const cached = segmentsCache.get(normalized);
  if (cached !== undefined) return cached;
  return cacheSet(segmentsCache, normalized, splitPathCore(normalized, { normalize: false, filterEmpty: true }));
}

export function isValidPath(path: string): boolean {
  return isValidPathCore(path);
}

export function isValidNormalizedPath(normalized: string): boolean {
  return isValidNormalizedPathCore(normalized);
}

export function getBySegments(obj: unknown, segments: PathSegments): unknown {
  return getBySegmentsCore(obj, segments, { guardForbidden: true });
}

export function getByPath(obj: unknown, path: string): unknown {
  if (!obj) return undefined;
  if (!path) return obj;
  return getBySegmentsCore(obj, splitPath(path), { guardForbidden: true });
}

export function setByPath(obj: unknown, path: string, value: unknown): void {
  if (!obj || !path) return;
  // Delegated to jsnq: same resulting tree and the same rejection of forbidden segments
  // (proven in test/path-core-jsnq-parity.test.ts), and faster because it reuses the
  // cached path plan — 82.1ms -> 39.1ms on repeated paths, 102.7ms -> 88.3ms on a
  // 90%-repeat mix over 200k writes. getBySegments deliberately stays local: jsnq has no
  // forbidden-segment guard, so delegating it would drop prototype-pollution protection.
  writeJsonPathValue(obj, path, value);
}

export function pathExists(obj: unknown, path: string): boolean {
  return pathExistsCore(obj, path);
}

export function getParentPath(path: string): string | null {
  return getParentPathCore(path);
}

export function enumerateAncestors(path: string, options: { includeNumericParent?: boolean } = {}): string[] {
  return enumerateAncestorPathsCore(path, options);
}

export function resolveVersionPath(normalized: string, options: ResolveVersionPathOptions): string {
  return resolveVersionPathCore(normalized, options);
}

export function cloneJson<T>(value: T): T {
  return cloneJsonCore(value);
}

export function getParentSegments(segments: PathSegments): PathSegments {
  return getParentSegmentsCore(segments);
}

export function resolveParentAndKey(obj: unknown, path: string): { parent: any; key: string | null; segments: string[] } {
  return resolveParentAndKeyCore(obj, path) as { parent: any; key: string | null; segments: string[] };
}

export function ensurePathIn(target: unknown, segments: PathSegments): unknown {
  return ensurePathInCore(target, segments);
}
