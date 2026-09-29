# image-host

基于 EdgeOne Pages Node Functions 的个人图床，当前使用腾讯云 COS 上传，provider 架构支持后续扩展其他后端。

## 技术栈

- Vite 8
- React 19
- TypeScript 7
- EdgeOne Pages Node Functions
- Tencent COS 预签名直传

## 已实现

- 拖拽上传
- `Ctrl + V` 粘贴截图上传
- 本地保存上传令牌和对象前缀（默认 `uploads`）
- Node Functions 校验上传令牌
- 函数按 provider 签发上传参数，当前实现为 COS 预签名 PUT URL
- 上传完成后生成原始链接、HTML、Markdown、BBCode
- 前端显示当前 provider 的 CDN 域名
- 按当前上传令牌查看已保存的上传历史

## 本地开发

本项目只使用 `pnpm` 管理依赖，请不要混用 `npm install` 或提交 `package-lock.json`。

需要 Node.js 22.22.2+ 或 24.15.0+ 的对应主版本及 pnpm（测试依赖要求；CI 使用 Node.js 24）。项目提供 `.nvmrc`，使用 nvm 时执行 `nvm install`、`nvm use` 即可选择 Node.js 22。

先安装依赖：

```bash
pnpm install
```

复制 `.env.example` 为 `.env.local`，填写上传令牌及 COS 配置，然后启动前端和本地 API：

```bash
pnpm dev
```

访问 `http://localhost:3000`。`pnpm dev` 在同一端口提供 `/api/health`、`/api/sign-upload` 和 `/api/upload-history`，直接调用项目中的函数处理器。Node 和 Edge 处理器共用 `.env.local`；历史 KV 使用 `.local-data/history` 下的本地文件，重启后保留，且不会提交到 Git。

本地上传会写入所配置的真实 COS 桶；这个适配器不模拟 EdgeOne 的运行时限制和 KV 最终一致性。仅调试静态前端可使用 `pnpm dev:frontend`，该命令不提供 API。

运行验证：

```bash
pnpm check:server
pnpm test
```

构建产物：

```bash
pnpm build
```

## 环境变量

复制 [`.env.example`](./.env.example) 到 `.env.local` 或在 EdgeOne Pages 后台配置：

- `UPLOAD_TOKEN`
  前端输入的上传令牌。适合个人单用户场景。
- `UPLOAD_TOKEN_SHA256`
  如果不想在平台里保存明文令牌，可以只填 SHA-256 哈希值。
- `COS_SECRET_ID`
- `COS_SECRET_KEY`
- `COS_BUCKET`
- `COS_REGION`
- `COS_PUBLIC_BASE_URL`
  图片公开访问域名，建议使用你绑定到 COS 的自定义域名。
- `DEFAULT_UPLOAD_PROVIDER`
  默认 provider，当前填写 `cos`。
- `DEFAULT_PATH_PREFIX`
  默认对象前缀，默认 `uploads`，例如 `uploads/forum`。
- `MAX_UPLOAD_SIZE_BYTES`
- `SIGNED_URL_EXPIRES_SECONDS`
- `CORS_ALLOWED_ORIGINS`
  Node Function 签名接口允许访问的来源列表，使用半角逗号分隔，例如 `http://localhost:3000,https://img.example.com`。

`UPLOAD_TOKEN` 和 `UPLOAD_TOKEN_SHA256` 二选一即可。

## 上传与历史可靠性

- 所有选图、粘贴和拖放批次共享最多 3 个并发任务；入队时固定令牌和路径配置。
- API 请求超时为 30 秒，对象上传超时为 5 分钟；移除等待中或上传中的卡片会取消任务，离开应用时清理请求。切换到历史页不会取消正在上传的任务。
- 历史保存重试复用 `uploadId` 和 `uploadedAt`，映射到同一个 KV key，不依赖 KV 读后写去重；旧历史记录仍可读取。
- “清空已保存”仅清除历史已成功保存的卡片，保留保存失败后的重试入口。
- 切换历史令牌立即清除旧列表、分页游标和详情，并取消旧查询。

## 历史缩略图

默认仍使用原图。COS/CI 已开启图片处理、且公开访问域名支持处理参数时，在构建环境设置 `VITE_COS_THUMBNAILS=true`，历史列表会请求最大 640×640 的缩略图，详情和复制链接保留原图。使用腾讯云 [imageMogr2 图片处理参数](https://www.tencentcloud.com/pt/document/product/436/40497)。带查询参数的链接保持原样，避免破坏签名；缩略图失败时回退原图。

该变量由 Vite 在构建时读取，更改后需重新构建部署。上传卡片采用独立记忆化组件，忽略重复进度值，预览图片延迟加载并异步解码。

## 上传历史 KV 配置

上传签名继续运行在 Node Functions；上传历史 API 运行在 Edge Functions，并使用 EdgeOne KV 保存元数据。

1. 在 EdgeOne 控制台创建一个 KV 命名空间。
2. 将其绑定到当前项目，绑定变量名必须为 `IMAGE_HISTORY_KV`。
3. 确保 Edge Function 与已有 Node Functions 一起部署；新增接口为 `/api/upload-history`，不会与现有签名接口冲突。

历史记录按上传令牌的 SHA-256 指纹隔离，KV 中不保存明文令牌。EdgeOne KV 为最终一致性存储：其他边缘节点可能在最多约 60 秒后才读到刚写入的记录。

## CORS 配置

这个项目有两处 CORS，需要分别配置：

### 1. Node Function 签名接口 CORS

`/api/sign-upload` 会从 `CORS_ALLOWED_ORIGINS` 读取允许来源。

- 本地开发可以设置为 `http://localhost:3000`
- 线上部署应设置为你的前端正式域名
- 多个来源使用半角逗号分隔
- 如果请求带有 `Origin`，但不在白名单中，接口会直接返回 `403`

示例：

```env
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://img.example.com
```

### 2. 对象存储直传 CORS

浏览器拿到签名后，上传目标会变成对应存储服务，因此对象存储侧也必须允许你的前端来源发起直传请求。

COS 至少允许：

- 来源：你的前端域名
- 方法：`PUT`, `GET`, `HEAD`
- 允许头：`Content-Type`, `Content-Length`, `Content-Disposition`

如果 `COS_PUBLIC_BASE_URL` 为空，前端会回显 COS 默认访问地址。

## EdgeOne Pages 部署

推荐结构：

- 静态前端：Vite 构建输出
- Node Functions：[`node-functions/api/sign-upload.js`](./node-functions/api/sign-upload.js)
- Edge Functions：[`edge-functions/api/upload-history.js`](./edge-functions/api/upload-history.js)

部署时确认：

1. 构建命令使用 `pnpm build`
2. 输出目录使用 `dist`
3. 环境变量在 EdgeOne Pages 后台配置
4. `node-functions` 与 `edge-functions` 目录一并上传
5. `CORS_ALLOWED_ORIGINS` 已包含你的正式前端域名

### GitHub Actions 自动部署

工作流文件位于 [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)。

当前仓库如果已经在 EdgeOne Pages 中绑定为 `GitHub` Provider，就不要再通过 CLI 上传 `dist`。  
这类项目会由 EdgeOne 在收到 Git 推送后自动拉取仓库并构建部署。

因此当前工作流的职责是构建校验，它会：

1. 使用 `pnpm` 安装依赖并构建前端
2. 严格使用 `pnpm-lock.yaml` 保证依赖树一致
3. 检查服务端 JavaScript 语法，运行令牌、队列、取消/超时、历史幂等、页面竞态和本地 API 回归测试
4. 在 `push` 和 `pull_request` 时验证项目可以成功构建

如果你想走 GitHub Actions 直接上传部署，必须在 EdgeOne 新建一个 `Upload` 类型项目，而不是复用当前的 GitHub 集成项目。

## 上传流程

1. 前端读取文件或粘贴截图
2. 调用 `/api/sign-upload`
3. Node Function 校验 `Origin` 和 `x-upload-token`
4. 函数根据选定 provider 生成对应上传参数，当前为 COS 预签名 URL
5. 浏览器直接上传到对应对象存储
6. 上传成功后，前端写入当前令牌对应的 EdgeOne KV 历史记录
7. 前端展示嵌入代码，并可从“上传历史”查看已保存记录

## 后续建议

- 增加对象删除接口
- 增加图片压缩和格式转换
- 把单令牌扩展为多令牌
- 增加简单限流和审计日志
