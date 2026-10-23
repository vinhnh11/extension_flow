# Prompt cài đặt cho AI agent

Cách dùng: clone repo này, mở một AI agent có quyền chạy lệnh trên máy (Claude Code, Codex, Hermes...) trong thư mục repo,
rồi dán nguyên phần trong khung dưới đây. Agent tự cài và kiểm tra; chỉ hỏi bạn những thứ chỉ bạn có
(đăng nhập các trang web, khoá fal.ai, Telegram...).

Repo có 2 dự án độc lập, dùng cái nào cũng được:
- `batchpilot/`: extension Chrome chạy batch prompt và workflow trên Google Flow, ChatGPT, Grok.
- `motion-control/`: công cụ Python thay nhân vật AI vào video viral (fal.ai).

---

```
Bạn là kỹ sư triển khai. Nhiệm vụ: dựng hai dự án trong repo này (batchpilot và motion-control) để chạy được y như bản gốc.
Làm tới khi kiểm tra bằng lệnh thật, đừng chỉ mô tả. Chỗ nào thiếu thì tự cài/tự sửa. Chỉ hỏi người dùng những thứ bạn không thể tự có
(liệt kê ở bước 5). Trước hết hỏi người dùng muốn cài dự án nào (cả hai, hoặc một), rồi làm đúng phần đó.

QUY TẮC AN TOÀN (bắt buộc)
- Không in, không ghi vào chat, không commit khoá/token. Khoá (FAL_KEY, Telegram bot token) chỉ nằm trong biến môi trường hoặc ô cài đặt
  của extension; không ghi vào file trong repo. File .env đã nằm trong .gitignore.
- KHÔNG gọi API tốn tiền (fal.ai) và KHÔNG tạo ảnh/video thật trên Flow, ChatGPT, Grok khi chưa được người dùng cho phép rõ ràng.
  Kiểm tra chỉ dùng test có sẵn (không gọi API thật). Nếu cần thử thật thì nói rõ chi phí/hạn mức và hỏi trước.
- Không đăng nhập thay người dùng và không yêu cầu họ gửi mật khẩu cho bạn. Họ tự đăng nhập các trang trong trình duyệt của họ.
- Trước khi xoá/ghi đè dữ liệu có sẵn (inputs/, outputs/, runs/, workflow đã lưu), hỏi người dùng.
- Chỉ dùng nhân vật do người dùng tạo hoặc người đã đồng ý; video gốc thuộc bản quyền của người đăng. Nhắc người dùng điều này một lần.

BƯỚC 1 - KIỂM TRA MÁY (tự cài nếu thiếu, hỏi trước khi cài thứ lớn)
- Google Chrome hoặc Edge (bản mới, hỗ trợ Manifest V3 và Side Panel). Kiểm bản trình duyệt.
- Node.js (bản bất kỳ gần đây) chỉ để chạy test của batchpilot. Kiểm: node -v
- Cho motion-control: Python 3.11+ (python --version) và ffmpeg có trong PATH (ffmpeg -version).
- git.

BƯỚC 2 - BATCHPILOT (extension Chrome, thư mục batchpilot/)
Extension thuần JavaScript, KHÔNG có bước build, KHÔNG cần server. Chạy trên chính các tab người dùng đã đăng nhập.
1. Chạy test logic: node batchpilot/test/core.test.js. Kết quả mong đợi: "core.test.js: all checks passed". Nếu lỗi, đọc lỗi và sửa nguyên nhân thật.
2. Kiểm manifest: batchpilot/manifest.json hợp lệ (Manifest V3, có side_panel, service worker background.js).
   Lưu ý: manifest không khai báo icon nên Chrome dùng icon mặc định; thư mục icons/ đang trống, đó là bình thường, không phải lỗi.
3. Nạp extension: Chrome không cho agent tự bấm nạp extension dạng Load unpacked qua dòng lệnh một cách đáng tin cậy, nên HƯỚNG DẪN người dùng làm tay:
   a. Mở chrome://extensions, bật Developer mode (góc phải trên).
   b. Bấm "Load unpacked", chọn thư mục batchpilot/ trong repo này (đường dẫn tuyệt đối trên máy họ, bạn hãy in sẵn đường dẫn đó).
   c. Ghim icon BatchPilot, bấm vào để mở side panel.
   Nếu người dùng đồng ý và bạn có công cụ điều khiển trình duyệt, bạn có thể hỗ trợ mở trang chrome://extensions, nhưng không thể thay họ đăng nhập.
4. Quyền extension xin (nói rõ cho người dùng trước khi họ nạp): storage, unlimitedStorage, sidePanel, tabs, scripting, downloads, debugger,
   và truy cập flow.google.com, chatgpt.com, grok.com, api.telegram.org cùng vài tên miền lưu ảnh/video. Quyền "debugger" chỉ dùng làm
   phương án dự phòng click thật khi cách click thường không được. Không có server riêng, không thu thập dữ liệu.
5. Người dùng tự đăng nhập Google Flow (flow.google.com), ChatGPT, Grok trong cùng trình duyệt. Với Flow: mở sẵn một project
   (flow.google.com/project/...) và chọn model, tỉ lệ, số lượng ngay trong Flow; nên đặt 1 kết quả cho mỗi prompt.
6. Cách dùng ngắn (đọc batchpilot/README.md để có chi tiết):
   - Tab Batch: chọn nền tảng, dán prompt (cách nhau một dòng trống, hoặc chọn "Mỗi dòng 1 prompt"), thêm ảnh tham chiếu nếu cần,
     bấm "Thêm vào hàng đợi & chạy". Giữ side panel mở trong lúc chạy. Kết quả tải về Downloads/batchpilot/<nền tảng>/.
   - Tab Workflow: Mở Workflow Editor, kéo các node, nối bằng chấm; trong prompt dùng @slug để chèn text của node khác.
   - Mẫu "Motion Control" trong Workflow Editor: chọn ảnh node model và outfit, chọn video ở node source, bấm Chạy workflow
     (chạy hoàn toàn trên Flow, không cần fal.ai).
   - Telegram (tuỳ chọn): điền bot token ở Cài đặt, Chat ID ở node. Người dùng tự tạo bot (BotFather); không nhận token qua chat.
7. Nếu một trang đổi giao diện làm bước nào đó lỗi: README nói selector mặc định CHƯA được kiểm chứng trên tài khoản thật. Hướng dẫn người dùng vào
   Cài đặt -> Selector để ghi đè bằng JSON, hoặc dùng Cài đặt -> "Chụp cấu trúc trang" rồi gửi nội dung cho người bảo trì. Đừng tự bịa selector.

BƯỚC 3 - MOTION-CONTROL (Python + fal.ai, thư mục motion-control/)
Thay nhân vật AI vào video viral, giữ chuyển động/camera/bối cảnh. Bước 1 tạo character sheet (Nano Banana qua fal.ai),
bước 2 thay người bằng Wan 2.2 Animate Replace. Chỉ phụ thuộc gói fal-client==1.0.3.
1. cd motion-control, tạo môi trường ảo: python -m venv .venv
   Cài: .venv/Scripts/pip install -r requirements.txt (Linux/macOS: .venv/bin/pip). Thư mục .venv/ không nằm trong git, phải tạo trên máy mới.
2. Chạy test không gọi API thật: .venv/Scripts/python test_run.py. Kết quả mong đợi: "test_run.py: all checks passed".
3. Tạo thư mục dữ liệu nếu chưa có (không nằm trong git): inputs/characters/<tên>/face.png (mặt + dáng, nền trơn),
   inputs/characters/<tên>/outfit.png (trang phục, phụ kiện), inputs/videos/*.mp4 (video gốc). Các thư mục outputs/ và runs/ tự tạo khi chạy.
   Prompt nằm trong prompts/ (character_sheet.txt, motion_transfer.txt), người dùng sửa thoải mái.
4. Chạy thật (CHỈ khi người dùng cho phép và đã hiểu chi phí): đặt biến môi trường FAL_KEY (PowerShell: $env:FAL_KEY="..."; bash: export FAL_KEY=...)
   rồi .venv/Scripts/python run.py. Mỗi cặp (nhân vật x video) là một job; chạy lại chỉ chạy job chưa xong; muốn làm lại thì xoá file output của job đó;
   trạng thái/lỗi nằm ở runs/state.json.
5. Biến môi trường tuỳ chọn: CONCURRENCY (mặc định 1), MAX_SECONDS (mặc định 10), RESOLUTION (480p/580p/720p, mặc định 720p),
   SHEET_MODEL (mặc định fal-ai/nano-banana/edit). Chi phí tham khảo của bản gốc: khoảng 0,08 USD mỗi giây video ở 720p (giá niêm yết có thể đổi;
   nói rõ đây là ước tính, và hãy để người dùng tự xem giá hiện tại trên fal.ai). Đặt MAX_SECONDS thấp để kiểm soát chi phí khi thử.
6. Video đầu vào quá dài tốn nhiều tiền: khuyên người dùng thử với 1 nhân vật và 1 video ngắn trước.

BƯỚC 4 - KIỂM TRA CUỐI VÀ BÀN GIAO
Chạy và báo số liệu thật: node batchpilot/test/core.test.js, motion-control test_run.py. Nói rõ phần nào chưa thử (đặc biệt: chưa chạy thật trên Flow,
ChatGPT, Grok với tài khoản của người dùng; chưa gọi fal.ai). In ngắn gọn: đường dẫn thư mục extension để Load unpacked, lệnh chạy motion-control,
và nơi người dùng cần tự điền (khoá fal.ai, Telegram, đăng nhập các trang).

BƯỚC 5 - NHỮNG THỨ CHỈ NGƯỜI DÙNG CÓ (hỏi, đừng tự bịa)
(a) đăng nhập Google Flow / ChatGPT / Grok trong trình duyệt của họ; (b) khoá FAL_KEY nếu dùng motion-control (họ tự dán vào biến môi trường);
(c) bot token Telegram nếu dùng; (d) ảnh nhân vật, ảnh trang phục, video gốc của họ; (e) lựa chọn: cài dự án nào.
```

---

## Ghi chú cho người duy trì repo

- Selector trong BatchPilot chưa kiểm chứng trên tài khoản thật; các trang có thể đổi giao diện bất kỳ lúc nào.
- BatchPilot là phiên bản tự viết lại ý tưởng của extension TobyFlow (xem `batchpilot/ANALYSIS.md`); không dùng mã hay máy chủ của TobyFlow.
- README của batchpilot còn ghi đường dẫn `D:\ai\batchpilot` (máy của chủ repo); người khác thay bằng đường dẫn thư mục `batchpilot/` trên máy mình.
- Cập nhật prompt này khi đổi cách cài đặt.
