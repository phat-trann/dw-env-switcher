import * as vscode from 'vscode';
import { ActiveConfig } from '../types';

/** Prophet-style session output, implemented locally; never prints configuration objects or HTTP bodies. */
export class UploadOutput implements vscode.Disposable {
    private channel?: vscode.OutputChannel;
    private secrets: string[] = [];
    private getChannel(): vscode.OutputChannel { return this.channel ??= vscode.window.createOutputChannel('DW Manager Uploader'); }
    setTarget(active: ActiveConfig): void {
        this.secrets = [active.password, active.username,
            active.username && active.password ? Buffer.from(`${active.username}:${active.password}`).toString('base64') : undefined]
            .filter((value): value is string => !!value).sort((a, b) => b.length - a.length);
    }
    write(message: string): void {
        let safe = message;
        for (const secret of this.secrets) safe = safe.split(secret).join('[REDACTED]');
        this.getChannel().appendLine(`[${new Date().toLocaleTimeString()}] ${safe.replace(/[\r\n\x00-\x1f]/g, ' ')}`);
    }
    warning(message: string): void { this.write(`[WARN] ${message}`); }
    error(message: string): void { this.write(`[ERROR] ${message}`); this.show(); }
    show(): void { this.getChannel().show(true); }
    dispose(): void { this.channel?.dispose(); this.channel = undefined; this.secrets = []; }
}
