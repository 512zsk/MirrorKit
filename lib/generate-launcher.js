const fs = require('fs');
const path = require('path');

// UTF-8 BOM — cmd.exe 需要 BOM 才能正确识别 UTF-8 编码的 bat 文件
const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

function generateLauncher(rootDir, config) {
    const mirrorName = config.mirrorName;
    const entryPath = config.startPath === '/'
        ? `/${mirrorName}/`
        : `/${mirrorName}${config.startPath.startsWith('/') ? config.startPath : `/${config.startPath}`}`;

    const script = [
        '@echo off',
        'chcp 65001 >nul',
        `title ${mirrorName} - 离线镜像`,
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
        `echo   ${mirrorName} 离线镜像`,
        `echo   目标站点: ${config.targetHost}`,
        'echo.',
        'echo   正在启动服务器...',
        'echo.',
        '',
        'start "MirrorKit" /min cmd /c "cd /d \"%cd%\" && node server.js --auto-port"',
        '',
        'set RETRY=0',
        ':wait',
        'timeout /t 1 /nobreak >nul',
        'set /a RETRY+=1',
        'powershell -Command "try { $null = Invoke-RestMethod -Uri \'http://localhost:3000/__health.json\' -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1',
        'if not errorlevel 1 goto :open',
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
        'for /f "tokens=*" %%a in (\'powershell -Command "(Invoke-RestMethod -Uri \'http://localhost:3000/__health.json\' -TimeoutSec 3).port" 2^>nul\') do set PORT=%%a',
        'if "%PORT%"=="" set PORT=3000',
        `start http://localhost:%PORT%${entryPath}`,
        'echo.',
        'echo   ═══════════════════════════════════════',
        `echo    镜像地址: http://localhost:%PORT%${entryPath}`,
        'echo    关闭此窗口即可停止服务器',
        'echo   ═══════════════════════════════════════',
        'echo.',
        'pause >nul',
        ''
    ].join('\r\n');

    const mirrorDir = path.join(rootDir, mirrorName);
    fs.mkdirSync(mirrorDir, { recursive: true });
    const filePath = path.join(mirrorDir, '启动.bat');
    // BOM + UTF-8，cmd.exe 才能正确显示中文
    fs.writeFileSync(filePath, Buffer.concat([BOM, Buffer.from(script, 'utf8')]));
    return filePath;
}

module.exports = { generateLauncher };
