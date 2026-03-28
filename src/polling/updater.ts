import { DEFAULT_TIMEOUTS } from '../constants.js';
import { AuthError, NetworkError } from '../errors.js';
import type { ILinkHttpClient } from '../http/client.js';
import type { GetUpdatesResponse, RawMessage } from '../types/api.js';

export interface UpdaterOptions {
  getCursor: () => Promise<string>;
  saveCursor: (cursor: string) => Promise<void>;
  onMessage: (rawMessage: RawMessage) => Promise<void> | void;
  onLogout: (reason: string) => Promise<void> | void;
  onError: (error: Error) => void;
  getChannelVersion: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export class UpdatesPoller {
  private aborted = false;
  private failCount = 0;
  private running: Promise<void> | null = null;

  constructor(private readonly http: ILinkHttpClient, private readonly options: UpdaterOptions) {}

  start(): Promise<void> {
    if (!this.running) {
      this.aborted = false;
      this.running = this.pollLoop().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  stop(): void {
    this.aborted = true;
  }

  private async pollLoop(): Promise<void> {
    let timeoutMs: number = DEFAULT_TIMEOUTS.updates;

    while (!this.aborted) {
      try {
        const response = await this.http.post<GetUpdatesResponse>('ilink/bot/getupdates', {
          get_updates_buf: await this.options.getCursor(),
          base_info: { channel_version: this.options.getChannelVersion() },
        }, timeoutMs);

        if (typeof response.longpolling_timeout_ms === 'number' && response.longpolling_timeout_ms > 0) {
          timeoutMs = response.longpolling_timeout_ms;
        }

        if (response.get_updates_buf !== undefined) {
          await this.options.saveCursor(response.get_updates_buf);
        }

        for (const message of response.msgs ?? []) {
          await this.options.onMessage(message);
        }

        this.failCount = 0;
      } catch (error) {
        if (error instanceof AuthError && error.code === -14) {
          this.aborted = true;
          await this.options.onLogout('session_expired');
          return;
        }

        if (error instanceof NetworkError && error.isTimeout) {
          this.failCount = 0;
          continue;
        }

        this.failCount += 1;
        this.options.onError(error as Error);
        const delay = this.failCount >= 3 ? 30_000 : 2_000;
        if (this.failCount >= 3) {
          this.failCount = 0;
        }
        await this.sleep(delay);
      }
    }
  }

  private async sleep(ms: number): Promise<void> {
    if (this.aborted) {
      return;
    }
    if (this.options.sleep) {
      await this.options.sleep(ms);
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
