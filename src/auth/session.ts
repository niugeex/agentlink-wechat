import { AuthError } from '../errors.js';
import type { Credentials } from '../types/api.js';

export class SessionState {
  private credentials: Credentials | null;
  private pausedUntil = 0;

  constructor(credentials: Credentials | null = null) {
    this.credentials = credentials;
  }

  setCredentials(credentials: Credentials | null): void {
    this.credentials = credentials;
  }

  getCredentials(): Credentials | null {
    return this.credentials;
  }

  get accountId(): string | null {
    return this.credentials?.botId ?? null;
  }

  assertActive(): Credentials {
    if (!this.credentials) {
      throw new AuthError('Not logged in');
    }
    if (this.pausedUntil > Date.now()) {
      throw new AuthError('Session is paused due to prior logout');
    }
    return this.credentials;
  }

  pauseFor(durationMs: number): void {
    this.pausedUntil = Date.now() + durationMs;
  }

  clearPause(): void {
    this.pausedUntil = 0;
  }
}
