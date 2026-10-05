import * as fs from 'fs';
import * as vscode from 'vscode';

export interface JsonReadResult<T> {
    data?: T;
    error?: Error;
}

/**
 * Pure read+parse helper — no vscode dependency, so it can be unit tested
 * without spinning up the extension host.
 */
export function tryReadJson<T>(filePath: string): JsonReadResult<T> {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
        return { error: err instanceof Error ? err : new Error(String(err)) };
    }

    try {
        return { data: JSON.parse(raw) as T };
    } catch (err) {
        return { error: err instanceof Error ? err : new Error(String(err)) };
    }
}

/**
 * Reads and parses JSON, surfacing failures as a VS Code error message instead
 * of throwing. Returns undefined if the file is missing/unreadable/invalid.
 */
export function readJsonOrWarn<T>(filePath: string, label: string): T | undefined {
    const { data, error } = tryReadJson<T>(filePath);
    if (error) {
        vscode.window.showErrorMessage(`Failed to read ${label}: ${error.message}`);
        return undefined;
    }
    return data;
}

export function writeJson(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
}
