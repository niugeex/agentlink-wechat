import { describe, expect, it } from 'vitest';
import { TypingIndicator } from '../src/messaging/typing.js';

const credentials = {
  botToken: 'token',
  botId: 'bot@im.bot',
  userId: 'owner@im.wechat',
  baseUrl: 'https://ilinkai.weixin.qq.com',
  savedAt: Date.now(),
};

describe('TypingIndicator', () => {
  it('reuses cached tickets for the same user', async () => {
    const calls: string[] = [];
    const indicator = new TypingIndicator(
      {
        post: async (path: string) => {
          calls.push(path);
          if (path === 'ilink/bot/getconfig') {
            return { typing_ticket: 'ticket-1' };
          }
          return {};
        },
      } as never,
      () => credentials,
      () => '2.1.1',
    );

    await indicator.start('user@im.wechat', 'ctx');
    await indicator.stop('user@im.wechat');
    await indicator.start('user@im.wechat', 'ctx');
    await indicator.stop('user@im.wechat');

    expect(calls.filter((entry) => entry === 'ilink/bot/getconfig')).toHaveLength(1);
    expect(calls.filter((entry) => entry === 'ilink/bot/sendtyping').length).toBeGreaterThanOrEqual(2);
  });
});
