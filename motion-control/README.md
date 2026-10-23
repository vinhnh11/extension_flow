# Auto Motion Control
Thay nhân vật AI của bạn vào video viral, giữ nguyên chuyển động, camera và bối cảnh. Bước 1 tạo character sheet bằng Nano Banana, bước 2 thay người bằng Wan 2.2 Animate Replace. Cả hai chạy trên fal.ai.

**Cài đặt** (Python 3.11+, ffmpeg có trong PATH):
`python -m venv .venv` → `.venv\Scripts\pip install -r requirements.txt`

**Đặt file:**
- `inputs/characters/<ten>/face.png`: mặt + dáng người, nền trơn
- `inputs/characters/<ten>/outfit.png`: trang phục, phụ kiện
- `inputs/videos/*.mp4`: video gốc
- Prompt nằm trong `prompts/`, sửa thoải mái.

**Chạy:**
`$env:FAL_KEY="..."` rồi `.venv\Scripts\python run.py`
- Mỗi cặp (nhân vật × video) là một job. Kết quả nằm ở `outputs/<ten>/`: `sheet.png`, `<video>.mp4`, `<video>_compare.mp4`.
- Chạy lại thì chỉ chạy các job chưa xong. Muốn làm lại một job thì xóa file output của job đó. Trạng thái và lỗi của từng job nằm trong `runs/state.json`.

**Biến môi trường** (tùy chọn):
- `CONCURRENCY` (mặc định 1)
- `MAX_SECONDS` (mặc định 10)
- `RESOLUTION`: 480p / 580p / 720p (mặc định 720p, khoảng $0.08 mỗi giây video)
- `SHEET_MODEL` (mặc định `fal-ai/nano-banana/edit`)

**Kiểm tra:** `.venv\Scripts\python test_run.py`, không gọi API thật.

Chỉ dùng nhân vật do bạn tạo, hoặc người đã đồng ý. Video gốc thuộc bản quyền của người đăng.
