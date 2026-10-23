"""Smoke test: job list, resume, retry and the ffmpeg steps, with fake generators (no API calls).
Run: python test_run.py   (needs ffmpeg on PATH)
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import run


def ff(*args):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *map(str, args)], check=True)


def probe(path, entries):
    out = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
                          f'stream={entries}', '-of', 'csv=p=0', str(path)], capture_output=True, text=True).stdout
    return out.strip()


with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
    root = Path(d)
    shutil.copytree(run.ROOT / 'prompts', root / 'prompts')
    char = root / 'inputs/characters/mai'
    char.mkdir(parents=True)
    for name in ('face.png', 'outfit.png'):
        ff('-f', 'lavfi', '-i', 'color=c=gray:s=64x64', '-frames:v', 1, '-update', 1, char / name)
    (root / 'inputs/characters/half_done').mkdir()  # no images -> not a job
    videos = root / 'inputs/videos'
    videos.mkdir(parents=True)
    for v in ('dance', 'walk'):  # 3 s, 30 fps, landscape: prep must make it 9:16 at 16 fps
        ff('-f', 'lavfi', '-i', 'testsrc=s=1280x720:r=30:d=3', videos / f'{v}.mp4')

    run.set_root(root)
    assert run.list_jobs() == [('mai', 'dance'), ('mai', 'walk')]

    calls = {'image': 0, 'video': []}
    crash = {'walk'}

    def fake_image(images, prompt, dest):
        calls['image'] += 1
        assert [p.name for p in images] == ['face.png', 'outfit.png'] and 'CHARACTER REFERENCE SHEET' in prompt
        ff('-f', 'lavfi', '-i', 'color=c=white:s=720x1280', '-frames:v', 1, '-update', 1, dest)

    def fake_video(image, video, prompt, dest):
        calls['video'].append(Path(video).stem.split('_')[0])
        assert Path(image).name == 'sheet_front.png' and 'MOTION TRANSFER' in prompt
        if calls['video'][-1] in crash:
            raise RuntimeError('simulated crash')  # not retryable -> job fails, batch continues
        shutil.copy(video, dest)

    run.generate_image, run.generate_video = fake_image, fake_video

    # First run: one job fails, the other finishes.
    assert run.run_all(1) == {'done': 1, 'skipped': 0, 'failed': 1}
    state = json.loads((root / 'runs/state.json').read_text('utf-8'))
    assert state['mai/walk']['status'] == 'failed' and 'simulated crash' in state['mai/walk']['error']
    out = root / 'outputs/mai'
    for f in ('sheet.png', 'sheet_front.png', 'dance.mp4', 'dance_compare.mp4'):
        assert (out / f).exists(), f
    assert not list(root.rglob('*.part.*')), 'temp files left behind'
    clip = root / 'runs/prep/dance_10s.mp4'
    assert probe(clip, 'width,height,nb_read_frames') == '720,1280,48', probe(clip, 'width,height,nb_read_frames')
    assert probe(out / 'sheet_front.png', 'width,height') == '360,640'
    assert probe(out / 'dance_compare.mp4', 'width,height') == '1440,1280'

    # Resume: only the failed job runs again, the cached sheet is reused.
    crash.clear()
    calls['video'].clear()
    assert run.run_all(1) == {'done': 1, 'skipped': 1, 'failed': 0}
    assert calls == {'image': 1, 'video': ['walk']}

    # Deleting an output re-runs just that job.
    (out / 'dance.mp4').unlink()
    calls['video'].clear()
    assert run.run_all(2) == {'done': 1, 'skipped': 1, 'failed': 0}
    assert calls['video'] == ['dance']

# Retry: rate-limit errors are retried (2x max), other errors are not.
attempts = []


def flaky():
    attempts.append(1)
    if len(attempts) < 3:
        raise RuntimeError('HTTP 429: rate limit exceeded')
    return 'ok'


assert run.with_retry(flaky, wait=0) == 'ok' and len(attempts) == 3
attempts.clear()
try:
    run.with_retry(lambda: attempts.append(1) or (_ for _ in ()).throw(ValueError('bad input')), wait=0)
except ValueError:
    pass
assert len(attempts) == 1

print('test_run.py: all checks passed')
