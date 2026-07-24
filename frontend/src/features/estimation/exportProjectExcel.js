import ExcelJS from 'exceljs';
import { getPanelFinishingLabel, sortMaterialPanels } from '../panel/wallPlanPanelUtils';
import { groupWallPanelsForDisplay } from '../panel/wallPanelCalculationUtils';

const COLORS = {
    titleFill: '1E3A5F',
    titleFont: 'FFFFFF',
    sectionFill: '334155',
    sectionFont: 'FFFFFF',
    headerFill: '2563EB',
    headerFont: 'FFFFFF',
    headerAlt: {
        wall: '2563EB',
        ceiling: '16A34A',
        floor: '7C3AED',
        doors: '4F46E5',
        slabs: 'CA8A04',
        support: 'EA580C',
        totals: '475569',
        install: '4F46E5',
        meta: '64748B',
    },
    altRow: 'F8FAFC',
    border: 'CBD5E1',
    labelFill: 'F1F5F9',
    thinBorder: {
        style: 'thin',
        color: { argb: 'FFCBD5E1' },
    },
};

function calculateRoomArea(roomPoints) {
    if (!Array.isArray(roomPoints) || roomPoints.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < roomPoints.length; i++) {
        const j = (i + 1) % roomPoints.length;
        area += roomPoints[i].x * roomPoints[j].y;
        area -= roomPoints[j].x * roomPoints[i].y;
    }
    return Math.abs(area) / 2;
}

function formatProjectFileName(name) {
    return String(name || 'Project')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

function sanitizeSheetName(name, usedNames) {
    let base = String(name || 'Room')
        .replace(/[\\/?*[\]:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 28) || 'Room';

    let candidate = base;
    let n = 2;
    while (usedNames.has(candidate.toLowerCase())) {
        const suffix = ` (${n})`;
        candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
        n += 1;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
}

function getRoomWallIdSet(room) {
    const ids = new Set();
    (room?.walls || []).forEach((w) => {
        const id = typeof w === 'object' && w !== null ? w.id : w;
        if (id != null && id !== '') ids.add(String(id));
    });
    return ids;
}

function panelRoomId(panel) {
    let rid = panel?.room_id ?? panel?.room ?? panel?.roomId;
    if (rid != null && typeof rid === 'object') {
        rid = rid.id ?? rid.room_id ?? rid;
    }
    return rid == null || rid === '' ? null : String(rid);
}

function groupCeilingPanels(panels = []) {
    const panelsByDimension = new Map();
    panels.forEach((panel) => {
        if (!panel) return;
        const panelThickness = panel.thickness || 150;
        const isVertical = panel.width >= panel.length;
        let displayWidth = panel.width;
        let displayLength = panel.length;
        if (isVertical) {
            displayWidth = panel.length;
            displayLength = panel.width;
        }
        const intMat = panel.inner_face_material ?? 'PPGI';
        const intThk = panel.inner_face_thickness ?? 0.5;
        const extMat = panel.outer_face_material ?? 'PPGI';
        const extThk = panel.outer_face_thickness ?? 0.5;
        const key = `${displayWidth}_${displayLength}_${panelThickness}_${intMat}_${intThk}_${extMat}_${extThk}`;
        if (!panelsByDimension.has(key)) {
            panelsByDimension.set(key, {
                width: displayWidth,
                length: displayLength,
                thickness: panelThickness,
                quantity: 0,
                inner_face_material: intMat,
                inner_face_thickness: intThk,
                outer_face_material: extMat,
                outer_face_thickness: extThk,
            });
        }
        panelsByDimension.get(key).quantity += 1;
    });
    return sortMaterialPanels(Array.from(panelsByDimension.values()));
}

function groupFloorPanels(panels = [], rooms = []) {
    const roomById = new Map((rooms || []).map((room) => [String(room.id), room]));
    const panelsByKey = new Map();

    panels.forEach((panel) => {
        if (!panel) return;
        const roomId = panelRoomId(panel);
        const room = roomId ? roomById.get(roomId) : null;
        const floorThickness = room?.floor_thickness || 20;
        const isCut = !!(panel.is_cut_panel || panel.is_cut);
        const panelType = isCut ? 'Cut' : 'Full';
        const isVertical = panel.width >= panel.length;
        let displayWidth = panel.width;
        let displayLength = panel.length;
        if (isVertical) {
            displayWidth = panel.length;
            displayLength = panel.width;
        }
        const key = `${displayWidth}_${displayLength}_${floorThickness}_${panelType}`;
        if (!panelsByKey.has(key)) {
            panelsByKey.set(key, {
                width: displayWidth,
                length: displayLength,
                thickness: floorThickness,
                quantity: 0,
                type: panelType,
            });
        }
        panelsByKey.get(key).quantity += 1;
    });

    return sortMaterialPanels(Array.from(panelsByKey.values()));
}

function wallPanelRows(panels = []) {
    return panels.map((panel, index) => [
        index + 1,
        panel.width ?? '',
        panel.length ?? '',
        panel.quantity ?? 1,
        panel.type || '',
        panel.application || '',
        panel.thickness ?? '',
        getPanelFinishingLabel(panel),
    ]);
}

function ceilingPanelRows(panels = []) {
    return panels.map((panel) => {
        const intMat = panel.inner_face_material ?? 'PPGI';
        const intThk = panel.inner_face_thickness ?? 0.5;
        const extMat = panel.outer_face_material ?? 'PPGI';
        const extThk = panel.outer_face_thickness ?? 0.5;
        const same = intMat === extMat && intThk === extThk;
        const finishing = same
            ? `Both ${extThk}mm ${extMat}`
            : `INT ${intThk}mm ${intMat} / EXT ${extThk}mm ${extMat}`;
        return [
            panel.width ?? '',
            panel.length ?? '',
            panel.thickness ?? '',
            panel.quantity ?? 1,
            finishing,
        ];
    });
}

function floorPanelRows(panels = []) {
    return panels.map((panel) => [
        panel.width ?? '',
        panel.length ?? '',
        panel.thickness ?? '',
        panel.quantity ?? 1,
        panel.type || '',
    ]);
}

function doorRows(doors = []) {
    return doors.map((door) => [
        door.door_type || '',
        door.width ?? '',
        door.height ?? '',
        door.thickness ?? '',
    ]);
}

function applyBorder(cell) {
    cell.border = {
        top: COLORS.thinBorder,
        left: COLORS.thinBorder,
        bottom: COLORS.thinBorder,
        right: COLORS.thinBorder,
    };
}

function styleTitleRow(sheet, rowNumber, colCount, text) {
    sheet.mergeCells(rowNumber, 1, rowNumber, colCount);
    const cell = sheet.getCell(rowNumber, 1);
    cell.value = text;
    cell.font = { bold: true, size: 14, color: { argb: `FF${COLORS.titleFont}` } };
    cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: `FF${COLORS.titleFill}` },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    sheet.getRow(rowNumber).height = 26;
    for (let c = 1; c <= colCount; c += 1) {
        applyBorder(sheet.getCell(rowNumber, c));
    }
}

function styleSectionRow(sheet, rowNumber, colCount, text, fillHex = COLORS.sectionFill) {
    sheet.mergeCells(rowNumber, 1, rowNumber, colCount);
    const cell = sheet.getCell(rowNumber, 1);
    cell.value = text;
    cell.font = { bold: true, size: 11, color: { argb: `FF${COLORS.sectionFont}` } };
    cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: `FF${fillHex}` },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    sheet.getRow(rowNumber).height = 22;
    for (let c = 1; c <= colCount; c += 1) {
        applyBorder(sheet.getCell(rowNumber, c));
    }
}

function writeKeyValueRows(sheet, startRow, pairs) {
    let row = startRow;
    pairs.forEach(([label, value]) => {
        const labelCell = sheet.getCell(row, 1);
        const valueCell = sheet.getCell(row, 2);
        labelCell.value = label;
        valueCell.value = value ?? '';
        labelCell.font = { bold: true, size: 10 };
        labelCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: `FF${COLORS.labelFill}` },
        };
        labelCell.alignment = { vertical: 'middle' };
        valueCell.alignment = { vertical: 'middle' };
        applyBorder(labelCell);
        applyBorder(valueCell);
        sheet.getRow(row).height = 18;
        row += 1;
    });
    return row;
}

/**
 * Write a formatted Excel table (header + body) and return next free row.
 * Body text stays on one line (no wrap) so finishing labels are not squeezed.
 * Table width matches the header/body column count only (no extra empty columns).
 */
function writeDataTable(sheet, startRow, headers, bodyRows, {
    headerFill = COLORS.headerFill,
} = {}) {
    if (!bodyRows || bodyRows.length === 0) return startRow;

    const colSpan = headers.length;
    const headerRow = sheet.getRow(startRow);
    headers.forEach((header, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = header;
        cell.font = { bold: true, size: 10, color: { argb: `FF${COLORS.headerFont}` } };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: `FF${headerFill}` },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
        applyBorder(cell);
    });
    headerRow.height = 22;

    bodyRows.forEach((values, rowIndex) => {
        const excelRow = sheet.getRow(startRow + 1 + rowIndex);
        for (let colIndex = 0; colIndex < colSpan; colIndex += 1) {
            const cell = excelRow.getCell(colIndex + 1);
            const value = values[colIndex] ?? '';
            cell.value = value;
            cell.alignment = {
                vertical: 'middle',
                horizontal: typeof value === 'number' ? 'center' : 'left',
                wrapText: false,
            };
            cell.font = { size: 10 };
            if (rowIndex % 2 === 1) {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: `FF${COLORS.altRow}` },
                };
            }
            applyBorder(cell);
        }
        excelRow.height = 20;
    });

    return startRow + 1 + bodyRows.length;
}

function setColumnWidths(sheet, widths) {
    widths.forEach((width, index) => {
        sheet.getColumn(index + 1).width = width;
    });
}

/** Widen columns from cell content so finishing / face text stays fully visible. */
function autoFitColumns(sheet, { minWidth = 10, maxWidth = 55, padding = 2 } = {}) {
    const widths = {};
    sheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            // Merged section titles would inflate column A — skip them.
            if (cell.isMerged) return;

            const raw = cell.value;
            let text = '';
            if (raw == null) text = '';
            else if (typeof raw === 'object' && Array.isArray(raw.richText)) {
                text = raw.richText.map((part) => part.text || '').join('');
            } else {
                text = String(raw);
            }
            const needed = Math.min(maxWidth, Math.max(minWidth, text.length + padding));
            widths[colNumber] = Math.max(widths[colNumber] || minWidth, needed);
        });
    });
    Object.entries(widths).forEach(([col, width]) => {
        sheet.getColumn(Number(col)).width = width;
    });
}

function appendSection(sheet, row, {
    title,
    headers,
    bodyRows,
    headerFill,
}) {
    if (!bodyRows || bodyRows.length === 0) return row;

    const colSpan = headers.length;
    styleSectionRow(sheet, row, colSpan, title, headerFill);
    row += 1;
    row = writeDataTable(sheet, row, headers, bodyRows, { headerFill });
    return row + 2; // blank gap after each table
}

function buildProjectSheet(workbook, exportData, slabWidth, slabLength) {
    const sheet = workbook.addWorksheet('Project Summary', {
        views: [{ state: 'frozen', ySplit: 1 }],
        properties: { defaultRowHeight: 18 },
    });
    // Col 5 must be wide: ceiling/floor "Face / Finishing" lands here (not col 8).
    setColumnWidths(sheet, [16, 14, 14, 10, 42, 16, 12, 42]);

    const wallRows = wallPanelRows(exportData?.wallPanels || []);
    const ceilingRows = ceilingPanelRows(exportData?.ceilingPanels || []);
    const floorRows = floorPanelRows(exportData?.floorPanels || []);
    const doorBody = doorRows(exportData?.doors || []);
    const titleSpan = Math.max(
        3, // project totals
        wallRows.length ? 8 : 0,
        ceilingRows.length ? 5 : 0,
        floorRows.length ? 5 : 0,
        doorBody.length ? 4 : 0,
        (exportData?.slabs || []).length ? 4 : 0,
        exportData?.supportAccessories?.isNeeded ? 2 : 0,
        2
    );

    let row = 1;
    styleTitleRow(sheet, row, titleSpan, 'PROJECT SUMMARY');
    row += 1;

    const info = exportData?.projectInfo || {};
    row = writeKeyValueRows(sheet, row, [
        ['Project Name', info.name || ''],
        ['Dimensions', info.dimensions || ''],
        ['Rooms', info.rooms ?? ''],
        ['Walls', info.walls ?? ''],
        ['Doors', info.doors ?? ''],
        ['Export Date', exportData?.exportDate || ''],
    ]);
    row += 1;

    const totalWall = (exportData?.wallPanels || []).reduce((s, p) => s + (p.quantity || 1), 0);
    const totalCeiling = (exportData?.ceilingPanels || []).reduce((s, p) => s + (p.quantity || 1), 0);
    const totalFloor = (exportData?.floorPanels || []).reduce((s, p) => s + (p.quantity || 1), 0);
    const slabArea = slabWidth * slabLength;
    const totalSlabs = (exportData?.slabs || []).reduce((sum, room) => {
        if (room.room_points?.length > 0 && slabArea > 0) {
            return sum + Math.ceil(calculateRoomArea(room.room_points) / slabArea);
        }
        return sum;
    }, 0);

    row = appendSection(sheet, row, {
        title: 'PROJECT TOTALS',
        headers: ['Item', 'Quantity', 'Notes'],
        bodyRows: [
            ['Total Wall Panels', totalWall, 'From project panel calculation'],
            ['Total Ceiling Panels', totalCeiling, 'From ceiling plans'],
            ['Total Floor Panels', totalFloor, 'From floor plans'],
            ['Total Doors', (exportData?.doors || []).length, 'From project data'],
            ['Total Slabs', totalSlabs, `Slab size ${slabWidth} x ${slabLength} mm`],
        ],
        headerFill: COLORS.headerAlt.totals,
    });

    if (exportData?.installationEstimates) {
        row = appendSection(sheet, row, {
            title: 'INSTALLATION TIME ESTIMATES',
            headers: ['Working Days', 'Working Weeks', 'Working Months'],
            bodyRows: [[
                exportData.installationEstimates.days ?? '',
                exportData.installationEstimates.weeks ?? '',
                exportData.installationEstimates.months ?? '',
            ]],
            headerFill: COLORS.headerAlt.install,
        });
    }

    row = appendSection(sheet, row, {
        title: 'WALL PANELS (WHOLE PROJECT)',
        headers: ['No.', 'Width (mm)', 'Length (mm)', 'Qty', 'Type', 'Application', 'Thk (mm)', 'Finishing'],
        bodyRows: wallRows,
        headerFill: COLORS.headerAlt.wall,
    });

    row = appendSection(sheet, row, {
        title: 'CEILING PANELS (WHOLE PROJECT)',
        headers: ['Width (mm)', 'Length (mm)', 'Thk (mm)', 'Qty', 'Face / Finishing'],
        bodyRows: ceilingRows,
        headerFill: COLORS.headerAlt.ceiling,
    });

    row = appendSection(sheet, row, {
        title: 'FLOOR PANELS (WHOLE PROJECT)',
        headers: ['Width (mm)', 'Length (mm)', 'Thk (mm)', 'Qty', 'Type'],
        bodyRows: floorRows,
        headerFill: COLORS.headerAlt.floor,
    });

    row = appendSection(sheet, row, {
        title: 'DOORS (WHOLE PROJECT)',
        headers: ['Type', 'Width (mm)', 'Height (mm)', 'Thk (mm)'],
        bodyRows: doorBody,
        headerFill: COLORS.headerAlt.doors,
    });

    if ((exportData?.slabs || []).length > 0) {
        row = appendSection(sheet, row, {
            title: 'SLAB FLOORS (WHOLE PROJECT)',
            headers: ['Room Name', 'Area (m2)', 'Slab Size (mm)', 'Slabs Needed'],
            bodyRows: exportData.slabs.map((room) => {
                const areaMm2 = room.room_points?.length ? calculateRoomArea(room.room_points) : 0;
                return [
                    room.room_name || 'Unnamed Room',
                    areaMm2 > 0 ? Math.round(areaMm2 / 1000000) : '',
                    `${slabWidth} x ${slabLength}`,
                    areaMm2 > 0 && slabArea > 0 ? Math.ceil(areaMm2 / slabArea) : '',
                ];
            }),
            headerFill: COLORS.headerAlt.slabs,
        });
    }

    if (exportData?.supportAccessories?.isNeeded) {
        row = appendSection(sheet, row, {
            title: 'SUPPORT ACCESSORIES',
            headers: ['Property', 'Value'],
            bodyRows: [
                ['Support Type', exportData.supportAccessories.type === 'nylon' ? 'Nylon Hanger' : 'Alu Suspension'],
                ['Include Accessories', exportData.supportAccessories.includeAccessories ? 'Yes' : 'No'],
                ['Include Cable', exportData.supportAccessories.includeCable ? 'Yes' : 'No'],
            ],
            headerFill: COLORS.headerAlt.support,
        });
    }

    autoFitColumns(sheet);
    return sheet;
}

function buildRoomSheet(workbook, sheetName, {
    room,
    wallPanels,
    ceilingPanels,
    floorPanels,
    doors,
    slabWidth,
    slabLength,
}) {
    const sheet = workbook.addWorksheet(sheetName, {
        views: [{ state: 'frozen', ySplit: 1 }],
        properties: { defaultRowHeight: 18 },
    });
    setColumnWidths(sheet, [16, 14, 14, 10, 42, 16, 12, 42]);

    const areaMm2 = room.room_points?.length ? calculateRoomArea(room.room_points) : 0;
    const isSlab = room.floor_type === 'slab' || room.floor_type === 'Slab';
    const slabArea = slabWidth * slabLength;
    const wallRows = wallPanelRows(wallPanels);
    const ceilingRows = ceilingPanelRows(ceilingPanels);
    const floorRows = floorPanelRows(floorPanels);
    const doorBody = doorRows(doors);
    const titleSpan = Math.max(
        wallRows.length ? 8 : 0,
        ceilingRows.length ? 5 : 0,
        floorRows.length ? 5 : 0,
        doorBody.length ? 4 : 0,
        isSlab ? 3 : 0,
        2
    );

    let row = 1;
    styleTitleRow(sheet, row, titleSpan, 'ROOM PANEL LIST');
    row += 1;

    row = writeKeyValueRows(sheet, row, [
        ['Room Name', room.room_name || 'Unnamed Room'],
        ['Level', room.storey_name || 'Unassigned'],
        ['Floor Type', room.floor_type || ''],
        ['Floor Thickness (mm)', room.floor_thickness ?? ''],
        ['Height (mm)', room.height ?? ''],
        ['Area (m2)', areaMm2 > 0 ? Math.round(areaMm2 / 1000000) : ''],
    ]);
    row += 1;

    row = appendSection(sheet, row, {
        title: 'WALL PANELS',
        headers: ['No.', 'Width (mm)', 'Length (mm)', 'Qty', 'Type', 'Application', 'Thk (mm)', 'Finishing'],
        bodyRows: wallRows,
        headerFill: COLORS.headerAlt.wall,
    });

    row = appendSection(sheet, row, {
        title: 'CEILING PANELS',
        headers: ['Width (mm)', 'Length (mm)', 'Thk (mm)', 'Qty', 'Face / Finishing'],
        bodyRows: ceilingRows,
        headerFill: COLORS.headerAlt.ceiling,
    });

    row = appendSection(sheet, row, {
        title: 'FLOOR PANELS',
        headers: ['Width (mm)', 'Length (mm)', 'Thk (mm)', 'Qty', 'Type'],
        bodyRows: floorRows,
        headerFill: COLORS.headerAlt.floor,
    });

    row = appendSection(sheet, row, {
        title: 'DOORS',
        headers: ['Type', 'Width (mm)', 'Height (mm)', 'Thk (mm)'],
        bodyRows: doorBody,
        headerFill: COLORS.headerAlt.doors,
    });

    if (isSlab) {
        row = appendSection(sheet, row, {
            title: 'SLAB FLOOR',
            headers: ['Area (m2)', 'Slab Size (mm)', 'Slabs Needed'],
            bodyRows: [[
                areaMm2 > 0 ? Math.round(areaMm2 / 1000000) : '',
                `${slabWidth} x ${slabLength}`,
                areaMm2 > 0 && slabArea > 0 ? Math.ceil(areaMm2 / slabArea) : '',
            ]],
            headerFill: COLORS.headerAlt.slabs,
        });
    }

    if (
        wallPanels.length === 0 &&
        ceilingPanels.length === 0 &&
        floorPanels.length === 0 &&
        doors.length === 0 &&
        !isSlab
    ) {
        const cell = sheet.getCell(row, 1);
        cell.value = 'No panel / door data for this room.';
        cell.font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
        cell.alignment = { vertical: 'middle', indent: 1 };
    }

    autoFitColumns(sheet);
    return sheet;
}

async function triggerBrowserDownload(buffer, filename) {
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Build and download a multi-sheet Excel workbook with formatted tables:
 * - Sheet 1: whole-project summary + panel lists
 * - Sheets 2..n: one sheet per room with that room's panels only
 */
export async function downloadProjectExcel({
    exportData,
    rawWallPanels = [],
    rawCeilingPanels = [],
    rawFloorPanels = [],
    slabWidth = 1210,
    slabLength = 3000,
} = {}) {
    if (!exportData) {
        throw new Error('Export data is required');
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'United Panel';
    workbook.created = new Date();

    const usedNames = new Set(['project summary']);
    buildProjectSheet(workbook, exportData, slabWidth, slabLength);

    const rooms = exportData.rooms || [];
    rooms.forEach((room) => {
        const wallIds = getRoomWallIdSet(room);
        const roomWallPanels = sortMaterialPanels(
            groupWallPanelsForDisplay(
                (rawWallPanels || []).filter((panel) => wallIds.has(String(panel.wallId)))
            )
        );
        const roomCeilingPanels = groupCeilingPanels(
            (rawCeilingPanels || []).filter((panel) => panelRoomId(panel) === String(room.id))
        );
        const roomFloorPanels = groupFloorPanels(
            (rawFloorPanels || []).filter((panel) => panelRoomId(panel) === String(room.id)),
            [room]
        );
        const roomDoors = (exportData.doors || []).filter((door) => {
            const wallId = door.linked_wall ?? door.wall_id ?? door.wall;
            const id = typeof wallId === 'object' && wallId !== null ? wallId.id : wallId;
            return id != null && wallIds.has(String(id));
        });

        const levelPrefix = room.storey_name ? `${room.storey_name} - ` : '';
        const sheetTitle = sanitizeSheetName(
            `${levelPrefix}${room.room_name || `Room ${room.id}`}`,
            usedNames
        );

        buildRoomSheet(workbook, sheetTitle, {
            room,
            wallPanels: roomWallPanels,
            ceilingPanels: roomCeilingPanels,
            floorPanels: roomFloorPanels,
            doors: roomDoors,
            slabWidth,
            slabLength,
        });
    });

    const filename = `${formatProjectFileName(exportData.projectInfo?.name)} Project Summary.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    await triggerBrowserDownload(buffer, filename);
    return filename;
}
