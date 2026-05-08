# Agent Notes for MMM-OneDrive

## Context

MMM-OneDrive is a heavily customized MagicMirror module used for OneDrive photo slideshows. It does more than basic rotation: the backend resizes fetched photos, sends raw image buffers to the frontend, and uses an isolated OpenCV-based `src/vision/vision-worker.js` process for face detection, interest regions, color analysis, and Ken Burns animation decisions.

The production runtime is a Raspberry Pi 5 running Raspberry Pi OS Bookworm. MagicMirror is managed by PM2 as `MagicMirror`. The module depends on a custom OpenCV build with DNN support plus `@u4/opencv4nodejs`; native module compatibility matters after MagicMirror/Electron updates.

## Current Investigation

After updating MagicMirror to 2.36.0 / Electron 41 and moving to `canvas` 3.x, the Pi started hard-freezing after hours. Persistent journal logs showed repeated global OOM events where the kernel killed the main Electron process. This proves Electron was the OOM victim, not necessarily the root leak. Possible sources include renderer image/blob lifecycle, MagicMirror/Electron behavior, native canvas/sharp allocations, or OpenCV worker/native memory.

Commit `4699ebe` added the first stabilization pass:

- Vision is optional enrichment, not a gate for photo display.
- Worker request timeout defaults to a bounded budget and returns static fallback.
- Dead/unavailable worker gives `animationType: "static"` and `method: "worker_not_ready"` instead of delaying photos.
- Worker timeout triggers worker restart in the background.
- Health checks now use IPC responses, not just PID existence.
- The worker now honors `faceDetection.enabled`.
- Frontend debug blob URLs are revoked when not used.
- Basic telemetry logs memory/process state every 10 photos.

The expected behavior is that photos continue to rotate even if `vision-worker` dies, hangs, or restarts. Fallback photos should display without Ken Burns pan/zoom.

## Dev and Test Loop

There are multiple checkouts:

- Windows edit/push checkout: `D:\dev\git\MMM-OneDrive`
- WSL MagicMirror checkout: `~/MagicMirror/modules/MMM-OneDrive`
- Pi production checkout: `~/MagicMirror/modules/MMM-OneDrive`

Prefer making repo edits in the Windows checkout unless the user explicitly says to work in WSL. Push changes to GitHub, then pull into WSL or the Pi. Do not assume the WSL checkout is the same filesystem copy as Windows.

WSL has the correct Node through an nvm login shell. Use `wsl -e bash -lic '...'` for WSL commands; non-login WSL shells may pick up Windows Node/npm and fail with UNC path errors.

Typical WSL validation:

```bash
cd ~/MagicMirror/modules/MMM-OneDrive
git pull
npm run build
cd ~/MagicMirror
npm run server
```

Then open `http://localhost:8080`. To test worker recovery:

```bash
pkill -f 'src/vision/vision-worker.js'
tail -f /tmp/magicmirror-server.log
```

Expected result: the next affected photo uses static fallback, the worker restarts, and later photos resume vision processing.

Typical Pi deploy:

```bash
cd ~/MagicMirror/modules/MMM-OneDrive
git pull
npm run build
pm2 restart MagicMirror
```

Useful Pi checks:

```bash
pm2 status
ps -eo pid,ppid,ni,stat,%cpu,%mem,rss,cmd --sort=-rss | head -30
pm2 logs MagicMirror --lines 200 --nostream
journalctl -k -b 0 --no-pager | grep -iE 'oom|out of memory|killed process|segfault|electron|node'
```

## Working Rules

- Do not make Pi machine config changes without explicitly calling them out first.
- Module code changes should be committed and pushed from the repo, then pulled into WSL/Pi.
- Generated `MMM-OneDrive.js` and `MMM-OneDrive.js.map` may change after `npm run build`; the `.map` file can differ by environment.
- Full Jest currently has unrelated/environment failures: stale OneDrive auth, older frontend tests referencing removed `updatePhotos`, and Windows `canvas` resolution. Prefer targeted tests plus WSL functional validation until the broader test suite is cleaned up.
- PM2 only watches the wrapper process memory, not the child Electron renderer memory, so PM2 memory limits are not sufficient to prevent global OOM.
