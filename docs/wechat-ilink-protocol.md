# 微信 iLink Bot API 协议调研文档

> 来源：基于公开分发包、协议行为观测与兼容性验证整理
> 日期：2026-03-28

---

## 1. 概述

腾讯为 OpenClaw 提供了微信 Channel 插件，通过 iLink Bot HTTP API 实现微信消息收发。本文档聚焦协议兼容性调研与工程落地要点，便于 SDK 开发、联调和维护。

### 1.1 两个 npm 包的关系

| 包名 | 版本 | 作用 |
|---|---|---|
| `@tencent-weixin/openclaw-weixin-cli` | 2.0.1 | 安装器 CLI，只有 `install` 命令 |
| `@tencent-weixin/openclaw-weixin` | 2.1.1 | 实际的 Channel 插件，包含业务逻辑与协议适配 |

### 1.2 协议栈

```text
微信用户 ←→ 微信服务器 ←→ iLink Bot API (HTTP/JSON) ←→ Channel 插件 ←→ AI Agent
```

---

## 2. API 端点清单

**Base URL:** `https://ilinkai.weixin.qq.com`  
**CDN URL:** `https://novac2c.cdn.weixin.qq.com/c2c`

| # | 端点 | 方法 | 用途 | 超时 |
|---|---|---|---|---|
| 1 | `ilink/bot/get_bot_qrcode?bot_type=3` | GET | 获取登录二维码 | 5s |
| 2 | `ilink/bot/get_qrcode_status?qrcode=<qrcode-id>` | GET | 轮询扫码状态 | 35s |
| 3 | `ilink/bot/getupdates` | POST | 接收消息 | 35s |
| 4 | `ilink/bot/sendmessage` | POST | 发送消息 | 默认 |
| 5 | `ilink/bot/getconfig` | POST | 获取 typing ticket | 10s |
| 6 | `ilink/bot/sendtyping` | POST | 发送 / 取消正在输入状态 | 10s |
| 7 | `ilink/bot/getuploadurl` | POST | 获取媒体上传预签名 URL | 默认 |

---

## 3. 公共请求规范

### 3.1 公共 Headers

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

### 3.2 公共请求体字段

每个 POST 请求体都包含：

```json
{
  "base_info": {
    "channel_version": "2.1.1"
  }
}
```

### 3.3 协议枚举值

```text
MessageType:     NONE=0, USER=1, BOT=2
MessageItemType: NONE=0, TEXT=1, IMAGE=2, VOICE=3, FILE=4, VIDEO=5
MessageState:    NEW=0, GENERATING=1, FINISH=2
TypingStatus:    TYPING=1, CANCEL=2
UploadMediaType: IMAGE=1, VIDEO=2, FILE=3, VOICE=4
```

---

## 4. 认证流程

### 4.1 获取二维码

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

### 4.2 轮询扫码状态

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

### 4.3 confirmed 响应

```json
{
  "status": "confirmed",
  "bot_token": "<sample-bot-token>",
  "ilink_bot_id": "<sample-bot-id>",
  "baseurl": "https://ilinkai.weixin.qq.com",
  "ilink_user_id": "<sample-user-id>"
}
```

### 4.4 凭证字段

| 字段 | 用途 |
|---|---|
| `bot_token` | API 认证令牌 |
| `ilink_bot_id` | Bot 账号 ID |
| `ilink_user_id` | 扫码者用户 ID |
| `baseurl` | 当前账号对应 API 基础地址 |

---

## 5. 消息收发

### 5.1 接收消息 (`getupdates`)

首次请求时 `get_updates_buf` 为空字符串，后续使用上次响应返回的游标值。

响应中的关键字段：
- `msgs`：本次拉取到的消息列表
- `get_updates_buf`：下一次轮询游标
- `context_token`：回复消息时必须回传

错误码：
- `errcode: -14`：会话过期，需要重新登录

### 5.2 发送消息 (`sendmessage`)

文本消息关键字段：
- `from_user_id`：空字符串
- `message_type`：`2`，表示 BOT 消息
- `message_state`：通常为 `2`，表示 FINISH
- `client_id`：客户端消息唯一标识
- `context_token`：来自入站消息，回复时必须原样回传

成功响应通常是空对象 `{}`。

### 5.3 流式输出

协议层存在 `message_state` 字段，可区分：

1. 部分回复：`message_state: 1` (GENERATING)，使用相同 `client_id`
2. 最终回复：`message_state: 2` (FINISH)

工程侧需要注意：
- 协议字段支持上述两种状态
- 在 SDK 设计上，建议将最终回复模式作为默认路径
- 流式回复适合作为可选增强能力按需启用

常见分块策略：
- 至少积累 **200 字** 才发一块
- 或空闲 **3 秒** 后发送当前缓冲
- 文本超过 **4000 字** 自动分块

---

## 6. 正在输入指示器

### 6.1 获取 typing_ticket

通过 `getconfig` 获取 `typing_ticket`，并按小时级 TTL 缓存。

### 6.2 发送输入状态

通过 `sendtyping` 控制：
- `status: 1` = 正在输入
- `status: 2` = 取消

常见保活间隔为 5 秒。

---

## 7. 媒体处理

### 7.1 AES-128-ECB 加解密

```text
算法: AES-128-ECB
填充: PKCS7
IV: null
```

AES Key 常见两种格式：
- 直接 base64 编码的 16 字节原始 key
- base64 编码后的 ASCII hex 字符串，再转回 16 字节 key

### 7.2 媒体下载

下载优先级通常为：IMAGE > VIDEO > FILE > VOICE。

下载流程：
1. 从消息 item 提取 CDN URL 或下载参数
2. 下载密文
3. 根据消息携带的 AES key 解密
4. 落盘保存

### 7.3 媒体上传

上传流程：
1. 读取文件并计算 MD5
2. 生成随机 filekey 和 AES key
3. 调用 `getuploadurl`
4. AES 加密后上传到 CDN
5. 读取 CDN 返回的下载参数
6. 构建媒体消息并通过 `sendmessage` 下发

---

## 8. 消息处理流水线

典型处理顺序：
1. 解析斜杠命令
2. 解析文本与引用消息
3. 下载媒体附件
4. 做白名单 / 配对校验
5. 缓存 `context_token`
6. 启动 typing 指示器
7. 调用 AI Agent
8. 将 Markdown 结果转换为更适合微信阅读的纯文本
9. 发送文本或媒体回复

---

## 9. 斜杠命令

| 命令 | 功能 |
|---|---|
| `/echo <message>` | 回显测试 |
| `/toggle-debug` | 开关调试模式 |

---

## 10. 容错与重连

轮询主循环的典型策略：
- `getupdates` 超时：视为正常，继续轮询
- 网络错误：短暂退避后重试
- 连续失败达到阈值：进入更长的冷却期
- `errcode=-14`：视为会话过期，暂停或重新登录

---

## 11. 多账号管理

典型规则：
1. 单账号场景直接使用当前账号
2. 多账号场景优先按缓存的 `context_token` 解析出站账号
3. 唯一命中则发送
4. 多个账号同时命中时应报 `ambiguous`

---

## 12. 鉴权与配对

默认策略可采用 `dmPolicy: "pairing"`：
- 扫码者自动加入白名单
- 白名单持久化到本地文件
- 未授权消息静默丢弃

---

## 13. 文件存储结构

典型目录结构：

```text
~/.agentlink/
├── wechat/
│   ├── accounts.json
│   ├── accounts/<account-id>.json
│   ├── accounts/<account-id>.sync.json
│   ├── accounts/<account-id>.context-tokens.json
│   └── debug-mode.json
└── credentials/
    └── agentlink-wechat-<account-id>-allowFrom.json
```

---

## 14. 日志建议

建议：
- 使用 JSON Lines 或清晰的文本日志
- 默认脱敏 token、URL query 和敏感 body 字段
- 将日志级别做成可配置项

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

**结论：当前文档覆盖的核心协议路径已经完成可用性验证，可用于构建基于 iLink Bot API 的工程接入。**

---

## 16. 桥接实现建议

最小可用路径：

```text
扫码登录 → getupdates 轮询 → AI 处理 → sendmessage 回复
```

完整工程中建议包含：
- 游标持久化
- `context_token` 缓存
- 会话过期处理
- Markdown 转纯文本
- 媒体加解密与上传下载
- 多账号与白名单
