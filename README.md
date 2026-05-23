# MirrorKit 使用说明

[中文](README.md) | [English](README_EN.md)

## 开源协议

本项目使用 GNU Affero General Public License v3.0 or later。

```text
SPDX-License-Identifier: AGPL-3.0-or-later
```

你可以复制、分发和修改本项目代码，但修改版也必须以相同协议开源。

如果你把修改版部署成网络服务供他人使用，也必须向使用者提供对应源码。

注意：本协议只覆盖本项目工具代码，不覆盖通过本工具下载到本地的第三方网站资源。

## 免责声明

本项目仅供学习研究、技术交流和本地测试使用，请勿用于任何违法违规用途。

本工具只是模拟镜像站的本地研究工具，并非目标网站的完整复制版本，也不代表目标网站官方内容。

通过本工具下载到本地的所有资源，仅限个人学习研究和本地测试。未经授权，不得对下载资源进行二次上传、公开传播、分发、商用或用于搭建公开镜像站；此类行为可能构成侵权或违法。

使用者应自行确认目标网站的版权、服务条款、访问限制和当地法律法规。禁止将本项目用于未授权复制、传播、商用、绕过访问控制、侵犯版权、侵犯隐私、攻击网站或其他不当行为。

因使用本项目产生的任何风险、损失、法律责任或第三方纠纷，均由使用者自行承担，项目作者不承担任何责任。

这是一个网页本地镜像框架。

目标规则：

```text
所有资源先走本地
本地没有，再去远程请求
请求成功后，缓存到本地
以后再访问，直接读本地
```

外层 `index.html` 只是启动页，不保存目标网站首页。目标网站内容都会放进一个独立文件夹里，例如：

```text
项目文件夹/
├─ index.html
├─ server.js
├─ tools/
└─ example-site.com/
   ├─ index.html
   ├─ assets/
   └─ ...
```

项目外层文件夹叫什么都可以，不影响代码。

## 零、运行依赖

本项目需要安装：

```text
Node.js 18 或更高版本
现代浏览器，例如 Chrome、Edge、Firefox
```

原因：

```text
server.js 和 tools 里的脚本都用 Node.js 运行
下载远程资源时使用 Node.js 内置 fetch
fetch 从 Node.js 18 开始内置，低版本 Node 可能无法运行
```

检查 Node.js 版本：

```bat
node -v
```

如果显示类似下面这样，就可以用：

```text
v18.x.x
v20.x.x
v22.x.x
```

本项目没有额外 npm 依赖，不需要运行：

```bat
npm install
```

只要 Node.js 版本够，直接运行即可：

```bat
npm start
```

或者：

```bat
node server.js --auto-port
```

或者双击：

```text
一键启动服务器.bat
```

这个交互式菜单提供 9 个选项：

```text
[1] 一键启动（自动打开浏览器）
[2] 启动服务器（不打开浏览器）
[3] 预下载全部资源后启动
[4] 续传上次中断的下载后启动
[5] 自定义端口启动
[6] 仅预下载（不启动服务器）
[7] 运行健康检查
[8] 查看已下载资源统计
[9] 导出独立离线包
```

菜单会自动读取 `mirror.config.json` 显示当前镜像名称和目标站点。

此外，每次启动服务器或开始爬取时，`lib/generate-launcher.js` 会自动在每个镜像文件夹里生成一个简洁版 `启动.bat`，双击即可直接进入该站点的离线镜像，无需选择菜单。

## 一、换网站要改哪里

换网站主要改：

```text
mirror.config.json
```

`server.js` 和 `tools/` 脚本会读取同一份配置，环境变量优先级最高。

如果你要维护多个站点，可以复制多份配置文件：

```text
mirror.config.json
sites/site-a.json
sites/site-b.json
```

运行时指定配置：

```bat
node server.js --config sites/site-a.json
node tools\mirror-assets.js --config sites/site-a.json --dry-run
node tools\mirror-assets.js --config sites/site-a.json
```

常用配置示例：

```json
{
    "port": 3000,
    "autoPort": true,
    "targetHost": "https://example.com",
    "mirrorName": "example.com",
    "startPath": "/"
}
```

### 1. TARGET_HOST

目标网站域名，只写协议 + 域名，不要带最后的 `/`。

```json
{
    "targetHost": "https://example.com"
}
```

改成你要扒的网站：

```json
{
    "targetHost": "https://www.xxx.com"
}
```

### 2. MIRROR_NAME

本地保存文件夹名。

```json
{
    "mirrorName": "example.com"
}
```

例如：

```json
{
    "mirrorName": "xxx.com"
}
```

下载内容会保存到：

```text
项目文件夹/xxx.com/
```

### 3. START_PATH

目标网站入口路径。

如果网站首页就是：

```text
https://www.xxx.com/
```

就写：

```json
{
    "startPath": "/"
}
```

如果入口是：

```text
https://www.xxx.com/zh
```

就写：

```json
{
    "startPath": "/zh"
}
```

访问镜像时用：

```text
http://localhost:3000/<MIRROR_NAME><START_PATH>
```

例如：

```text
http://localhost:3000/xxx.com/
http://localhost:3000/xxx.com/zh
```

### 4. AUTO_PORT

端口被占用时，是否自动尝试下一个可用端口。

```json
{
    "autoPort": true
}
```

建议保持开启，尤其是双击启动或给非技术用户使用时。

## 二、工具怎么用

工具都在 `tools/` 文件夹里。

### 1. tools\check.js

用途：一键验收。

它会运行：

```text
doctor 运行前诊断
所有工具 / lib / 测试脚本语法检查
package.json 和 mirror.config.json 解析检查
完整 node:test 测试套件
```

运行：

```bat
npm run check
```

只做快速检查，不跑完整测试：

```bat
node tools\check.js --quick
```

机器可读输出：

```bat
node tools\check.js --json
```

同一套检查也会在 GitHub Actions 里自动运行：

```text
.github/workflows/check.yml
```

它会在 Node.js 18、20、22 上执行 `npm run check`，用于提前发现跨版本问题。

### 2. tools\doctor.js

用途：运行前诊断。

它会检查：

```text
Node.js 版本
配置文件是否有效
关键项目文件是否存在
镜像目录是否可写
本地服务器端口是否可用
```

运行：

```bat
node tools\doctor.js
```

机器可读输出：

```bat
node tools\doctor.js --json
```

如果只想看一次总览，使用聚合状态命令：

```bat
node tools\status.js
node tools\status.js --json
```

### 3. server.js

用途：启动本地服务器。

它负责：

```text
打开本地镜像
优先读取本地文件
本地没有时去远程下载
下载成功后保存本地
把页面里的外链改成本地镜像路径
支持本地视频和大文件的 Range 分段读取
```

运行：

```bat
node server.js
```

服务器环境不想自动打开浏览器时：

```bat
node server.js --no-open
```

使用指定配置文件：

```bat
node server.js --config sites/site-a.json
```

如果 3000 端口被占用，可以直接指定端口：

```bat
node server.js --port 3001
node server.js --config sites/site-a.json --port 3001
```

也可以让服务器自动尝试下一个可用端口：

```bat
node server.js --auto-port
node server.js --config sites/site-a.json --auto-port
```

或者双击：

```text
一键启动服务器.bat
```

这个脚本会先检查 Node.js 和项目配置，再用自动端口回退启动本地服务。

打开：

```text
http://localhost:3000/
```

脚本或监控可以检查健康状态：

```text
http://localhost:3000/__health.json
```

它会返回当前配置、入口路径、运行时间、镜像目录是否存在，以及服务端日志文件位置。

外层启动页会自动显示当前配置的入口。

### 调试日志

服务器和下载工具都会把结构化日志写到 `logs/`：

```text
logs/mirrorkit-server.log
logs/mirrorkit-tools.log
```

这些文件是 newline-delimited JSON，每一行都是一个事件，适合排查哪个 URL 下载失败、被拒绝缓存、端口是否回退、任务是否中断。

实时看服务器日志：

```bat
node server.js --auto-port
```

指定日志文件：

```bat
node server.js --log-file logs\site-a-server.log
node tools\mirror-assets.js --log-file logs\site-a-tools.log
```

关闭文件日志：

```bat
set MIRRORKIT_LOG_FILE=0
```

日志默认超过 5 MB 会轮转为 `.1` 文件，避免长期运行撑满磁盘。可以调整上限：

```bat
set MIRRORKIT_LOG_MAX_BYTES=10485760
```

`--json-log` 仍然会把机器可读事件输出到控制台，方便管道或脚本消费：

```bat
node tools\mirror-assets.js --json-log
```

快速汇总最近日志、错误和警告：

```bat
node tools\logs.js
node tools\logs.js --json
```

### 4. tools\mirror-assets.js

用途：通用批量下载。

适合下载普通网站资源：

```text
HTML
CSS
JS
JSON
图片
字体
普通视频文件
wasm
压缩纹理
```

运行：

```bat
node tools\mirror-assets.js
```

只想预览将处理哪些资源、不发起下载：

```bat
node tools\mirror-assets.js --dry-run
```

使用指定配置文件预览：

```bat
node tools\mirror-assets.js --config sites/site-a.json --dry-run
```

如果想重新检查坏缓存：

```bat
node tools\mirror-assets.js --retry-bad
```

如果中途按 Ctrl + C 停止，脚本会保存进度；继续下载：

```bat
node tools\mirror-assets.js --resume
```

长任务只看摘要，减少刷屏：

```bat
node tools\mirror-assets.js --quiet
```

输出机器可读 JSON 日志，便于脚本分析：

```bat
node tools\mirror-assets.js --json-log
```

下载过程也会默认追加到：

```text
logs/mirrorkit-tools.log
```

一般换网站后，先跑这个。

下载完整结束后，它会在镜像目录写入：

```text
.mirror-manifest.json
```

这个文件记录本次下载工具、完成时间、资源列表、文件大小、SHA-256 摘要和统计数据，方便之后用 `tools\report.js` 追踪镜像完整度。

### 5. tools\mirror-cms-media.js

用途：补充下载隐藏媒体。

有些网站的视频、图片不直接写在 HTML 里，而是藏在：

```text
CMS JSON
远程存储桶
app 缓存号文件
运行时数据文件
```

这种情况下，普通 `mirror-assets.js` 可能扫不到，就跑这个补充脚本。

运行：

```bat
node tools\mirror-cms-media.js
```

只预览 CMS / 媒体资源、不发起下载：

```bat
node tools\mirror-cms-media.js --dry-run
```

使用指定配置文件预览：

```bat
node tools\mirror-cms-media.js --config sites/site-a.json --dry-run
```

重新检查坏缓存：

```bat
node tools\mirror-cms-media.js --retry-bad
```

长任务只看摘要：

```bat
node tools\mirror-cms-media.js --quiet
```

输出机器可读 JSON 日志：

```bat
node tools\mirror-cms-media.js --json-log
```

下载过程也会默认追加到：

```text
logs/mirrorkit-tools.log
```

这个脚本也读取 `mirror.config.json`：

```json
{
    "cmsMediaHost": "https://storage.example.com/example-bucket"
}
```

如果新网站没有 CMS / 远程媒体桶，不用跑这个。

如果新网站有类似的远程媒体桶，就把 `cmsMediaHost` 改成对应地址。

下载完整结束后，它会在镜像目录写入：

```text
.mirror-manifest-cms.json
```

这个文件记录 CMS / 媒体补充下载的资源列表、文件大小、SHA-256 摘要和统计数据。

### 6. tools\find-video-refs.js

用途：查本地文本文件里有没有视频链接。

运行：

```bat
node tools\find-video-refs.js
```

它只查引用，不下载。

能帮你判断视频链接藏在哪个文件里。

### 7. tools\logs.js

用途：查看和汇总本地日志。

它默认读取：

```text
logs/mirrorkit-server.log
logs/mirrorkit-server.log.1
logs/mirrorkit-tools.log
logs/mirrorkit-tools.log.1
```

运行：

```bat
node tools\logs.js
```

只看指定日志文件：

```bat
node tools\logs.js logs\mirrorkit-server.log
```

机器可读输出：

```bat
node tools\logs.js --json
```

限制展示数量：

```bat
node tools\logs.js --limit 50
```

### 8. tools\status.js

用途：一键汇总当前项目状态。

它会同时检查：

```text
doctor 运行前诊断
镜像目录是否存在
坏缓存数量
manifest 是否存在并匹配当前文件
日志是否能解析
日志里是否有 error / warn
```

输出里会带 Suggested next steps，直接给出下一步该运行的命令。
如果镜像、manifest 和日志都正常，它会建议运行 `tools\export-standalone.js --check` 导出独立离线项目。

运行：

```bat
node tools\status.js
```

机器可读输出：

```bat
node tools\status.js --json
```

限制日志摘要数量：

```bat
node tools\status.js --log-limit 50
```

### 9. tools\report.js

用途：生成镜像目录报告。

它会统计：

```text
文件总数
总字节数
文件类型分布
坏缓存数量
manifest 完成记录
manifest 文件摘要
进度文件
最大文件列表
```

运行：

```bat
node tools\report.js
```

指定目录：

```bat
node tools\report.js xxx.com
```

机器可读输出：

```bat
node tools\report.js --json
```

### 10. tools\verify-manifest.js

用途：校验 manifest 记录的文件快照是否仍然匹配当前镜像目录。

它会检查：

```text
manifest 里记录但本地缺失的文件
本地存在但大小或 SHA-256 已变化的文件
manifest 没记录但本地额外出现的文件
```

运行：

```bat
node tools\verify-manifest.js
```

指定 CMS / 媒体 manifest：

```bat
node tools\verify-manifest.js --cms
```

机器可读输出：

```bat
node tools\verify-manifest.js --json
```

### 11. tools\export-standalone.js

用途：把当前镜像导出成一个独立离线本地项目。

导出的文件夹会包含：

```text
server.js
package.json
README.md
start-windows.bat
start.sh
mirror.config.json
<mirrorName>/
```

导出时会重建 `<mirrorName>/.mirror-manifest.json`，用于导出项目自己的完整性自检。

它不会包含：

```text
tools/
lib/
tests/
MirrorKit 爬虫脚本
```

运行：

```bat
node tools\export-standalone.js --config sites/site-a.json
```

指定输出目录：

```bat
node tools\export-standalone.js --config sites/site-a.json --out exports\site-a-offline
```

也可以导出到项目外的绝对路径，例如桌面、移动硬盘或 U 盘：

```bat
node tools\export-standalone.js --config sites/site-a.json --out D:\offline-sites\site-a
```

如果要覆盖已有导出目录：

```bat
node tools\export-standalone.js --config sites/site-a.json --out exports\site-a-offline --force
```

为了避免误删，`--force` 只会覆盖空目录或之前由 MirrorKit standalone 导出生成过的目录；不会覆盖普通工作目录、项目根目录或源镜像目录。

导出后立即运行独立项目自检：

```bat
node tools\export-standalone.js --config sites/site-a.json --check
```

进入导出的文件夹后，直接运行：

Windows 双击或运行：

```bat
start-windows.bat
```

macOS / Linux 运行：

```sh
sh start.sh
```

这两个启动脚本会先运行离线自检，通过后才启动本地服务。

如果默认端口被占用，启动脚本会自动尝试下一个可用端口。

也可以手动运行：

```bat
node server.js
```

手动运行时也可以启用自动端口：

```bat
node server.js --auto-port
```

导出项目也可以自己做离线自检：

```bat
node server.js --check
npm run check
```

自检会校验入口文件，并用导出时生成的 manifest 检查文件大小和 SHA-256；manifest 缺失或文件不匹配都会失败。

查看导出项目自己的命令帮助：

```bat
node server.js --help
```

导出项目也会把运行日志写到自己的文件夹里：

```text
logs/mirrorkit-standalone.log
```

这个日志同样会在超过 5 MB 后轮转。

导出的项目只读本地文件，不会继续爬取远程资源。

导出项目支持本地二进制文件的 Range 分段读取，视频离线播放和拖动进度条会更稳定。

### 12. tools\validate-assets.js

用途：检查本地资源有没有坏缓存。

运行：

```bat
node tools\validate-assets.js
```

它默认检查当前 `mirrorName` 对应的镜像文件夹。也可以指定目录：

```bat
node tools\validate-assets.js xxx.com
```

如果要读取另一份配置里的 `mirrorName`：

```bat
node tools\validate-assets.js --config sites/site-a.json
```

它会检查有没有把 HTML 错误页误保存成图片、JSON、字体等资源。

## 三、推荐流程

### 普通网站

```bat
npm run check
node tools\doctor.js --config sites/site-a.json
node tools\status.js --config sites/site-a.json
node tools\mirror-assets.js --config sites/site-a.json --dry-run
node tools\mirror-assets.js --config sites/site-a.json
node tools\verify-manifest.js --config sites/site-a.json
node tools\report.js --config sites/site-a.json
node tools\export-standalone.js --config sites/site-a.json --check
```

然后进入导出的文件夹，运行 `start-windows.bat` 或 `sh start.sh`，再打开：

```text
http://localhost:3000/
```

### 有隐藏视频 / CMS 数据的网站

```bat
npm run check
node tools\doctor.js --config sites/site-a.json
node tools\status.js --config sites/site-a.json
node tools\mirror-assets.js --config sites/site-a.json --dry-run
node tools\mirror-assets.js --config sites/site-a.json
node tools\mirror-cms-media.js --config sites/site-a.json --dry-run
node tools\mirror-cms-media.js --config sites/site-a.json
node tools\verify-manifest.js --config sites/site-a.json
node tools\verify-manifest.js --config sites/site-a.json --cms
node tools\report.js --config sites/site-a.json
node tools\export-standalone.js --config sites/site-a.json --check
```

然后进入导出的文件夹，运行 `start-windows.bat` 或 `sh start.sh`，再打开：

```text
http://localhost:3000/
```

### 只想边打开边自动补资源

直接启动服务器：

```bat
node server.js
```

然后在网页里操作、滚动、进入详情页。

服务器看到缺失资源，会自动下载。

注意：如果网页里的地址是完整外链，例如：

```text
https://cdn.xxx.com/a.mp4
```

服务器会把它改成本地镜像路径：

```text
/xxx.com/cdn.xxx.com/a.mp4
```

这样浏览器会先问本地服务器，本地没有时才去远程缓存。

## 四、什么时候需要改更多规则

一般只改：

```text
TARGET_HOST
MIRROR_NAME
START_PATH
```

只有下面情况才改别的。

### 1. 缺少某种扩展名

位置：

```text
lib/constants.js
```

改：

```js
const ASSET_EXTS = [
    ...
];
```

例如网站有：

```text
.glb
.gltf
.pdf
.m3u8
.ts
.m4s
```

就加进去。

### 2. 有特殊 CMS / 远程媒体桶

改 `mirror.config.json`：

```json
{
    "cmsMediaHost": "https://storage.example.com/example-bucket"
}
```

### 3. 有多个入口页

位置：

```text
tools/mirror-assets.js
```

改：

```js
const SEED_URLS = [
    START_PATH,
    '/about',
    '/work',
    '/contact'
];
```

### 4. 某些路径带点但不是域名

改 `mirror.config.json`：

```json
{
    "sitePathPrefixes": ["content", "etc.clientlibs", "experiment", "webui", "auth", "graphql"]
}
```

例如：

```text
/etc.clientlibs/xxx.js
```

虽然有点，但它是站内路径，不是远程域名。

## 五、重新扒一个网站

如果想清掉当前镜像重新下载：

1. 关闭服务器窗口。
2. 删除当前镜像文件夹，例如：

```text
xxx.com/
```

3. 确认配置正确：

```text
mirror.config.json
```

4. 重新运行：

```bat
node tools\mirror-assets.js
node server.js
```

如果需要隐藏媒体：

```bat
node tools\mirror-cms-media.js
```


## 六、常见问题

### 1. 打开页面变成下载文件

通常是无扩展名页面没有保存成 `index.html`。

现在服务器会把这种路径：

```text
/about
```

保存成：

```text
<MIRROR_NAME>/about/index.html
```

### 2. 视频已经下载，本地断网还是播不了

通常是网页还在请求外网完整地址。

现在服务器会把外链改成本地镜像路径。如果改完后仍然不行：

```text
重启服务器
Ctrl + F5 强制刷新页面
确认视频文件确实在镜像文件夹里
确认浏览器请求返回的是本地地址；本地视频文件支持 Range 分段读取
```

### 3. 日志出现 Rejected unexpected content

意思是远程返回的内容不像目标资源。

例如请求的是：

```text
.jpg
.js
.json
```

但远程实际返回：

```text
text/html
```

这通常是 404、跳转页、fallback 页面。脚本拒绝缓存是正常保护。

### 4. 菜单、轮播、弹窗点不开

先确认：

```text
改完 server.js 后重启服务器
浏览器 Ctrl + F5 强制刷新
打开控制台看 JS 报错
```

注意：不要粗暴重写整个 JS。现在服务器只做外链前缀替换，避免破坏压缩 JS。

## 七、编码注意

所有包含中文注释的文件都保持 UTF-8。

不要用 PowerShell 重定向写中文文件，例如：

```bat
echo 中文 > README.md
```

这种方式容易把中文写坏。
