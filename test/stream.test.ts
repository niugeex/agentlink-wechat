import { describe, expect, it } from 'vitest';
import { ReplyStream } from '../src/messaging/stream.js';
import { Message } from '../src/messaging/receiver.js';
import { MessageItemType, MessageState, MessageType } from '../src/types/api.js';

function createMessage(): Message {
  return new Message(
    {
      credentials: {
        botToken: 'token',
        botId: 'bot@im.bot',
        userId: 'owner@im.wechat',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        savedAt: Date.now(),
      },
      sender: { replyText: async () => undefined } as never,
      saveContextToken: async () => undefined,
      createReplyStream: () => { throw new Error('not used'); },
      replyImage: async () => undefined,
      replyFile: async () => undefined,
    },
    {
      message_id: '1',
      from_user_id: 'user@im.wechat',
      to_user_id: 'bot@im.bot',
      create_time_ms: Date.now(),
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'hi' } }],
      context_token: 'ctx',
    },
  );
}

describe('ReplyStream', () => {
  it('flushes cumulative generating snapshots and a finish snapshot with a stable client id', async () => {
    const sent: Array<{ text: string; state: MessageState; clientId?: string }> = [];
    const typingEvents: string[] = [];
    const stream = new ReplyStream(
      {
        replyText: async (_toUserId, _contextToken, text, state, clientId) => {
          sent.push({ text, state: state ?? MessageState.FINISH, clientId });
        },
      },
      {
        start: async () => { typingEvents.push('start'); },
        stop: async () => { typingEvents.push('stop'); },
      },
      createMessage(),
      'bot@im.bot',
      { minChunkSize: 5, flushInterval: 1000, maxChunkSize: 10 },
    );

    stream.write('hello');
    stream.write(' world');
    await stream.end();

    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ text: 'hello', state: MessageState.GENERATING });
    expect(sent[1]).toMatchObject({ text: 'helloworld', state: MessageState.GENERATING });
    expect(sent[2]).toMatchObject({ text: 'helloworld', state: MessageState.FINISH });
    expect(sent[0].clientId).toBe(sent[1].clientId);
    expect(sent[1].clientId).toBe(sent[2].clientId);
    expect(typingEvents).toEqual(['start', 'stop']);
  });

  it('normalizes markdown before sending', async () => {
    const sent: string[] = [];
    const stream = new ReplyStream(
      {
        replyText: async (_toUserId, _contextToken, text) => { sent.push(text); },
      },
      null,
      createMessage(),
      'bot@im.bot',
      { minChunkSize: 1, flushInterval: 1000 },
    );

    stream.write('[text](https://example.com)');
    await stream.end();

    expect(sent[0]).toBe('text');
    expect(sent.at(-1)).toBe('text');
  });
});

