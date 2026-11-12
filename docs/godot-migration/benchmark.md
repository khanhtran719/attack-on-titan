# Benchmark Three.js và Godot Web

Đối chiếu Three.js `6836b59` với Godot 4.7.2 release Web, Compatibility và một luồng. So sánh artefact truyền mạng tách khỏi số đo frame. Vite source map, icon tùy chọn và splash ngoài phiên chơi không tính vào kích thước core.

## Kích thước build

| Thành phần | Three.js | Godot Web |
|---|---:|---:|
| JavaScript gameplay hoặc loader/adapter | 3.01 MB | 0.65 MB |
| WebAssembly runtime | Rapier được bundle trong JavaScript | 39.51 MB |
| Game pack | Assets sinh trong JavaScript | 0.85 MB PCK |
| Gzip | 1.02 MB JavaScript theo Vite | 11.02 MB toàn bộ core |

Core Godot gồm 41.02 MB chưa nén. Đo gzip từng tệp ở mức 9 gồm HTML, WASM, PCK, JS loader, bridge và hai audio worklet. Web host nên phục vụ WASM qua gzip hoặc Brotli. Thời gian tương tác còn phụ thuộc vào băng thông, decode/compile WASM, khởi tạo Godot và GPU upload.

## Training ở vị trí spawn

Chạy Chrome 157.0.8103.50 headless với ANGLE Metal Apple M1 Pro trên macOS 26.5.2. Cả hai dùng 1280 × 720, DPR 1, chất lượng mặc định và cùng màn Training khi đứng yên. Dùng hai lượt xen kẽ mỗi engine, warm-up 2.5 giây rồi đo rAF trong 6 giây. Đếm lệnh vẽ WebGL ở một phép đo 60 frame riêng. Localhost không nén HTTP, mỗi lần mở dùng browser context mới.

| Chỉ số | Three.js | Godot Web |
|---|---:|---:|
| FPS trung bình | 60.00 | 60.00 |
| 1% low | 59.52 FPS | 59.52 FPS |
| p95 / p99 frame time | 16.80 / 16.80 ms | 16.70 / 16.80 ms |
| Lệnh draw WebGL trung bình / frame | 452 | 434 |
| JS heap quan sát qua Chrome | 21.18–23.93 MB | 58.95–59.01 MB |
| Từ navigation đến menu tương tác | 275–351 ms | 1,305–1,447 ms |
| Resource bytes nhận trên localhost | 3.04 MB | 41.04 MB |

Hai engine đạt mức 60 FPS trong cảnh thử. Godot tải chậm hơn khoảng một giây trên localhost và tải nhiều dữ liệu hơn. JS heap chỉ đo heap JavaScript qua API Chrome. Tổng RAM của tiến trình, bộ nhớ tuyến tính WASM và bộ nhớ GPU cần phép đo riêng. Các mẫu ghi trước cập nhật nút restart trong lobby co-op, với cùng scene và logic render của Training.

```bash
TITAN_THREE_BUILD=/absolute/path/to/threejs/dist \
TITAN_BENCHMARK_SAMPLES=2 \
TITAN_BROWSER_ARTIFACTS=/tmp/titan-browser-qa \
node --import tsx --test --test-name-pattern=benchmark godot-client/tests/browser-smoke.test.ts
```

## Chỉ số chưa đo đủ

Chưa có đường chạy dài cùng camera/input, hiệu ứng dày, workload 4 người, 50/100/200 ms RTT hay bộ số liệu memory, draw calls và frame time qua nhiều thiết bị. So sánh đầu vào/ACK và reconnect cục bộ nằm trong test co-op, còn latency ở mạng thực chưa đo. Một benchmark nhiều thiết bị cần khóa viewport/DPR, chất lượng, route, seed và browser, chạy ít nhất 3 lần lặp và đo input correction, peak memory, cold start và RTT bên cạnh FPS.

## So sánh trước và sau đợt chỉnh đồ họa Godot

Dùng cùng đầu vào ở Training trên Chrome 157, Apple M1 Pro và viewport 1280 × 720, DPR 1. Đo thời gian khung hình qua `requestAnimationFrame` trong một lượt chạy 6,1 giây qua phố và một lượt ODM 2,25 giây cho mỗi bản. Chrome ghi nhận cấp phát renderbuffer MSAA 4× ở mức High của bản sau.

| Phép đo | Pilot trước | Sau khi chỉnh |
|---|---:|---:|
| FPS trung bình khi chạy qua phố | 60,0 | 60,0 |
| p95 frame time khi chạy qua phố | 16,8 ms | 16,7 ms |
| FPS trung bình khi dùng ODM | 60,0 | 60,0 |
| p95 frame time khi dùng ODM | 16,7 ms | 16,8 ms |
| PCK Web | 4,25 MB | 2,21 MB |

Bản sau dùng lại cùng bộ texture cho 12 căn nhà và nén bản đồ màu khi import. Ở DPR 2, kiểm tra riêng xác nhận canvas CSS 1280 × 720 có buffer 2560 × 1440 và dùng MSAA 4×. Phép đo FPS chỉ bao phủ DPR 1, ở mức trần 60 FPS của lần chạy Chrome này.
