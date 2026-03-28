import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { resolve } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

import { Agent, run, setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled, tool } from '@openai/agents';
import OpenAI from 'openai';
import { z } from 'zod';

import { Message, NetworkError, AgentLinkWechat } from '@agentlink/wechat';

const execFileAsync = promisify(execFile);

type DocRecord = {
  path: string;
  content: string;
};

type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

type ManagedBot = {
  key: string;
  bot: AgentLinkWechat;
};

const REPO_ROOT = process.cwd();
const CONFIG_PATH = resolve(REPO_ROOT, 'examples/openai-doc-agent.config.json');
const DOC_PATHS = [
  'README.md',
  'docs/wechat-ilink-protocol.md',
  'docs/wechat-sdk-design.md',
] as const;

const ProviderConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseURL: z.string().min(1).optional(),
  model: z.string().min(1),
  api: z.enum(['responses', 'chat_completions']).default('chat_completions'),
});

const docsPromise = Promise.all(
  DOC_PATHS.map(async (path): Promise<DocRecord> => {
    const content = await readFile(resolve(REPO_ROOT, path), 'utf8');
    return { path, content };
  }),
);

async function loadProviderConfig(): Promise<ProviderConfig> {
  let fileConfig: Partial<ProviderConfig> = {};

  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    fileConfig = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<ProviderConfig>;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'ENOENT') {
      throw error;
    }
  }

  const merged = {
    model: 'xiaomi/mimo-v2-pro',
    api: 'chat_completions' as const,
    ...fileConfig,
  };

  if (!merged.apiKey) {
    return promptForProviderConfig(merged);
  }

  return ProviderConfigSchema.parse(merged);
}

async function promptForProviderConfig(seed: Partial<ProviderConfig>): Promise<ProviderConfig> {
  const rl = createInterface({ input, output });

  const ask = async (label: string, currentValue?: string, required = false): Promise<string> => {
    while (true) {
      const suffix = currentValue ? ` (default: ${currentValue})` : '';
      let answer = '';
      try {
        answer = (await rl.question(`${label}${suffix}: `)).trim();
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ABORT_ERR') {
          console.log('');
          throw new Error('Provider setup cancelled by user.');
        }
        throw error;
      }
      const value = answer || currentValue || '';
      if (!required || value) {
        return value;
      }
      console.log(`${label} is required. Please enter a value.`);
    }
  };

  try {
    console.log('');
    console.log('Provider config file was not found.');
    console.log('We will create a local config by asking for the endpoint first, then the model, API mode, and finally the API key.');
    console.log('After the first setup, the demo will save them to a local config file for later runs.');
    console.log('');

    const baseURL = await ask('Base URL', seed.baseURL ?? 'https://openrouter.ai/api/v1');
    const model = await ask('Model', seed.model ?? 'xiaomi/mimo-v2-pro');
    const apiInput = await ask('API mode (responses or chat_completions)', seed.api ?? 'chat_completions');
    const apiKey = await ask('API key', undefined, true);

    let config: ProviderConfig;
    try {
      config = ProviderConfigSchema.parse({
        apiKey,
        baseURL,
        model,
        api: apiInput,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.log('The provider config is invalid. Please restart setup and check the values.');
      }
      throw error;
    }

    await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    console.log(`Saved local config to ${CONFIG_PATH}`);

    return config;
  } finally {
    rl.close();
  }
}

function configureProvider(config: ProviderConfig): void {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  setDefaultOpenAIClient(client as unknown as Parameters<typeof setDefaultOpenAIClient>[0]);
  setOpenAIAPI(config.api);
  setTracingDisabled(true);

  const endpoint = config.baseURL ?? 'https://api.openai.com/v1';
  console.log(`Agent provider ready: ${endpoint} | model=${config.model} | api=${config.api}`);
}

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

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeModelReply(input: string): string {
  return input
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, (_match, code: string) => code.trim())
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\|[\s:|-]+\|$/gm, '')
    .replace(/^\|(.+)\|$/gm, (_match, row: string) =>
      row
        .split('|')
        .map((cell) => cell.trim())
        .join('  '),
    )
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '- ')
    .replace(/^\s*\d+\.\s+/gm, (match) => match.trimStart())
    .replace(/[*_~`]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function excerptAround(content: string, query: string): string {
  const normalizedQuery = normalize(query);
  const lines = content.split(/\r?\n/);
  const matchedIndex = lines.findIndex((line) => normalize(line).includes(normalizedQuery));
  if (matchedIndex === -1) {
    return lines.slice(0, 12).join('\n');
  }
  const start = Math.max(0, matchedIndex - 3);
  const end = Math.min(lines.length, matchedIndex + 4);
  return lines.slice(start, end).join('\n');
}

const searchDocs = tool({
  name: 'search_docs',
  description:
    'Search README and docs for AgentLink WeChat concepts. Use this before answering SDK-specific questions.',
  parameters: z.object({
    query: z.string().min(2),
  }),
  async execute({ query }) {
    const docs = await docsPromise;
    const normalizedQuery = normalize(query);
    const matches = docs
      .map((doc) => {
        const lines = doc.content.split(/\r?\n/);
        const hitCount = lines.filter((line) => normalize(line).includes(normalizedQuery)).length;
        return {
          path: doc.path,
          hitCount,
          excerpt: excerptAround(doc.content, query),
        };
      })
      .filter((doc) => doc.hitCount > 0)
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 3);

    if (matches.length === 0) {
      return 'No direct match found in the local docs.';
    }

    return matches
      .map(
        (match, index) =>
          [
            `${index + 1}. ${match.path} (${match.hitCount} hits)`,
            match.excerpt,
          ].join('\n'),
      )
      .join('\n\n');
  },
});

const readDoc = tool({
  name: 'read_doc',
  description:
    'Read one of the local project docs in full when search results are not enough to answer accurately.',
  parameters: z.object({
    path: z.enum(DOC_PATHS),
  }),
  async execute({ path }) {
    const docs = await docsPromise;
    const doc = docs.find((item) => item.path === path);
    if (!doc) {
      return 'Document not found.';
    }
    return doc.content;
  },
});

function createAgent(model: string): Agent {
  return new Agent({
    name: 'AgentLink WeChat Doc Assistant',
    model,
    instructions: [
      'You are the official AgentLink WeChat documentation assistant.',
      'Answer in concise Simplified Chinese.',
      'Prefer factual answers grounded in the local project docs.',
      'Use the tools before answering any question about SDK features, setup, API behavior, examples, or roadmap.',
      'If the docs do not cover something, say so clearly instead of guessing.',
      'When useful, cite the document path in plain text such as README.md or docs/wechat-sdk-design.md.',
    ].join(' '),
    tools: [searchDocs, readDoc],
  });
}

class MultiAccountDocAgentDemo {
  private readonly agent: Agent;
  private readonly bots = new Map<string, ManagedBot>();
  private loginInFlight: Promise<void> | null = null;

  constructor(model: string) {
    this.agent = createAgent(model);
  }

  async start(): Promise<void> {
    await docsPromise;
    const accounts = await new AgentLinkWechat().listAccounts();

    for (const accountId of accounts) {
      await this.startStoredAccount(accountId);
    }

    if (this.bots.size === 0) {
      await this.enrollNewAccount('initial startup');
      return;
    }

    console.log(`Loaded ${this.bots.size} account(s): ${this.describeAccountsInline()}`);
  }

  printWelcome(): void {
    console.log('');
    console.log('AgentLink WeChat Multi-Account Doc Agent');
    console.log('');
    console.log('Terminal commands:');
    console.log('  help       Show this help');
    console.log('  accounts   List online accounts');
    console.log('  login-new  Start QR login for a new account');
    console.log('  quit       Stop all bots and exit');
    console.log('');
    console.log('WeChat chat commands:');
    console.log('  /accounts  List online accounts');
    console.log('  /login-new Start QR login for a new account');
    console.log('  /logout    Logout the current account');
    console.log('');
    console.log('Reply mode:');
    console.log('  Simplicity-first. The demo sends one final reply after the model completes.');
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
          console.log(`Online accounts (${this.bots.size}): ${this.describeAccountsInline()}`);
          this.printPrompt();
          continue;
        }

        if (command === 'login-new') {
          if (this.loginInFlight) {
            console.log('A new account login is already in progress.');
          } else {
            this.loginInFlight = this.enrollNewAccount('requested from terminal')
              .catch((error) => {
                console.error('failed to enroll new account', error);
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

        console.log(`Unknown command: ${command}`);
        console.log('Type `help` to see available terminal commands.');
        this.printPrompt();
      }
    } finally {
      rl.close();
    }
  }

  private printPrompt(): void {
    output.write('demo> ');
  }

  private describeAccountsInline(): string {
    const accounts = Array.from(this.bots.keys());
    return accounts.length > 0 ? accounts.join(', ') : '(none)';
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
      console.log(`Started stored account ${key}`);
    } catch (error) {
      console.error(`failed to start stored account ${accountId}`, error);
    }
  }

  private attachBot(bot: AgentLinkWechat, fallbackKey: string): void {
    bot.on('qrcode', (url) => {
      const normalizedUrl = normalizeQrUrl(url);
      console.log(`[${fallbackKey}] Scan this QR code URL to log in:`);
      console.log(normalizedUrl);
      void openExternal(normalizedUrl).catch((error) => {
        console.error('failed to open QR code URL automatically', error);
      });
    });

    bot.on('qrcode:scanned', () => {
      console.log(`[${fallbackKey}] QR code scanned. Confirm login in WeChat.`);
    });

    bot.on('login', (credentials) => {
      const key = credentials.botId;
      this.bots.set(key, { key, bot });
      if (key !== fallbackKey && this.bots.has(fallbackKey) && this.bots.get(fallbackKey)?.bot === bot) {
        this.bots.delete(fallbackKey);
      }
      console.log(`Logged in as ${credentials.botId}`);
    });

    bot.on('logout', (reason) => {
      const removedKeys = this.removeBotEntries(bot);
      const key = bot.botId ?? removedKeys[0] ?? fallbackKey;
      console.log(`[${key}] logout: ${reason}`);
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
    if (!text) {
      await message.reply('Please send a text question so I can search the docs for you.');
      return;
    }

    if (text === '/logout') {
      await message.reply('Logging out this account. You will need to scan again next time.');
      await bot.logout();
      return;
    }

    if (text === '/accounts') {
      await message.reply(`Online accounts (${this.bots.size}):\n${Array.from(this.bots.keys()).join('\n') || '(none)'}`);
      return;
    }

    if (text === '/login-new') {
      if (this.loginInFlight) {
        await message.reply('A new account login is already in progress. Check the latest QR code window.');
        return;
      }
      await message.reply('Starting a new account login flow. A QR code window will open shortly.');
      this.loginInFlight = this.enrollNewAccount(`requested by ${message.userId}`)
        .catch((error) => {
          console.error('failed to enroll new account', error);
        })
        .finally(() => {
          this.loginInFlight = null;
          this.printPrompt();
        });
      return;
    }

    console.log(`[${bot.botId ?? 'unknown'}] [${message.timestamp.toISOString()}] ${message.userId}: ${message.text}`);

    try {
      const result = await run(this.agent, text);
      const output = normalizeModelReply(String(result.finalOutput ?? ''));
      await message.reply(output || 'I could not find a confident answer in the local docs yet.');
    } catch (error) {
      console.error('agent error', error);
      await message.reply('The doc assistant hit an error. Check your provider config and try again.');
    }
  }

  private async enrollNewAccount(reason: string): Promise<void> {
    console.log(`Starting new account enrollment: ${reason}`);
    const bot = new AgentLinkWechat();
    const tempKey = `pending-${Date.now()}`;
    this.attachBot(bot, tempKey);

    await bot.login();
    const credentials = await bot.waitForLogin();
    await bot.start();

    const key = credentials.botId;
    this.bots.set(key, { key, bot });
    this.bots.delete(tempKey);
    console.log(`New account enrolled and started: ${key}`);
    console.log(`Online accounts (${this.bots.size}): ${this.describeAccountsInline()}`);
  }
}

async function main(): Promise<void> {
  const providerConfig = await loadProviderConfig();
  configureProvider(providerConfig);

  const demo = new MultiAccountDocAgentDemo(providerConfig.model);
  demo.printWelcome();
  await demo.start();
  void demo.startTerminalConsole();
}

void main().catch((error) => {
  if (error instanceof Error && error.message === 'Provider setup cancelled by user.') {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  console.error('Fatal error while starting demo', error);
  process.exitCode = 1;
});
