@echo off
chcp 65001 >nul
title MirrorKit - 离线镜像启动器
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo  [错误] 未找到 Node.js，请先安装 Node.js 18+ https://nodejs.org/
    pause
    exit /b 1
)

:menu
cls
for /f "usebackq delims=" %%a in (`node -p "require('./mirror.config.json').mirrorName"`) do set "MNAME=%%a"
for /f "usebackq delims=" %%a in (`node -p "require('./mirror.config.json').targetHost"`) do set "MHOST=%%a"

echo   ╔══════════════════════════════════════════╗
echo   ║       MirrorKit - 离线镜像启动器        ║
echo   ╚══════════════════════════════════════════╝
echo.
echo   当前镜像: %MNAME%
echo   目标站点: %MHOST%
echo.
echo   [1] 一键启动（自动打开浏览器）
echo   [2] 启动服务器（不打开浏览器）
echo   [3] 预下载全部资源后启动
echo   [4] 续传上次中断的下载后启动
echo   [5] 自定义端口启动
echo   [6] 仅预下载（不启动服务器）
echo   [7] 运行健康检查
echo   [8] 查看已下载资源统计
echo   [9] 导出独立离线包
echo   [0] 退出
echo.
echo   ─────────────────────────────────────────
set "choice=1"
set /p "choice=  请选择 [1]: "
echo.

if "%choice%"=="0" goto :quit
if "%choice%"=="1" goto :quickstart
if "%choice%"=="2" goto :serveronly
if "%choice%"=="3" goto :crawl_then_start
if "%choice%"=="4" goto :resume_then_start
if "%choice%"=="5" goto :customport
if "%choice%"=="6" goto :crawlonly
if "%choice%"=="7" goto :healthcheck
if "%choice%"=="8" goto :status
if "%choice%"=="9" goto :export
goto :menu

:: ====== [1] 一键启动 ======
:quickstart
call :launch_server "--auto-port"
call :wait_server
if errorlevel 1 goto :endpause
call :get_port
call :open_browser "http://localhost:%PORT%/"
echo   本地地址: http://localhost:%PORT%/
echo   镜像入口: http://localhost:%PORT%/%MNAME%/
call :wait_close
goto :quit

:: ====== [2] 仅启动服务器 ======
:serveronly
call :launch_server "--auto-port"
call :wait_server
if errorlevel 1 goto :endpause
call :get_port
echo   本地地址: http://localhost:%PORT%/
echo   镜像入口: http://localhost:%PORT%/%MNAME%/
call :wait_close
goto :quit

:: ====== [3] 预下载后启动 ======
:crawl_then_start
echo   正在预下载资源...
echo.
node tools\mirror-assets.js
if errorlevel 1 (
    echo.
    echo   预下载出错（部分完成不影响使用）
    echo.
    pause
)
call :launch_server "--auto-port"
call :wait_server
if errorlevel 1 goto :endpause
call :get_port
call :open_browser "http://localhost:%PORT%/"
echo   本地地址: http://localhost:%PORT%/
echo   镜像入口: http://localhost:%PORT%/%MNAME%/
call :wait_close
goto :quit

:: ====== [4] 续传下载后启动 ======
:resume_then_start
echo   正在续传上次中断的下载...
echo.
node tools\mirror-assets.js --resume
if errorlevel 1 (
    echo.
    echo   续传出错
    pause
)
call :launch_server "--auto-port"
call :wait_server
if errorlevel 1 goto :endpause
call :get_port
call :open_browser "http://localhost:%PORT%/"
echo   本地地址: http://localhost:%PORT%/
echo   镜像入口: http://localhost:%PORT%/%MNAME%/
call :wait_close
goto :quit

:: ====== [5] 自定义端口 ======
:customport
set "customport=3000"
set /p "customport=  输入端口号 [3000]: "
call :launch_server "--port %customport% --auto-port"
call :wait_server
if errorlevel 1 goto :endpause
call :get_port
call :open_browser "http://localhost:%PORT%/"
echo   本地地址: http://localhost:%PORT%/
echo   镜像入口: http://localhost:%PORT%/%MNAME%/
call :wait_close
goto :quit

:: ====== [6] 仅预下载 ======
:crawlonly
echo   正在预下载资源...
echo   下载完成后可再次运行本脚本选择启动。
echo.
node tools\mirror-assets.js
echo.
echo   预下载完成。
pause
goto :menu

:: ====== [7] 健康检查 ======
:healthcheck
echo   正在运行健康检查...
echo.
node tools\doctor.js --auto-port
echo.
pause
goto :menu

:: ====== [8] 资源统计 ======
:status
if exist "tools\status.js" (
    node tools\status.js
) else (
    echo   镜像文件夹: %MNAME%\
    if exist "%MNAME%\index.html" (
        echo   状态: 已有镜像内容
    ) else (
        echo   状态: 暂无镜像内容，需先启动服务器或预下载
    )
)
echo.
pause
goto :menu

:: ====== [9] 导出独立包 ======
:export
echo   正在导出独立离线包...
echo.
node tools\export-standalone.js
echo.
echo   导出完成。离线包在 exports\ 目录下。
pause
goto :menu

:: ====== 退出 ======
:quit
echo   再见！
exit /b 0

:endpause
pause
goto :quit

:: ============================================
::  子过程
:: ============================================

:launch_server
start "MirrorKit-Server" /min cmd /c "cd /d "%cd%" && node server.js %*"
goto :eof

:wait_server
set RETRY=0
:wait_loop
timeout /t 1 /nobreak >nul
set /a RETRY+=1
powershell -Command "try { $null = Invoke-RestMethod -Uri 'http://localhost:3000/__health.json' -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto :eof
if %RETRY% geq 20 goto :wait_fail
echo   等待服务器就绪... (%RETRY%/20)
goto :wait_loop
:wait_fail
echo.
echo   [错误] 服务器启动超时。
echo   请手动运行: node server.js --auto-port
echo.
pause
exit /b 1

:get_port
for /f "tokens=*" %%a in ('powershell -Command "(Invoke-RestMethod -Uri 'http://localhost:3000/__health.json' -TimeoutSec 3).port" 2^>nul') do set PORT=%%a
if "%PORT%"=="" set PORT=3000
goto :eof

:open_browser
start "" %~1
goto :eof

:wait_close
echo.
echo   ═══════════════════════════════════════
echo    服务器运行中... 关闭此窗口停止服务器。
echo   ═══════════════════════════════════════
echo.
pause >nul
goto :eof
