# Báo cáo phân tích TobyFlow (labs.toby.vn)

Ngày phân tích: 2026-10-21 · Công cụ: REA (reverse-engineer-anything) + đọc mã đã giải nén · Bản phân tích: extension **v1.3.101**

## 1. TobyFlow thực chất là gì

| Thành phần | Vai trò |
|---|---|
| `labs.toby.vn` | Landing page (Laravel + Vite, `/build/assets/app-*.js`), gallery workflow mẫu, bảng giá, affiliate, API backend `/api/v1/*`. **Không** chứa tính năng tạo ảnh/video. |
| Chrome extension `iicjfgdnngmpfocfanpiammedafmomin` | Sản phẩm thật: tự động thao tác trên giao diện web của **Google Flow, ChatGPT, Grok, Gemini, Muse** bằng tài khoản của chính người dùng. 215 file JS (~10 MB), chỉ minify khoảng trắng, không obfuscate. |
| Extension phụ "TobyBridge" (`heieobedadlfdkppgagnhfakcdapbfka`) | Chế độ "API" cho Flow: gọi backend nội bộ của Google bằng token phiên lấy từ trình duyệt. |
| `mcp.labs.toby.vn` | MCP server đặt trên cloud. Claude Desktop gửi lệnh tới server qua `mcp-remote`, server đẩy lệnh xuống side panel qua SSE (Mercure). |

Chính trang landing cũng ghi: *"TobyFlow không tự tạo ảnh/video. Tool giúp bạn tự động hóa mọi thao tác trên các nền tảng AI đang dùng."*

**Evidence REA**
- `ev_7d38862c010c4e79d741d956284c26b08f729af3c3914ea84a16e3f51438d24d`: capture trang chủ, gồm network, accessibility và screenshot.
- `ev_986d333f43fca4a63a2e30152c1a34b95223b629f2a5f1baf10630235e1474a8`: graph tĩnh của toàn bộ extension (215 file, 0 lỗi parse).

## 2. Kiến trúc extension (MV3)

- **Side panel** (`sidebar.html` → `src/app.js`) chứa gần như toàn bộ logic: hàng đợi, executor của workflow, MCP và Telegram.
- **Service worker** (`background.js`): quản lý tab, inject script, tải file, menu chuột phải, gọi API backend.
- **Content scripts** cho từng site: `content.js` + driver cho Flow, `chat-content-{chatgpt,grok,gemini,muse}.js`, `i2p-content.js` chạy trên mọi trang.
- **Script chạy ở MAIN world trên Flow:**
  - hook `fetch`/XHR để ghép prompt với kết quả trả về từ `/_/AiSandboxAngularFrontend/data/batchexecute`;
  - bridge để click nút submit của Angular.
- **Giao tiếp:** `chrome.runtime` message dạng `{action}`, ví dụ `chatgpt:submitAndWait`, `grok:submitAndWait`, `pq:*`, `insertText`, `clickSubmit`, `waitForNewTiles`…
- **Phụ thuộc server, đây là điểm then chốt:**
  - DOM selector, text dùng để nhận diện lỗi, thông số timing, danh sách model, prompt template của các tool AI đều tải từ `labs.toby.vn/api/v1/extension-config/*` bằng request có ký bằng device key.
  - Không đăng nhập thì automation không chạy, kể cả phần "local".
  - Các tính năng còn bị khóa theo gói (`FeatureGate`).
- **Lưu trữ:**
  - `chrome.storage.local`, các key dạng `af_*`, `toby_*`;
  - IndexedDB `autoflow_pro`, `tobyflow_gen_batches`, …;
  - đồng bộ workflow, history và task lên backend.

## 3. Tính năng và cơ chế

### 3.1 Batch generate (tab Gen)

- **Nhập prompt:**
  - các prompt cách nhau bằng **dòng trống**;
  - nhập từ `.txt` thì mỗi dòng là 1 prompt, dòng bắt đầu bằng `#` là chú thích.
- **Ảnh tham chiếu:** 4 chế độ `all` / `sequential` / `none` / `mention` (`@tên`).
- **Chain:** kết quả của prompt trước làm ảnh tham chiếu cho prompt sau.
- **Nhịp chạy:**
  - delay ngẫu nhiên 3–10 giây giữa các prompt, nghỉ 5–15 giây sau mỗi 4 prompt;
  - thử lại tối đa 2 lần, prompt lỗi được đưa xuống **cuối** hàng đợi.
- **Tên file:**
  - mẫu `[Date]_[Project]_[Prompt]_[Index]`;
  - `[Prompt]` là ASCII tối đa 40 ký tự, `[Index]` có 3 chữ số;
  - lưu vào `Downloads/tobyflow_output/<task>/`.

### 3.2 Google Flow (`flow.google.com/project/<uuid>`)

- **Editor:** ProseMirror.
  - Text được đưa vào bằng `ClipboardEvent('paste')` giả lập; nếu không được thì dùng `execCommand('insertText')`.
  - Sau đó so lại nội dung trong editor để xác nhận.
- **Cài đặt** (model, tỉ lệ, số lượng, Image/Video, Frames/Ingredients, thời lượng): mở panel cài đặt rồi click theo icon/nhãn lấy từ config server, sau đó kiểm tra lại `aria-checked`/`aria-selected`.
- **Submit:**
  - giả lập chuỗi pointer events;
  - bản gốc còn gọi thẳng listener của Angular với một event được làm giả `isTrusted: true`.
- **Nhận kết quả**, kết hợp hai cách:
  - hook `batchexecute` để khớp prompt với operation/media ID (bằng fingerprint FNV-1a);
  - quét tile mỗi 300–500 ms: có media `flow-content.google/...` là xong, có `NN%` là đang chạy, có nút retry là lỗi.
- **Captcha:** phát hiện iframe reCAPTCHA thì tạm dừng.
- **Tải về:**
  - dùng menu tải xuống của chính Flow;
  - đổi tên file trong `chrome.downloads.onDeterminingFilename`.

### 3.3 ChatGPT

- **Chuẩn bị:**
  - mỗi job mở chat mới;
  - xóa ảnh/text cũ khỏi composer;
  - chọn model.
- **Ảnh tham chiếu:** gán `input.files` bằng `DataTransfer` rồi kích hoạt `change`.
- **Chế độ tạo ảnh:**
  - gõ `@` để chọn "Create image";
  - nếu không được thì thêm tiền tố "Generate an image of: " và luôn nối câu "…in X aspect ratio".
- **Nhập text và gửi:**
  - nhập text: paste → `insertText` → `innerHTML`;
  - gửi: Enter → click → `form.requestSubmit()`.
- **Nhận kết quả:**
  - poll mỗi 1 giây, lấy các `<img>` mới mà alt bắt đầu bằng "Generated image", không có class `blur-2xl` và không nằm trong form;
  - khóa theo `file_id`;
  - xong khi đã có ảnh mới và nút stop biến mất.
- **Phân loại lỗi:** `RATE_LIMIT`, `CONTENT_BLOCKED`, `TEXT_ONLY`, … bằng cách so text với mẫu lấy từ server.

### 3.4 Grok Imagine (`grok.com/imagine`)

- **Cài đặt:**
  - chọn chế độ Image/Video, chất lượng, tỉ lệ, thời lượng, độ phân giải bằng radio/menu;
  - với video thì gán vai trò cho từng ảnh tham chiếu.
- **Nhập prompt:**
  - bỏ toàn bộ ký tự `@` khỏi prompt;
  - nhập theo thứ tự paste → `insertText` → `beforeinput`.
- **Gửi:** `form.requestSubmit`.
- **Nhận kết quả:**
  - URL chuyển sang `/imagine/post/<id>`, hoặc chờ ảnh data-URI ổn định;
  - media lấy từ `assets.grok.com` / `imagine-public.x.ai`;
  - có `NN%` là đang tạo, đứng yên 90 giây thì dừng.
- Lưu checkpoint từng bước vào `chrome.storage.session` để chạy tiếp khi tab bị reload.

### 3.5 Workflow builder

- **Canvas:** dùng **Drawflow** (MIT) bọc thêm một lớp `DiagramCanvas`.
- **Node:** Google Flow, ChatGPT, Grok, Gemini, Muse, Image, Text, Prompt (AI Agent), Text Extract, Download, Wait, Telegram, Note.
- **Kiểu cổng:** text / image / video / frame / any.
- **@mention:** mỗi node có slug `^[a-z][a-z0-9_]{0,29}$`.
  - `@slug` trỏ tới node text thì được **thay bằng text** của node đó;
  - `@slug` trỏ tới node ảnh thì được **gắn làm ảnh tham chiếu**.
- **Chạy:**
  - server trả về plan theo tầng topo;
  - node bị tắt thì bỏ qua; node phía trước lỗi thì node phía sau cũng bị bỏ qua;
  - thử lại tối đa 2 lần; lưu checkpoint 10 giây/lần.
- **Lưu trữ:** workflow lưu trên backend; template được chia sẻ qua gallery.

### 3.6 Các tính năng còn lại

| Tính năng | Cách hoạt động |
|---|---|
| MCP | Relay qua cloud; các lệnh `gen_image`, `gen_video`, `run_workflow`, `run_node`, `get_context`, `upload_ref`… |
| Telegram | Liên kết tài khoản, backend gửi giúp; nhận lệnh `/image`, `/workflow` qua SSE. |
| i2p | Chuột phải vào một ảnh → tạo prompt bằng tab ChatGPT/Gemini của người dùng. |
| Prompt Assistant | Biến 1 ý tưởng thành nhiều prompt. |
| Auto CapCut | Dựng project CapCut thông qua native host. |
| Angles / Effects | Tạo prompt theo góc máy hoặc hiệu ứng. |
| Watermark remover | Xóa watermark của ảnh/video AI. |
| Albums / History | Lưu trong IndexedDB và trên backend. |

## 4. Những phần **không** đưa vào bản clone, và lý do

| Phần | Lý do |
|---|---|
| Xóa watermark ảnh/video AI | Vi phạm điều khoản của Google/xAI và có thể trái quy định về gắn nhãn nội dung AI. |
| Giả `isTrusted`, patch `EventTarget.prototype` | Là kỹ thuật lách cơ chế chống bot của trang. Bản clone chỉ dùng pointer event thường kèm `click()`. |
| Chế độ API của Flow qua TobyBridge | Gọi backend không công khai của Google bằng token phiên lấy từ trình duyệt, có rủi ro khóa tài khoản. |
| Config / selector lấy từ server TobyFlow | Là tài sản được bảo vệ của họ. Bản clone tự viết selector và cho người dùng sửa trong phần Cài đặt. |
| MCP qua cloud, đồng bộ backend, gói trả phí | Cần hạ tầng server riêng, ngoài phạm vi lần này. |
| Gemini, Muse, i2p, CapCut, Angles, Effects | Chưa làm trong lần này; có thể bổ sung sau theo cùng khung. |

## 5. Đối chiếu TobyFlow → BatchPilot

| TobyFlow | BatchPilot (`D:\ai\batchpilot`) |
|---|---|
| Batch tab: tách prompt, import `.txt`, ảnh ref all/seq/none | `sidepanel.*`: đủ cả ba (chế độ `mention` dùng trong Workflow) |
| Hàng đợi, retry xuống cuối, delay ngẫu nhiên, pause/stop | `sidepanel.js` `run()` / `runItem()` |
| Tự tải, mẫu tên `[Date]_[Prompt]_[Index]` | `lib/core.js` `buildFilename()` + `lib/runner.js` `download()` |
| Driver Flow / ChatGPT / Grok | `content/flow.js`, `content/chatgpt.js`, `content/grok.js` + helper chung `content/common.js` |
| Workflow Drawflow, slug, @mention, tắt node, bỏ qua khi node trước lỗi | `workflow.*`, thứ tự topo tính local (`topoOrder`) |
| Node Download / Delay / Telegram / Note | Có. Telegram gọi thẳng Bot API bằng token của bạn, không qua server. |
| Lưu workflow, template | `chrome.storage.local` + xuất/nhập JSON |
