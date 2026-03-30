import { describe, expect, it } from 'vitest';
import { AgentLinkWechat, LoginCancelledError } from '../src/index.js';

describe('AgentLinkWechat login cancellation', () => {
  it('rejects waitForLogin when cancelLogin is called', async () => {
    const bot = new AgentLinkWechat();

    (bot as any).loginFlow = {
      async createLogin() {
        return { qrcodeId: 'qr1', qrcodeUrl: 'https://example.com/qr1' };
      },
      async waitForLogin(_loginResult: unknown, signal?: AbortSignal) {
        return await new Promise((resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new LoginCancelledError('Login cancelled')),
            { once: true },
          );
        });
      },
    };

    await bot.login();
    const pending = bot.waitForLogin();
    bot.cancelLogin();

    await expect(pending).rejects.toBeInstanceOf(LoginCancelledError);
  });
});
