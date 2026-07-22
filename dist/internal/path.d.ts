/**
 * Local Solid path adapter.
 *
 * The pure algorithms live in this project's own path-core.ts. Angular keeps an
 * equivalent local path-core.ts file, but there is no shared package/folder at
 * runtime. This adapter owns Solid-specific root semantics and lightweight
 * bounded caches for hot proxy paths.
 */
import { type PathSegments, type ResolveVersionPathOptions } from './path-core.js';
export type { PathSegments, VersionDependencyMode } from './path-core.js';
export declare function clearPathCaches(): void;
export declare function normalizePath(path: string): string;
export declare function splitPath(path: string): string[];
export declare function isValidPath(path: string): boolean;
export declare function isValidNormalizedPath(normalized: string): boolean;
export declare function getBySegments(obj: unknown, segments: PathSegments): unknown;
export declare function getByPath(obj: unknown, path: string): unknown;
export declare function setByPath(obj: unknown, path: string, value: unknown): void;
export declare function pathExists(obj: unknown, path: string): boolean;
export declare function getParentPath(path: string): string | null;
export declare function enumerateAncestors(path: string, options?: {
    includeNumericParent?: boolean;
}): string[];
export declare function resolveVersionPath(normalized: string, options: ResolveVersionPathOptions): string;
export declare function cloneJson<T>(value: T): T;
export declare function getParentSegments(segments: PathSegments): PathSegments;
export declare function resolveParentAndKey(obj: unknown, path: string): {
    parent: any;
    key: string | null;
    segments: string[];
};
export declare function ensurePathIn(target: unknown, segments: PathSegments): unknown;
