import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';

import { NetworkError, AgentLinkWechat } from '@agentlink/wechat';

const execFileAsync = promisify(execFile);

function normalizeQrUrl(input: string): string {
  const url = new URL(input);
  if (!url.searchParams.has('bot_type')) {
    url.searchParams.set('bot_type', '3');
  }
  return url.toString();
}

async function openExternal(url: string): Promise<void> {
  const currentPlatform = platform();

  if (currentPlatform === 'win32') {
    const escaped = url.replace(/'/g, "''");
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${escaped}'`]);
    return;
  }

  if (currentPlatform === 'darwin') {
    await execFileAsync('open', [url]);
    return;
  }

  await execFileAsync('xdg-open', [url]);
}

async function main(): Promise<void> {
  const bot = new AgentLinkWechat();

  bot.on('qrcode', (url) => {
    const normalizedUrl = normalizeQrUrl(url);
    console.log('请扫码登录:');
    console.log(normalizedUrl);
    void openExternal(normalizedUrl).catch((error) => {
      console.error('自动打开二维码链接失败', error);
    });
  });

  bot.on('qrcode:scanned', () => {
    console.log('已扫码，请在微信内确认登录');
  });

  bot.on('login', (credentials) => {
    console.log(`登录成功: ${credentials.botId}`);
  });

  bot.on('message', async (message) => {
    console.log(`[${message.timestamp.toISOString()}] ${message.userId}: ${message.text}`);
    await message.reply(`echo: ${message.text}`);
  });

  bot.on('error', (error) => {
    if (error instanceof NetworkError) {
      if (error.isTimeout) {
        return;
      }
      console.warn('network warning', error.message);
      return;
    }
    console.error('bot error', error);
  });

  await bot.login();
  await bot.waitForLogin();
  await bot.start();
}

void main();
