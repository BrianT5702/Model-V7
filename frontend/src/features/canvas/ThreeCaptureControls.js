import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaCamera, FaStop, FaVideo } from 'react-icons/fa';
import {
    captureFilename,
    captureScreenshotBlob,
    createViewRecorder,
    downloadBlob,
    extensionForMime,
} from './capture3DView';

const toolbarButtonClass = 'flex items-center px-2 sm:px-2.5 py-1.5 rounded-md text-sm font-medium transition-all duration-200 shadow-sm';
const idleButtonClass = 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 dark:border dark:border-gray-600';

function releasePointerLock() {
    if (typeof document !== 'undefined' && document.pointerLockElement) {
        document.exitPointerLock();
    }
}

function activeFullscreenElement() {
    if (typeof document === 'undefined') return null;
    return document.fullscreenElement
        || document.webkitFullscreenElement
        || document.mozFullScreenElement
        || document.msFullscreenElement
        || null;
}

/** Native fullscreen only shows the fullscreen element. A dialog on document.body stays hidden. */
function useOverlayHost() {
    const [host, setHost] = useState(null);
    useEffect(() => {
        const sync = () => setHost(activeFullscreenElement() || document.body);
        sync();
        document.addEventListener('fullscreenchange', sync);
        document.addEventListener('webkitfullscreenchange', sync);
        return () => {
            document.removeEventListener('fullscreenchange', sync);
            document.removeEventListener('webkitfullscreenchange', sync);
        };
    }, []);
    return host;
}

const ThreeCaptureControls = forwardRef(function ThreeCaptureControls({
    getCanvas,
    viewRootRef,
    projectName,
    canRecord,
    disabled,
}, ref) {
    const [phase, setPhase] = useState('idle');
    const [error, setError] = useState('');
    const [review, setReview] = useState(null);
    const overlayHost = useOverlayHost();
    const phaseRef = useRef('idle');
    const sessionRef = useRef(null);
    const reviewUrlRef = useRef('');
    const apiRef = useRef({});

    const setPhaseBoth = (next) => {
        phaseRef.current = next;
        setPhase(next);
    };

    const closeReview = () => {
        if (reviewUrlRef.current) {
            URL.revokeObjectURL(reviewUrlRef.current);
            reviewUrlRef.current = '';
        }
        setReview(null);
        if (phaseRef.current === 'review') {
            setPhaseBoth('idle');
        }
    };

    const openReview = (kind, blob) => {
        releasePointerLock();
        if (reviewUrlRef.current) {
            URL.revokeObjectURL(reviewUrlRef.current);
        }
        const url = URL.createObjectURL(blob);
        reviewUrlRef.current = url;
        const extension = kind === 'image' ? 'png' : extensionForMime(blob.type);
        setReview({
            kind,
            url,
            blob,
            filename: captureFilename(projectName, extension),
        });
        setPhaseBoth('review');
    };

    const takeScreenshot = async () => {
        if (disabled || phaseRef.current === 'preparing' || phaseRef.current === 'recording') return;
        setError('');
        const instance = getCanvas?.();
        if (!instance?.renderer) {
            setError('3D view is not ready yet.');
            return;
        }
        try {
            const blob = await captureScreenshotBlob(instance);
            openReview('image', blob);
        } catch (err) {
            setError(err?.message || 'Could not capture the view.');
        }
    };

    const beginRecording = async () => {
        if (!canRecord || disabled) return;
        if (phaseRef.current !== 'idle' && phaseRef.current !== 'review') return;
        if (phaseRef.current === 'review') closeReview();
        setError('');
        const instance = getCanvas?.();
        if (!instance?.renderer) {
            setError('3D view is not ready yet.');
            return;
        }
        const session = createViewRecorder(instance);
        sessionRef.current = session;
        setPhaseBoth('preparing');
        try {
            await session.prepareAndStart();
            if (sessionRef.current !== session) return;
            setPhaseBoth('recording');
        } catch (err) {
            if (err?.code === 'cancelled') return;
            if (sessionRef.current === session) {
                sessionRef.current = null;
                setPhaseBoth('idle');
            }
            setError(err?.message || 'Could not start recording.');
        }
    };

    const stopRecording = async () => {
        const phaseNow = phaseRef.current;
        const session = sessionRef.current;
        if (!session || (phaseNow !== 'preparing' && phaseNow !== 'recording')) return;
        if (phaseNow === 'preparing') {
            session.cancelPrepare();
            sessionRef.current = null;
            setPhaseBoth('idle');
            return;
        }
        sessionRef.current = null;
        setPhaseBoth('idle');
        try {
            const blob = await session.stop();
            if (!blob || blob.size < 500) {
                setError('The recording was empty. Try again.');
                return;
            }
            openReview('video', blob);
        } catch (err) {
            setError(err?.message || 'Could not finish the recording.');
        }
    };

    apiRef.current.isBusy = () => phaseRef.current === 'preparing' || phaseRef.current === 'recording';
    apiRef.current.finish = () => stopRecording();

    useImperativeHandle(ref, () => ({
        isBusy: () => apiRef.current.isBusy(),
        finish: () => apiRef.current.finish(),
    }), []);

    useEffect(() => {
        if (!error) return undefined;
        const timer = window.setTimeout(() => setError(''), 4500);
        return () => window.clearTimeout(timer);
    }, [error]);

    useEffect(() => {
        if (phase !== 'preparing' && phase !== 'recording') return undefined;
        const onBeforeUnload = (event) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [phase]);

    useEffect(() => () => {
        sessionRef.current?.cancelPrepare();
        sessionRef.current?.stop?.();
        sessionRef.current = null;
        if (reviewUrlRef.current) {
            URL.revokeObjectURL(reviewUrlRef.current);
            reviewUrlRef.current = '';
        }
    }, []);

    const busy = disabled || phase === 'preparing' || phase === 'recording';
    const stage = viewRootRef?.current?.querySelector('.three-canvas-stage') || null;

    const saveReview = () => {
        if (!review) return;
        downloadBlob(review.blob, review.filename);
        closeReview();
    };

    return (
        <>
            <button
                type="button"
                onClick={takeScreenshot}
                disabled={busy}
                title="Capture this view and save it"
                className={`${toolbarButtonClass} ${idleButtonClass} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
                <FaCamera className="mr-1.5 text-xs" />
                <span className="hidden sm:inline">Screenshot</span>
                <span className="sm:hidden">Shot</span>
            </button>
            {phase === 'recording' ? (
                <button
                    type="button"
                    onClick={stopRecording}
                    title="Stop and save the recording"
                    className={`${toolbarButtonClass} bg-red-600 text-white hover:bg-red-700`}
                >
                    <FaStop className="mr-1.5 text-xs" />
                    <span className="hidden sm:inline">Stop</span>
                    <span className="sm:hidden">Stop</span>
                </button>
            ) : (
                <button
                    type="button"
                    onClick={beginRecording}
                    disabled={!canRecord || busy || phase === 'preparing'}
                    title={canRecord ? 'Record this view, then save the video' : 'Sign in to record a video'}
                    className={`${toolbarButtonClass} ${idleButtonClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                    <FaVideo className="mr-1.5 text-xs" />
                    <span className="hidden sm:inline">{phase === 'preparing' ? 'Preparing…' : 'Record'}</span>
                    <span className="sm:hidden">{phase === 'preparing' ? '…' : 'Rec'}</span>
                </button>
            )}
            {stage && phase === 'preparing' && createPortal(
                <div className="three-build-overlay" role="status" aria-live="polite">
                    <div className="three-build-card">
                        <div className="three-build-spinner" aria-hidden="true" />
                        <p className="three-build-title">Preparing recording</p>
                        <p className="three-build-copy">You can rotate and walk the model once recording starts.</p>
                    </div>
                </div>,
                stage,
            )}
            {stage && phase === 'recording' && createPortal(
                <div className="pointer-events-none absolute top-3 left-3 z-20 inline-flex items-center gap-2 rounded-full bg-red-600/95 px-3 py-1 text-xs font-semibold text-white shadow">
                    <span className="h-2 w-2 rounded-full bg-white animate-pulse" aria-hidden="true" />
                    Recording
                </div>,
                stage,
            )}
            {stage && error && createPortal(
                <div className="absolute top-3 left-1/2 z-20 max-w-[90%] -translate-x-1/2 rounded-md bg-gray-900/90 px-3 py-2 text-center text-xs font-medium text-white" role="alert">
                    {error}
                </div>,
                stage,
            )}
            {review && overlayHost && createPortal(
                <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="capture-save-title">
                    <div className="w-full max-w-3xl rounded-lg bg-white p-4 shadow-xl dark:bg-gray-800">
                        <h2 id="capture-save-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
                            {review.kind === 'image' ? 'Save screenshot' : 'Save recording'}
                        </h2>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                            A watermark is included. Save this file to your device?
                        </p>
                        <div className="mt-3 overflow-hidden rounded-md border border-gray-200 bg-slate-100 dark:border-gray-700 dark:bg-gray-900">
                            {review.kind === 'image' ? (
                                <img src={review.url} alt="Screenshot preview" className="max-h-[60vh] w-full object-contain" />
                            ) : (
                                <video src={review.url} controls playsInline className="max-h-[60vh] w-full bg-black" />
                            )}
                        </div>
                        <p className="mt-2 truncate text-xs text-gray-500 dark:text-gray-400" title={review.filename}>
                            {review.filename}
                        </p>
                        <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeReview}
                                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
                            >
                                Don&apos;t save
                            </button>
                            <button
                                type="button"
                                onClick={saveReview}
                                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                Save to device
                            </button>
                        </div>
                    </div>
                </div>,
                overlayHost,
            )}
        </>
    );
});

export default ThreeCaptureControls;
