import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { platform } from 'node:os';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';

import { AgentLinkWechat, NetworkError } from '@agentlink/wechat';

const execFileAsync = promisify(execFile);
const REPO_ROOT = process.cwd();

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

function renderHelp(): string {
  return [
    '媒体发送示例命令：',
    '/send-image <相对路径>',
    '/send-file <相对路径>',
    '/send-video <相对路径>',
    '',
    '示例：',
    '/send-image examples/assets/demo-card.png',
    '/send-file examples/assets/demo-brief.txt',
    '/send-video examples/assets/demo-video.mp4',
  ].join('\n');
}

function printStartupGuide(): void {
  console.log('');
  console.log('媒体发送示例已启动。');
  console.log('可以直接在微信里发送：');
  console.log('  /help');
  console.log('  /send-image examples/assets/demo-card.png');
  console.log('  /send-file examples/assets/demo-brief.txt');
  console.log('  /send-video examples/assets/demo-video.mp4');
  console.log('');
}

async function ensureFile(relativePath: string): Promise<string> {
  const filePath = resolve(REPO_ROOT, relativePath);
  await access(filePath);
  return filePath;
}

async function startBot(bot: AgentLinkWechat): Promise<void> {
  const accounts = await bot.listAccounts();
  if (accounts.length > 0) {
    console.log(`检测到本地已保存账号，直接启动：${accounts[0]}`);
    await bot.start();
    return;
  }

  await bot.login();
  await bot.waitForLogin();
  await bot.start();
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
    const text = message.text.trim();
    console.log(`[${message.timestamp.toISOString()}] ${message.userId}: ${message.text}`);

    if (!text || text === '/help' || text === '/examples') {
      await message.reply(renderHelp());
      return;
    }

    const [command, ...rest] = text.split(/\s+/);
    const relativePath = rest.join(' ').trim();

    if (command === '/send-image') {
      if (!relativePath) {
        await message.reply('用法：/send-image <相对路径>');
        return;
      }
      try {
        const filePath = await ensureFile(relativePath);
        await message.reply(`开始发送图片：${basename(filePath)}`);
        await message.replyImage(filePath);
      } catch {
        await message.reply(`未找到文件：${relativePath}`);
      }
      return;
    }

    if (command === '/send-file' || command === '/send-video') {
      if (!relativePath) {
        await message.reply(`用法：${command} <相对路径>`);
        return;
      }
      try {
        const filePath = await ensureFile(relativePath);
        await message.reply(`开始发送文件：${basename(filePath)}`);
        await message.replyFile(filePath);
      } catch {
        await message.reply(`未找到文件：${relativePath}`);
      }
      return;
    }

    await message.reply(['未识别命令。', renderHelp()].join('\n\n'));
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

  await startBot(bot);
  printStartupGuide();
}

void main();
