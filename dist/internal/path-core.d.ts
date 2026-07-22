export type PathSegments = readonly string[];
export type VersionDependencyMode = 'exact' | 'container';
export interface SplitPathOptions {
    normalize?: boolean;
    filterEmpty?: boolean;
}
export interface PathMutationOptions {
    createArrays?: boolean;
    guardForbidden?: boolean;
}
export interface ResolveVersionPathOptions {
    dependencyMode: VersionDependencyMode;
    bumpNumericParent: boolean;
}
export declare function isTraversable(value: unknown): value is Record<string, unknown>;
export declare function normalizePathCore(path: string): string;
export declare function splitPathCore(path: string, options?: SplitPathOptions): string[];
export declare function isNumericSegmentCore(segment: string | undefined | null): boolean;
export declare function isForbiddenPathSegmentCore(segment: unknown): boolean;
export declare function hasForbiddenPathSegmentCore(segments: readonly unknown[]): boolean;
export declare function isValidNormalizedPathCore(normalized: string): boolean;
export declare function isValidPathCore(path: string): boolean;
export declare function assertSafePathSegmentsCore(segments: readonly unknown[], path: string): void;
export declare function getBySegmentsCore<T = unknown>(obj: unknown, segments: PathSegments, options?: {
    guardForbidden?: boolean;
}): T | undefined;
export declare function getByPathCore<T = unknown>(obj: unknown, path: string, options?: {
    rootReturnsObject?: boolean;
    guardForbidden?: boolean;
    filterEmpty?: boolean;
}): T | undefined;
export declare function setByPathCore(obj: unknown, path: string, value: unknown, options?: PathMutationOptions): void;
export declare function pathExistsCore(obj: unknown, path: string, options?: {
    guardForbidden?: boolean;
}): boolean;
export declare function getParentPathNormalizedCore(normalized: string): string | null;
export declare function getParentPathCore(path: string): string | null;
export declare function getPathKeyCore(path: string): string | null;
export declare function nearestNumericContainerPathCore(path: string): string | null;
export declare function directNumericParentPathCore(path: string): string | null;
export declare function resolveVersionPathCore(normalized: string, options: ResolveVersionPathOptions): string;
export declare function enumerateAncestorPathsCore(path: string, options?: {
    includeNumericParent?: boolean;
}): string[];
export declare function resolveParentAndKeyCore(obj: unknown, path: string): {
    parent: unknown;
    key: string | null;
    segments: string[];
};
export declare function getParentSegmentsCore(segments: PathSegments): PathSegments;
export declare function ensurePathInCore(target: unknown, segments: PathSegments): unknown;
export declare function cloneJsonCore<T>(value: T): T;
