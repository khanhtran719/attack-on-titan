# Tiến độ migration

| Milestone | Kết quả |
|---|---|
| 0. Baseline | Xác lập phạm vi từ audit và mã nguồn ở `6836b59`. Three.js build thành công, Vitest 30/30. Vite báo bundle JavaScript vượt ngưỡng cảnh báo 500 kB. |
| 1. Godot và export | Godot 4.7.2 Standard, GL Compatibility, GDScript 60 tick/s. Scene chính và export Web độc lập. |
| 2. Thành phố và asset | Xuất layout từ nguồn dùng chung. Bake bốn GLB gồm skin, 48 clip và 25 socket. Test Godot đối chiếu 5 pose với Three.js trong 8 mm. |
| 3. Traversal và gameplay | Movement, camera, hai móc, gas, lock-on, kiếm, spear, các trạng thái Titan và game loop Training/Hunt. So sánh bộ giải rope với fixture TS trong sai số `1e-5`. |
| 4. Multiplayer | Hai Chrome chạy fixture GDScript/WASM đã list, create, join, ready, start, di chuyển có ACK, quick chat, bắn spear, reconnect với token và leave trước backend gốc. |
| 5. Giao diện và feedback | Control nodes cho menu, HUD, settings, map, lobby và màn kết quả. Chrome qua UI solo, lưu Settings sau reload, và lobby/match co-op thật với hai client. Restart co-op làm mới roster và ammo, hai client bắn được sau khi vào trận mới. Test phát lại snapshot tới muộn khi rời phòng và xác nhận vẫn ở menu chính. |
| 6. Chất lượng | 9 bộ test headless đạt. Web release đã chạy Chrome. macOS ZIP universal arm64/x86_64 đã xuất và mở headless. Xem benchmark và ma trận parity để đối chiếu từng đường dẫn. |

Nhánh migration được tạo trong một clone cục bộ riêng sau khi thao tác tạo nhánh trong checkout chính bị từ chối. Source Three.js, lockfile và backend ở revision gốc. Không có merge hoặc deploy.

Định nghĩa hoàn thành đầy đủ còn phụ thuộc vào các hàng chưa xác minh trong [ma trận parity](feature-parity.md) và [vấn đề còn mở](known-issues.md).
