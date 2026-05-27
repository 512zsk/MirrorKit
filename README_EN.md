# MirrorKit User Guide

[中文](README.md) | [English](README_EN.md)

## License

This project is licensed under the GNU Affero General Public License v3.0 or later.

```text
SPDX-License-Identifier: AGPL-3.0-or-later
```

You may copy, distribute, and modify this project, but modified versions must also be released under the same license.

If you deploy a modified version as a network service for others to use, you must also provide the corresponding source code to those users.

Important: this license only covers the MirrorKit tool code. It does not cover third-party website assets downloaded with this tool.

## Disclaimer

This project is for learning, research, technical study, and local testing only. Do not use it for any illegal or unauthorized purpose.

MirrorKit is a local research tool that simulates a mirror site. It is not a complete copy of any target website and is not affiliated with any target website.

All resources downloaded with this tool are for personal research and local testing only. Without authorization, do not re-upload, publish, redistribute, commercialize, or use downloaded resources to operate a public mirror site. Those actions may violate copyright law or other laws.

Users are responsible for checking the copyright, terms of service, access rules, and applicable laws for any target website. Do not use this project for unauthorized copying, redistribution, commercial use, access-control bypassing, privacy violations, attacks, or other improper behavior.

Any risk, loss, legal liability, or third-party dispute caused by using this project is the user's own responsibility. The project author assumes no liability.

MirrorKit is a local website mirror framework.

Core rule:

```text
Try local files first
If missing, request the remote site
If the request succeeds, cache it locally
Future visits read from local files
```

The outer `index.html` is only a starter page. It does not store the target website homepage. Target website files are saved inside a separate mirror folder, for example:

```text
project-folder/
├─ index.html
├─ server.js
├─ tools/
└─ example-site.com/
   ├─ index.html
   ├─ assets/
   └─ ...
```

The outer project folder name can be changed freely.

## 0. Requirements

Install:

```text
Node.js 18 or newer
A modern browser, such as Chrome, Edge, or Firefox
```

Why:

```text
server.js and the scripts in tools/ run with Node.js
Remote resources are downloaded with the built-in Node.js fetch API
fetch is built into Node.js starting from Node.js 18
```

Check your Node.js version:

```bat
node -v
```

These versions are fine:

```text
v18.x.x
v20.x.x
v22.x.x
```

This project has no npm package dependencies. You do not need to run:

```bat
npm install
```

Run directly:

```bat
npm start
```

Or:

```bat
node server.js --auto-port
```

Or double-click:

```text
一键启动服务器.bat
```

This interactive menu provides 9 options:

```text
[1] Quick start (auto-open browser)
[2] Start server only (no browser)
[3] Pre-download all resources then start
[4] Resume interrupted download then start
[5] Start on a custom port
[6] Pre-download only (no server)
[7] Run health check
[8] View downloaded resource statistics
[9] Export standalone offline package
```

The menu reads `mirror.config.json` to display the current mirror name and target site.

Additionally, every time the server starts or a crawl begins, `lib/generate-launcher.js` auto-generates a simplified `启动.bat` inside each mirror folder. Double-clicking it opens that site's offline mirror directly — no menu selection needed.

## 1. How To Change The Target Website

Usually you only need to edit:

```text
mirror.config.json
```

`server.js` and the scripts in `tools/` read the same config file. Environment variables have the highest priority.

If you maintain multiple target sites, keep multiple config files:

```text
mirror.config.json
sites/site-a.json
sites/site-b.json
```

Run with a selected config:

```bat
node server.js --config sites/site-a.json
node tools\mirror-assets.js --config sites/site-a.json --dry-run
node tools\mirror-assets.js --config sites/site-a.json
```

Common config example:

```json
{
    "port": 3000,
    "autoPort": true,
    "targetHost": "https://example.com",
    "mirrorName": "example.com",
    "startPath": "/",
    "maxDownloadBytes": 268435456
}
```

### TARGET_HOST

The source website origin. Use protocol plus domain only. Do not include the final `/`.

```json
{
    "targetHost": "https://example.com"
}
```

Change it to your target site:

```json
{
    "targetHost": "https://www.xxx.com"
}
```

### MIRROR_NAME

The local folder name for downloaded files.

```json
{
    "mirrorName": "example.com"
}
```

For example:

```json
{
    "mirrorName": "xxx.com"
}
```

Downloaded files will be saved into:

```text
project-folder/xxx.com/
```

### START_PATH

The entry path of the target site.

If the entry is:

```text
https://www.xxx.com/
```

use:

```json
{
    "startPath": "/"
}
```

If the entry is:

```text
https://www.xxx.com/zh
```

use:

```json
{
    "startPath": "/zh"
}
```

Open the mirror with:

```text
http://localhost:3000/<MIRROR_NAME><START_PATH>
```

Examples:

```text
http://localhost:3000/xxx.com/
http://localhost:3000/xxx.com/zh
```

### AUTO_PORT

Whether the server should try the next available port when the configured port is busy.

```json
{
    "autoPort": true
}
```

Keeping this enabled is recommended, especially for double-click startup and non-technical users.

### MAX_DOWNLOAD_BYTES

Maximum size, in bytes, for a single remote resource that MirrorKit will cache.

```json
{
    "maxDownloadBytes": 268435456
}
```

The default is 256 MB. Resources above this limit are rejected and are not
written into the local mirror.

MirrorKit is intended for local research of page structure, styling, scripts,
and necessary display assets. It is not intended to bulk-copy large third-party
videos or complete media libraries.

You can temporarily override the limit with an environment variable:

```bat
set MIRROR_MAX_DOWNLOAD_BYTES=104857600
```

## 2. Tools

All helper scripts are in `tools/`.

### tools\check.js

Runs the aggregate project check.

It runs:

```text
doctor preflight diagnostics
tool / lib / test script syntax checks
package.json and mirror.config.json parse checks
full node:test suite
```

Run:

```bat
npm run check
```

Quick check without the full test suite:

```bat
node tools\check.js --quick
```

Machine-readable output:

```bat
node tools\check.js --json
```

The same checks also run in GitHub Actions:

```text
.github/workflows/check.yml
```

It runs `npm run check` on Node.js 18, 20, and 22 to catch cross-version issues early.

### tools\doctor.js

Runs preflight diagnostics.

It checks:

```text
Node.js version
Config validity
Required project files
Mirror folder write access
Local server port availability
```

Run:

```bat
node tools\doctor.js
```

Machine-readable output:

```bat
node tools\doctor.js --json
```

For a one-command overview, use the aggregate status command:

```bat
node tools\status.js
node tools\status.js --json
```

### server.js

Starts the local server.

It handles:

```text
Opening the local mirror
Reading local files first
Fetching missing files from the remote site
Saving fetched files locally
Rewriting external links to local mirror paths
Serving local videos and large files with byte-range requests
Rejecting remote resources above maxDownloadBytes
```

Run:

```bat
node server.js
```

In server environments where you do not want to open a browser automatically:

```bat
node server.js --no-open
```

Use a specific config file:

```bat
node server.js --config sites/site-a.json
```

If port 3000 is already in use, pass a port directly:

```bat
node server.js --port 3001
node server.js --config sites/site-a.json --port 3001
```

You can also let the server try the next available port automatically:

```bat
node server.js --auto-port
node server.js --config sites/site-a.json --auto-port
```

Or double-click:

```text
一键启动服务器.bat
```

This script checks Node.js and the project configuration before starting the local server with automatic port fallback.

Then open:

```text
http://localhost:3000/
```

Scripts or monitors can check server health:

```text
http://localhost:3000/__health.json
```

It returns the current config, entry path, uptime, whether the mirror folder exists, and the server log file path.

The starter page automatically shows the current mirror entry.

### Debug Logs

The server and download tools append structured logs to `logs/`:

```text
logs/mirrorkit-server.log
logs/mirrorkit-tools.log
```

These files are newline-delimited JSON. Each line is one event, which helps trace failed URLs, rejected cache writes, port fallback, and interrupted jobs.

Watch live server logs:

```bat
node server.js --auto-port
```

Choose a log file:

```bat
node server.js --log-file logs\site-a-server.log
node tools\mirror-assets.js --log-file logs\site-a-tools.log
```

Disable file logging:

```bat
set MIRRORKIT_LOG_FILE=0
```

Logs rotate to `.1` after 5 MB by default, which prevents long-running sessions from filling the disk. Change the limit with:

```bat
set MIRRORKIT_LOG_MAX_BYTES=10485760
```

`--json-log` still prints machine-readable events to stdout for pipelines and scripts:

```bat
node tools\mirror-assets.js --json-log
```

Quickly summarize recent logs, errors, and warnings:

```bat
node tools\logs.js
node tools\logs.js --json
```

### tools\mirror-assets.js

General batch downloader.

Good for ordinary website resources:

```text
HTML
CSS
JS
JSON
Images
Fonts
Normal video files
wasm
Compressed textures
```

The downloader respects `maxDownloadBytes`. Oversized resources are marked as
rejected and are not written into the local mirror.

Run:

```bat
node tools\mirror-assets.js
```

Preview planned resources without downloading anything:

```bat
node tools\mirror-assets.js --dry-run
```

Preview with a specific config file:

```bat
node tools\mirror-assets.js --config sites/site-a.json --dry-run
```

Retry bad cache files:

```bat
node tools\mirror-assets.js --retry-bad
```

If you stop with Ctrl + C, progress is saved. Continue later with:

```bat
node tools\mirror-assets.js --resume
```

For long runs, print only summaries:

```bat
node tools\mirror-assets.js --quiet
```

Print machine-readable JSON logs for scripts:

```bat
node tools\mirror-assets.js --json-log
```

The same run is also appended by default to:

```text
logs/mirrorkit-tools.log
```

Run this first after changing the target website.

After a full completed run, it writes this file into the mirror folder:

```text
.mirror-manifest.json
```

The manifest records the tool, completion time, resource list, file sizes, SHA-256 hashes, and run statistics so `tools\report.js` can track mirror completeness later.

### tools\mirror-cms-media.js

Supplemental downloader for hidden media.

Some websites do not write videos and images directly in HTML. They may be hidden in:

```text
CMS JSON
Remote storage buckets
Cache-versioned app files
Runtime data files
```

In those cases, `mirror-assets.js` may not discover everything. Run this supplemental script.

Run:

```bat
node tools\mirror-cms-media.js
```

Preview CMS/media resources without downloading anything:

```bat
node tools\mirror-cms-media.js --dry-run
```

Preview with a specific config file:

```bat
node tools\mirror-cms-media.js --config sites/site-a.json --dry-run
```

Retry bad cache files:

```bat
node tools\mirror-cms-media.js --retry-bad
```

For long runs, print only summaries:

```bat
node tools\mirror-cms-media.js --quiet
```

Print machine-readable JSON logs:

```bat
node tools\mirror-cms-media.js --json-log
```

The same run is also appended by default to:

```text
logs/mirrorkit-tools.log
```

This script also reads `mirror.config.json`:

```json
{
    "cmsMediaHost": "https://storage.example.com/example-bucket"
}
```

If the new site does not use a CMS or remote media bucket, you do not need this script.

If the new site has a similar media bucket, change `cmsMediaHost`.

After a full completed run, it writes this file into the mirror folder:

```text
.mirror-manifest-cms.json
```

The manifest records the CMS/media supplemental resource list, file sizes, SHA-256 hashes, and run statistics.

### tools\find-video-refs.js

Finds video links inside local text files.

Run:

```bat
node tools\find-video-refs.js
```

It only searches references. It does not download files.

### tools\logs.js

Views and summarizes local logs.

By default, it reads:

```text
logs/mirrorkit-server.log
logs/mirrorkit-server.log.1
logs/mirrorkit-tools.log
logs/mirrorkit-tools.log.1
```

Run:

```bat
node tools\logs.js
```

Read a selected log file:

```bat
node tools\logs.js logs\mirrorkit-server.log
```

Machine-readable output:

```bat
node tools\logs.js --json
```

Limit displayed entries:

```bat
node tools\logs.js --limit 50
```

### tools\status.js

Provides a one-command project status overview.

It checks:

```text
doctor preflight diagnostics
whether the mirror folder exists
invalid cached asset count
whether manifests exist and match current files
whether logs can be parsed
whether logs contain error / warn events
```

The output includes Suggested next steps with the next command to run.
If the mirror, manifest, and logs are healthy, it suggests `tools\export-standalone.js --check` to export a standalone offline project.

Run:

```bat
node tools\status.js
```

Machine-readable output:

```bat
node tools\status.js --json
```

Limit log summary entries:

```bat
node tools\status.js --log-limit 50
```

### tools\report.js

Generates a mirror folder report.

It summarizes:

```text
Total files
Total bytes
File type distribution
Invalid cached asset count
Manifest completion records
Manifest file digests
Progress files
Largest files
```

Run:

```bat
node tools\report.js
```

Select a directory:

```bat
node tools\report.js xxx.com
```

Machine-readable output:

```bat
node tools\report.js --json
```

### tools\verify-manifest.js

Verifies that the file snapshot recorded in a manifest still matches the current mirror folder.

It checks:

```text
Files recorded in the manifest but missing locally
Local files whose size or SHA-256 changed
Extra local files not recorded in the manifest
```

Run:

```bat
node tools\verify-manifest.js
```

Verify a CMS/media manifest:

```bat
node tools\verify-manifest.js --cms
```

Machine-readable output:

```bat
node tools\verify-manifest.js --json
```

### tools\export-standalone.js

Exports the current mirror as a standalone offline local project.

The exported folder contains:

```text
server.js
package.json
README.md
start-windows.bat
start.sh
mirror.config.json
<mirrorName>/
```

The exporter rebuilds `<mirrorName>/.mirror-manifest.json` for the standalone project's own integrity checks.

It does not contain:

```text
tools/
lib/
tests/
MirrorKit crawler scripts
```

Run:

```bat
node tools\export-standalone.js --config sites/site-a.json
```

Choose an output folder:

```bat
node tools\export-standalone.js --config sites/site-a.json --out exports\site-a-offline
```

You can also export to an absolute path outside the project, such as a desktop folder, external drive, or USB drive:

```bat
node tools\export-standalone.js --config sites/site-a.json --out D:\offline-sites\site-a
```

Overwrite an existing export folder:

```bat
node tools\export-standalone.js --config sites/site-a.json --out exports\site-a-offline --force
```

To prevent accidental deletion, `--force` only replaces an empty directory or a directory previously created by MirrorKit standalone export. It will not replace an ordinary work folder, the project root, or the source mirror folder.

Run the standalone self-check immediately after export:

```bat
node tools\export-standalone.js --config sites/site-a.json --check
```

Inside the exported folder, run:

Windows:

```bat
start-windows.bat
```

macOS / Linux:

```sh
sh start.sh
```

Both start scripts run the offline self-check before launching the local server.

If the default port is busy, the start scripts automatically try the next available port.

You can also run the server directly:

```bat
node server.js
```

When running manually, you can enable automatic port fallback:

```bat
node server.js --auto-port
```

The exported project can also check itself offline:

```bat
node server.js --check
npm run check
```

The self-check verifies the entry file and uses the generated manifest to compare file sizes and SHA-256 hashes. It fails if the manifest is missing or mirrored files no longer match it.

Show the exported project's own command help:

```bat
node server.js --help
```

The exported project also writes runtime logs inside its own folder:

```text
logs/mirrorkit-standalone.log
```

This log also rotates after 5 MB by default.

The exported project only reads local files. It does not crawl or fetch remote resources.

The exported project supports byte-range requests for local binary files, which makes offline video playback and seeking more reliable.

### tools\validate-assets.js

Checks for bad local cached files.

Run:

```bat
node tools\validate-assets.js
```

By default, it checks the mirror folder configured by `mirrorName`. You can also pass a directory:

```bat
node tools\validate-assets.js xxx.com
```

To read `mirrorName` from another config file:

```bat
node tools\validate-assets.js --config sites/site-a.json
```

It helps detect cases where an HTML error page was accidentally saved as an image, JSON file, font, or other asset.

## 3. Recommended Workflow

### Ordinary Website

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

Then enter the exported folder, run `start-windows.bat` or `sh start.sh`, and open:

```text
http://localhost:3000/
```

### Website With Hidden Videos Or CMS Data

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

Then enter the exported folder, run `start-windows.bat` or `sh start.sh`, and open:

```text
http://localhost:3000/
```

### Lazy Cache While Browsing

Start only the server:

```bat
node server.js
```

Then browse, scroll, and open detail pages. Missing resources will be fetched and cached when the browser requests them.

If a page contains a full external URL like:

```text
https://cdn.xxx.com/a.mp4
```

the server rewrites it to:

```text
/xxx.com/cdn.xxx.com/a.mp4
```

So the browser asks the local server first. If the file is missing locally, the server fetches and caches it.

## 4. When To Change More Rules

Usually only change:

```text
TARGET_HOST
MIRROR_NAME
START_PATH
```

Change more rules only in these cases.

### Missing File Extensions

File:

```text
lib/constants.js
```

Edit:

```js
const ASSET_EXTS = [
    ...
];
```

For example, add:

```text
.glb
.gltf
.pdf
.m3u8
.ts
.m4s
```

### Special CMS Or Remote Media Bucket

Edit `mirror.config.json`:

```json
{
    "cmsMediaHost": "https://storage.example.com/example-bucket"
}
```

### Multiple Entry Pages

File:

```text
tools/mirror-assets.js
```

Edit:

```js
const SEED_URLS = [
    START_PATH,
    '/about',
    '/work',
    '/contact'
];
```

### Paths With Dots That Are Not Domains

Edit `mirror.config.json`:

```json
{
    "sitePathPrefixes": ["content", "etc.clientlibs", "experiment", "webui", "auth", "graphql"]
}
```

Example:

```text
/etc.clientlibs/xxx.js
```

It contains a dot, but it is still an internal site path, not a remote domain.

## 5. Re-Mirroring A Website

1. Close the server window.
2. Delete the current mirror folder, for example:

```text
xxx.com/
```

3. Confirm the config:

```text
mirror.config.json
```

4. Run again:

```bat
node tools\mirror-assets.js
node server.js
```

If hidden media is needed:

```bat
node tools\mirror-cms-media.js
```

## 6. FAQ

### A Page Opens As A Downloaded File

This usually means an extensionless route was not saved as `index.html`.

The server now saves a route like:

```text
/about
```

as:

```text
<MIRROR_NAME>/about/index.html
```

### Videos Were Downloaded, But Offline Playback Still Fails

Usually the page is still requesting a full external URL.

The server rewrites external links to local mirror paths. If it still fails:

```text
Restart the server
Press Ctrl + F5 in the browser
Confirm the video file exists inside the mirror folder
Confirm the browser is requesting the local mirror URL; local video files support byte-range requests
```

### Log Shows Rejected unexpected content

The remote response does not look like the requested resource.

For example, the request expects:

```text
.jpg
.js
.json
```

but the remote server returns:

```text
text/html
```

That is usually a 404 page, redirect page, or fallback page. Rejecting it is normal protection.

### Menus, Carousels, Or Modals Do Not Open

Check:

```text
Restart the server after editing server.js
Press Ctrl + F5 in the browser
Open the browser console and inspect JS errors
```

Do not rewrite the whole JS file aggressively. The server only rewrites external URL prefixes to avoid breaking minified JS.

## 7. Encoding Note

Files containing Chinese comments should stay UTF-8.

Do not write Chinese files with PowerShell redirection, for example:

```bat
echo 中文 > README.md
```

That can corrupt Chinese text.
