import React, { useRef, useState } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../api/api';

/**
 * Import a United Panel PDF / DWG / DXF floor plan into an existing project.
 * Preview → confirm creates walls, doors, rooms, and corner joints.
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
    const [pageIndex, setPageIndex] = useState(0);
    const [regionIndex, setRegionIndex] = useState(0);
    const [replaceExisting, setReplaceExisting] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    if (!open) return null;

    const isCad = /\.(dwg|dxf)$/i.test(file?.name || '');

    const reset = () => {
        setFile(null);
        setPreview(null);
        setPageIndex(0);
        setRegionIndex(0);
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
            form.append('page_index', String(pageIndex));
            form.append('region_index', String(regionIndex));
            if (storeyId != null) form.append('storey', String(storeyId));

            const res = await api.post(`/projects/${projectId}/import-pdf-walls/`, form, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 180000,
            });

            if (confirm) {
                onImported?.(res.data);
                reset();
                onClose?.();
            } else {
                setPreview(res.data);
                if (typeof res.data?.region_index === 'number') {
                    setRegionIndex(res.data.region_index);
                }
            }
        } catch (err) {
            const timedOut = err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '');
            const msg = timedOut
                ? 'Import timed out. Large drawings can take 1–3 minutes — try again.'
                : (err?.response?.data?.error
                    || err?.response?.data?.name?.[0]
                    || err?.message
                    || 'Failed to import plan.');
            setError(String(msg));
        } finally {
            setBusy(false);
        }
    };

    const walls = preview?.walls || [];
    const doors = preview?.doors || [];
    const rooms = preview?.rooms || [];
    const intersections = preview?.intersections || [];
    const wallDims = preview?.dimensions?.wall || [];
    const panelHints = preview?.panel_hints || preview?.dimensions?.panel || [];
    const pageCount = preview?.page_count || 1;
    const regions = preview?.regions || [];

    return (
        <ModalOverlay className="bg-black/50 flex items-center justify-center z-[12000] p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-5 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Import plan from PDF / DWG</h3>
                    <p className="text-sm text-gray-600 mt-1">
                        DWG/DXF uses CAD wall layers (recommended). PDF extracts wall outlines when layers
                        are not available. Doors, rooms, and joints are created when detected.
                    </p>
                </div>

                <div className="px-5 py-4 overflow-y-auto modal-scroll-panel space-y-4">
                    <div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.dwg,.dxf,application/pdf,image/vnd.dwg,application/dxf"
                            className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3
                                file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700
                                hover:file:bg-blue-100"
                            onChange={(e) => {
                                const next = e.target.files?.[0] || null;
                                setFile(next);
                                setPreview(null);
                                setPageIndex(0);
                                setRegionIndex(0);
                                setError('');
                            }}
                        />
                    </div>

                    {!isCad && (pageCount > 1 || preview) && (
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            Page
                            <select
                                className="border border-gray-300 rounded-md px-2 py-1"
                                value={pageIndex}
                                disabled={busy}
                                onChange={(e) => {
                                    setPageIndex(Number(e.target.value) || 0);
                                    setPreview(null);
                                }}
                            >
                                {Array.from({ length: Math.max(pageCount, pageIndex + 1) }, (_, i) => (
                                    <option key={i} value={i}>
                                        {i + 1}{pageCount > 1 ? ` / ${pageCount}` : ''}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {regions.length > 1 && (
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            Plan region
                            <select
                                className="border border-gray-300 rounded-md px-2 py-1"
                                value={regionIndex}
                                disabled={busy}
                                onChange={(e) => {
                                    setRegionIndex(Number(e.target.value) || 0);
                                    setPreview(null);
                                }}
                            >
                                {regions.map((r) => (
                                    <option key={r.index} value={r.index}>
                                        #{r.index + 1}: {r.segment_count} segs, {r.span_x}×{r.span_y} mm
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={replaceExisting}
                            onChange={(e) => setReplaceExisting(e.target.checked)}
                            disabled={busy}
                        />
                        Replace existing walls, doors, rooms, and joints when confirming
                    </label>

                    {error && (
                        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
                            {error}
                        </div>
                    )}

                    {preview && (
                        <div className="space-y-3 text-sm">
                            <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 space-y-1">
                                <div><span className="font-medium">Dialect:</span> {preview.dialect || '—'}</div>
                                <div><span className="font-medium">Walls:</span> {walls.length}</div>
                                <div><span className="font-medium">Doors:</span> {doors.length}</div>
                                <div><span className="font-medium">Rooms:</span> {rooms.length}</div>
                                <div><span className="font-medium">Joints:</span> {intersections.length}</div>
                                <div><span className="font-medium">Height:</span> {preview.height_mm} mm</div>
                                <div><span className="font-medium">Thickness:</span> {preview.thickness_mm} mm</div>
                                {preview.overall_width_mm != null && (
                                    <div><span className="font-medium">Overall width:</span> {preview.overall_width_mm} mm</div>
                                )}
                            </div>

                            {rooms.length > 0 && (
                                <div>
                                    <div className="font-medium text-gray-800 mb-1">Rooms</div>
                                    <div className="text-gray-600">
                                        {rooms.map((r) => r.name).join(', ')}
                                    </div>
                                </div>
                            )}

                            <div>
                                <div className="font-medium text-gray-800 mb-1">Wall dimensions detected</div>
                                <div className="text-gray-600">
                                    {wallDims.length
                                        ? [...new Set(wallDims.map((d) => d.value_mm))].sort((a, b) => a - b).join(', ')
                                        : 'None'}
                                </div>
                            </div>

                            <div>
                                <div className="font-medium text-gray-800 mb-1">Panel module hints</div>
                                <div className="text-gray-600">
                                    {panelHints.length
                                        ? panelHints
                                            .map((d) => d.text || `${d.quantity || 1} x ${d.module_mm || d.value_mm}`)
                                            .slice(0, 12)
                                            .join(', ')
                                        : 'None'}
                                </div>
                            </div>

                            {(preview.notes || []).length > 0 && (
                                <div className="rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-xs px-3 py-2 space-y-1">
                                    {(preview.notes || []).map((n, i) => (
                                        <div key={i}>{n}</div>
                                    ))}
                                </div>
                            )}

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
                        {busy && !preview ? 'Parsing…' : 'Preview plan'}
                    </button>
                    <button
                        type="button"
                        className="form-btn-primary px-4 py-2 text-sm"
                        disabled={!preview?.walls?.length || busy}
                        onClick={() => runParse(file, true)}
                    >
                        {busy && preview ? 'Importing…' : 'Import into project'}
                    </button>
                </div>
            </div>
        </ModalOverlay>
    );
}
