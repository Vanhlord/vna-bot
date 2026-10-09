<div align="center">

# 🎵 VNA Music Bot (Commercial Lightweight Edition)

**Bot Nghe Nhạc Discord Tinh Gọn • Luồng Kép Hybrid (play-dl + yt-dlp) • Treo Phòng Voice 24/7 • Tìm Kiếm Tự Động Autocomplete**

[![Discord.js](https://img.shields.io/badge/Discord.js-v14.17-blue.svg?logo=discord)](https://discord.js.org/)
[![NodeJS](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg?logo=node.js)](https://nodejs.org/)
[![Audio Engine](https://img.shields.io/badge/Audio%20Engine-play--dl%20%2B%20yt--dlp-orange.svg)](https://github.com/yt-dlp/yt-dlp)
[![License](https://img.shields.io/badge/License-MIT-brightgreen.svg)](LICENSE)

</div>

---

## 🌟 Tính Năng Chính (Core Features)

- 🎵 **Lệnh `/play` Siêu Tốc & Thông Minh:**
  - Tự động gợi ý tên bài hát khi đang gõ (Live Search Autocomplete).
  - Hỗ trợ link YouTube, Spotify track/album/playlist công khai và tìm kiếm từ khóa.
  - Spotify không cần API key: bot đọc metadata playlist rồi tự ghép từng bài với
    bản YouTube phù hợp theo tên, nghệ sĩ và thời lượng để phát âm thanh.
  - Giao diện Embed hiển thị thanh tiến trình `▰▰▰▱▱▱`, ảnh bìa HD và người yêu cầu.
- 🔒 **Treo Phòng Voice 24/7 Bất Tử (`/join`, `/treo`):**
  - Bot tự động ở lại trong phòng voice 24/7.
  - Tự động ghi nhớ và kết nối lại phòng cũ khi bot hoặc VPS khởi động lại.
- 🚀 **Engine Luồng Kép Zero-Lag:**
  - Kết hợp `play-dl` + `yt-dlp-exec` + `ffmpeg-static` (không lo lỗi 403 / chặn IP).

---

## 📜 Danh Sách Lệnh (Command List)

| Lệnh Slash | Mô tả chi tiết |
| :--- | :--- |
| **`/play <bài hát hoặc link>`** | Tìm và phát bài hát ngay lập tức (có gợi ý tìm kiếm). |
| **`/join [kênh voice]`** | Cho bot tham gia vào phòng voice và kích hoạt treo 24/7. |
| **`/treo <on / off>`** | Bật hoặc tắt chế độ treo phòng 24/7 cho server. |
| **`/skip`** | Bỏ qua bài hiện tại và tự động chuyển sang bài tiếp theo. |
| **`/leave`** | Cho bot rời voice và tắt chế độ treo 24/7. |

---

## 🚀 Hướng Dẫn Cài Đặt (Quick Start)

### 1️⃣ Yêu Cầu:
* **Node.js** phiên bản `18.0.0` trở lên.

### 2️⃣ Cài Đặt & Cấu Hình:
```bash
# 1. Cài đặt thư viện
npm install

# 2. Tạo file .env và điền Token bot
cp .env.example .env
```

### 3️⃣ Khởi Động:
* Windows: Bấm đúp **`start.bat`** (hoặc `npm start`).
* Linux / VPS: Chạy `./start.sh` (hoặc `npm start`).

---

## 📄 Bản Quyền & Giấy Phép
Dự án được phát hành theo giấy phép **MIT License**. Tự do sử dụng và tùy biến cho cộng đồng! 🎉
