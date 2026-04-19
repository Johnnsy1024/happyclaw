<p align="center">
  <img src="web/public/icons/logo-1024.png" alt="HappyClaw Logo" width="120" />
</p>

<h1 align="center">HappyClaw</h1>

<p align="center">
  自托管、多用户、本地优先的 AI Agent 系统，直接复用 Claude Code 与 Codex 运行时。
</p>

## TL;DR

HappyClaw 适合想把 Claude Code / Codex 变成一个可通过 Web 和 IM 使用的本地服务的人。它不是 API wrapper，也不是 prompt workflow 壳子，而是把现成的 agent runtime、工作区、会话、权限、消息路由和备份恢复整合成一套系统。

最短启动路径：

```bash
git clone https://github.com/riba2534/happyclaw.git
cd happyclaw
make start
```

然后访问 `http://localhost:3000`。

## 你需要什么

必需：

- Node.js `>= 20`
- 一种 AI Runtime 凭据：Claude 或 Codex 二选一即可

按需：

- Docker / OrbStack
  只有使用容器模式时才必需。管理员默认主工作区可以直接跑在宿主机上；成员和容器模式工作区需要 Docker。
- IM 渠道凭据
  Feishu、Telegram、QQ、WeChat、DingTalk 都是可选接入项。

说明：

- 首次 `make start` 不是简单启动。它可能安装依赖、编译前后端、编译 `agent-runner`、检查或构建 Docker 镜像。
- 如果你的网络环境较慢，首次启动会明显更久。

## 快速开始

```bash
git clone https://github.com/riba2534/happyclaw.git
cd happyclaw
make start
```

启动完成后：

1. 打开 `http://localhost:3000`
2. 创建管理员账号
3. 配置 Claude 或 Codex Runtime
4. 开始在 Web 中对话

如果你只想先验证系统是否能跑起来，IM 渠道可以后配。

## 首次初始化

### 1. 创建管理员

系统第一次启动会进入初始化流程。你需要先创建管理员账号。

### 2. 配置 Agent Runtime

当前初始化是否完成，主要取决于 Claude / Codex provider 是否配置好。IM 渠道不是阻塞项。

支持的 runtime：

- Claude
- Codex

### 3. 可选配置 IM 通道

初始化完成后，你可以在设置页继续接入 IM 渠道。

## IM 通道

当前设置页里有 5 个通道：

- Feishu
- Telegram
- QQ
- WeChat
- DingTalk

注意：

- 不同通道能力不完全对等。
- 初始向导里主要覆盖 Feishu、Telegram、QQ、WeChat。
- DingTalk 目前走设置页配置路径。

建议把 README 里的 IM 认知保持在“支持接入多种渠道，但能力和接入方式按渠道分别看”，不要假设所有通道完全一致。

## Agent Runtime

### Claude

支持两类模式：

- 官方渠道
  - OAuth
  - setup token
  - API Key
- 第三方渠道
  - `base URL`
  - `auth token`
  - `model`
  - 自定义环境变量

### Codex

支持：

- 导入本机 `~/.codex/auth.json`
- 手动提供 `auth.json`
- API Key
- 兼容 OpenAI API 的第三方后端

说明：

- Runtime 的大部分配置通过 Web UI 管理。
- 但系统仍然依赖部分部署环境变量和本地持久化配置，不应理解成“完全不依赖配置文件”。

## 执行模式

HappyClaw 只有两种执行模式：

- `host`
- `container`

默认行为：

- admin 主工作区默认 `host`
- member 主工作区默认 `container`

这意味着：

- Docker 不是绝对必需
- 但一旦要用容器模式，就必须保证本机 Docker daemon 可用

## 常用命令

```bash
make start
make dev
make dev-backend
make dev-web
make build
make typecheck
make test
make backup
make restore
make reset-init
npm run reset:admin -- <用户名> <新密码>
```

说明：

- `make start` 面向本地生产式启动
- `make dev` 同时拉起前后端开发环境
- `make backup` / `make restore` 面向运行态迁移和恢复，不只是代码仓库备份

## 数据与备份

真实运行态主要存放在 `data/` 下，而不是 git 仓库本身。

关键目录：

- `data/db`
- `data/config`
- `data/groups`
- `data/sessions`
- `data/memory`
- `data/mcp-servers`
- `data/skills`
- `data/avatars`

关键说明：

- 会话密钥默认在 `data/config/session-secret.key`
- 如果这个文件丢失，已有登录 cookie 会失效，用户需要重新登录
- 这也是为什么“跨机器恢复”不能等同于“重新 clone 一份仓库”

### 当前官方备份覆盖

`make backup` 现在会包含：

- `data/db`
- `data/config`
- `data/groups`
- `data/sessions`
- `data/memory`
- `data/mcp-servers`
- `data/avatars`
- `data/skills`（如果存在）

不会包含：

- `data/ipc`
- `data/env`
- 临时日志与构建产物

### 跨 Mac 恢复结论

当前项目不具备“在另一台 Mac 上 `git pull` 后直接无缝使用”的属性。

更准确的说法是：

- 代码仓库可以迁移
- 运行态数据也可以迁移
- 但目标机器仍然需要准备本地环境，例如 Node、Docker、以及可能的 `~/.claude` / `~/.codex` 登录态

最稳妥的恢复流程：

1. 在源机器停止服务
2. 执行 `make backup`
3. 在目标机器准备 Node 和 Docker
4. clone 仓库
5. 恢复备份
6. 重新 `make start`
7. 检查 host 模式工作区中的绝对路径配置是否仍然有效

## 开发

开发时需要区分前后端端口：

- 后端默认 `3000`
- Vite 前端默认 `5173`

如果你修改后端端口，不要忘了同步前端代理目标。

开发常用：

```bash
make dev
make dev-backend
make dev-web
make typecheck
make format-check
```

生产态端口使用 `WEB_PORT` 控制。

## 故障排查

### Docker 不可用

如果容器模式无法工作，先确认：

- Docker / OrbStack 已安装
- Docker daemon 正在运行
- 本机能执行 `docker info`

### 端口冲突

默认端口是 `3000`。如果启动时报端口占用，换一个端口：

```bash
WEB_PORT=3001 make start
```

### Node 与原生模块 ABI 不匹配

如果你看到 `better-sqlite3` 或其他原生模块报 `NODE_MODULE_VERSION` 错误，说明安装依赖和运行程序使用了不同主版本的 Node。

建议：

- 固定使用同一个 Node 主版本
- 删除 `node_modules` 后重新安装

### 反向代理部署

如果服务跑在 nginx、caddy 或其他反向代理后面，记得设置：

```bash
TRUST_PROXY=true
```

同时按实际域名收紧 CORS，而不是长期依赖宽松的本地默认值。

### 重新部署后登录失效

优先检查 `data/config/session-secret.key` 是否保留。

## 附录

### 项目定位

HappyClaw 的重点不是自己重新实现 agent，而是把现有 runtime、会话、工作区、权限和多通道接入整合成可自托管的本地系统。

### 相关资源

- 架构与审查结论见 [docs/project-review.md](/Users/faizalfeng/happyclaw/docs/project-review.md)
- 截图见 [docs/screenshots](/Users/faizalfeng/happyclaw/docs/screenshots)

### 许可证

MIT
