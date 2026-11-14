@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0" || exit /b 1
title Мой бюджет
set "HOST=127.0.0.1"
set "DATABASE_URL="

where npm.cmd >nul 2>&1 || goto node_missing
node -e "const [major,minor]=process.versions.node.split('.').map(Number); process.exit(major*100+minor < 2212 ? 1 : 0)" || goto node_missing

if not exist "node_modules\.prisma\client\index.js" (
  echo Устанавливаем зависимости...
  call npm ci || goto fail
)

set "SEED="
if not exist "prisma\budget.db" set "SEED=1"
call npm run db:migrate || goto fail
if defined SEED (
  call npm run db:seed || goto fail
)
node "server\launch-local.mjs" --check-build
if errorlevel 1 (
  call npm run build || goto fail
  node "server\launch-local.mjs" --record-build || goto fail
)

node "server\launch-local.mjs"
if errorlevel 1 goto fail
exit /b 0

:node_missing
echo Установите Node.js 22.12 или новее с npm.

:fail
echo Запуск остановлен. Подробности выше.
pause
exit /b 1
