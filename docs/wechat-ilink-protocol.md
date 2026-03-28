# 微信 iLink / OpenClaw WeChat Channel 协议调研文档

> 来源：基于腾讯公开发布的 `@tencent-weixin/openclaw-weixin` npm 包、README、已发布源码与本地兼容性验证整理
> 参考基线：`@tencent-weixin/openclaw-weixin@2.1.1`
> 日期：2026-03-28

---

## 1. 文档定位

本文档用于说明微信 iLink Bot / OpenClaw WeChat Channel 的公开协议语义、接口命名、消息结构和工程接入要点。

需要特别说明：

- 腾讯官方公开发布的是 OpenClaw 渠道插件 `@tencent-weixin/openclaw-weixin`
- 本仓库 `AgentLink WeChat` 是一个独立的 TypeScript SDK
- 本文档的目标不是复述官方插件的安装方式，而是提炼协议层事实，供 SDK 开发、联调和兼容性验证使用

换句话说：

- 官方插件提供 OpenClaw 宿主中的 Channel 能力
- 本文档聚焦其公开暴露出来的协议层行为
- 本仓库代码在术语和接口语义上尽量对齐官方插件，但工程结构保持独立

---

## 2. 公开包与关系说明

### 2.1 两个 npm 包的关系

| 包名 | 版本 | 作用 |
|---|---|---|
| `@tencent-weixin/openclaw-weixin-cli` | 2.0.1 | 安装器 CLI，提供一键安装能力 |
| `@tencent-weixin/openclaw-weixin` | 2.1.1 | 实际的 OpenClaw WeChat Channel 插件，包含协议实现与运行时逻辑 |

### 2.2 协议栈

```text
微信用户 ←→ 微信服务器 ←→ iLink Bot API (HTTP / JSON) ←→ OpenClaw WeChat Channel 插件 ←→ AI Agent / 应用
```

### 2.3 本仓库的对齐范围

当前文档与实现重点对齐以下内容：

- 接口命名：`getupdates`、`sendmessage`、`getuploadurl`、`getconfig`、`sendtyping`
- 长轮询游标：`get_updates_buf`
- 消息类型与状态：`MessageType`、`MessageItemType`、`MessageState`
- typing ticket、Channel、多账号、配对等术语
- 媒体上传下载中的 CDN / AES 表达方式

以下内容在本仓库中是有意保持不同的：

- OpenClaw 插件安装与 gateway 生命周期管理
- OpenClaw 宿主目录结构
- 插件入口文件与宿主配置结构
- 独立 SDK 的 API 抽象和 examples 组织方式

---

## 3. API 端点清单

**Base URL:** `https://ilinkai.weixin.qq.com`  
**CDN URL:** `https://novac2c.cdn.weixin.qq.com/c2c`

| # | 端点 | 方法 | 用途 | 典型超时 |
|---|---|---|---|---|
| 1 | `ilink/bot/get_bot_qrcode?bot_type=3` | GET | 获取登录二维码 | 5s |
| 2 | `ilink/bot/get_qrcode_status?qrcode=<qrcode-id>` | GET | 轮询扫码状态 | 35s |
| 3 | `ilink/bot/getupdates` | POST | 长轮询接收消息 | 默认 35s，可由服务端动态下发 |
| 4 | `ilink/bot/sendmessage` | POST | 发送消息 | 默认 |
| 5 | `ilink/bot/getconfig` | POST | 获取账号配置（如 typing ticket） | 10s |
| 6 | `ilink/bot/sendtyping` | POST | 发送 / 取消正在输入状态 | 10s |
| 7 | `ilink/bot/getuploadurl` | POST | 获取媒体上传预签名参数 | 默认 |

---

## 4. 公共请求规范

### 4.1 公共 Headers

所有请求：

```text
iLink-App-Id: bot
iLink-App-ClientVersion: 131329
```

仅 POST 请求：

```text
Content-Type: application/json
AuthorizationType: ilink_bot_token
Authorization: Bearer <bot_token>
X-WECHAT-UIN: <base64(String(randomUint32))>
```

可选：

```text
SKRouteTag: <number>
```

### 4.2 公共请求体字段

每个 POST 请求体都包含：

```json
{
  "base_info": {
    "channel_version": "2.1.1"
  }
}
```

### 4.3 协议枚举值

```text
MessageType:     NONE=0, USER=1, BOT=2
MessageItemType: NONE=0, TEXT=1, IMAGE=2, VOICE=3, FILE=4, VIDEO=5
MessageState:    NEW=0, GENERATING=1, FINISH=2
TypingStatus:    TYPING=1, CANCEL=2
UploadMediaType: IMAGE=1, VIDEO=2, FILE=3, VOICE=4
```

---

## 5. 认证流程

### 5.1 获取二维码

```text
GET https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3
```

响应示例：

```json
{
  "ret": 0,
  "qrcode": "<sample-qrcode-id>",
  "qrcode_img_content": "https://liteapp.weixin.qq.com/q/<sample-link>?qrcode=<sample-qrcode-id>&bot_type=3"
}
```

### 5.2 轮询扫码状态

```text
GET https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=<qrcode_id>
```

状态流转：

```text
wait → scaned → confirmed
              → scaned_but_redirect
     → expired
```

`scaned_but_redirect` 表示需要切换到 `redirect_host` 继续轮询。

### 5.3 confirmed 响应

```json
{
  "status": "confirmed",
  "bot_token": "<sample-bot-token>",
  "ilink_bot_id": "<sample-bot-id>",
  "baseurl": "https://ilinkai.weixin.qq.com",
  "ilink_user_id": "<sample-user-id>"
}
```

### 5.4 凭证字段

| 字段 | 用途 |
|---|---|
| `bot_token` | API 认证令牌 |
| `ilink_bot_id` | Bot 账号 ID |
| `ilink_user_id` | 扫码者用户 ID |
| `baseurl` | 当前账号对应 API 基础地址 |
| `redirect_host` | IDC 重定向时新的轮询 host |
| `route_tag` | 可选的路由标签 |

---

## 6. 长轮询与消息接收

### 6.1 `getupdates`

首次请求时 `get_updates_buf` 为空字符串，后续使用上次响应返回的游标值。

请求体：

```json
{
  "get_updates_buf": "",
  "base_info": {
    "channel_version": "2.1.1"
  }
}
```

响应中的关键字段：

- `msgs`：本次拉取到的消息列表
- `get_updates_buf`：下一次轮询游标
- `context_token`：回复消息时必须回传
- `longpolling_timeout_ms`：服务端建议的下一次长轮询超时值

错误码：

- `errcode: -14`：会话过期，需要重新登录

### 6.2 `longpolling_timeout_ms`

官方公开实现会读取 `getupdates` 响应中的 `longpolling_timeout_ms`，并将其作为下一次长轮询请求的超时值。

这意味着：

- 客户端不应永久写死轮询超时
- 更稳妥的做法是：初始值使用 35s，后续优先采纳服务端返回值

本仓库当前实现已经对齐这一行为。

---

## 7. 消息结构

### 7.1 `WeixinMessage`

关键字段：

| 字段 | 说明 |
|---|---|
| `message_id` | 消息唯一 ID |
| `from_user_id` | 发送者 ID |
| `to_user_id` | 接收者 ID |
| `client_id` | 客户端消息 ID |
| `create_time_ms` | 创建时间戳 |
| `message_type` | USER / BOT |
| `message_state` | NEW / GENERATING / FINISH |
| `item_list` | 消息内容数组 |
| `context_token` | 回复时必须原样回传的上下文令牌 |

### 7.2 `MessageItem`

支持的主要类型：

- `TEXT`
- `IMAGE`
- `VOICE`
- `FILE`
- `VIDEO`

常见工程含义：

- `TEXT`：文本消息
- `IMAGE`：图片消息，带 CDN 媒体引用
- `FILE`：文件附件消息
- `VIDEO`：视频消息，不应与普通文件混发
- `VOICE`：语音消息，可能包含转文字段

### 7.3 消息状态

协议层存在 `message_state` 字段：

- `NEW`：新消息
- `GENERATING`：流式 / 部分回复阶段
- `FINISH`：最终回复阶段

工程实践中：

- 默认推荐最终回复模式
- 流式回复可作为增强能力按需启用
- 流式过程中的多个分块应复用相同 `client_id`

---

## 8. 发送消息 (`sendmessage`)

文本消息关键字段：

- `from_user_id`：空字符串
- `message_type`：`BOT`
- `message_state`：通常为 `FINISH`
- `client_id`：客户端消息唯一标识
- `context_token`：来自入站消息，回复时必须原样回传

成功响应通常是空对象 `{}`。

### 8.1 文本发送

文本可由一个或多个 `TEXT` item 组成；若做长文本切分，属于客户端封装行为。

### 8.2 图片发送

图片消息应使用 `IMAGE` item，下挂 `image_item.media`。

### 8.3 文件发送

文件附件应使用 `FILE` item，下挂 `file_item`。

### 8.4 视频发送

视频消息应使用 `VIDEO` item，下挂 `video_item`。

这点非常重要：

- 视频上传的 `media_type` 应为 `VIDEO`
- 最终下发消息时也应组装为 `VIDEO` item
- 不应把视频简单降级成 `FILE` 消息

本仓库当前实现已经对齐这一行为。

---

## 9. 正在输入指示器

### 9.1 获取 typing ticket

通过 `getconfig` 获取 `typing_ticket`，并按小时级 TTL 缓存。

### 9.2 发送输入状态

通过 `sendtyping` 控制：

- `status: 1` = 正在输入
- `status: 2` = 取消输入

常见保活间隔为 5 秒。

---

## 10. 媒体上传下载

### 10.1 AES-128-ECB 加解密

```text
算法: AES-128-ECB
填充: PKCS7
IV: null
```

AES Key 常见两种表达方式：

- 原始 16 字节 key 的 base64 字符串
- 十六进制字符串形式的 key，经转换后得到原始 16 字节 key

### 10.2 媒体下载

常见优先级为：

```text
IMAGE > VIDEO > FILE > VOICE
```

下载流程：

1. 从消息 item 提取 CDN URL 或下载参数
2. 下载密文
3. 根据消息携带的 AES key 解密
4. 落盘保存

### 10.3 媒体上传

上传流程：

1. 读取文件并计算 MD5
2. 生成随机 `filekey` 和 AES key
3. 调用 `getuploadurl`
4. AES 加密后上传到 CDN
5. 读取 CDN 返回的下载参数
6. 构建对应的 `IMAGE` / `VIDEO` / `FILE` 消息 item
7. 通过 `sendmessage` 下发

当前公开实现中：

- 图片、视频、文件走不同的消息组包路径
- 上传时可统一先拿 `upload_full_url` 或 `upload_param`
- 当前公开代码对图片 / 视频 / 文件默认都使用 `no_need_thumb: true`

---

## 11. 斜杠命令

公开实现和本仓库当前都支持以下内置命令：

| 命令 | 功能 |
|---|---|
| `/echo <message>` | 回显测试 |
| `/toggle-debug` | 开关调试模式 |

---

## 12. 多账号、配对与鉴权

### 12.1 多账号管理

典型规则：

1. 单账号场景直接使用当前账号
2. 多账号场景优先按缓存的 `context_token` 解析出站账号
3. 唯一命中则发送
4. 多个账号同时命中时应报 `ambiguous`

### 12.2 配对与白名单

默认策略可采用 `pairing`：

- 扫码者自动加入白名单
- 白名单持久化到本地文件
- 未授权消息静默丢弃

### 12.3 本仓库与官方插件在存储层的差异

官方 OpenClaw 插件默认使用 `.openclaw` 宿主目录。

本仓库作为独立 SDK，默认使用：

```text
~/.agentlink/wechat
```

因此：

- 协议语义是可对齐的
- 本地存储布局不必与官方插件完全一致
- 若未来需要无缝迁移旧数据，可额外补兼容层

---

## 13. 容错与重连

轮询主循环的典型策略：

- `getupdates` 超时：视为正常，继续轮询
- 网络错误：短暂退避后重试
- 连续失败达到阈值：进入更长冷却期
- `errcode=-14`：视为会话过期，暂停或重新登录
- 服务端返回新的 `longpolling_timeout_ms`：更新客户端下一次轮询超时

---

## 14. 本仓库默认目录结构

```text
~/.agentlink/
└── wechat/
    ├── wechat/
    │   ├── accounts.json
    │   ├── accounts/<account-id>.json
    │   ├── accounts/<account-id>.sync.json
    │   ├── accounts/<account-id>.context-tokens.json
    │   └── debug-mode.json
    └── credentials/
        └── agentlink-wechat-<account-id>-allowFrom.json
```

说明：

- 这是本仓库 SDK 的本地状态目录
- 不等同于 OpenClaw 插件在 `.openclaw` 下的宿主状态目录

---

## 15. 兼容性验证结果（2026-03-28）

| 步骤 | 状态 | 说明 |
|---|---|---|
| 获取二维码 | ✅ | `get_bot_qrcode` 无需授权 |
| 扫码获取 token | ✅ | 返回完整凭证 |
| 接收消息 | ✅ | `getupdates` 正常返回微信消息 |
| 发送文本 | ✅ | 文本回复已完成真实链路验证 |
| 文件上传发送 | ✅ | 文件消息已完成真实链路验证 |
| 图片下载解密 | ✅ | 入站图片下载与落盘已完成真实链路验证 |
| 视频消息组包 | ✅ | 当前 SDK 已按 `VIDEO` item 下发，而非降级成 `FILE` |
| 动态轮询超时 | ✅ | 当前 SDK 已支持读取 `longpolling_timeout_ms` |

**结论：当前文档覆盖的核心协议路径已经完成对齐和可用性验证，可用于构建基于 iLink Bot API 的独立 SDK 与工程接入。**
