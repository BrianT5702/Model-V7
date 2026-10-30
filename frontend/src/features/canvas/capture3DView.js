import { renderPresentationPostFx } from './presentationPostFx';
import { drawCaptureWatermark } from './captureWatermark';

const PREPARE_MS = 900;

const RECORDER_TYPES = [
    'video/webm;codecs=vp8',
    'video/webm',
    'video/webm;codecs=vp9',
    'video/mp4;codecs=avc1',
    'video/mp4',
];

export function captureFilename(projectName, extension) {
    const cleaned = String(projectName || '3d-view')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60) || '3d-view';
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${cleaned}-${stamp}.${extension}`;
}

export function extensionForMime(mime) {
    return String(mime || '').includes('mp4') ? 'mp4' : 'webm';
}

function canvasSize(source) {
    return {
        width: source.width || source.clientWidth || 0,
        height: source.height || source.clientHeight || 0,
    };
}

/** Draw the current 3D frame, then the watermark, onto a 2D canvas. */
export function paintWatermarkedFrame(instance, targetCanvas, lockedSize = null) {
    if (!instance?.renderer || instance._disposed) {
        throw new Error('3D view is not ready');
    }
    renderPresentationPostFx(instance);
    const source = instance.renderer.domElement;
    const natural = canvasSize(source);
    const width = lockedSize?.width || natural.width;
    const height = lockedSize?.height || natural.height;
    if (!width || !height) {
        throw new Error('3D view has no size yet');
    }
    if (targetCanvas.width !== width || targetCanvas.height !== height) {
        targetCanvas.width = width;
        targetCanvas.height = height;
    }
    const ctx = targetCanvas.getContext('2d', { alpha: false });
    ctx.drawImage(source, 0, 0, width, height);
    drawCaptureWatermark(ctx, width, height);
    return targetCanvas;
}

function canvasToBlob(canvas, type) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Could not create the image'));
                return;
            }
            resolve(blob);
        }, type);
    });
}

export async function captureScreenshotBlob(instance) {
    const canvas = document.createElement('canvas');
    paintWatermarkedFrame(instance, canvas);
    return canvasToBlob(canvas, 'image/png');
}

function createMediaRecorder(stream) {
    if (typeof MediaRecorder === 'undefined') {
        throw new Error('This browser cannot record video');
    }
    for (const mimeType of RECORDER_TYPES) {
        if (typeof MediaRecorder.isTypeSupported === 'function' && !MediaRecorder.isTypeSupported(mimeType)) {
            continue;
        }
        try {
            return new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: 6_000_000,
            });
        } catch {
            // Try the next container the browser accepts.
        }
    }
    return new MediaRecorder(stream);
}

function mountCaptureCanvas(canvas) {
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'fixed';
    canvas.style.left = '-10000px';
    canvas.style.top = '0';
    canvas.style.width = '1px';
    canvas.style.height = '1px';
    canvas.style.pointerEvents = 'none';
    if (!canvas.isConnected) {
        document.body.appendChild(canvas);
    }
}

export function createViewRecorder(instance) {
    const canvas = document.createElement('canvas');
    let recorder = null;
    let captureTrack = null;
    let chunks = [];
    let raf = 0;
    let running = false;
    let cancelled = false;
    let mimeType = 'video/webm';
    let lockedSize = null;

    const paint = () => {
        paintWatermarkedFrame(instance, canvas, lockedSize);
        if (!lockedSize && canvas.width && canvas.height) {
            lockedSize = { width: canvas.width, height: canvas.height };
        }
        if (typeof captureTrack?.requestFrame === 'function') {
            captureTrack.requestFrame();
        }
    };

    const unmountCanvas = () => {
        canvas.remove();
    };

    const cancelLoop = () => {
        running = false;
        if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
        }
    };

    return {
        cancelPrepare() {
            cancelled = true;
            cancelLoop();
            unmountCanvas();
        },
        async prepareAndStart() {
            cancelled = false;
            paint();
            const started = performance.now();
            await new Promise((resolve) => {
                const step = () => {
                    if (cancelled) {
                        resolve();
                        return;
                    }
                    try {
                        paint();
                    } catch (error) {
                        // Keep waiting until the view has a frame, or prepare is cancelled.
                    }
                    if (performance.now() - started >= PREPARE_MS) {
                        resolve();
                    } else {
                        requestAnimationFrame(step);
                    }
                };
                requestAnimationFrame(step);
            });
            if (cancelled) {
                const error = new Error('cancelled');
                error.code = 'cancelled';
                throw error;
            }
            if (instance._disposed) {
                unmountCanvas();
                throw new Error('3D view is not ready');
            }
            mountCaptureCanvas(canvas);
            const stream = canvas.captureStream(0);
            captureTrack = stream.getVideoTracks()[0] || null;
            paint();
            recorder = createMediaRecorder(stream);
            mimeType = recorder.mimeType || 'video/webm';
            chunks = [];
            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    chunks.push(event.data);
                }
            };
            running = true;
            const loop = () => {
                if (!running) return;
                try {
                    paint();
                } catch (error) {
                    // Skip a frame if the view is resizing.
                }
                raf = requestAnimationFrame(loop);
            };
            recorder.start(250);
            raf = requestAnimationFrame(loop);
        },
        stop() {
            cancelLoop();
            const active = recorder;
            recorder = null;
            captureTrack = null;
            const finish = (blob) => {
                unmountCanvas();
                active?.stream?.getTracks?.().forEach((track) => track.stop());
                return blob;
            };
            if (!active || active.state === 'inactive') {
                const blob = new Blob(chunks, { type: mimeType });
                chunks = [];
                return Promise.resolve(finish(blob));
            }
            return new Promise((resolve) => {
                active.addEventListener('stop', () => {
                    const blob = new Blob(chunks, { type: active.mimeType || mimeType });
                    chunks = [];
                    resolve(finish(blob));
                }, { once: true });
                if (active.state === 'recording' || active.state === 'paused') {
                    active.stop();
                } else {
                    const blob = new Blob(chunks, { type: mimeType });
                    chunks = [];
                    resolve(finish(blob));
                }
            });
        },
    };
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
