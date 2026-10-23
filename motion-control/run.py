"""Auto Motion Control: put your AI character into viral videos, keeping motion, camera and scene.

Step 1  character sheet  face.png + outfit.png -> outputs/<char>/sheet.png   (Nano Banana edit, cached per character)
Step 2  motion transfer  sheet front panel + video -> outputs/<char>/<video>.mp4  (Wan 2.2 Animate Replace)
A job is one (character x video) pair. `python run.py` runs every unfinished job; delete an output to redo it.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONCURRENCY = int(os.environ.get('CONCURRENCY', '1'))
MAX_SECONDS = float(os.environ.get('MAX_SECONDS', '10'))  # Wan Replace documents no cap; 10s keeps cost predictable
RESOLUTION = os.environ.get('RESOLUTION', '720p')         # 480p | 580p | 720p
SHEET_MODEL = os.environ.get('SHEET_MODEL', 'fal-ai/nano-banana/edit')
VIDEO_MODEL = 'fal-ai/wan/v2.2-14b/animate/replace'
FPS = 16                                                  # Wan bills per 16 frames, so 30 fps input costs ~2x
USD_PER_SEC = {'480p': 0.04, '580p': 0.06, '720p': 0.08}  # fal list price, Oct 2026


def set_root(root):
    global INPUTS, OUTPUTS, PROMPTS, RUNS
    root = Path(root)
    INPUTS, OUTPUTS, PROMPTS, RUNS = root / 'inputs', root / 'outputs', root / 'prompts', root / 'runs'


set_root(ROOT)


# ---------- provider (fal.ai): change provider by rewriting these two functions ----------

def _fal():
    import fal_client  # lazy, so the smoke test runs without the package
    if not os.environ.get('FAL_KEY'):
        raise RuntimeError('FAL_KEY environment variable is not set')
    return fal_client


def generate_image(images, prompt, dest):
    fal = _fal()
    res = fal.submit(SHEET_MODEL, arguments={
        'prompt': prompt,
        'image_urls': [fal.upload_file(p) for p in images],
        'aspect_ratio': '9:16', 'num_images': 1, 'output_format': 'png',
    }).get()
    download(res['images'][0]['url'], dest)


def generate_video(image, video, prompt, dest):
    fal = _fal()
    res = fal.submit(VIDEO_MODEL, arguments={
        'image_url': fal.upload_file(image),
        'video_url': fal.upload_file(video),
        'prompt': prompt,
        'resolution': RESOLUTION,
    }).get()
    download(res['video']['url'], dest)


# ---------- files & ffmpeg ----------

def tmp_for(dest):
    # Write next to the target, then rename: a half-written file never looks finished.
    return dest.with_name(f'{dest.stem}.part{dest.suffix}')


def download(url, dest):
    tmp = tmp_for(dest)
    with urllib.request.urlopen(url, timeout=600) as r, open(tmp, 'wb') as f:
        shutil.copyfileobj(r, f)
    os.replace(tmp, dest)


def ffmpeg(*args):
    r = subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *map(str, args)], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f'ffmpeg: {r.stderr.strip()[-300:]}')


def ffmpeg_to(dest, *args):
    tmp = tmp_for(dest)
    ffmpeg(*args, tmp)
    os.replace(tmp, dest)


def duration(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                       capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def prep_video(src, dest):
    """Trim to MAX_SECONDS, center-crop to 9:16 at 720x1280, resample to 16 fps."""
    ffmpeg_to(dest, '-i', src, '-t', MAX_SECONDS,
              '-vf', f'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps={FPS}',
              '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac')


def crop_front(sheet, dest):
    """Bottom-left panel of the 2x2 sheet (full body, front): Wan takes a single character image."""
    ffmpeg_to(dest, '-i', sheet, '-vf', 'crop=iw/2:ih/2:0:ih/2', '-frames:v', 1, '-update', 1)


def make_compare(original, result, dest):
    """Original | result side by side, same height and fps, for eyeballing the motion."""
    ffmpeg_to(dest, '-i', original, '-i', result, '-filter_complex',
              f'[0:v]scale=-2:1280,fps={FPS},setsar=1[a];[1:v]scale=-2:1280,fps={FPS},setsar=1[b];'
              '[a][b]hstack=inputs=2:shortest=1',
              '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p')


# ---------- jobs ----------

RETRYABLE = re.compile(r'429|rate.?limit|time.?out|50[234]|connect|temporar|reset by peer', re.I)


def with_retry(fn, *args, tries=3, wait=10):
    """Up to 2 retries with exponential backoff, only for network / rate-limit style errors."""
    for attempt in range(tries):
        try:
            return fn(*args)
        except Exception as e:
            if attempt == tries - 1 or not RETRYABLE.search(f'{type(e).__name__}: {e}'):
                raise
            time.sleep(wait * 2 ** attempt)


class State:
    """runs/state.json: one record per job, rewritten atomically on every change."""

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.data = json.loads(path.read_text('utf-8')) if path.exists() else {}

    def set(self, job, **fields):
        with self.lock:
            self.data.setdefault(job, {}).update(fields, updated=time.strftime('%Y-%m-%d %H:%M:%S'))
            tmp = self.path.with_suffix('.tmp')
            tmp.write_text(json.dumps(self.data, indent=2, ensure_ascii=False), 'utf-8')
            os.replace(tmp, self.path)


_locks = defaultdict(threading.Lock)
_locks_guard = threading.Lock()
_print_lock = threading.Lock()


def lock(key):
    with _locks_guard:
        return _locks[key]


def log(job, msg, t0):
    with _print_lock:
        print(f'[{time.strftime("%H:%M:%S")}] {job:<32} {time.time() - t0:7.1f}s  {msg}', flush=True)


def read_prompt(name):
    return (PROMPTS / name).read_text('utf-8')


def list_jobs():
    chars_dir, videos_dir = INPUTS / 'characters', INPUTS / 'videos'
    chars = sorted(d.name for d in chars_dir.iterdir()
                   if (d / 'face.png').exists() and (d / 'outfit.png').exists()) if chars_dir.exists() else []
    videos = sorted(p.stem for p in videos_dir.glob('*.mp4')) if videos_dir.exists() else []
    return [(c, v) for c in chars for v in videos]


def ensure_sheet(char):
    out = OUTPUTS / char
    out.mkdir(parents=True, exist_ok=True)
    sheet, front = out / 'sheet.png', out / 'sheet_front.png'
    with lock(f'sheet:{char}'):
        if not sheet.exists():
            src = INPUTS / 'characters' / char
            with_retry(generate_image, [src / 'face.png', src / 'outfit.png'], read_prompt('character_sheet.txt'), sheet)
        if not front.exists() or front.stat().st_mtime < sheet.stat().st_mtime:
            crop_front(sheet, front)
    return front


def ensure_clip(video):
    dest = RUNS / 'prep' / f'{video}_{MAX_SECONDS:g}s.mp4'
    with lock(f'prep:{video}'):
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            prep_video(INPUTS / 'videos' / f'{video}.mp4', dest)
    return dest


def run_job(char, video, state):
    job = f'{char}/{video}'
    result, compare = OUTPUTS / char / f'{video}.mp4', OUTPUTS / char / f'{video}_compare.mp4'
    if result.exists() and compare.exists():
        state.set(job, status='done')
        return 'skipped'
    t0, step, cost = time.time(), 'sheet', 0.0
    try:
        state.set(job, status='running', step=step, error=None)
        log(job, 'sheet', t0)
        front = ensure_sheet(char)
        step = 'prep'
        state.set(job, step=step)
        clip = ensure_clip(video)
        if not result.exists():
            step = 'video'
            state.set(job, step=step)
            log(job, f'video ({VIDEO_MODEL}, {RESOLUTION})', t0)
            with_retry(generate_video, front, clip, read_prompt('motion_transfer.txt'), result)
            cost = round(duration(clip) * USD_PER_SEC.get(RESOLUTION, 0), 2)
        step = 'compare'
        state.set(job, step=step)
        make_compare(clip, result, compare)
        state.set(job, status='done', step=None, seconds=round(time.time() - t0, 1), est_cost_usd=cost)
        log(job, f'done · est. ${cost}', t0)
        return 'done'
    except Exception as e:
        state.set(job, status='failed', step=step, error=f'{type(e).__name__}: {e}'[:500])
        log(job, f'FAILED at {step}: {e}', t0)
        return 'failed'


def run_all(concurrency=CONCURRENCY):
    jobs = list_jobs()
    if not jobs:
        print('No jobs. Add inputs/characters/<name>/face.png + outfit.png and inputs/videos/*.mp4')
        return {}
    RUNS.mkdir(parents=True, exist_ok=True)
    state = State(RUNS / 'state.json')
    pool = ThreadPoolExecutor(max_workers=max(1, concurrency))
    try:
        results = list(pool.map(lambda j: run_job(*j, state), jobs))
    except KeyboardInterrupt:
        print('\nInterrupted. Run again to resume unfinished jobs.', flush=True)
        os._exit(130)  # don't wait for in-flight API calls; they are redone next run
    pool.shutdown()
    summary = {k: results.count(k) for k in ('done', 'skipped', 'failed')}
    print(f'{len(jobs)} jobs: ' + ', '.join(f'{v} {k}' for k, v in summary.items()))
    return summary


if __name__ == '__main__':
    sys.exit(1 if run_all().get('failed') else 0)
