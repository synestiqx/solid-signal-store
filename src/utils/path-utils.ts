/**
 * Minimal, self-contained PathUtils for store-solid (retained for API surface + isValid*).
 * Core primitives delegated to THE single source of truth: src/internal/path.ts
 * Single source of truth for path parsing: core files must not re-implement simple path logic.
 * Proxy/bridge/SolidStore import directly from internal/path; this is the thin adapter.
 * isValid* are local (intentionally permissive). No caching.
 */

import {
  normalizePath as _normalizePath,
  splitPath as _splitPath,
  getByPath as _getByPath,
  setByPath as _setByPath,
  getParentPath as _getParentPath,
  isValidPath as _isValidPath,
  isValidNormalizedPath as _isValidNormalizedPath,
  pathExists as _pathExists,
  enumerateAncestors as _enumerateAncestors,
  resolveVersionPath as _resolveVersionPath,
  type VersionDependencyMode,
} from '../internal/path';

export type StoreData = Record<string, unknown>;
export type { VersionDependencyMode } from '../internal/path';

export class PathUtils {
  static normalizePath(path: string): string {
    return _normalizePath(path);
  }

  static splitNormalizedPath(normalized: string): readonly string[] {
    // Delegate via splitPath (idempotent normalize + split+filter); API preserved.
    return _splitPath(normalized);
  }

  static getByPath(obj: any, path: string): unknown {
    if (!obj || !path) return undefined;
    // Preserve exact prior semantics for falsy path (return undef, not root obj).
    // Core traversal delegated.
    return _getByPath(obj, path);
  }

  static setByPath(obj: any, path: string, value: unknown): void {
    // Guard matches internal exactly; full delegation safe + minimal.
    return _setByPath(obj, path, value);
  }

  static isValidPath(path: string): boolean {
    return _isValidPath(path);
  }

  static isValidNormalizedPath(normalized: string): boolean {
    return _isValidNormalizedPath(normalized);
  }

  static getParentPath(path: string): string | null {
    // Direct delegation (semantics identical, no extra validation here).
    return _getParentPath(path);
  }

  static pathExists(obj: StoreData, path: string): boolean {
    return _pathExists(obj, path);
  }

  static resolveVersionPath(
    normalized: string,
    options: { dependencyMode: VersionDependencyMode; bumpNumericParent: boolean }
  ): string {
    return _resolveVersionPath(normalized, options);
  }

  static enumerateAncestors(path: string, options: { includeNumericParent?: boolean } = {}): string[] {
    return _enumerateAncestors(path, options);
  }
}
