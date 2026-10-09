/**
 * Side 1 and Side 2 follow the wall as drawn, from its start point to its end point.
 * Side 1 is the right-hand side of that direction. Side 2 is the other side.
 * This does not use the model center.
 *
 * Stored fields stay inner_face_* (Side 1) and outer_face_* (Side 2).
 */

export function side1Normal(startX, startY, endX, endY) {
    const dx = Number(endX) - Number(startX);
    const dy = Number(endY) - Number(startY);
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
}

export function lineLiesOnSide1(wall, line) {
    if (!wall || !line?.[0] || !line?.[1]) return false;
    const n = side1Normal(wall.start_x, wall.start_y, wall.end_x, wall.end_y);
    const midX = (Number(wall.start_x) + Number(wall.end_x)) / 2;
    const midY = (Number(wall.start_y) + Number(wall.end_y)) / 2;
    const lx = (Number(line[0].x) + Number(line[1].x)) / 2;
    const ly = (Number(line[0].y) + Number(line[1].y)) / 2;
    return n.x * (lx - midX) + n.y * (ly - midY) > 0;
}

/**
 * Side 1 color is the inner_face finish. Side 2 color is the outer_face finish.
 * Returns the color that belongs on each drawn line.
 */
export function colorsForWallLines(wall, line1, line2, side1Color, side2Color) {
    const line1IsSide1 = lineLiesOnSide1(wall, line1);
    return {
        line1Color: line1IsSide1 ? side1Color : side2Color,
        line2Color: line1IsSide1 ? side2Color : side1Color,
        line1IsSide1,
    };
}
