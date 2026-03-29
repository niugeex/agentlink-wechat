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

import { NetworkError, AgentLinkWechat } from '@agentlink/wechat';

const execFileAsync = promisify(execFile);

type DocRecord = {
  path: string;
  content: string;
};

type ProviderConfig = z.infer<typeof ProviderConfigSchema>;


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
  const providerConfig = await loadProviderConfig();
  configureProvider(providerConfig);

  const agent = createAgent(providerConfig.model);
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
    if (!text) {
      await message.reply('请发送文字问题，我会在文档里帮你查找。');
      return;
    }

    console.log(`[${message.timestamp.toISOString()}] ${message.userId}: ${message.text}`);

    try {
      const result = await run(agent, text);
      const reply = normalizeModelReply(String(result.finalOutput ?? ''));
      await message.reply(reply || '文档中暂时没有找到相关内容。');
    } catch (error) {
      console.error('agent error', error);
      await message.reply('查询出错，请检查 provider 配置后重试。');
    }
  });

  bot.on('error', (error) => {
    if (error instanceof NetworkError) {
      if (error.isTimeout) return;
      console.warn('network warning', error.message);
      return;
    }
    console.error('bot error', error);
  });

  await startBot(bot);
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
