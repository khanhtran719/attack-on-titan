# Vấn đề và kiểm tra còn mở

## Tính năng và trải nghiệm

- Co-op dùng SDK Colyseus JS qua JavaScriptBridge, nên chỉ có trong Web export. macOS native hỗ trợ các mode solo.
- Giao diện Godot dùng Control nodes và world markers mới. Những phần cần đối chiếu gồm độ chi tiết marker đồng đội, scoreboard và bố cục với 4 người. Tính tương đương thẩm mỹ với giao diện HTML/CSS chưa được duyệt.
- AI solo dùng ray và hướng tránh chướng ngại trong thành phố. Cần chạy route dài ở góc phố, khi nhiều Titan đuổi cùng lúc và cả hai đợt Hunt để đánh giá kẹt đường.
- Godot và Rapier có sai khác ở contact, slide và thời điểm tích phân. Fixtures khớp công thức ODM và engine smoke qua được các ca quan trọng. Cảm giác, ổn định qua frame stall và sai số prediction thực tế còn cần đối chiếu trên cùng input trace.
- Solo Thunder Spear quét đường bay với collider mỗi tick. Toàn bộ trường hợp Titan đổi vị trí trong khi đạn bay và đo tương đương với bản Three.js còn mở.
- Save cũ được nhập khi trình duyệt chạy cùng origin và chưa có save Godot. LocalStorage ở origin khác chỉ truy cập được từ origin đó.

## Phát hành và xác nhận

- Chrome desktop đã chạy export Web. Chưa có kết quả Firefox, Safari, browser matrix nhiều độ phân giải, reconnect qua mạng WAN hay HTTPS/WSS qua proxy triển khai.
- Đã xuất macOS ZIP ad-hoc, chưa có phân phối hoặc notarization.
- Cần playtest thắng Training/Hunt và co-op đủ trận trên các thiết bị đích, gồm revive, đủ 4 người, thua/thắng/restart và audio nghe thực tế.
- Chưa có ngân sách frame, startup và memory được người phát triển phê duyệt. Xem [benchmark](benchmark.md) trước khi quyết định sử dụng Godot làm client mặc định.
- Một số lệnh headless trên sandbox macOS ghi lỗi truy cập app data và chứng thư hệ thống. Asset import, tests và exports vẫn chạy. Browser clean profile được kiểm tra riêng.
