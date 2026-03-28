import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';

import { AgentLinkWechat, NetworkError } from '@agentlink/wechat';

const execFileAsync = promisify(execFile);
const GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';

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

type GeoResult = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type ForecastResponse = {
  current?: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
};

function weatherCodeToText(code: number): string {
  if (code === 0) return '晴';
  if (code === 1) return '大部晴朗';
  if (code === 2) return '局部多云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if ([51, 53, 55, 56, 57].includes(code)) return '毛毛雨';
  if ([61, 63, 65, 66, 67].includes(code)) return '降雨';
  if ([71, 73, 75, 77].includes(code)) return '降雪';
  if ([80, 81, 82].includes(code)) return '阵雨';
  if ([85, 86].includes(code)) return '阵雪';
  if (code === 95) return '雷暴';
  if (code === 96 || code === 99) return '强雷暴';
  return `天气代码 ${code}`;
}

function renderHelp(): string {
  return [
    '天气示例命令：',
    '/weather 上海',
    '/weather 杭州',
    '/weather Beijing',
    '',
    '说明：',
    '- 支持中文、英文城市名',
    '- 默认返回当前位置的实时天气和今日温度范围',
  ].join('\n');
}

function printStartupGuide(): void {
  console.log('');
  console.log('天气查询示例已启动。');
  console.log('可以直接在微信里发送：');
  console.log('  /help');
  console.log('  /weather 上海');
  console.log('  /weather 杭州');
  console.log('  /weather Beijing');
  console.log('');
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

async function geocodeCity(query: string): Promise<GeoResult | null> {
  const url = new URL(GEOCODING_API);
  url.searchParams.set('name', query);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'zh');
  url.searchParams.set('format', 'json');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Geocoding request failed: ${response.status}`);
  }

  const payload = await response.json() as { results?: GeoResult[] };
  return payload.results?.[0] ?? null;
}

async function fetchWeather(place: GeoResult): Promise<ForecastResponse> {
  const url = new URL(FORECAST_API);
  url.searchParams.set('latitude', String(place.latitude));
  url.searchParams.set('longitude', String(place.longitude));
  url.searchParams.set('timezone', place.timezone ?? 'auto');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('current', [
    'temperature_2m',
    'apparent_temperature',
    'relative_humidity_2m',
    'weather_code',
    'wind_speed_10m',
  ].join(','));
  url.searchParams.set('daily', [
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_probability_max',
  ].join(','));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Forecast request failed: ${response.status}`);
  }

  return await response.json() as ForecastResponse;
}

function renderWeather(place: GeoResult, forecast: ForecastResponse): string {
  const current = forecast.current;
  const daily = forecast.daily;
  if (!current) {
    return `未拿到 ${place.name} 的实时天气数据。`;
  }

  const location = [place.name, place.admin1, place.country].filter(Boolean).join(' / ');
  const max = daily?.temperature_2m_max?.[0];
  const min = daily?.temperature_2m_min?.[0];
  const rain = daily?.precipitation_probability_max?.[0];

  return [
    `天气：${location}`,
    `实时：${weatherCodeToText(current.weather_code)}，${current.temperature_2m}°C`,
    `体感：${current.apparent_temperature}°C，湿度 ${current.relative_humidity_2m}%`,
    `风速：${current.wind_speed_10m} km/h`,
    `今日：${min ?? '-'}°C ~ ${max ?? '-'}°C，降水概率 ${rain ?? '-'}%`,
    `更新时间：${current.time}`,
  ].join('\n');
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

    if (!text || text === '/help') {
      await message.reply(renderHelp());
      return;
    }

    const [command, ...rest] = text.split(/\s+/);
    const query = rest.join(' ').trim();

    if (command !== '/weather') {
      await message.reply(['未识别命令。', renderHelp()].join('\n\n'));
      return;
    }

    if (!query) {
      await message.reply('用法：/weather 上海');
      return;
    }

    try {
      const place = await geocodeCity(query);
      if (!place) {
        await message.reply(`未找到城市：${query}`);
        return;
      }
      const forecast = await fetchWeather(place);
      await message.reply(renderWeather(place, forecast));
    } catch (error) {
      console.error('weather example failed', error);
      await message.reply('天气查询失败，请稍后再试。');
    }
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
