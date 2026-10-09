# Hướng dẫn lấy YouTube Cookies (Bypass "Sign in to confirm you're not a bot")

Khi chạy bot trên VPS hoặc Hosting (Render, Railway, DigitalOcean, Heroku...), YouTube thường chặn địa chỉ IP Datacenter và bắt xác minh tài khoản (`Sign in to confirm you're not a bot`).

Để khắc phục triệt để, bạn chỉ cần xuất cookie YouTube từ trình duyệt của mình vào bot:

### Cách 1: Dùng tiện ích mở rộng trình duyệt (Khuyên dùng)
1. Cài đặt tiện ích mở rộng: **"Get cookies.txt LOCALLY"** trên trình duyệt Chrome/Edge/Firefox:
   - Chrome/Edge: [Get cookies.txt LOCALLY (Chrome Web Store)](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
2. Truy cập [https://www.youtube.com](https://www.youtube.com) và đảm bảo bạn đã đăng nhập tài khoản Google.
3. Bấm vào icon tiện ích mở rộng ở góc trên trình duyệt -> Bấm **Export** để tải về file `cookies.txt`.
4. Đặt file đó vào đúng đường dẫn này: `vna-music-bot/cookies/cookies.txt`.

### Cách 2: Dùng biến môi trường trong `.env` (Dành cho Hosting không tải file được)
1. Mở file `cookies.txt` vừa tải về bằng Notepad, copy toàn bộ nội dung.
2. Mở file `.env` (hoặc cấu hình Environment Variables trên Hosting của bạn) và dán vào:
   ```env
   YOUTUBE_COOKIE="dán toàn bộ nội dung cookies vào đây"
   ```
3. Khởi động lại bot. Bot sẽ tự động nhận diện và phát nhạc bình thường 100%!
