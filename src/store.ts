import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { resolve as resolvePath } from 'path';

// Minimal dot-notation JSON store — replaces `conf` which is ESM-only in v11+.
export class JsonStore {
    readonly path: string;
    private data: Record<string, unknown>;

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
        let obj = this.data as Record<string, unknown>;
        for (let i = 0; i < parts.length - 1; i++) {
            if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) obj[parts[i]] = {};
            obj = obj[parts[i]] as Record<string, unknown>;
        }
        obj[parts[parts.length - 1]] = value;
        writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    }
}
