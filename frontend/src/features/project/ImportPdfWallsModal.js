import React, { useRef, useState } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../api/api';

/**
 * Import walls from a United Panel PDF floor plan.
 * Preview → confirm creates walls only (no joints/doors/windows).
 */
export default function ImportPdfWallsModal({
    projectId,
    storeyId,
    open,
    onClose,
    onImported,
}) {
    const fileInputRef = useRef(null);
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [replaceExisting, setReplaceExisting] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    if (!open) return null;

    const reset = () => {
        setFile(null);
        setPreview(null);
        setReplaceExisting(false);
        setBusy(false);
        setError('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleClose = () => {
        if (busy) return;
        reset();
        onClose?.();
    };

    const runParse = async (selectedFile, confirm) => {
        if (!selectedFile || !projectId) return;
        setBusy(true);
        setError('');
        try {
            const form = new FormData();
            form.append('file', selectedFile);
            form.append('confirm', confirm ? 'true' : 'false');
            form.append('replace_existing', replaceExisting ? 'true' : 'false');
            if (storeyId != null) form.append('storey', String(storeyId));

            const res = await api.post(`/projects/${projectId}/import-pdf-walls/`, form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            if (confirm) {
                onImported?.(res.data);
                reset();
                onClose?.();
            } else {
                setPreview(res.data);
            }
        } catch (err) {
            const msg =
                err?.response?.data?.error
                || err?.message
                || 'Failed to import PDF walls.';
            setError(String(msg));
        } finally {
            setBusy(false);
        }
    };

    const walls = preview?.walls || [];
    const wallDims = preview?.dimensions?.wall || [];
    const panelDims = preview?.dimensions?.panel || [];

    return (
        <ModalOverlay className="bg-black/50 flex items-center justify-center z-[12000] p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-5 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Import walls from PDF</h3>
                    <p className="text-sm text-gray-600 mt-1">
                        Detects green wall outlines and wall dimensions. Panel sizes are listed but not drawn.
                        Joints, doors, and windows stay for you to set later.
                    </p>
                </div>

                <div className="px-5 py-4 overflow-y-auto modal-scroll-panel space-y-4">
                    <div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="application/pdf,.pdf"
                            className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3
                                file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700
                                hover:file:bg-blue-100"
                            onChange={(e) => {
                                const next = e.target.files?.[0] || null;
                                setFile(next);
                                setPreview(null);
                                setError('');
                            }}
                        />
                    </div>

                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={replaceExisting}
                            onChange={(e) => setReplaceExisting(e.target.checked)}
                            disabled={busy}
                        />
                        Replace existing walls when confirming
                    </label>

                    {error && (
                        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
                            {error}
                        </div>
                    )}

                    {preview && (
                        <div className="space-y-3 text-sm">
                            <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2">
                                <div><span className="font-medium">Walls found:</span> {walls.length}</div>
                                <div><span className="font-medium">Height:</span> {preview.height_mm} mm</div>
                                <div><span className="font-medium">Thickness:</span> {preview.thickness_mm} mm</div>
                                {preview.overall_width_mm != null && (
                                    <div><span className="font-medium">Overall width (OCR):</span> {preview.overall_width_mm} mm</div>
                                )}
                            </div>

                            <div>
                                <div className="font-medium text-gray-800 mb-1">Wall dimensions detected</div>
                                <div className="text-gray-600">
                                    {wallDims.length
                                        ? [...new Set(wallDims.map((d) => d.value_mm))].sort((a, b) => a - b).join(', ')
                                        : 'None'}
                                </div>
                            </div>

                            <div>
                                <div className="font-medium text-gray-800 mb-1">Panel dimensions (ignored for geometry)</div>
                                <div className="text-gray-600">
                                    {panelDims.length
                                        ? [...new Set(panelDims.map((d) => d.value_mm))].sort((a, b) => a - b).join(', ')
                                        : 'None'}
                                </div>
                            </div>

                            <div className="max-h-48 overflow-auto border border-gray-200 rounded-md">
                                <table className="min-w-full text-xs">
                                    <thead className="bg-gray-100 sticky top-0">
                                        <tr>
                                            <th className="text-left px-2 py-1">#</th>
                                            <th className="text-left px-2 py-1">Length</th>
                                            <th className="text-left px-2 py-1">Start</th>
                                            <th className="text-left px-2 py-1">End</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {walls.map((w, idx) => (
                                            <tr key={idx} className="border-t border-gray-100">
                                                <td className="px-2 py-1">{idx + 1}</td>
                                                <td className="px-2 py-1">{w.length_mm}</td>
                                                <td className="px-2 py-1">({w.start_x}, {w.start_y})</td>
                                                <td className="px-2 py-1">({w.end_x}, {w.end_y})</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-5 py-4 border-t border-gray-200 flex flex-wrap justify-end gap-2">
                    <button
                        type="button"
                        className="form-btn-secondary px-4 py-2 text-sm"
                        onClick={handleClose}
                        disabled={busy}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="form-btn-secondary px-4 py-2 text-sm"
                        disabled={!file || busy}
                        onClick={() => runParse(file, false)}
                    >
                        {busy && !preview ? 'Parsing…' : 'Preview walls'}
                    </button>
                    <button
                        type="button"
                        className="form-btn-primary px-4 py-2 text-sm"
                        disabled={!preview?.walls?.length || busy}
                        onClick={() => runParse(file, true)}
                    >
                        {busy && preview ? 'Creating…' : 'Create walls'}
                    </button>
                </div>
            </div>
        </ModalOverlay>
    );
}
