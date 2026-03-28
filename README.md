# AgentLink WeChat

AgentLink WeChat 是一个面向微信 iLink Bot / OpenClaw WeChat Channel 场景的独立 TypeScript SDK，用于构建消息机器人、自动化流程和 AI Agent 集成。

本仓库不是腾讯官方的 OpenClaw 微信插件仓库。它的定位是：基于公开可见的微信 iLink / OpenClaw Channel 协议语义，提供一个更适合二次开发、示例演示、测试验证和自定义集成的独立 SDK 实现。

它将底层协议细节封装在 `src/` 中，提供扫码登录、长轮询收消息、消息回复、媒体上传下载、多账号管理和本地会话持久化等能力。

## 项目定位

如果你想直接使用官方 OpenClaw 渠道插件形态，请优先使用腾讯公开发布的 `@tencent-weixin/openclaw-weixin`，并在 OpenClaw 运行时中通过插件方式安装、启用和登录。

如果你需要的是：

- 一个可直接阅读和修改的 TypeScript 代码库
- 一个便于自定义封装的微信 Channel SDK
- 一个适合做 AI Agent 示例、联调和实验的独立项目

那么这个仓库更适合你。

简而言之：

- 官方插件：面向 OpenClaw 插件安装、Channel 启用、gateway 生命周期
- 本仓库：面向独立 SDK、示例优先、协议实现与二次开发

## 兼容性与术语对齐

本项目会尽量与腾讯公开发布的 `@tencent-weixin/openclaw-weixin` 保持协议术语和接口语义一致，尤其参考其 npm README 中已经公开的能力描述与命名方式。

当前已对齐的方向包括：

- 接口命名：`getupdates`、`sendmessage`、`getuploadurl`、`getconfig`、`sendtyping`
- 长轮询与同步游标语义：`get_updates_buf`
- 消息状态术语：`NEW`、`GENERATING`、`FINISH`
- 媒体上传与 CDN / AES 相关术语
- typing ticket、Channel、多账号等表述

当前文档与实现参考的公开信息基线为：

- `@tencent-weixin/openclaw-weixin@2.1.1`
- 核对日期：2026-03-28

以下内容是有意保持不同的：

- 仓库结构
- 包名与发布目标
- 本地运行时目录布局
- SDK 抽象层与示例组织方式

也就是说：协议层术语尽量对齐官方插件，工程形态与开发者体验则保持本仓库自己的独立设计。

## 特性

- 扫码登录与本地会话持久化
- 基于长轮询的文本消息收发
- 流式回复与 typing 指示器
- 图片、文件上传下载与 AES 媒体处理
- 多账号出站解析、白名单配对、斜杠命令
- Node.js 18+，运行时仅依赖内置模块

## 当前状态

当前已完成：

- Phase 1：扫码登录、文本收发、持久化
- Phase 2：流式回复、typing 指示器、重连处理、Markdown 清洗
- Phase 3：AES 媒体上传下载
- Phase 4：多账号、白名单配对、斜杠命令

## 快速开始

前置要求：

- Node.js 18+
- npm

安装依赖：

```bash
npm install
```

构建 SDK：

```bash
npm run build
```

运行测试：

```bash
npm test
```

运行基础回声示例：

```bash
node examples/echo-bot.ts
```

这个示例会验证最基础的链路：扫码登录、接收消息、发送回复。登录完成后，给 bot 发送一条消息，它会自动回复 `echo: <message>`。

## 最小示例

```ts
import { AgentLinkWechat } from '@agentlink/wechat';

const bot = new AgentLinkWechat();

await bot.login();
await bot.waitForLogin();
await bot.start();

bot.on('message', async (message) => {
  await message.reply(`echo: ${message.text}`);
});
```

常用方法：

- `login()` / `waitForLogin()`：扫码登录与等待会话建立
- `start()` / `stop()`：启动或停止长轮询
- `sendText()` / `sendImage()` / `sendFile()`：基于已缓存上下文主动发送消息
- `listAccounts()`：查看本地已保存账号

常用事件：

- `message`
- `login`
- `logout`
- `error`
- `qrcode`
- `qrcode:scanned`

## AI Agent Demo

仓库内提供了一个基于 OpenAI Agents SDK 的可运行示例：

- `examples/openai-doc-agent.ts`

这个 demo 会把 AgentLink WeChat 接入一个本地文档助手 Agent。它支持：

- 启动时自动加载已保存账号
- 没有账号时再触发扫码登录
- 基于 `README.md` 和 `docs/` 中的本地文档回答问题

当前 demo 的设计原则：

- 微信侧默认发送一条最终回复
- 模型返回的 Markdown 会先转换成更适合微信阅读的纯文本
- provider 配置使用本地配置文件管理，而不是隐式依赖环境变量

模板配置文件：

- `examples/openai-doc-agent.config.example.json`

本地配置文件：

- `examples/openai-doc-agent.config.json`

本地配置文件已加入 `.gitignore`，适合存放 `apiKey`、`baseURL`、`model` 等不希望提交的内容。

配置示例：

```json
{
  "apiKey": "<your-openrouter-api-key>",
  "baseURL": "https://openrouter.ai/api/v1",
  "model": "xiaomi/mimo-v2-pro",
  "api": "chat_completions"
}
```

运行 demo：

```bash
npm run demo:openai-agent
```

如果 `examples/openai-doc-agent.config.json` 不存在，demo 会引导你输入 `Base URL`、`Model`、`API mode` 和 `API key`，然后自动写入本地配置文件。

终端命令：

- `help`
- `accounts`
- `login-new`
- `quit`

微信内可用命令：

- `/accounts`
- `/login-new`
- `/logout`

推荐体验问题：

- `怎么开始扫码登录？`
- `支持哪些内置命令？`
- `图片和文件能力在哪个阶段完成？`
- `context_token 是做什么的？`

## 白名单与配对

默认私聊策略为 `pairing`。扫码登录成功的账号会自动加入允许列表，你也可以手动传入：

```ts
const bot = new AgentLinkWechat({
  allowFrom: ['<allowed-user-id>@im.wechat'],
});
```

如果希望关闭白名单校验，可以设置 `dmPolicy: 'open'`。

## 仓库结构

- `docs/`：协议调研与 SDK 设计文档
- `src/`：TypeScript SDK 源码
- `test/`：单元测试
- `examples/`：可直接运行的示例程序

## 文档索引

- [协议调研文档](./docs/wechat-ilink-protocol.md)
- [SDK 设计文档](./docs/wechat-sdk-design.md)

## 开源说明

- License：MIT
- Node.js 支持版本：`>=18`
- 构建产物目录：`dist/`
- 本地 demo 配置文件不会提交：`examples/openai-doc-agent.config.json`
- 默认运行时数据目录位于用户主目录下的 `.agentlink/wechat`

如果后续要进一步公开发布或长期维护，建议持续关注官方 OpenClaw 微信插件公开文档中的协议变化、兼容性范围和术语更新。
