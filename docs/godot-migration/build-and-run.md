# Build và chạy Titan Hunter bằng Godot

Cài Node (đã thử với Node 24), Godot **4.7.2 Standard** và bộ export templates cùng phiên bản. Chạy lệnh dưới đây từ thư mục gốc của checkout migration. [Tải engine và export templates](https://godotengine.org/download/archive/4.7.2-stable/)

```bash
npm ci
godot --editor --path godot-client
```

Chạy scene chính bằng F6 khi mở `scenes/main.tscn` hoặc F5 từ project. Native editor chạy được Training và Hunt.

## Web và co-op

```bash
GODOT_BIN=godot godot-client/tools/build.sh web
python3 -m http.server 8080 --bind 127.0.0.1 --directory godot-client/exports/web
```

Mở `http://localhost:8080` trên Chrome desktop. Để bật co-op, chạy backend ở terminal thứ hai.

```bash
npm run server
```

Trong **Co-op Operations**, nhập `http://localhost:2567` ở Server nếu phát hiện tự động không trỏ đến backend local. Tạo một phòng, mở tab/profile khác, nhập mã phòng, bấm Ready và để đội trưởng bấm Start operation.

Trên macOS, đặt `GODOT_BIN` thành đường dẫn executable bên trong `Godot.app/Contents/MacOS/Godot` nếu Godot chưa có trong PATH. Export native cho macOS dùng cùng templates.

```bash
GODOT_BIN=godot godot-client/tools/build.sh macos
```

## Điều khiển

| Phím | Hành động |
|---|---|
| WASD hoặc mũi tên, Space, Q | Di chuyển, nhảy, né |
| Chuột trái / Z, chuột phải / X | Giữ để bắn hoặc kéo dây ODM từng bên, nhả để tháo |
| Shift | Sprint trên đất, đốt gas trên không |
| Tab hoặc chuột giữa, C hoặc cuộn | Khóa Titan và chuyển vùng khóa. Nếu đặt bản đồ vào Tab, T dùng để khóa. |
| F, V, R | Chém, Thunder Spear, tiếp tế hoặc thay lưỡi |
| H hoặc dấu backtick, Esc hoặc P | Giữ để mở bản đồ chiến thuật, mở menu tạm dừng |
| G, 1–4, giữ E | Ping, quick chat, hồi sinh đồng đội trong co-op |

## Chất lượng hình ảnh

Trong **Settings → Graphics quality**, mức Low tắt MSAA và bóng, Medium dùng MSAA 2×, High dùng MSAA 4×. Cả ba mức giữ độ phân giải 3D bằng độ phân giải canvas. High tăng lọc dị hướng để chi tiết tường và mái dễ đọc hơn khi nhìn xiên.

## Kiểm thử và tạo lại dữ liệu

```bash
npm test
npm run build
GODOT_BIN=godot godot-client/tools/test.sh
node --import tsx godot-client/tools/export-game-data.ts
node --import tsx godot-client/tools/bake-rigs.mts --check
node --import tsx --test godot-client/tests/network-bridge.test.ts
node --import tsx --test godot-client/tests/network-game-ui.test.ts
node --import tsx --test godot-client/tests/browser-smoke.test.ts
```

Sau khi sửa rig gốc, chạy lại lệnh bake bỏ `--check`, rồi import lại project Godot. Để chạy fixture Colyseus qua WASM, đặt `TITAN_TEST_GODOT_BIN` và `TITAN_TEST_WEB_TEMPLATE` tới Godot và file `web_nothreads_debug.zip` từ templates. Các test networking dùng Chrome cục bộ và hỗ trợ `TITAN_TEST_CHROME_BIN`. `browser-smoke.test.ts` hỗ trợ `TITAN_CHROME_BIN`, dùng Tesseract để đọc HUD canvas, và dùng `TITAN_THREE_BUILD` để bật benchmark.

## Hosting và debug

- Phục vụ toàn bộ thư mục `exports/web` cùng origin, gồm `coop-bridge.js`, HTML, PCK, WASM và các audio worklet. Dùng `Content-Type: application/wasm` cho WASM và gzip hoặc Brotli. Web export một luồng dùng các header HTTP thông thường.
- Khi frontend và backend cùng origin, định tuyến `/api/`, `/matchmake/` và WebSocket Colyseus qua reverse proxy hiện tại. Trên HTTPS dùng WSS và cấu hình endpoint phù hợp, giữ nguyên backend. Kiểm tra host phát triển và production riêng.
- Mở Settings để bật collider, anchor, Titan zone, Nape, velocity, AI state hoặc FPS/draw calls. Kiểm tra browser console và Network cho lỗi WASM, audio, WebSocket và origin.
- CI hiện tại tiếp tục kiểm tra Three.js. Job migration có thể cài Godot đúng bản và templates, chạy `tools/test.sh`, xuất Web, rồi chạy các test Chrome against backend cục bộ. Không có bước deploy trong các script.
