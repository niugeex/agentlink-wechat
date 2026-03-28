import { describe, expect, it } from 'vitest';
import { MessageState, MessageType } from '../src/types/api.js';
import { buildSendPayload, buildTextItems, splitText } from '../src/messaging/sender.js';

describe('sender helpers', () => {
  it('splits oversized text payloads', () => {
    expect(splitText('abcdef', 2)).toEqual(['ab', 'cd', 'ef']);
  });

  it('builds text items', () => {
    expect(buildTextItems('hello')).toEqual([
      {
        type: 1,
        text_item: { text: 'hello' },
      },
    ]);
  });

  it('builds protocol-correct payload', () => {
    const payload = buildSendPayload({
      toUserId: 'user@im.wechat',
      clientId: 'sdk-1',
      contextToken: 'ctx',
      items: buildTextItems('hello'),
      state: MessageState.FINISH,
      channelVersion: '2.1.1',
    });

    expect(payload.msg.from_user_id).toBe('');
    expect(payload.msg.to_user_id).toBe('user@im.wechat');
    expect(payload.msg.message_type).toBe(MessageType.BOT);
    expect(payload.msg.message_state).toBe(MessageState.FINISH);
    expect(payload.msg.context_token).toBe('ctx');
    expect(payload.base_info.channel_version).toBe('2.1.1');
  });
});
