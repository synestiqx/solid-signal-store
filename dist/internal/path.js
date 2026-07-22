/**
 * Local Solid path adapter.
 *
 * The pure algorithms live in this project's own path-core.ts. Angular keeps an
 * equivalent local path-core.ts file, but there is no shared package/folder at
 * runtime. This adapter owns Solid-specific root semantics and lightweight
 * bounded caches for hot proxy paths.
 */
import { cloneJsonCore, ensurePathInCore, enumerateAncestorPathsCore, getBySegmentsCore, getParentPathCore, getParentSegmentsCore, isValidNormalizedPathCore, isValidPathCore, normalizePathCore, pathExistsCore, resolveParentAndKeyCore, resolveVersionPathCore, setByPathCore, splitPathCore, } from './path-core.js';
const CACHE_MAX = 5000;
const normalizedCache = new Map();
const segmentsCache = new Map();
function cacheSet(map, key, value, limit = CACHE_MAX) {
    map.set(key, value);
    if (map.size > limit) {
        const first = map.keys().next().value;
        if (first !== undefined)
            map.delete(first);
    }
    return value;
}
export function clearPathCaches() {
    normalizedCache.clear();
    segmentsCache.clear();
}
export function normalizePath(path) {
    if (!path)
        return '';
    const cached = normalizedCache.get(path);
    if (cached !== undefined)
        return cached;
    return cacheSet(normalizedCache, path, normalizePathCore(path));
}
export function splitPath(path) {
    if (!path)
        return [];
    const normalized = normalizePath(path);
    const cached = segmentsCache.get(normalized);
    if (cached !== undefined)
        return cached;
    return cacheSet(segmentsCache, normalized, splitPathCore(normalized, { normalize: false, filterEmpty: true }));
}
export function isValidPath(path) {
    return isValidPathCore(path);
}
export function isValidNormalizedPath(normalized) {
    return isValidNormalizedPathCore(normalized);
}
export function getBySegments(obj, segments) {
    return getBySegmentsCore(obj, segments, { guardForbidden: true });
}
export function getByPath(obj, path) {
    if (!obj)
        return undefined;
    if (!path)
        return obj;
    return getBySegmentsCore(obj, splitPath(path), { guardForbidden: true });
}
export function setByPath(obj, path, value) {
    if (!obj || !path)
        return;
    setByPathCore(obj, path, value, { createArrays: true, guardForbidden: true });
}
export function pathExists(obj, path) {
    return pathExistsCore(obj, path);
}
export function getParentPath(path) {
    return getParentPathCore(path);
}
export function enumerateAncestors(path, options = {}) {
    return enumerateAncestorPathsCore(path, options);
}
export function resolveVersionPath(normalized, options) {
    return resolveVersionPathCore(normalized, options);
}
export function cloneJson(value) {
    return cloneJsonCore(value);
}
export function getParentSegments(segments) {
    return getParentSegmentsCore(segments);
}
export function resolveParentAndKey(obj, path) {
    return resolveParentAndKeyCore(obj, path);
}
export function ensurePathIn(target, segments) {
    return ensurePathInCore(target, segments);
}
//# sourceMappingURL=path.js.map