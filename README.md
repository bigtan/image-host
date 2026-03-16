# image-host

基于 EdgeOne Pages Node Functions 和腾讯云 COS 的个人图床。

## 技术栈

- Vite 7
- React 19
- TypeScript 5
- EdgeOne Pages Node Functions
- Tencent COS 预签名直传

## 已实现

- 拖拽上传
- `Ctrl + V` 粘贴截图上传
- 本地保存上传令牌和对象前缀
- Node Functions 校验上传令牌
- 函数签发 COS 预签名 PUT URL
- 上传完成后生成原始链接、HTML、Markdown、BBCode

## 本地开发

先安装依赖：

```bash
pnpm install
```

启动前端：

```bash
pnpm dev
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
- `DEFAULT_PATH_PREFIX`
  默认对象前缀，例如 `forum`。
- `MAX_UPLOAD_SIZE_BYTES`
- `SIGNED_URL_EXPIRES_SECONDS`

`UPLOAD_TOKEN` 和 `UPLOAD_TOKEN_SHA256` 二选一即可。

## COS 配置

需要给 COS Bucket 配置浏览器直传的 CORS 规则，至少允许：

- 来源：你的 EdgeOne Pages 域名
- 方法：`PUT`, `GET`, `HEAD`
- 允许头：`Content-Type`

如果 `COS_PUBLIC_BASE_URL` 为空，前端会回显 COS 默认访问地址。

## EdgeOne Pages 部署

推荐结构：

- 静态前端：Vite 构建输出
- 函数目录：[`node-functions/api/sign-upload.js`](./node-functions/api/sign-upload.js)

部署时确认：

1. 构建命令使用 `pnpm build`
2. 输出目录使用 `dist`
3. 环境变量在 EdgeOne Pages 后台配置
4. `node-functions` 目录一并上传

### GitHub Actions 自动部署

工作流文件位于 [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)。

当前仓库如果已经在 EdgeOne Pages 中绑定为 `GitHub` Provider，就不要再通过 CLI 上传 `dist`。  
这类项目会由 EdgeOne 在收到 Git 推送后自动拉取仓库并构建部署。

因此当前工作流的职责是构建校验，它会：

1. 使用 `pnpm` 安装依赖并构建前端
2. 在 `push` 和 `pull_request` 时验证项目可以成功构建

如果你想走 GitHub Actions 直接上传部署，必须在 EdgeOne 新建一个 `Upload` 类型项目，而不是复用当前的 GitHub 集成项目。

## 上传流程

1. 前端读取文件或粘贴截图
2. 调用 `/api/sign-upload`
3. Node Function 校验 `x-upload-token`
4. 函数使用 COS 密钥为单个对象生成短期 PUT URL
5. 浏览器直接 PUT 到 COS
6. 前端展示嵌入代码

## 后续建议

- 增加上传历史和删除接口
- 增加图片压缩和格式转换
- 把单令牌扩展为多令牌
- 增加简单限流和审计日志
