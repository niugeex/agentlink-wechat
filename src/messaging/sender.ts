import { MessageItemType, MessageState, MessageType, type Credentials, type SendMessageRequest, type SendableMessageItem } from '../types/api.js';
import type { ILinkHttpClient } from '../http/client.js';
import { ProtocolError } from '../errors.js';
import { createClientId } from '../utils/ids.js';
import { markdownToPlainText } from '../utils/markdown.js';

export interface SendTextParams {
  credentials: Credentials;
  toUserId: string;
  contextToken: string;
  text: string;
  state?: MessageState;
  clientId?: string;
  normalizeMarkdown?: boolean;
}

export function splitText(text: string, maxChunkSize: number): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxChunkSize) {
    chunks.push(text.slice(index, index + maxChunkSize));
  }
  return chunks;
}

export function buildTextItems(text: string, maxChunkSize = 4_000): SendableMessageItem[] {
  return splitText(text, maxChunkSize).map((chunk) => ({
    type: MessageItemType.TEXT,
    text_item: { text: chunk },
  }));
}

export function buildSendPayload(params: {
  toUserId: string;
  clientId: string;
  contextToken: string;
  items: SendableMessageItem[];
  state: MessageState;
  channelVersion: string;
}): SendMessageRequest {
  return {
    msg: {
      from_user_id: '',
      to_user_id: params.toUserId,
      client_id: params.clientId,
      message_type: MessageType.BOT,
      message_state: params.state,
      item_list: params.items,
      context_token: params.contextToken,
    },
    base_info: {
      channel_version: params.channelVersion,
    },
  };
}

export class MessageSender {
  constructor(
    private readonly http: ILinkHttpClient,
    private readonly getCredentials: () => Credentials,
    private readonly getChannelVersion: () => string,
  ) {}

  async sendText(params: SendTextParams): Promise<void> {
    const preparedText = params.normalizeMarkdown === false ? params.text : markdownToPlainText(params.text);
    await this.sendItems(params.toUserId, params.contextToken, buildTextItems(preparedText), params.state ?? MessageState.FINISH, params.clientId);
  }

  async sendItems(toUserId: string, contextToken: string, items: SendableMessageItem[], state = MessageState.FINISH, clientId?: string): Promise<void> {
    const credentials = this.getCredentials();
    const payload = buildSendPayload({
      toUserId,
      clientId: clientId ?? createClientId(credentials.botId),
      contextToken,
      items,
      state,
      channelVersion: this.getChannelVersion(),
    });

    const response = await this.http.post<{ ret?: number }>('ilink/bot/sendmessage', payload);
    if (typeof response.ret === 'number' && response.ret !== 0) {
      throw new ProtocolError(`Failed to send message with ret=${response.ret}`, response.ret);
    }
  }

  async replyText(toUserId: string, contextToken: string, text: string, state = MessageState.FINISH, clientId?: string): Promise<void> {
    const credentials = this.getCredentials();
    await this.sendText({
      credentials,
      toUserId,
      contextToken,
      text,
      state,
      clientId,
    });
  }
}
