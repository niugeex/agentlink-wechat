import { NetworkError, AgentLinkWechat } from '@agentlink/wechat';

async function main(): Promise<void> {
  const bot = new AgentLinkWechat();

  bot.on('qrcode', (url) => {
    console.log('请扫码登录:');
    console.log(url);
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
