const BRACKET_SEGMENT_RE = /\[(.*?)\]/g;
const BASIC_PATH_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z0-9_$]+|\[\d+\])*$/;
const NORMALIZED_PATH_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z0-9_$]+)*$/;
const NUMERIC_SEGMENT_RE = /^\d+$/;
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
export function isTraversable(value) {
    return value != null && (typeof value === 'object' || typeof value === 'function');
}
export function normalizePathCore(path) {
    if (!path)
        return '';
    return path.indexOf('[') === -1 ? path : path.replace(BRACKET_SEGMENT_RE, '.$1');
}
export function splitPathCore(path, options = {}) {
    if (!path)
        return [];
    const normalized = options.normalize === false ? path : normalizePathCore(path);
    const parts = normalized ? normalized.split('.') : [];
    return options.filterEmpty ? parts.filter(Boolean) : parts;
}
export function isNumericSegmentCore(segment) {
    return !!segment && NUMERIC_SEGMENT_RE.test(segment);
}
export function isForbiddenPathSegmentCore(segment) {
    return segment !== undefined && segment !== null && FORBIDDEN_PATH_SEGMENTS.has(String(segment));
}
export function hasForbiddenPathSegmentCore(segments) {
    for (const segment of segments) {
        if (isForbiddenPathSegmentCore(segment))
            return true;
    }
    return false;
}
export function isValidNormalizedPathCore(normalized) {
    return typeof normalized === 'string' &&
        normalized.length > 0 &&
        NORMALIZED_PATH_RE.test(normalized) &&
        !hasForbiddenPathSegmentCore(splitPathCore(normalized, { normalize: false }));
}
export function isValidPathCore(path) {
    if (!path || typeof path !== 'string' || path.trim().length === 0)
        return false;
    try {
        return isValidNormalizedPathCore(normalizePathCore(path));
    }
    catch {
        return BASIC_PATH_RE.test(path);
    }
}
export function assertSafePathSegmentsCore(segments, path) {
    if (hasForbiddenPathSegmentCore(segments)) {
        throw new Error(`Unsafe path segment in '${path}'`);
    }
}
export function getBySegmentsCore(obj, segments, options = {}) {
    if (options.guardForbidden && hasForbiddenPathSegmentCore(segments))
        return undefined;
    let current = obj;
    for (const segment of segments) {
        if (current == null)
            return undefined;
        current = current[segment];
    }
    return current;
}
export function getByPathCore(obj, path, options = {}) {
    if (!obj)
        return undefined;
    if (!path)
        return options.rootReturnsObject ? obj : undefined;
    return getBySegmentsCore(obj, splitPathCore(path, { filterEmpty: options.filterEmpty }), { guardForbidden: options.guardForbidden });
}
export function setByPathCore(obj, path, value, options = {}) {
    const segments = splitPathCore(path, { filterEmpty: true });
    if (segments.length === 0)
        return;
    if (options.guardForbidden !== false)
        assertSafePathSegmentsCore(segments, path);
    let current = obj;
    const lastIndex = segments.length - 1;
    for (let i = 0; i < lastIndex; i++) {
        const segment = segments[i];
        const nextSegment = segments[i + 1];
        const shouldCreateArray = options.createArrays !== false && isNumericSegmentCore(nextSegment);
        const currentValue = current[segment];
        if (!isTraversable(currentValue)) {
            current[segment] = shouldCreateArray ? [] : {};
        }
        else if (shouldCreateArray && !Array.isArray(currentValue)) {
            current[segment] = [];
        }
        current = current[segment];
    }
    const last = segments[lastIndex];
    if (Array.isArray(current) && isNumericSegmentCore(last)) {
        current[Number(last)] = value;
    }
    else {
        current[last] = value;
    }
}
export function pathExistsCore(obj, path, options = {}) {
    if (!obj || typeof obj !== 'object' || !path)
        return false;
    const segments = splitPathCore(path);
    if (options.guardForbidden !== false && hasForbiddenPathSegmentCore(segments))
        return false;
    let current = obj;
    for (const segment of segments) {
        if (current == null || typeof current !== 'object')
            return false;
        if (Array.isArray(current) && isNumericSegmentCore(segment)) {
            const index = Number(segment);
            if (!Number.isInteger(index) || index < 0 || index >= current.length)
                return false;
            current = current[index];
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(current, segment))
            return false;
        current = current[segment];
    }
    return true;
}
export function getParentPathNormalizedCore(normalized) {
    if (!isValidNormalizedPathCore(normalized))
        return null;
    const index = normalized.lastIndexOf('.');
    return index === -1 ? null : normalized.slice(0, index);
}
export function getParentPathCore(path) {
    if (!isValidPathCore(path))
        return null;
    return getParentPathNormalizedCore(normalizePathCore(path));
}
export function getPathKeyCore(path) {
    if (!isValidPathCore(path))
        return null;
    const normalized = normalizePathCore(path);
    const index = normalized.lastIndexOf('.');
    return index === -1 ? normalized : normalized.slice(index + 1);
}
export function nearestNumericContainerPathCore(path) {
    if (!path)
        return null;
    const normalized = normalizePathCore(path);
    if (!isValidNormalizedPathCore(normalized))
        return null;
    const parts = splitPathCore(normalized, { normalize: false }).filter(Boolean);
    const index = parts.findIndex((segment) => isNumericSegmentCore(segment));
    return index > 0 ? parts.slice(0, index).join('.') : null;
}
export function directNumericParentPathCore(path) {
    if (!path)
        return null;
    const normalized = normalizePathCore(path);
    if (!isValidNormalizedPathCore(normalized))
        return null;
    const parts = splitPathCore(normalized, { normalize: false }).filter(Boolean);
    const last = parts[parts.length - 1];
    return isNumericSegmentCore(last) && parts.length > 1 ? parts.slice(0, -1).join('.') : null;
}
export function resolveVersionPathCore(normalized, options) {
    if (options.dependencyMode === 'container') {
        const parent = getParentPathNormalizedCore(normalized);
        const base = parent ?? normalized;
        return options.bumpNumericParent ? nearestNumericContainerPathCore(base) ?? base : base;
    }
    return options.bumpNumericParent ? nearestNumericContainerPathCore(normalized) ?? normalized : normalized;
}
export function enumerateAncestorPathsCore(path, options = {}) {
    if (!path || typeof path !== 'string')
        return [];
    const normalized = normalizePathCore(path);
    if (!isValidNormalizedPathCore(normalized))
        return [];
    const parts = splitPathCore(normalized, { normalize: false }).filter(Boolean);
    const out = [];
    for (let i = parts.length; i >= 1; i--) {
        out.push(parts.slice(0, i).join('.'));
    }
    if (options.includeNumericParent) {
        const parentPath = directNumericParentPathCore(normalized);
        if (parentPath && !out.includes(parentPath))
            out.push(parentPath);
    }
    return out;
}
export function resolveParentAndKeyCore(obj, path) {
    const segments = splitPathCore(path, { filterEmpty: true });
    if (segments.length === 0)
        return { parent: obj, key: null, segments };
    const key = segments[segments.length - 1];
    let parent = obj;
    for (let i = 0; i < segments.length - 1; i++) {
        if (!isTraversable(parent))
            return { parent: undefined, key, segments };
        parent = parent[segments[i]];
    }
    return { parent, key, segments };
}
export function getParentSegmentsCore(segments) {
    return !segments || segments.length <= 1 ? [] : segments.slice(0, -1);
}
export function ensurePathInCore(target, segments) {
    let current = target;
    for (let i = 0; i < segments.length; i++) {
        if (!isTraversable(current))
            return target;
        const segment = segments[i];
        const nextSegment = segments[i + 1];
        if (!isTraversable(current[segment])) {
            current[segment] = isNumericSegmentCore(nextSegment) ? [] : {};
        }
        current = current[segment];
    }
    return current;
}
export function cloneJsonCore(value) {
    if (value == null || typeof value !== 'object')
        return value;
    try {
        return structuredClone(value);
    }
    catch {
        try {
            return JSON.parse(JSON.stringify(value));
        }
        catch {
            return value;
        }
    }
}
//# sourceMappingURL=path-core.js.map