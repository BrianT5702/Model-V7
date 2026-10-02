import React, { useEffect, useRef } from 'react';
import { calculateActualProjectDimensions } from '../canvas/drawing';
import { formatDimensionValue } from '../canvas/DimensionConfig';
import {
    collectExtentsFromRooms,
    computePlanFitTransform,
} from '../canvas/planCanvasUtils';
import {
    getPlanCanvasBackground,
    getPlanCanvasGridColor,
    getPlanDefaultWallColors,
} from '../canvas/planCanvasTheme';
import { useTheme } from '../theme/ThemeContext';

function mergeBounds(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
        minX: Math.min(a.minX, b.minX),
        maxX: Math.max(a.maxX, b.maxX),
        minY: Math.min(a.minY, b.minY),
        maxY: Math.max(a.maxY, b.maxY),
    };
}

function boundsFromPayload(walls, rooms, project) {
    const wallBounds = walls.length
        ? calculateActualProjectDimensions(walls)
        : null;
    const roomBounds = collectExtentsFromRooms(rooms);
    let bounds = mergeBounds(
        wallBounds && wallBounds.width > 0
            ? { minX: wallBounds.minX, maxX: wallBounds.maxX, minY: wallBounds.minY, maxY: wallBounds.maxY }
            : null,
        roomBounds
    );
    if (!bounds && project) {
        bounds = { minX: 0, maxX: Number(project.width) || 10000, minY: 0, maxY: Number(project.length) || 10000 };
    }
    return bounds;
}

function toCanvas(x, y, scale, offsetX, offsetY) {
    return { x: offsetX + Number(x) * scale, y: offsetY + Number(y) * scale };
}

function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

function pointsClose(a, b, tolMm = 12) {
    return dist2(a, b) <= tolMm * tolMm;
}

function lineIntersection(a1, a2, b1, b2) {
    const dax = a2.x - a1.x;
    const day = a2.y - a1.y;
    const dbx = b2.x - b1.x;
    const dby = b2.y - b1.y;
    const denom = dax * dby - day * dbx;
    if (Math.abs(denom) < 1e-9) {
        return null;
    }
    const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom;
    if (!Number.isFinite(t)) {
        return null;
    }
    return { x: a1.x + t * dax, y: a1.y + t * day };
}

function wallOffsetFaces(wall) {
    const sx = Number(wall.start_x);
    const sy = Number(wall.start_y);
    const ex = Number(wall.end_x);
    const ey = Number(wall.end_y);
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.hypot(dx, dy) || 1;
    const half = (Number(wall.thickness) || 100) / 2;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    return {
        left: [{ x: sx + nx, y: sy + ny }, { x: ex + nx, y: ey + ny }],
        right: [{ x: sx - nx, y: sy - ny }, { x: ex - nx, y: ey - ny }],
        start: { x: sx, y: sy },
        end: { x: ex, y: ey },
        half,
        isPartition: String(wall.application_type || '').toLowerCase() === 'partition',
    };
}

function miterWallEnd(faces, whichEnd, others) {
    const joint = whichEnd === 'start' ? faces.start : faces.end;
    const leftFallback = whichEnd === 'start' ? faces.left[0] : faces.left[1];
    const rightFallback = whichEnd === 'start' ? faces.right[0] : faces.right[1];
    if (!others.length) {
        return { left: leftFallback, right: rightFallback };
    }
    const wallDx = faces.end.x - faces.start.x;
    const wallDy = faces.end.y - faces.start.y;
    const len = Math.hypot(wallDx, wallDy) || 1;
    const out = whichEnd === 'start'
        ? { x: -wallDx / len, y: -wallDy / len }
        : { x: wallDx / len, y: wallDy / len };
    const maxMiter = Math.max(faces.half * 8, 400);
    const alongOut = (point) => (point.x - joint.x) * out.x + (point.y - joint.y) * out.y;
    const usable = (point) => (
        point
        && Number.isFinite(point.x)
        && Number.isFinite(point.y)
        && dist2(point, joint) <= maxMiter * maxMiter
    );
    const farthestOut = (fallback, hits) => {
        const valid = [fallback, ...hits].filter(usable);
        if (!valid.length) {
            return fallback;
        }
        valid.sort((a, b) => alongOut(b) - alongOut(a));
        return valid[0];
    };

    let left = leftFallback;
    let right = rightFallback;
    others.forEach((other) => {
        left = farthestOut(left, [
            lineIntersection(faces.left[0], faces.left[1], other.left[0], other.left[1]),
            lineIntersection(faces.left[0], faces.left[1], other.right[0], other.right[1]),
        ]);
        right = farthestOut(right, [
            lineIntersection(faces.right[0], faces.right[1], other.left[0], other.left[1]),
            lineIntersection(faces.right[0], faces.right[1], other.right[0], other.right[1]),
        ]);
    });
    return { left, right };
}

function fillWallPolygon(ctx, points, color) {
    if (!points || points.length < 3) {
        return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'miter';
    ctx.fill();
    ctx.stroke();
}

function drawJoinedPreviewWalls(ctx, walls, scale, offsetX, offsetY, colors) {
    const facesList = walls.map(wallOffsetFaces);
    walls.forEach((wall, index) => {
        const faces = facesList[index];
        const othersAt = (joint) => facesList.filter((other, otherIndex) => (
            otherIndex !== index
            && (pointsClose(other.start, joint) || pointsClose(other.end, joint))
        ));
        const startJoin = miterWallEnd(faces, 'start', othersAt(faces.start));
        const endJoin = miterWallEnd(faces, 'end', othersAt(faces.end));
        const polygon = [startJoin.left, endJoin.left, endJoin.right, startJoin.right].map((point) => (
            toCanvas(point.x, point.y, scale, offsetX, offsetY)
        ));
        fillWallPolygon(ctx, polygon, faces.isPartition ? colors.partition : colors.wall);
    });
}

function storeyIdOf(row) {
    if (row == null) return null;
    if (row.storey != null && typeof row.storey === 'object') {
        return row.storey.id ?? row.storey;
    }
    return row.storey ?? row.storey_id ?? null;
}

export function filterPreviewByStoreyOrder(payload, storeyOrder) {
    if (storeyOrder == null || !payload) {
        return payload;
    }
    const storey = (payload.storeys || []).find((item) => Number(item.order) === Number(storeyOrder));
    if (!storey) {
        return { ...payload, walls: [], rooms: [], doors: [] };
    }
    const storeyId = storey.id;
    return {
        ...payload,
        walls: (payload.walls || []).filter((wall) => Number(storeyIdOf(wall)) === Number(storeyId)),
        rooms: (payload.rooms || []).filter((room) => Number(storeyIdOf(room)) === Number(storeyId)),
        doors: (payload.doors || []).filter((door) => Number(storeyIdOf(door)) === Number(storeyId)),
    };
}

function drawGrid(ctx, width, height) {
    const step = 32;
    ctx.strokeStyle = getPlanCanvasGridColor(false);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += step) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
    }
    for (let y = 0; y <= height; y += step) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();
}

function wallLengthMm(wall) {
    return Math.hypot(
        Number(wall.end_x) - Number(wall.start_x),
        Number(wall.end_y) - Number(wall.start_y)
    );
}

function drawDimTicks(ctx, ax, ay, bx, by, color) {
    const dx = bx - ax;
    const dy = by - ay;
    const mag = Math.hypot(dx, dy) || 1;
    const tx = (-dy / mag) * 5;
    const ty = (dx / mag) * 5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.moveTo(ax - tx, ay - ty);
    ctx.lineTo(ax + tx, ay + ty);
    ctx.moveTo(bx - tx, by - ty);
    ctx.lineTo(bx + tx, by + ty);
    ctx.stroke();
}

function drawDimLabel(ctx, text, x, y, angle, fillBg, fillFg, occupied) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width;
    const box = { x, y, r: Math.max(16, width / 2 + 6) };
    const overlaps = occupied.some((item) => Math.hypot(item.x - x, item.y - y) < item.r + box.r);
    if (overlaps) {
        ctx.restore();
        return false;
    }
    ctx.fillStyle = fillBg;
    ctx.fillRect(-width / 2 - 3, -7, width + 6, 14);
    ctx.fillStyle = fillFg;
    ctx.fillText(text, 0, 0);
    ctx.restore();
    occupied.push(box);
    return true;
}

function drawPreviewDimensions(ctx, walls, scale, offsetX, offsetY, isDark) {
    if (!walls.length) {
        return;
    }
    const actual = calculateActualProjectDimensions(walls);
    const { minX, maxX, minY, maxY } = actual;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const wallColor = isDark ? '#93c5fd' : '#1d4ed8';
    const projectColor = isDark ? '#c4b5fd' : '#7c3aed';
    const labelBg = isDark ? 'rgba(17, 24, 39, 0.82)' : 'rgba(255, 255, 255, 0.9)';
    const occupied = [];

    walls.forEach((wall) => {
        const length = wallLengthMm(wall);
        if (!Number.isFinite(length) || length < 20) {
            return;
        }
        const dx = Number(wall.end_x) - Number(wall.start_x);
        const dy = Number(wall.end_y) - Number(wall.start_y);
        const mag = Math.hypot(dx, dy) || 1;
        let nx = -dy / mag;
        let ny = dx / mag;
        const mx = (Number(wall.start_x) + Number(wall.end_x)) / 2;
        const my = (Number(wall.start_y) + Number(wall.end_y)) / 2;
        if (nx * (cx - mx) + ny * (cy - my) > 0) {
            nx = -nx;
            ny = -ny;
        }
        const start = toCanvas(wall.start_x, wall.start_y, scale, offsetX, offsetY);
        const end = toCanvas(wall.end_x, wall.end_y, scale, offsetX, offsetY);
        const shift = 14;
        const ax = start.x + nx * shift;
        const ay = start.y + ny * shift;
        const bx = end.x + nx * shift;
        const by = end.y + ny * shift;
        drawDimTicks(ctx, ax, ay, bx, by, wallColor);
        let angle = Math.atan2(by - ay, bx - ax);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
            angle += Math.PI;
        }
        drawDimLabel(
            ctx,
            formatDimensionValue(length),
            (ax + bx) / 2,
            (ay + by) / 2,
            angle,
            labelBg,
            wallColor,
            occupied
        );
    });

    const topLeft = toCanvas(minX, minY, scale, offsetX, offsetY);
    const topRight = toCanvas(maxX, minY, scale, offsetX, offsetY);
    const bottomRight = toCanvas(maxX, maxY, scale, offsetX, offsetY);
    const projectShift = 28;
    drawDimTicks(ctx, topLeft.x, topLeft.y - projectShift, topRight.x, topRight.y - projectShift, projectColor);
    drawDimLabel(
        ctx,
        formatDimensionValue(actual.width),
        (topLeft.x + topRight.x) / 2,
        topLeft.y - projectShift,
        0,
        labelBg,
        projectColor,
        occupied
    );
    drawDimTicks(ctx, topRight.x + projectShift, topRight.y, bottomRight.x + projectShift, bottomRight.y, projectColor);
    let lengthAngle = Math.PI / 2;
    drawDimLabel(
        ctx,
        formatDimensionValue(actual.length),
        topRight.x + projectShift,
        (topRight.y + bottomRight.y) / 2,
        lengthAngle,
        labelBg,
        projectColor,
        occupied
    );
}

const VersionPlanPreview = ({ payload, storeyOrder = null }) => {
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    const { isDark } = useTheme();

    useEffect(() => {
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) {
            return undefined;
        }

        const draw = () => {
            const rect = wrap.getBoundingClientRect();
            const cssWidth = Math.max(Math.floor(rect.width), 1);
            const cssHeight = Math.max(Math.floor(rect.height), 1);
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.floor(cssWidth * dpr);
            canvas.height = Math.floor(cssHeight * dpr);
            canvas.style.width = `${cssWidth}px`;
            canvas.style.height = `${cssHeight}px`;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const filtered = filterPreviewByStoreyOrder(payload, storeyOrder) || {};
            const walls = Array.isArray(filtered.walls) ? filtered.walls : [];
            const rooms = Array.isArray(filtered.rooms) ? filtered.rooms : [];
            const doors = Array.isArray(filtered.doors) ? filtered.doors : [];
            const project = filtered.project || {};

            ctx.fillStyle = getPlanCanvasBackground();
            ctx.fillRect(0, 0, cssWidth, cssHeight);
            drawGrid(ctx, cssWidth, cssHeight);

            if (!walls.length && !rooms.length) {
                ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
                ctx.font = '13px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('No walls or rooms in this snapshot.', cssWidth / 2, cssHeight / 2);
                return;
            }

            const bounds = boundsFromPayload(walls, rooms, project);
            const { scale, offsetX, offsetY } = computePlanFitTransform(cssWidth, cssHeight, bounds, {
                padding: 56,
                maxScale: 4,
            });
            const colors = getPlanDefaultWallColors();

            rooms.forEach((room) => {
                const points = Array.isArray(room.room_points) ? room.room_points : [];
                if (points.length < 3) {
                    return;
                }
                ctx.beginPath();
                points.forEach((point, index) => {
                    const mapped = toCanvas(point.x, point.y, scale, offsetX, offsetY);
                    if (index === 0) {
                        ctx.moveTo(mapped.x, mapped.y);
                    } else {
                        ctx.lineTo(mapped.x, mapped.y);
                    }
                });
                ctx.closePath();
                ctx.fillStyle = isDark ? 'rgba(59, 130, 246, 0.12)' : 'rgba(59, 130, 246, 0.08)';
                ctx.fill();
            });

            drawJoinedPreviewWalls(ctx, walls, scale, offsetX, offsetY, colors);

            doors.forEach((door) => {
                const wall = walls.find((item) => Number(item.id) === Number(door.linked_wall || door.wall_id));
                if (!wall) {
                    return;
                }
                const t = Math.min(1, Math.max(0, Number(door.position_x) || 0));
                const x = Number(wall.start_x) + (Number(wall.end_x) - Number(wall.start_x)) * t;
                const y = Number(wall.start_y) + (Number(wall.end_y) - Number(wall.start_y)) * t;
                const point = toCanvas(x, y, scale, offsetX, offsetY);
                ctx.fillStyle = isDark ? '#fbbf24' : '#d97706';
                ctx.beginPath();
                ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
                ctx.fill();
            });

            drawPreviewDimensions(ctx, walls, scale, offsetX, offsetY, isDark);
        };

        draw();
        const observer = new ResizeObserver(() => draw());
        observer.observe(wrap);
        return () => observer.disconnect();
    }, [payload, storeyOrder, isDark]);

    return (
        <div ref={wrapRef} className="absolute inset-0">
            <canvas ref={canvasRef} className="block w-full h-full" />
        </div>
    );
};

export default VersionPlanPreview;
