// Door anchor geometry: exterior installs on outer face (line1), interior on inner face (line2).

function pointOnLine(line, t) {
    return {
        x: line[0].x + (line[1].x - line[0].x) * t,
        y: line[0].y + (line[1].y - line[0].y) * t,
    };
}

function getWallLines(wall) {
    const line1 = wall._line1 || [
        { x: wall.start_x, y: wall.start_y },
        { x: wall.end_x, y: wall.end_y },
    ];
    const line2 = wall._line2 || line1;
    return { line1, line2 };
}

export function resolveDoorPlacement(wall, door) {
    const { line1, line2 } = getWallLines(wall);

    const wallLength = Math.hypot(wall.end_x - wall.start_x, wall.end_y - wall.start_y) || 1;
    const slashLength =
        door.door_type === 'swing'
            ? door.width
            : door.door_type === 'dock'
              ? door.width
              : door.width * 0.85;
    const halfSlashRatio = slashLength / wallLength / 2;
    const gapRatio = 200 / wallLength;
    const clampedPosition = Math.min(
        Math.max(door.position_x, halfSlashRatio + gapRatio),
        1 - halfSlashRatio - gapRatio
    );

    const isInterior = door.side === 'interior';
    const attachLine = isInterior ? line2 : line1;
    const anchor = pointOnLine(attachLine, clampedPosition);

    const angle = Math.atan2(
        attachLine[1].y - attachLine[0].y,
        attachLine[1].x - attachLine[0].x
    );

    const m1x = (line1[0].x + line1[1].x) / 2;
    const m1y = (line1[0].y + line1[1].y) / 2;
    const m2x = (line2[0].x + line2[1].x) / 2;
    const m2y = (line2[0].y + line2[1].y) / 2;
    let interiorDirX = m2x - m1x;
    let interiorDirY = m2y - m1y;
    const interiorLen = Math.hypot(interiorDirX, interiorDirY);
    if (interiorLen > 1e-6) {
        interiorDirX /= interiorLen;
        interiorDirY /= interiorLen;
    } else {
        interiorDirX = 0;
        interiorDirY = 1;
    }

    const localYWorldX = -Math.sin(angle);
    const localYWorldY = Math.cos(angle);
    const dot = localYWorldX * interiorDirX + localYWorldY * interiorDirY;
    const ySign = dot >= 0 ? 1 : -1;

    return {
        doorCenterX: anchor.x,
        doorCenterY: anchor.y,
        angle,
        ySign,
        clampedPosition,
        slashLength,
        slashHalf: door.door_type !== 'dock' ? slashLength / 2 : 0,
        isInterior,
    };
}

/** Slide panel sits on the room side when interior, exterior side when exterior. */
export function getSlidePanelYOffset(placement, wallThickness) {
    return placement.isInterior ? wallThickness : -wallThickness;
}

export function worldToDoorLocal(worldX, worldY, placement) {
    const { doorCenterX, doorCenterY, angle, ySign } = placement;
    const dx = worldX - doorCenterX;
    const dy = worldY - doorCenterY;
    const cosA = Math.cos(-angle);
    const sinA = Math.sin(-angle);
    const rx = cosA * dx - sinA * dy;
    const ry = sinA * dx + cosA * dy;
    return { x: rx, y: ry / ySign };
}

export function doorLocalToWorld(localX, localY, placement, options = {}) {
    let ly = localY;
    if (options.swingInteriorFlip && placement.isInterior) {
        ly = -ly;
    }
    const { doorCenterX, doorCenterY, angle, ySign } = placement;
    const scaledY = ly * ySign;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return {
        x: doorCenterX + cosA * localX - sinA * scaledY,
        y: doorCenterY + sinA * localX + cosA * scaledY,
    };
}

function wallWithOffsetLines(wall, wallLinesMap) {
    if (wall._line1 && wall._line2) return wall;
    const wallData = wallLinesMap?.get(wall.id);
    if (!wallData?.line1 || !wallData?.line2) return wall;
    return { ...wall, _line1: wallData.line1, _line2: wallData.line2 };
}

function modelPointToScreen(x, y, scaleFactor, offsetX, offsetY) {
    return { x: x * scaleFactor + offsetX, y: y * scaleFactor + offsetY };
}

function boundsFromModelPoints(points, scaleFactor, offsetX, offsetY, paddingPx = 12) {
    if (!points.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
        const screen = modelPointToScreen(point.x, point.y, scaleFactor, offsetX, offsetY);
        minX = Math.min(minX, screen.x);
        minY = Math.min(minY, screen.y);
        maxX = Math.max(maxX, screen.x);
        maxY = Math.max(maxY, screen.y);
    }
    return {
        x: minX - paddingPx,
        y: minY - paddingPx,
        width: maxX - minX + paddingPx * 2,
        height: maxY - minY + paddingPx * 2,
        type: 'door_obstacle',
    };
}

function collectDoorSymbolPoints(door, wall, placement) {
    const points = [];
    const { slashHalf, isInterior } = placement;
    const wallThickness = wall.thickness || 100;
    const addLocal = (localX, localY, options = {}) => {
        points.push(doorLocalToWorld(localX, localY, placement, options));
    };

    if (door.door_type === 'dock') {
        const rectWidth = door.width * 0.6;
        const rectHeight = door.width * 0.6 + 300;
        const rectY = isInterior ? 0 : -rectHeight;
        addLocal(-rectWidth / 2, rectY);
        addLocal(rectWidth / 2, rectY);
        addLocal(rectWidth / 2, rectY + rectHeight);
        addLocal(-rectWidth / 2, rectY + rectHeight);
        return points;
    }

    const slashLen = wallThickness * 0.6;
    const slashAngle = Math.PI / 4;
    const numSlashes = Math.max(2, 4);
    for (let i = 0; i < numSlashes; i++) {
        const t = numSlashes === 1 ? 0.5 : i / (numSlashes - 1);
        const px = -slashHalf + slashHalf * 2 * t;
        addLocal(px - Math.cos(slashAngle) * slashLen / 2, -Math.sin(slashAngle) * slashLen / 2);
        addLocal(px + Math.cos(slashAngle) * slashLen / 2, Math.sin(slashAngle) * slashLen / 2);
    }

    if (door.door_type === 'slide') {
        const halfLength = door.width * 1.1;
        const panelYOffset = getSlidePanelYOffset(placement, wallThickness);
        const offsets =
            door.configuration === 'double_sided' ? [-slashHalf / 2, slashHalf / 2] : [0];
        for (const offsetX of offsets) {
            addLocal(offsetX - halfLength / 2, panelYOffset - wallThickness / 2);
            addLocal(offsetX + halfLength / 2, panelYOffset + wallThickness / 2);
            addLocal(offsetX - halfLength / 2, panelYOffset + wallThickness * 2);
            addLocal(offsetX + halfLength / 2, panelYOffset + wallThickness * 2);
        }
    } else if (door.door_type === 'swing') {
        const radius = door.width / (door.configuration === 'double_sided' ? 2 : 1);
        const swingFlip = { swingInteriorFlip: isInterior };
        const panels =
            door.configuration === 'double_sided'
                ? [
                      { hingeOffset: -slashHalf, direction: 'left' },
                      { hingeOffset: slashHalf, direction: 'right' },
                  ]
                : [
                      {
                          hingeOffset: door.swing_direction === 'right' ? slashHalf : -slashHalf,
                          direction: door.swing_direction,
                      },
                  ];
        for (const { hingeOffset, direction } of panels) {
            const isRight = direction === 'right';
            const arcStart = isRight ? Math.PI : 0;
            const arcEnd = isRight ? Math.PI * 1.5 : -Math.PI * 0.5;
            addLocal(hingeOffset, 0, swingFlip);
            for (let step = 0; step <= 8; step++) {
                const t = step / 8;
                const ang = arcStart + (arcEnd - arcStart) * t;
                addLocal(hingeOffset + Math.cos(ang) * radius, Math.sin(ang) * radius, swingFlip);
            }
        }
    }

    return points;
}

/** Screen-space label obstacles so dimension text avoids door symbols. */
export function buildDoorLabelObstacles(doors, walls, scaleFactor, offsetX, offsetY, wallLinesMap = null) {
    if (!Array.isArray(doors) || doors.length === 0) return [];

    const obstacles = [];
    for (const door of doors) {
        const wall = walls.find((w) => w.id === door.linked_wall || w.id === door.wall_id);
        if (!wall) continue;
        const wallWithLines = wallWithOffsetLines(wall, wallLinesMap);
        const placement = resolveDoorPlacement(wallWithLines, door);
        const points = collectDoorSymbolPoints(door, wallWithLines, placement);
        const bounds = boundsFromModelPoints(points, scaleFactor, offsetX, offsetY);
        if (bounds) obstacles.push(bounds);
    }
    return obstacles;
}
