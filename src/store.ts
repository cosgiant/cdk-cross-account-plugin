import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { resolve as resolvePath } from 'path';

// Minimal dot-notation JSON store — replaces `conf` which is ESM-only in v11+.
export class JsonStore {
    readonly path: string;
    private data: Record<string, unknown>;
    private static readonly FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

    private static assertSafePath(parts: string[]): void {
        if (parts.length === 0) {
            throw new Error('Invalid key: empty path');
        }
        for (const part of parts) {
            if (part.length === 0 || JsonStore.FORBIDDEN_PATH_SEGMENTS.has(part)) {
                throw new Error('Invalid key: contains forbidden or empty path segment');
            }
        }
    }

    constructor() {
        const dir = resolvePath(homedir(), '.config', 'cdk-cross-account-plugin');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        this.path = resolvePath(dir, 'config.json');
        try {
            this.data = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, unknown>;
        } catch {
            this.data = {};
        }
    }

    get(key: string): unknown {
        return key.split('.').reduce(
            (obj: unknown, k) =>
                obj !== null && typeof obj === 'object'
                    ? (obj as Record<string, unknown>)[k]
                    : undefined,
            this.data,
        );
    }

    has(key: string): boolean {
        return this.get(key) !== undefined;
    }

    set(key: string, value: unknown): void {
        const parts = key.split('.');
        JsonStore.assertSafePath(parts);
        let obj = this.data as Record<string, unknown>;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!Object.prototype.hasOwnProperty.call(obj, part) || typeof obj[part] !== 'object' || obj[part] === null) {
                obj[part] = Object.create(null) as Record<string, unknown>;
            }
            obj = obj[part] as Record<string, unknown>;
        }
        // Deliberately re-checked here even though assertSafePath(parts)
        // above already covers lastPart: CodeQL's prototype-pollution
        // analysis (js/prototype-pollution-utility) only recognizes a
        // guard as covering this write when it's an inline literal
        // comparison immediately preceding it — a check in an earlier
        // statement, or one that goes through a Set/Map lookup, doesn't
        // get traced as a sanitizer for this specific line.
        const lastPart = parts[parts.length - 1];
        if (
            lastPart.length === 0 ||
            lastPart === '__proto__' ||
            lastPart === 'prototype' ||
            lastPart === 'constructor'
        ) {
            throw new Error('Invalid key: contains forbidden or empty path segment');
        }
        obj[lastPart] = value;
        writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    }
}
