/**
 * Wall-to-ceiling Cut L joint, from the temp-freezer section:
 * 150mm PIR wall and ceiling, a 50mm outer tongue left full height,
 * the ceiling let into the rebate, chemical infill in the pocket,
 * and 1 1/2" x 3" aluminum angles inside and outside.
 *
 * Horizontal extension is how far the ceiling reaches back over the
 * wall from the inner face. The tongue is whatever thickness is left
 * on the outside (150mm wall, 100mm extension → 50mm tongue).
 */

export const CUT_L_INFILL_GAP_MM = 15;
/** Tongue stands this far above the ceiling, matching the step in the section. */
export const CUT_L_UPSTAND_MM = 40;
export const CUT_L_ALU_SHORT_MM = 38.1;
export const CUT_L_ALU_LONG_MM = 76.2;
export const CUT_L_ALU_THICK_MM = 3;
export const CUT_L_FASTENER_DIA_MM = 6;
export const CUT_L_FASTENER_SPACING_MM = 450;

export function defaultCutLHorizontalExtensionMm(wallThickness) {
  const thickness = Number(wallThickness) || 0;
  if (thickness >= 200) return 125;
  if (thickness >= 150) return 100;
  if (thickness >= 125) return 75;
  if (thickness >= 100) return 75;
  if (thickness >= 75) return 50;
  return 50;
}

export function cutLHorizontalExtensionMm(wall) {
  const custom = wall?.ceiling_cut_l_horizontal_extension;
  if (custom !== null && custom !== undefined && custom !== '' && Number.isFinite(Number(custom))) {
    return Math.max(0, Number(custom));
  }
  return defaultCutLHorizontalExtensionMm(wall?.thickness || 150);
}

/** Width of the exterior tongue that stays full height. */
export function cutLTongueWidthMm(wall) {
  const thickness = Math.max(0, Number(wall?.thickness) || 0);
  const extension = cutLHorizontalExtensionMm(wall);
  let tongue = thickness - extension;
  if (!Number.isFinite(tongue) || tongue < 15) {
    tongue = thickness >= 100 ? 50 : Math.max(15, thickness * 0.34);
  }
  const maxTongue = Math.max(15, thickness - 20);
  return Math.min(Math.max(15, tongue), maxTongue);
}

export function ceilingThicknessMmForWall(wall, rooms) {
  let best = null;
  (rooms || []).forEach((room) => {
    const ids = Array.isArray(room?.walls)
      ? room.walls.map((entry) => String(typeof entry === 'object' ? entry.id : entry))
      : [];
    if (!ids.includes(String(wall?.id))) return;
    const raw = room.ceiling_plan?.ceiling_thickness
      ?? room.zone_ceiling_plan?.ceiling_thickness
      ?? room.ceiling_thickness;
    const thickness = Number(raw);
    if (Number.isFinite(thickness) && thickness > 0) {
      best = best == null ? thickness : Math.max(best, thickness);
    }
  });
  return best || 150;
}

/**
 * How far the ceiling edge sits in from the wall's outer face.
 * Tongue plus the infill pocket, with 1mm of bite so the ceiling
 * meets the infill instead of leaving a hairline crack.
 */
export function ceilingInsetFromOuterFaceMm(wall) {
  if (wall?.ceiling_joint_type !== 'cut_l' || wall.fill_gap_mode) return 0;
  const thickness = Number(wall.thickness) || 0;
  const tongue = cutLTongueWidthMm(wall);
  const gap = Math.min(CUT_L_INFILL_GAP_MM, Math.max(0, thickness - tongue - 5));
  const inset = tongue + gap - 1;
  return Math.max(0, Math.min(inset, Math.max(0, thickness - 8)));
}

/** Rebate sizes in millimetres. Null when this wall should stay a plain top. */
export function resolveCutLRebateMm(wall, rooms, wallHeightMm) {
  if (!wall || wall.ceiling_joint_type !== 'cut_l' || wall.fill_gap_mode) return null;
  const wallHeight = Number(wallHeightMm) || Number(wall.height) || 0;
  const thickness = Number(wall.thickness) || 0;
  if (wallHeight < 200 || thickness < 40) return null;
  const ceilingMm = ceilingThicknessMmForWall(wall, rooms);
  const rebateDepth = Math.min(ceilingMm, wallHeight * 0.85);
  if (rebateDepth < 40) return null;
  const tongue = cutLTongueWidthMm(wall);
  if (!(tongue > 5) || tongue >= thickness - 5) return null;
  const gap = Math.min(CUT_L_INFILL_GAP_MM, thickness - tongue - 5);
  return {
    rebateDepth,
    tongue,
    gap: Math.max(0, gap),
    ceilingMm,
  };
}
