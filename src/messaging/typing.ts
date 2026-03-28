import { randomInt } from 'node:crypto';
import { TypingStatus, type Credentials, type GetConfigResponse } from '../types/api.js';
import type { ILinkHttpClient } from '../http/client.js';

interface TicketState {
  ticket: string;
  expiresAt: number;
}

export class TypingIndicator {
  private readonly tickets = new Map<string, TicketState>();
  private readonly intervals = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly http: ILinkHttpClient,
    private readonly getCredentials: () => Credentials,
    private readonly getChannelVersion: () => string,
  ) {}

  async start(userId: string, contextToken: string): Promise<void> {
    this.getCredentials();
    const ticket = await this.ensureTicket(userId, contextToken);
    await this.send(userId, ticket.ticket, TypingStatus.TYPING);

    if (this.intervals.has(userId)) {
      return;
    }

    const interval = setInterval(() => {
      const current = this.tickets.get(userId);
      if (!current) {
        return;
      }
      void this.send(userId, current.ticket, TypingStatus.TYPING);
    }, 5_000);
    this.intervals.set(userId, interval);
  }

  async stop(userId: string): Promise<void> {
    const interval = this.intervals.get(userId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(userId);
    }
    const ticket = this.tickets.get(userId);
    if (ticket) {
      await this.send(userId, ticket.ticket, TypingStatus.CANCEL);
    }
  }

  private async ensureTicket(userId: string, contextToken: string): Promise<TicketState> {
    const current = this.tickets.get(userId);
    if (current && Date.now() < current.expiresAt) {
      return current;
    }

    const response = await this.http.post<GetConfigResponse>('ilink/bot/getconfig', {
      ilink_user_id: userId,
      context_token: contextToken,
      base_info: { channel_version: this.getChannelVersion() },
    });

    const ticket = {
      ticket: response.typing_ticket ?? '',
      expiresAt: Date.now() + randomInt(12, 24) * 3_600_000,
    };
    this.tickets.set(userId, ticket);
    return ticket;
  }

  private async send(userId: string, ticket: string, status: TypingStatus): Promise<void> {
    if (!ticket) {
      return;
    }
    await this.http.post('ilink/bot/sendtyping', {
      ilink_user_id: userId,
      typing_ticket: ticket,
      status,
      base_info: { channel_version: this.getChannelVersion() },
    });
  }
}
