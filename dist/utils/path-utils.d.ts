/**
 * Minimal, self-contained PathUtils for store-solid (retained for API surface + isValid*).
 * Core primitives delegated to THE single source of truth: src/internal/path.ts
 * Single source of truth for path parsing: core files must not re-implement simple path logic.
 * Proxy/bridge/SolidStore import directly from internal/path; this is the thin adapter.
 * isValid* are local (intentionally permissive). No caching.
 */
import { type VersionDependencyMode } from '../internal/path.js';
export type StoreData = Record<string, unknown>;
export type { VersionDependencyMode } from '../internal/path.js';
export declare class PathUtils {
    static normalizePath(path: string): string;
    static splitNormalizedPath(normalized: string): readonly string[];
    static getByPath(obj: any, path: string): unknown;
    static setByPath(obj: any, path: string, value: unknown): void;
    static isValidPath(path: string): boolean;
    static isValidNormalizedPath(normalized: string): boolean;
    static getParentPath(path: string): string | null;
    static pathExists(obj: StoreData, path: string): boolean;
    static resolveVersionPath(normalized: string, options: {
        dependencyMode: VersionDependencyMode;
        bumpNumericParent: boolean;
    }): string;
    static enumerateAncestors(path: string, options?: {
        includeNumericParent?: boolean;
    }): string[];
}
