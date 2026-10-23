# BatchPilot

Chrome extension (MV3) chạy batch prompt và workflow node trên **Google Flow, ChatGPT, Grok**, dùng chính các tab bạn đã đăng nhập. Không cần server và không thu thập dữ liệu. Phần phân tích bản gốc nằm trong [ANALYSIS.md](ANALYSIS.md).

## Cài đặt
1. Mở `chrome://extensions` và bật **Developer mode**.
2. Bấm **Load unpacked** rồi chọn thư mục `D:\ai\batchpilot`.
3. Bấm icon BatchPilot trên thanh công cụ để mở side panel.

## Dùng
- **Batch**
  - Chọn nền tảng, dán prompt (mỗi prompt cách nhau một dòng trống, hoặc chọn "Mỗi dòng 1 prompt"), thêm ảnh tham chiếu nếu cần.
  - Bấm **Thêm vào hàng đợi & chạy**.
  - Giữ side panel mở trong lúc chạy. Kết quả được tải về `Downloads/batchpilot/<nền tảng>/`.
  - **Flow:** mở sẵn một project (`flow.google.com/project/...`) và chọn model, tỉ lệ, số lượng ngay trong Flow.
  - **ChatGPT / Grok:** mỗi job mở một trang mới.
- **Workflow**
  - Mở bằng tab Workflow → **Mở Workflow Editor**.
  - Thêm node từ cột trái, kéo từ chấm phải sang chấm trái để nối hai node.
  - Trong prompt, viết `@slug` để chèn text của node Prompt, hoặc gắn ảnh của node Ảnh/kết quả. Ảnh được đánh số `[image N]` trong prompt.
  - Nút ⏻ để tắt một node. Workflow lưu trong trình duyệt và có thể xuất/nhập JSON.
- **Motion Control** (thay nhân vật vào video viral, chạy hoàn toàn trên Flow giống mẫu của TobyFlow)
  - Workflow Editor → **Mẫu: Motion Control**. Chọn ảnh ở node `model` (mặt + dáng) và `outfit`, chọn một hoặc nhiều video ở node `source`, rồi bấm **Chạy workflow**.
  - Node `sheet` tạo character sheet ở chế độ Ảnh của Flow. Node `motion` chạy ở chế độ Video · Ingredients, mỗi video nguồn một lần, với ảnh sheet và video đó làm ingredient. Node `save` tải kết quả về `Downloads/batchpilot/Motion Control/`, tên file theo tên video nguồn.
  - BatchPilot tự chuyển chế độ Ảnh/Video của Flow nếu nhận ra được popover cài đặt; nếu không, lỗi sẽ ghi rõ để bạn chuyển tay. Trong Flow nên đặt 1 kết quả cho mỗi prompt.
  - Video không được lưu cùng workflow (quá nặng), mở lại thì chọn lại. Mỗi video tối đa 45 MB.
  - Chỉ dùng nhân vật bạn có quyền dùng. Video gốc thuộc bản quyền của người đăng.
- **Telegram:** điền bot token trong Cài đặt, điền Chat ID trong node.
- **Chạy nền:** trên Flow, nút gửi được bấm bằng chính handler của trang (giống TobyFlow), nên tab/cửa sổ Flow có thể bị che hoặc thu nhỏ. Nếu cách đó không được, BatchPilot dùng click thật qua quyền `debugger` (thanh "đang gỡ lỗi trình duyệt" hiện thoáng qua, đừng bấm Hủy), cách này cần cửa sổ Flow đang hiển thị.

## Khi một site đổi giao diện
Selector mặc định là phỏng đoán ổn định nhất hiện có, **chưa được kiểm chứng trên tài khoản thật**. Nếu một bước bị lỗi (không tìm thấy ô nhập, nút gửi không phản hồi…), vào **Cài đặt → Selector tùy chỉnh** và ghi đè selector cho site đó, ví dụ:

```json
{ "flow": { "submit": ["button[aria-label='Create']"] },
  "chatgpt": { "editor": "#prompt-textarea" } }
```

Các key dùng được: `editor`, `submit`, `fileInput` (cả 3 site), `stop`, `assistant` (ChatGPT), `captcha` (Flow).

Không tự sửa được thì mở đúng chỗ bị lỗi trên trang (vd. bấm mở popover cài đặt của Flow), vào **Cài đặt → Chụp cấu trúc trang** và dán nội dung đã copy cho dev.

## Kiểm tra
`node test/core.test.js` kiểm tra phần logic thuần: tách prompt, tên file, thứ tự topo, @mention, phân phối ảnh tham chiếu, chia job theo video cho Motion Control.
