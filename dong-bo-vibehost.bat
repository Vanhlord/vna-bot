@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title ĐỒNG BỘ CODE LÊN VIBEHOST (Vanhlord/vna-bot)
color 0B

echo ================================================================
echo    🚀 VNA MUSIC BOT - ĐỒNG BỘ CODE LÊN VIBEHOST QUA GITHUB
echo    📦 Kho lưu trữ: https://github.com/Vanhlord/vna-bot.git
echo ================================================================
echo.

cd /d "%~dp0"

:: 1. Đảm bảo Git đã khởi tạo và liên kết đúng Repo
if not exist ".git" (
    git init >nul 2>&1
    git branch -M main >nul 2>&1
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    git remote add origin https://github.com/Vanhlord/vna-bot.git
) else (
    git remote set-url origin https://github.com/Vanhlord/vna-bot.git
)

:: 2. Gom các file code thay đổi
echo [1/3] Đang kiểm tra các file thay đổi...
git add .

:: 3. Đóng gói bản cập nhật
echo [2/3] Đang đóng gói bản cập nhật...
git commit -m "Update from PC: %date% %time%" >nul 2>&1

:: 4. Đẩy lên GitHub
echo [3/3] Đang đẩy code lên GitHub (nhánh main)...
git push -u origin main
if errorlevel 1 (
    echo.
    echo ================================================================
    echo  ❌ LỖI KHI ĐẨY CODE LÊN GITHUB!
    echo  - Nếu GitHub yêu cầu đăng nhập: Hãy đăng nhập tài khoản @Vanhlord.
    echo  - Nếu repo trên GitHub đã có file sẵn: Cần đồng bộ nhánh trước.
    echo ================================================================
) else (
    echo.
    echo ================================================================
    echo  ✅ THÀNH CÔNG! Code đã được đẩy lên GitHub!
    echo  ⚡ VibeHost sẽ tự động nhận diện và cập nhật vào bot ngay!
    echo ================================================================
)

echo.
echo Nhấn phím bất kỳ để đóng cửa sổ này...
pause >nul
