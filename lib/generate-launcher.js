const fs = require('fs');
const path = require('path');

// UTF-8 BOM — cmd.exe 需要 BOM 才能正确识别 UTF-8 编码的 bat 文件
const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

function generateLauncher(rootDir, config) {
    const mirrorName = config.mirrorName;
    const entryPath = config.startPath === '/'
        ? `/${mirrorName}/`
        : `/${mirrorName}${config.startPath.startsWith('/') ? config.startPath : `/${config.startPath}`}`;
    const forwardCookies = config.forwardCookies === true;

    const lines = [
        '@echo off',
        'chcp 65001 >nul',
        `title ${mirrorName} - MirrorKit 离线镜像`,
        'cd /d "%~dp0"',
        '',
        'where node >nul 2>nul',
        'if errorlevel 1 (',
        '    echo  [错误] 未找到 Node.js，请先安装 Node.js 18+ https://nodejs.org/',
        '    pause',
        '    exit /b 1',
        ')',
        '',
        'cd /d "%~dp0.."',
        '',
        'echo.',
        'echo   ═══════════════════════════════════════',
        `echo    ${mirrorName} 离线镜像`,
        'echo   ═══════════════════════════════════════',
        'echo.',
        `echo   目标站点: ${config.targetHost}`,
        'echo.',
    ];

    if (forwardCookies) {
        lines.push(
            'echo   [Cookie 模式] 已启用登录态转发',
            'echo.',
            'echo   使用步骤:',
            'echo     1. 服务器启动后，浏览器会自动打开镜像页面',
            'echo     2. 在浏览器中登录目标网站',
            'echo     3. 登录成功后，运行 node tools/mirror-assets.js',
            'echo     4. 爬虫会自动使用浏览器中保存的登录 Cookie',
            'echo.',
            'echo   注意: 爬取过程中请保持服务器运行',
            'echo         服务器会自动捕获并更新 Cookie',
            'echo.',
        );
    }

    lines.push(
        'echo   正在启动服务器...',
        'echo.',
        '',
        'start "MirrorKit" /min cmd /c "cd /d \"%cd%\" && node server.js --auto-port"',
        '',
        'set RETRY=0',
        ':wait',
        'timeout /t 1 /nobreak >nul',
        'set /a RETRY+=1',
        'if exist .port (',
        '    set /p PORT=<.port',
        '    if defined PORT goto :open',
        ')',
        'if %RETRY% geq 20 goto :fail',
        'echo   等待服务器就绪... (%RETRY%/20)',
        'goto :wait',
        '',
        ':fail',
        'echo   [错误] 服务器启动超时。',
        'echo   请手动运行: node server.js --auto-port',
        'pause',
        'exit /b 1',
        '',
        ':open',
        `start http://localhost:%PORT%${entryPath}`,
        'echo.',
        'echo   ═══════════════════════════════════════',
        `echo    镜像地址: http://localhost:%PORT%${entryPath}`,
        'echo    关闭此窗口即可停止服务器',
        'echo   ═══════════════════════════════════════',
        'echo.',
        'pause >nul',
        ''
    );

    const script = lines.join('\r\n');
    const mirrorDir = path.join(rootDir, mirrorName);
    fs.mkdirSync(mirrorDir, { recursive: true });
    const filePath = path.join(mirrorDir, '启动.bat');
    // BOM + UTF-8，cmd.exe 才能正确显示中文
    fs.writeFileSync(filePath, Buffer.concat([BOM, Buffer.from(script, 'utf8')]));
    return filePath;
}

module.exports = { generateLauncher };
