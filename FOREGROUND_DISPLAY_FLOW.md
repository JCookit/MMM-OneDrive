# MMM-OneDrive Foreground Display Flow

## Current State

As of 2026-05-17, local resize isolation has been merged to `main` in PR #2 (`0426d36`). The preferred production path for local resizing is `imageResize.backend: "sharpWorker"`, which fetches the original image but performs Sharp resize in `src/resize/resize-worker.js` instead of the MagicMirror/Electron helper process.

The stable comparison path remains `imageResize.backend: "onedriveThumbnail"`, which avoids local resize work by asking Microsoft Graph for a display-sized thumbnail. Use it as an A/B comparison if local resize behavior regresses.

The module has foreground telemetry enabled:

- `blob_prepared`
- `render_start`
- `image_load` / `image_error`
- `foreground_style_snapshot`

Verbose DOM mutation telemetry is available with `debugDomTelemetry: true`, but defaults off so thumbnail/memory runs stay readable.

The foreground blanking issue was a frontend state-machine problem, not bad image bytes. The fix is now implemented: image swaps are atomic, active blob URLs are revoked only after commit, and auth/error overlays no longer clear foreground photo DOM.

## Event Flow

Startup:

1. Frontend `start()` sends `INIT`.
2. Frontend immediately sends `NEXT_PHOTO`.
3. Backend initializes OneDrive, cache, scan state, the vision worker when Ken Burns is enabled, and the resize worker when `imageResize.backend` is `sharpWorker`.
4. Backend may send `SCAN_COMPLETE`; frontend calls `requestNextPhoto()`, but `processingRequested` should suppress duplicate in-flight requests.

Normal display:

1. Backend receives `NEXT_PHOTO`.
2. Backend `processNextPhotoRequest()` selects `localPhotoList[uiPhotoIndex]`.
3. Backend `prepareShowPhoto()` fetches/resizes or fetches OneDrive thumbnail, runs vision when allowed, then sends `RENDER_PHOTO`.
4. Frontend `RENDER_PHOTO` caches the payload.
5. If no display timer exists, frontend displays immediately; otherwise it waits for `displayTimer`.
6. Frontend `displayCachedPhoto()` creates blob URLs, renders the cached photo, immediately requests the next backend photo, and schedules the next display timer.

Resize paths:

- `imageResize.backend: "onedriveThumbnail"` asks Microsoft Graph for a display-sized thumbnail. If Graph fails, existing fallback behavior fetches the full image and uses local resize.
- `imageResize.backend: "sharp"` fetches the full image and resizes in the node helper process.
- `imageResize.backend: "canvas"` fetches the full image and resizes in the node helper process with Canvas.
- `imageResize.backend: "sharpWorker"` fetches the full image in the node helper, sends the buffer over Node IPC to `src/resize/resize-worker.js`, and receives a display-sized JPEG buffer back. The worker is bounded by `workerTimeoutMs`, recycled after `workerMaxJobs`, and recycled if worker RSS crosses `workerMaxRssMB`.

Sharp worker fallback:

1. If the sharp worker is missing, busy, crashes, times out, or returns an invalid buffer, backend keeps the original full-size fetched buffer.
2. Backend marks the payload `displayMode: "originalStatic"`.
3. Backend skips vision for that photo so the original full-size image is not sent to OpenCV.
4. Frontend displays the original image with `object-fit: contain`, suppresses foreground Ken Burns/static fade animation, and suppresses backdrop fade animation for that photo.
5. Slideshow timing and immediate prefetch continue unchanged.

Lifecycle and error paths:

- `MODULE_SUSPENDED`: should stop display scheduling only. It must not clear the current photo or revoke its active blob URL.
- `MODULE_RESUMED`: should resume scheduling only. It must not force a destructive rerender.
- `ERROR` shows an independent `ONEDRIVE_PHOTO_ERROR` overlay and must not clear foreground photo DOM.
- `CLEAR_ERROR` removes only `ONEDRIVE_PHOTO_ERROR`; auth success during normal thumbnail fetch must not blank the displayed photo.
- `NO_PHOTO` only clears `processingRequested`.
- `UPDATE_STATUS` only updates info text.

Device-auth first run:

1. Backend emits `ERROR` with the device-auth message.
2. Frontend shows that message in `ONEDRIVE_PHOTO_ERROR`, an overlay inside the photo module.
3. The overlay may be the only visible content if no photo has displayed yet.
4. After the user completes auth, backend emits `CLEAR_ERROR`.
5. Frontend removes only `ONEDRIVE_PHOTO_ERROR` and continues requesting/loading photos.
6. `CLEAR_ERROR` must never clear `ONEDRIVE_PHOTO_CURRENT`, because auth success also occurs during normal token refreshes and thumbnail fetches.

Kiosk auth guard:

- `allowInteractiveBrowserAuth` defaults to `false`.
- If silent auth fails and device-code auth fails or times out, the backend must surface/log the auth error and retry later; it must not launch browser auth.
- Browser-based auth through Electron `shell.openExternal` is allowed only when `allowInteractiveBrowserAuth: true` is explicitly configured.

## Historical Failure Pattern

The bad flow was:

1. `displayCachedPhoto()` created a new blob URL.
2. It immediately revoked the previous active blob URL.
3. `render()` immediately cleared `ONEDRIVE_PHOTO_CURRENT`.
4. It appended a new `<img>` whose animation starts at opacity `0`.
5. Backend prefetch started immediately.

If the renderer was delayed by backend/socket work or MMM-pages suspend/resume churn, the old visible foreground was already gone and the replacement foreground could remain visually absent during the first paint/fade window. The backdrop could still show because it is a separate background image.

## Intended Fix, Now Implemented

Foreground replacement should be atomic:

- Create the new foreground image off-DOM.
- Wait for the new image to fire `onload`.
- Only then clear/replace the foreground DOM.
- Only then switch the backdrop to the new URL.
- Only after the new image is committed should old blob URLs be revoked.
- If the new image fails or becomes stale, keep the old foreground photo intact and revoke only the unused new blob URLs.

Immediate backend prefetch is still required and should remain in place.

## Implemented Changes

The frontend now prepares blob URLs in `displayCachedPhoto()` but keeps the previously displayed blob URLs active. `render()` loads the replacement `<img>` off-DOM and commits the swap only after `onload`. Old blob URLs are revoked only after `foreground_swap_committed`. If the replacement image errors or becomes stale, the old displayed photo remains intact and the unused new blob URLs are revoked.

Error display now uses a separate `ONEDRIVE_PHOTO_ERROR` overlay. `ERROR` creates/updates that overlay, and `CLEAR_ERROR` removes only that overlay. This preserves the expected first-run device-auth message while preventing later auth success events from blanking the foreground photo.

Resize isolation now uses `src/resize/resize-worker.js` for `sharpWorker`. The node helper keeps slideshow timing independent from worker health: resize worker failure causes an `originalStatic` photo fallback for that one photo, not a blocked rotation. Vision is skipped for that fallback to avoid passing full-size images to OpenCV.

## Signals To Watch

Expected healthy telemetry:

- `blob_prepared` with nonzero `photoBufferSize`.
- `PIPELINE_TELEMETRY.configuredSize.resizeBackend` matching the tested backend.
- For `sharpWorker`, `resized.resizeWorker.pid` and worker memory in backend pipeline telemetry.
- `render_start`.
- `foreground_swap_ready`.
- `foreground_swap_committed`.
- `image_load` with nonzero `naturalWidth` and `naturalHeight`.
- `foreground_style_snapshot` without needing to stop the backend.
- If `debugDomTelemetry: true`, `dom_mutation` events showing every foreground, backdrop, wrapper, info, and animation mutation in order.

Unexpected signals:

- `image_error` for normal JPEG/HEIC-converted payloads.
- `foreground_swap_stale` frequently, which would imply overlapping display renders.
- `mainRevoked` incrementing before `foreground_swap_committed`.
- If `debugDomTelemetry: true`, any `dom_mutation` event from `CLEAR_ERROR` that touches foreground, backdrop, or animation state.
- If `debugDomTelemetry: true`, a `dom_mutation` event that clears foreground, changes animation, or changes backdrop at the same time the foreground disappears unexpectedly.
- For `sharpWorker`, unexpected `displayMode: "originalStatic"` means resize worker fallback was used. That should keep photos visible, but it is a fault signal for the resize path.
