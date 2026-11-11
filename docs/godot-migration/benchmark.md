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
