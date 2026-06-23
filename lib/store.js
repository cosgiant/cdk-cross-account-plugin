"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonStore = void 0;
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
// Minimal dot-notation JSON store — replaces `conf` which is ESM-only in v11+.
class JsonStore {
    constructor() {
        const dir = (0, path_1.resolve)((0, os_1.homedir)(), '.config', 'cdk-cross-account-plugin');
        if (!(0, fs_1.existsSync)(dir))
            (0, fs_1.mkdirSync)(dir, { recursive: true });
        this.path = (0, path_1.resolve)(dir, 'config.json');
        try {
            this.data = JSON.parse((0, fs_1.readFileSync)(this.path, 'utf8'));
        }
        catch (_a) {
            this.data = {};
        }
    }
    get(key) {
        return key.split('.').reduce((obj, k) => obj !== null && typeof obj === 'object'
            ? obj[k]
            : undefined, this.data);
    }
    has(key) {
        return this.get(key) !== undefined;
    }
    set(key, value) {
        const parts = key.split('.');
        let obj = this.data;
        for (let i = 0; i < parts.length - 1; i++) {
            if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null)
                obj[parts[i]] = {};
            obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
        (0, fs_1.writeFileSync)(this.path, JSON.stringify(this.data, null, 2));
    }
}
exports.JsonStore = JsonStore;
