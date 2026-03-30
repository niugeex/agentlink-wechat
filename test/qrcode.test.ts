import { describe, expect, it } from 'vitest';
import { QrCodeLogin } from '../src/auth/qrcode.js';
import { ILinkHttpClient } from '../src/http/client.js';
import { LoginCancelledError } from '../src/errors.js';

describe('QrCodeLogin', () => {
  it('handles wait -> scaned -> confirmed flow', async () => {
    const responses = [
      { ret: 0, qrcode: 'qr1', qrcode_img_content: 'https://example.com/qr1' },
      { status: 'wait' },
      { status: 'scaned' },
      {
        status: 'confirmed',
        bot_token: 'token',
        ilink_bot_id: 'bot@im.bot',
        ilink_user_id: 'user@im.wechat',
        baseurl: 'https://ilinkai.weixin.qq.com',
      },
    ];

    const http = new ILinkHttpClient({
      fetchImpl: async () => {
        const body = responses.shift();
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    let scanned = 0;
    const login = new QrCodeLogin(http, { onScanned: () => { scanned += 1; } });
    const created = await login.createLogin();
    const credentials = await login.waitForLogin(created);

    expect(created.qrcodeId).toBe('qr1');
    expect(scanned).toBe(1);
    expect(credentials.botId).toBe('bot@im.bot');
    expect(credentials.userId).toBe('user@im.wechat');
  });

  it('switches base url on redirect status', async () => {
    const seenUrls: string[] = [];
    const responses = [
      { ret: 0, qrcode: 'qr1', qrcode_img_content: 'https://example.com/qr1' },
      { status: 'scaned_but_redirect', redirect_host: 'alt.weixin.qq.com' },
      {
        status: 'confirmed',
        bot_token: 'token',
        ilink_bot_id: 'bot@im.bot',
        ilink_user_id: 'user@im.wechat',
        baseurl: 'https://alt.weixin.qq.com',
      },
    ];

    const http = new ILinkHttpClient({
      fetchImpl: async (input) => {
        seenUrls.push(String(input));
        const body = responses.shift();
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    const login = new QrCodeLogin(http);
    const created = await login.createLogin();
    const credentials = await login.waitForLogin(created);

    expect(credentials.baseUrl).toBe('https://alt.weixin.qq.com');
    expect(seenUrls.at(-1)).toContain('alt.weixin.qq.com');
  });

  it('throws LoginCancelledError when aborted before waiting completes', async () => {
    const http = new ILinkHttpClient({
      fetchImpl: async () => new Response(JSON.stringify({ status: 'wait' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    const login = new QrCodeLogin(http);
    const controller = new AbortController();
    controller.abort();

    await expect(
      login.waitForLogin({ qrcodeId: 'qr1', qrcodeUrl: 'https://example.com/qr1' }, controller.signal),
    ).rejects.toBeInstanceOf(LoginCancelledError);
  });
});
