import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

import { AgentLinkWechat, Message, NetworkError } from '@agentlink/wechat';

const execFileAsync = promisify(execFile);

type ManagedBot = {
  key: string;
  bot: AgentLinkWechat;
};

function normalizeQrUrl(inputUrl: string): string {
  const url = new URL(inputUrl);
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

class MultiAccountEchoDemo {
  private readonly bots = new Map<string, ManagedBot>();
  private loginInFlight: Promise<void> | null = null;

  async start(): Promise<void> {
    const accounts = await new AgentLinkWechat().listAccounts();

    for (const accountId of accounts) {
      await this.startStoredAccount(accountId);
    }

    if (this.bots.size === 0) {
      await this.enrollNewAccount('initial startup');
      return;
    }

    console.log(`已加载 ${this.bots.size} 个账号: ${this.describeAccountsInline()}`);
  }

  printWelcome(): void {
    console.log('');
    console.log('AgentLink WeChat Multi-Account Echo Demo');
    console.log('');
    console.log('终端命令:');
    console.log('  help       查看帮助');
    console.log('  accounts   查看当前在线账号');
    console.log('  login-new  新增一个扫码登录账号');
    console.log('  quit       停止所有 bot 并退出');
    console.log('');
    console.log('微信内命令:');
    console.log('  /accounts  查看当前在线账号');
    console.log('  /login-new 触发新账号扫码登录');
    console.log('  /logout    登出当前 bot 账号');
    console.log('');
    console.log('普通消息会直接回显，并带上当前 bot 账号标识。');
    console.log('');
  }

  async startTerminalConsole(): Promise<void> {
    const rl = createInterface({ input, output });
    this.printPrompt();

    try {
      for await (const line of rl) {
        const command = line.trim().toLowerCase();

        if (!command) {
          this.printPrompt();
          continue;
        }

        if (command === 'help') {
          this.printWelcome();
          this.printPrompt();
          continue;
        }

        if (command === 'accounts') {
          console.log(`在线账号 (${this.bots.size}): ${this.describeAccountsInline()}`);
          this.printPrompt();
          continue;
        }

        if (command === 'login-new') {
          if (this.loginInFlight) {
            console.log('已有一个新账号登录流程正在进行中。');
          } else {
            this.loginInFlight = this.enrollNewAccount('requested from terminal')
              .catch((error) => {
                console.error('新增账号失败', error);
              })
              .finally(() => {
                this.loginInFlight = null;
                this.printPrompt();
              });
          }
          continue;
        }

        if (command === 'quit' || command === 'exit') {
          rl.close();
          await this.stopAll();
          process.exit(0);
        }

        console.log(`未知命令: ${command}`);
        console.log('输入 `help` 查看可用命令。');
        this.printPrompt();
      }
    } finally {
      rl.close();
    }
  }

  private printPrompt(): void {
    output.write('multi-account-demo> ');
  }

  private describeAccountsInline(): string {
    const accounts = Array.from(this.bots.keys());
    return accounts.length > 0 ? accounts.join(', ') : '(none)';
  }

  private renderWechatHelp(): string {
    return [
      '微信内命令：',
      '/help 查看帮助',
      '/accounts 查看当前在线账号',
      '/login-new 触发新账号扫码登录',
      '/logout 登出当前 bot 账号',
    ].join('\n');
  }

  private removeBotEntries(bot: AgentLinkWechat): string[] {
    const removedKeys: string[] = [];
    for (const [key, entry] of this.bots.entries()) {
      if (entry.bot === bot) {
        this.bots.delete(key);
        removedKeys.push(key);
      }
    }
    return removedKeys;
  }

  private async stopAll(): Promise<void> {
    const bots = Array.from(this.bots.values()).map((entry) => entry.bot);
    for (const bot of bots) {
      bot.stop();
    }
    this.bots.clear();
  }

  private async startStoredAccount(accountId: string): Promise<void> {
    if (this.bots.has(accountId)) {
      return;
    }

    const bot = new AgentLinkWechat({ accountId });
    this.attachBot(bot, accountId);

    try {
      await bot.start();
      const key = bot.botId ?? accountId;
      this.bots.set(key, { key, bot });
      console.log(`已启动已保存账号 ${key}`);
    } catch (error) {
      console.error(`启动已保存账号失败: ${accountId}`, error);
    }
  }

  private attachBot(bot: AgentLinkWechat, fallbackKey: string): void {
    bot.on('qrcode', (url) => {
      const normalizedUrl = normalizeQrUrl(url);
      console.log(`[${fallbackKey}] 请扫码登录:`);
      console.log(normalizedUrl);
      void openExternal(normalizedUrl).catch((error) => {
        console.error('自动打开二维码链接失败', error);
      });
    });

    bot.on('qrcode:scanned', () => {
      console.log(`[${fallbackKey}] 已扫码，请在微信中确认登录。`);
    });

    bot.on('login', (credentials) => {
      const key = credentials.botId;
      this.bots.set(key, { key, bot });
      if (key !== fallbackKey && this.bots.get(fallbackKey)?.bot === bot) {
        this.bots.delete(fallbackKey);
      }
      console.log(`登录成功: ${credentials.botId}`);
    });

    bot.on('logout', (reason) => {
      const removedKeys = this.removeBotEntries(bot);
      const label = bot.botId ?? removedKeys[0] ?? fallbackKey;
      console.log(`[${label}] 已登出: ${reason}`);
    });

    bot.on('message', async (message) => {
      await this.handleMessage(bot, message);
    });

    bot.on('error', (error) => {
      const account = bot.botId ?? fallbackKey;
      if (error instanceof NetworkError) {
        if (error.isTimeout) {
          return;
        }
        console.warn(`[${account}] network warning: ${error.message}`);
        return;
      }
      console.error(`[${account}] bot error`, error);
    });
  }

  private async handleMessage(bot: AgentLinkWechat, message: Message): Promise<void> {
    const text = message.text.trim();
    const account = bot.botId ?? 'unknown';

    if (text === '/help') {
      await message.reply(this.renderWechatHelp());
      return;
    }

    if (text === '/accounts') {
      await message.reply(`在线账号 (${this.bots.size}):\n${Array.from(this.bots.keys()).join('\n') || '(none)'}`);
      return;
    }

    if (text === '/login-new') {
      if (this.loginInFlight) {
        await message.reply('已有一个新账号登录流程正在进行中，请查看最新弹出的二维码。');
        return;
      }

      await message.reply('正在启动新账号登录流程，稍后会弹出二维码。');
      this.loginInFlight = this.enrollNewAccount(`requested by ${message.userId}`)
        .catch((error) => {
          console.error('新增账号失败', error);
        })
        .finally(() => {
          this.loginInFlight = null;
          this.printPrompt();
        });
      return;
    }

    if (text === '/logout') {
      await message.reply('当前账号即将退出登录，下次需要重新扫码。');
      await bot.logout();
      return;
    }

    console.log(`[${account}] [${message.timestamp.toISOString()}] ${message.userId}: ${message.text}`);
    await message.reply(`[${account}] echo: ${message.text}`);
  }

  private async enrollNewAccount(reason: string): Promise<void> {
    console.log(`开始新增账号登录: ${reason}`);
    const bot = new AgentLinkWechat();
    const tempKey = `pending-${Date.now()}`;
    this.attachBot(bot, tempKey);

    await bot.login();
    const credentials = await bot.waitForLogin();
    await bot.start();

    const key = credentials.botId;
    this.bots.set(key, { key, bot });
    this.bots.delete(tempKey);
    console.log(`新账号已登录并启动: ${key}`);
    console.log(`在线账号 (${this.bots.size}): ${this.describeAccountsInline()}`);
  }
}

async function main(): Promise<void> {
  const demo = new MultiAccountEchoDemo();
  demo.printWelcome();
  await demo.start();
  void demo.startTerminalConsole();
}

void main().catch((error) => {
  console.error('启动多账号示例失败', error);
  process.exitCode = 1;
});
