# AgentLink WeChat SDK 设计文档

> 基于 [微信 iLink Bot API 协议调研文档](./wechat-ilink-protocol.md) 编写
> 日期：2026-03-28

---

## 1. 项目定位

AgentLink WeChat 是一个面向微信 iLink Bot 场景的 TypeScript SDK。

目标是把协议层细节封装在 SDK 内，对上提供稳定、事件驱动、适合 AI Agent 接入的开发接口，让开发者专注在业务逻辑、消息处理和 Agent 编排，而不是 HTTP 细节与协议字段管理。

设计原则：
- 协议细节收敛在内部实现
- 对外 API 简洁、稳定、类型明确
- 单包项目结构，降低维护复杂度
- 示例以“可学习、可联调、可复用”为目标
- 运行时仅依赖 Node.js 内置能力

---

## 2. 目标体验

开发者能够用很少的代码完成扫码登录、消息监听与回复：

```ts
import { AgentLinkWechat } from '@agentlink/wechat';

const bot = new AgentLinkWechat();

await bot.login();
await bot.waitForLogin();
await bot.start();

bot.on('message', async (message) => {
  await message.reply('received');
});
```

在此基础上，SDK 还支持：
- `replyImage()` / `replyFile()` 发送媒体
- `createReplyStream()` 进行流式回复
- `downloadMedia()` 下载入站媒体
- `listAccounts()` 管理本地已保存账号

---

## 3. 仓库结构

```text
agentlink-wechat/
├── docs/
│   ├── wechat-ilink-protocol.md
│   └── wechat-sdk-design.md
├── examples/
│   ├── echo-bot.ts
│   ├── openai-doc-agent.ts
│   └── openai-doc-agent.config.example.json
├── src/
│   ├── auth/
│   ├── http/
│   ├── media/
│   ├── messaging/
│   ├── polling/
│   ├── storage/
│   ├── types/
│   ├── utils/
│   ├── bot.ts
│   └── index.ts
├── test/
├── package.json
├── tsconfig.json
├── tsconfig.base.json
└── README.md
```

说明：
- `src/` 存放 SDK 源码
- `test/` 存放单元测试
- `examples/` 提供最小联调示例与 AI Agent 示例
- `docs/` 提供协议说明与设计说明

---

## 4. 核心对象

### 4.1 `AgentLinkWechat`

主入口类，负责：
- 登录与会话恢复
- 长轮询消息接收
- 事件分发
- 主动发送文本、图片、文件
- 多账号管理

核心方法：
- `login()`
- `waitForLogin()`
- `start()`
- `stop()`
- `logout()`
- `sendText()`
- `sendImage()`
- `sendFile()`
- `listAccounts()`

核心事件：
- `qrcode`
- `qrcode:scanned`
- `login`
- `logout`
- `message`
- `error`

### 4.2 `Message`

入站消息的标准化对象，负责：
- 提供统一的文本、发送者、时间等字段
- 封装回复能力
- 封装媒体下载能力

核心方法：
- `reply(text)`
- `replyImage(filePath)`
- `replyFile(filePath)`
- `createReplyStream()`
- `downloadMedia(destination)`

### 4.3 `ReplyStream`

用于流式回复的辅助对象，负责：
- 管理流式回复状态
- 串行发送分段更新
- 在结束时发送最终消息状态

说明：
- SDK 提供该能力
- 示例项目默认仍以最终回复模式为主，保持简单稳定

---

## 5. 模块划分

### 5.1 `auth/`

负责扫码登录流程：
- 获取二维码
- 轮询扫码状态
- 处理重定向
- 产出登录凭证

### 5.2 `http/`

负责协议请求的统一封装：
- 公共 headers
- 请求体基础字段
- 超时控制
- 错误归类

### 5.3 `polling/`

负责 `getupdates` 长轮询：
- 拉取消息
- 维护游标
- 区分正常超时与真实网络错误
- 触发重连或重新登录流程

### 5.4 `messaging/`

负责消息相关能力：
- 入站消息解析
- 出站 payload 构建
- `context_token` 管理
- typing 指示器
- 流式回复

### 5.5 `media/`

负责媒体能力：
- AES-128-ECB 加解密
- 上传前预处理
- 下载后解密与保存
- 图片、文件消息构建

### 5.6 `storage/`

负责本地状态持久化：
- 登录凭证
- 轮询游标
- `context_token`
- 多账号状态
- 白名单相关数据

### 5.7 `utils/`

负责通用工具：
- 路径解析
- 日志
- Markdown 清洗
- MIME 推断
- 队列与并发控制

---

## 6. 持久化设计

默认数据目录位于用户主目录下的 `.agentlink/wechat`。

持久化内容包括：
- 账号凭证
- 轮询游标
- `context_token`
- 调试模式状态
- 白名单相关文件

设计目标：
- 同一台机器上可恢复历史登录状态
- 支持多账号并存
- 不把敏感数据写入仓库

---

## 7. 错误处理策略

SDK 将错误分成若干类：
- `AuthError`
- `NetworkError`
- `ProtocolError`
- `MediaError`

策略约定：
- 长轮询超时视为正常空闲，不作为异常噪声上报
- 可恢复的网络错误允许重试
- 会话过期时进入重新登录流程
- 出站消息默认不做盲目重试，避免重复发送

---

## 8. 示例策略

当前仓库提供两个示例：

### 8.1 `examples/echo-bot.ts`

用途：
- 最小联调示例
- 验证扫码登录、收消息、发回复这条基础链路

### 8.2 `examples/openai-doc-agent.ts`

用途：
- 展示 AgentLink WeChat 与 AI Agent 的接入方式
- 提供本地文档检索、多账号运行、配置文件管理等参考实现

设计取向：
- 优先可读性和学习价值
- 优先稳定行为，不额外增加复杂兼容逻辑

---

## 9. 开发路线图

### Phase 1: MVP

- [x] 扫码登录
- [x] 文本消息收发
- [x] 凭证、游标与上下文持久化
- [x] 基础示例与 README

### Phase 2: 体验增强

- [x] 流式回复
- [x] typing 指示器
- [x] Markdown 转纯文本
- [x] 重连与并发消息处理

### Phase 3: 媒体支持

- [x] AES-128-ECB 加解密
- [x] 图片上传下载
- [x] 文件上传下载

### Phase 4: 高级功能

- [x] 多账号管理
- [x] 白名单配对
- [x] 斜杠命令
- [x] 调试模式

---

## 10. 测试策略

测试分为两层：

### 10.1 单元测试

覆盖核心模块逻辑，包括：
- 消息构建
- 媒体加解密
- 游标管理
- 存储读写
- 安全约束

### 10.2 联调验证

用于验证协议链路和真实微信侧行为，包括：
- 扫码登录
- 文本收发
- 文件上传
- 图片下载

---

## 11. 维护建议

- 文档、示例与实际代码结构保持一致
- 新增协议字段时，优先更新协议文档再更新实现
- 对外文档优先讲“如何使用”，内部实现细节留在源码和测试中
- 敏感数据只保存在本地配置或数据目录

---

## 12. 参考资料

如遇到字段含义、边界情况或新增接口，可参考官方 npm 分发产物做兼容性校对：

```bash
npx -y @tencent-weixin/openclaw-weixin-cli@latest install
```

建议重点查看：
- `src/api/api.ts`
- `src/api/types.ts`
- `src/messaging/send.ts`
- `src/channel.ts`
- `src/monitor.ts`
