# AgentLink WeChat SDK 设计文档

> 基于 [微信 iLink / OpenClaw WeChat Channel 协议调研文档](./wechat-ilink-protocol.md) 编写
> 日期：2026-03-30

---

## 1. 项目定位

AgentLink WeChat 是一个面向微信 iLink Bot / OpenClaw WeChat Channel 场景的独立 TypeScript SDK。

它不是腾讯官方 OpenClaw 微信插件仓库，而是一个围绕公开协议语义构建的开发者友好型代码库，目标是：

- 提供更直接的 TypeScript SDK 使用体验
- 提供可阅读、可调试、可修改的源码结构
- 提供独立于 OpenClaw 宿主的示例与测试
- 方便做微信消息接入，并支持 AI Agent 集成、自动化助手、业务系统对接和自定义开发

设计原则：

- 协议术语尽量与官方插件保持一致
- SDK 对外 API 尽量简洁、稳定、类型清晰
- 仓库结构服务于独立开发和学习，不强依赖 OpenClaw 宿主
- 示例代码优先强调“可学习、可联调、可复用”

---

## 2. 与官方插件的关系

### 2.1 官方插件负责什么

腾讯官方公开发布的 `@tencent-weixin/openclaw-weixin` 负责：

- OpenClaw 插件打包与安装
- Channel 在 OpenClaw 宿主中的注册
- gateway 生命周期集成
- 宿主配置、宿主状态目录和插件运行时约束

### 2.2 本仓库负责什么

本仓库负责：

- 封装微信 iLink / OpenClaw Channel 协议细节
- 提供独立的 TypeScript SDK 抽象
- 提供 examples、tests 和设计文档
- 让开发者不必依赖 OpenClaw 宿主也能直接做联调和验证

### 2.3 当前对齐策略

当前设计采用“协议语义对齐、工程形态独立”的策略：

- 对齐：接口名、字段名、消息状态、媒体类型、typing ticket、多账号上下文语义
- 不强求对齐：插件入口形式、目录结构、宿主配置、默认状态目录

---

## 3. 目标体验

开发者应能用少量代码完成：

- 扫码登录
- 启动长轮询
- 接收消息
- 回复文本 / 图片 / 文件
- 管理本地多账号

最小体验：

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

- `replyImage()` / `replyFile()`
- `createReplyStream()`
- `downloadMedia()`
- `listAccounts()`
- `cancelLogin()`
- 主动出站消息发送

---

## 4. 仓库结构

```text
agentlink-wechat/
├── docs/
│   ├── wechat-ilink-protocol.md
│   └── wechat-sdk-design.md
├── examples/
│   ├── echo-bot.ts
│   ├── weather-bot.ts
│   ├── send-media.ts
│   ├── multi-account-echo.ts
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
- `examples/` 提供最小联调与 AI Agent 示例
- `docs/` 提供协议说明与设计说明

---

## 5. 核心对象

### 5.1 `AgentLinkWechat`

主入口类，负责：

- 登录与会话恢复
- 长轮询消息接收
- 事件分发
- 主动发送文本、图片、文件
- 多账号管理

核心方法：

- `login()`
- `waitForLogin()`
- `cancelLogin()`
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

### 5.2 `Message`

入站消息对象，负责：

- 暴露统一字段，如文本、发送者、时间、消息项等
- 封装回复能力
- 封装媒体下载能力

核心方法：

- `reply(text)`
- `replyImage(filePath)`
- `replyFile(filePath)`
- `createReplyStream()`
- `downloadMedia(destination)`

### 5.3 `ReplyStream`

用于流式回复，负责：

- 管理 `GENERATING` / `FINISH` 状态
- 复用同一个 `client_id`
- 串行发送分块更新
- 与 typing 指示器协同

---

## 6. 模块划分

### 6.1 `auth/`

负责扫码登录流程：

- 获取二维码
- 轮询扫码状态
- 处理 IDC 重定向
- 产出登录凭证
- 支持主动取消当前登录流程

### 6.2 `http/`

负责协议请求的统一封装：

- 公共 headers
- 请求体基础字段
- 超时控制
- 错误分类

### 6.3 `polling/`

负责 `getupdates` 长轮询：

- 拉取消息
- 维护游标
- 区分正常超时与真实网络错误
- 会话过期时触发重新登录
- 读取服务端返回的 `longpolling_timeout_ms`

### 6.4 `messaging/`

负责消息相关能力：

- 入站消息解析
- 出站 payload 构建
- `context_token` 管理
- slash command 处理
- typing 指示器
- 流式回复

### 6.5 `media/`

负责媒体能力：

- AES-128-ECB 加解密
- 上传前预处理
- 下载后解密与保存
- 图片、视频、文件消息组包

说明：

- 当前实现已区分 `IMAGE` / `VIDEO` / `FILE` 三种出站消息
- 不再把视频简单降级成文件消息

### 6.6 `storage/`

负责本地状态持久化：

- 登录凭证
- 长轮询游标
- `context_token`
- 多账号状态
- 白名单相关数据

### 6.7 `utils/`

负责通用工具：

- 路径解析
- 日志
- Markdown 清洗
- MIME 推断
- 并发队列与 ID 生成

---

## 7. 持久化设计

默认运行时根目录位于用户主目录下的：

```text
~/.agentlink/wechat
```

默认布局下：

- 账号状态位于 `<dataDir>/wechat/`
- 白名单文件位于 `<dataDir>/credentials/`
- 下载媒体时，相对路径也基于 `dataDir` 根目录解析

设计目标：

- 同一台机器上可恢复历史登录状态
- 支持多账号并存
- 不把敏感数据写入仓库

与官方插件的差异：

- 官方插件通常落在 `.openclaw` 宿主目录
- 本仓库作为独立 SDK，使用自己的运行时目录布局

---

## 8. 错误处理策略

SDK 将错误分为：

- `AuthError`
- `LoginCancelledError`
- `NetworkError`
- `ProtocolError`
- `MediaError`

策略约定：

- 长轮询超时视为正常空闲，不作为错误上报
- 可恢复的网络错误允许重试
- 会话过期时触发重新登录流程
- `cancelLogin()` 用于主动中止扫码等待
- 出站消息默认不做盲目重试，避免重复发送

---

## 9. 示例策略

当前仓库提供多个示例：

### 9.1 `examples/echo-bot.ts`

用途：

- 最小联调示例
- 验证扫码登录、收消息、发回复这条基础链路

### 9.2 `examples/weather-bot.ts`

用途：

- 演示如何在消息处理器中接入外部 HTTP 服务
- 展示基于微信消息触发查询并返回结构化结果的方式

### 9.3 `examples/send-media.ts`

用途：

- 演示图片、文件、视频的上传发送流程
- 展示媒体消息与 AES 处理相关的实际接入方式

### 9.4 `examples/multi-account-echo.ts`

用途：

- 展示多账号运行的基础控制台形态
- 展示微信消息在多个 bot 账号上的并行接入方式
- 展示 `/accounts`、`/login-new`、`/logout` 这类多账号基础控制命令

### 9.5 `examples/openai-doc-agent.ts`

用途：

- 展示 AgentLink WeChat 与 AI Agent 的接入方式
- 提供本地文档检索、多账号运行、配置文件管理等参考实现

设计取向：

- 优先可读性和学习价值
- 优先稳定行为，不额外增加复杂兼容逻辑

---

## 10. 开发路线图

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
- [x] 视频消息组包与发送对齐

### Phase 4: 高级功能

- [x] 多账号管理
- [x] 白名单配对
- [x] 斜杠命令
- [x] 调试模式
- [ ] 更多官方插件兼容层（按需）

---

## 11. 测试策略

### 11.1 单元测试

覆盖核心模块逻辑，包括：

- 消息构建
- 媒体加解密
- 游标管理
- 存储读写
- 安全约束
- 视频消息组包
- 动态长轮询超时
- 登录取消行为

### 11.2 联调验证

用于验证真实链路行为，包括：

- 扫码登录
- 文本收发
- 文件上传
- 图片下载
- 协议字段与官方公开实现的对齐情况

---

## 12. 维护建议

- README、协议文档、设计文档和实际代码结构保持一致
- 新增协议字段时，优先更新协议文档，再更新实现
- 优先对齐官方公开插件中的协议术语和行为语义
- 对工程结构、运行目录、示例组织等非协议层差异保持明确说明
- 敏感数据只保存在本地配置或数据目录中
- 涉及 `dataDir`、存储路径和文件布局的调整，需要同步更新 README 与 docs


