@echo off
title VNA Music Bot - Commercial Edition
color 0b
echo ===================================================
echo       KHOI DONG VNA MUSIC BOT (COMMERCIAL)
echo ===================================================
echo.

IF NOT EXIST "node_modules" (
    echo [INFO] Phat hien chua cai dat thu vien. Dang cai dat tu dong...
    call npm install
    echo.
)

IF NOT EXIST ".env" (
    echo [WARNING] Chua tim thay file .env! Dang tao tu .env.example...
    copy .env.example .env
    echo [HUONG DAN] Ban hay mo file .env len va dien DISCORD_TOKEN vao nhe!
    echo.
    pause
)

echo [INFO] Dang khoi dong Bot Discord...
npm start
pause
