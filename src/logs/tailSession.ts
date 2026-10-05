import * as vscode from 'vscode';
import { fetchLogTail } from './webdavClient';

export interface TailTarget {
    hostname: string;
    username: string;
    password: string;
    fileName: string;
}

const DEFAULT_POLL_INTERVAL_MS = 4000;

/**
 * Polls a single sandbox log file over WebDAV and streams new content into
 * a dedicated Output Channel — a poor man's `tail -f` for SFCC logs.
 */
export class LogTailSession {
    private timer: ReturnType<typeof setInterval> | undefined;
    private lastSize = 0;
    private readonly channel: vscode.OutputChannel;

    constructor(private readonly target: TailTarget, private readonly intervalMs = DEFAULT_POLL_INTERVAL_MS) {
        this.channel = vscode.window.createOutputChannel(`SFCC Log: ${target.fileName}`);
    }

    async start(): Promise<void> {
        this.channel.show(true);
        await this.poll(true);
        this.timer = setInterval(() => this.poll(false), this.intervalMs);
    }

    reveal(): void {
        this.channel.show(true);
    }

    get isActive(): boolean {
        return this.timer !== undefined;
    }

    private async poll(isFirst: boolean): Promise<void> {
        try {
            const result = await fetchLogTail(this.target.hostname, this.target.username, this.target.password, this.target.fileName, this.lastSize);

            if (result.status === 416) {
                return; // no new content since lastSize
            }

            // Byte offsets (for the Range header and rotation detection) must be
            // computed from the UTF-8 byte length, not the JS string length —
            // otherwise multi-byte characters misalign the next request's offset.
            const bodyBuffer = Buffer.from(result.body, 'utf-8');

            if (result.status === 200) {
                // First fetch, or the server ignored our Range header and returned the whole file.
                const rotated = !isFirst && bodyBuffer.byteLength < this.lastSize;
                if (rotated) {
                    this.channel.appendLine('\n[dw-env-switcher] Log file was rotated/truncated — showing latest content.\n');
                }
                const newContent = isFirst || rotated ? result.body : bodyBuffer.subarray(this.lastSize).toString('utf-8');
                if (newContent) this.channel.append(newContent);
                this.lastSize = bodyBuffer.byteLength;
                return;
            }

            // 206 Partial Content — the response body is only the new bytes.
            if (result.body) this.channel.append(result.body);
            this.lastSize += bodyBuffer.byteLength;
        } catch (err) {
            this.channel.appendLine(`\n[dw-env-switcher] Stopped tailing — ${err instanceof Error ? err.message : String(err)}`);
            this.stop();
        }
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    dispose(): void {
        this.stop();
        this.channel.dispose();
    }
}
