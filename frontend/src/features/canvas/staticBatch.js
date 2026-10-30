import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import THREE from './threeInstance';
import { disposeMaterialSafe } from './wallSurfaceTextures';

const _position = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();

function ancestorHost(mesh) {
  let parent = mesh;
  while (parent) {
    const name = (parent.name || '').toLowerCase();
    if (parent.userData?.isDoor || name.includes('door')) return 'door';
    if (parent.userData?.isFloor || name.startsWith('floor')) return 'floor';
    if (parent.userData?.isCeiling || name.includes('ceiling')) return 'ceiling';
    if (parent.userData?.isWall || parent.userData?.isCutLDetail) return 'wall';
    parent = parent.parent;
  }
  return 'other';
}

function materialKey(material) {
  if (!material) return 'none';
  const mapId = (map) => map?.uuid || '';
  return [
    material.type,
    material.color?.getHexString?.() || '',
    material.roughness,
    material.metalness,
    material.opacity,
    material.transparent ? 1 : 0,
    material.side,
    material.depthWrite ? 1 : 0,
    material.depthTest ? 1 : 0,
    material.emissive?.getHexString?.() || '',
    material.emissiveIntensity,
    material.envMapIntensity,
    mapId(material.map),
    mapId(material.normalMap),
    mapId(material.roughnessMap),
    mapId(material.bumpMap),
    material.bumpScale,
    material.normalScale?.x,
    material.normalScale?.y,
    material.polygonOffset ? 1 : 0,
    material.polygonOffsetFactor,
    material.polygonOffsetUnits,
  ].join('|');
}

function extractGroup(mesh, group) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position || !group.count) return null;
  const index = geometry.getIndex();
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const tangent = geometry.getAttribute('tangent');
  const remap = new Map();
  const positions = [];
  const normals = [];
  const uvs = [];
  const tangents = [];
  const indices = [];
  _normalMatrix.getNormalMatrix(mesh.matrixWorld);

  for (let i = 0; i < group.count; i += 1) {
    const vertexIndex = index ? index.getX(group.start + i) : group.start + i;
    let mapped = remap.get(vertexIndex);
    if (mapped === undefined) {
      mapped = positions.length / 3;
      remap.set(vertexIndex, mapped);
      _position.fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld);
      positions.push(_position.x, _position.y, _position.z);
      if (normal) {
        _normal.fromBufferAttribute(normal, vertexIndex).applyMatrix3(_normalMatrix).normalize();
        normals.push(_normal.x, _normal.y, _normal.z);
      }
      if (uv) uvs.push(uv.getX(vertexIndex), uv.getY(vertexIndex));
      if (tangent) {
        _tangent.fromBufferAttribute(tangent, vertexIndex).applyMatrix3(_normalMatrix).normalize();
        tangents.push(_tangent.x, _tangent.y, _tangent.z, tangent.getW(vertexIndex));
      }
    }
    indices.push(mapped);
  }

  const baked = new THREE.BufferGeometry();
  baked.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length) baked.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (uvs.length) baked.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (tangents.length) baked.setAttribute('tangent', new THREE.Float32BufferAttribute(tangents, 4));
  baked.setIndex(indices);
  return baked;
}

function detachKeepers(mesh, root) {
  const keepers = [];
  mesh.traverse((child) => {
    if (child === mesh) return;
    if (child.isInstancedMesh || child.isLineSegments2 || child.isLine2) keepers.push(child);
  });
  keepers.forEach((child) => root.attach(child));
}

/**
 * Join repeated static walls and ceilings that share a finish into one mesh.
 * A zoomed-out orbit was paying one draw call per wall face.
 * Doors and floors stay separate because they move or hide on their own.
 */
export function consolidateStaticMeshes(root) {
  if (!root) return [];
  root.updateMatrixWorld(true);

  const meshes = [];
  root.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || obj.isLineSegments2 || obj.isLine2) return;
    if (obj.userData?.isStaticBatch || obj.userData?.isFatLineBatch) return;
    const host = ancestorHost(obj);
    if (host === 'wall' || host === 'ceiling') meshes.push(obj);
  });

  const buckets = new Map();
  meshes.forEach((mesh) => {
    const geometry = mesh.geometry;
    const position = geometry?.getAttribute?.('position');
    if (!position) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = geometry.groups?.length
      ? geometry.groups
      : [{ start: 0, count: geometry.index ? geometry.index.count : position.count, materialIndex: 0 }];
    const host = ancestorHost(mesh);
    groups.forEach((group) => {
      const material = materials[group.materialIndex || 0] || materials[0];
      if (!material) return;
      const baked = extractGroup(mesh, group);
      if (!baked) return;
      const key = [
        host,
        mesh.renderOrder,
        mesh.castShadow ? 1 : 0,
        mesh.receiveShadow ? 1 : 0,
        baked.getAttribute('normal') ? 1 : 0,
        baked.getAttribute('uv') ? 1 : 0,
        baked.getAttribute('tangent') ? 1 : 0,
        materialKey(material),
      ].join('||');
      const bucket = buckets.get(key) || [];
      bucket.push({ mesh, geometry: baked, material, host });
      buckets.set(key, bucket);
    });
  });

  // A mesh with a one-off finish stays whole. Taking only its shared faces
  // would drop the unique face when the original mesh is removed.
  const excluded = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    buckets.forEach((entries, key) => {
      const live = entries.filter((entry) => !excluded.has(entry.mesh));
      const meshCount = new Set(live.map((entry) => entry.mesh)).size;
      if (meshCount >= 2) {
        entries.forEach((entry) => {
          if (excluded.has(entry.mesh)) entry.geometry.dispose();
        });
        buckets.set(key, live);
        return;
      }
      live.forEach((entry) => {
        entry.geometry.dispose();
        if (!excluded.has(entry.mesh)) {
          excluded.add(entry.mesh);
          changed = true;
        }
      });
      entries.forEach((entry) => {
        if (excluded.has(entry.mesh) && !live.includes(entry)) entry.geometry.dispose();
      });
      buckets.set(key, []);
    });
  }

  const batches = [];
  const consumed = new Set();
  const keptMaterials = new Set();
  buckets.forEach((entries) => {
    if (entries.length < 2) return;
    let merged = null;
    try {
      merged = mergeGeometries(entries.map((entry) => entry.geometry), false);
    } catch (error) {
      merged = null;
    }
    entries.forEach((entry) => entry.geometry.dispose());
    if (!merged) return;
    const sample = entries[0];
    const batch = new THREE.Mesh(merged, sample.material);
    batch.name = sample.host === 'ceiling' ? 'ceiling_surface_batch' : 'wall_surface_batch';
    batch.renderOrder = sample.mesh.renderOrder;
    batch.castShadow = sample.mesh.castShadow;
    batch.receiveShadow = sample.mesh.receiveShadow;
    batch.frustumCulled = true;
    batch.matrixAutoUpdate = false;
    batch.userData.isStaticBatch = true;
    if (sample.host === 'ceiling') batch.userData.isCeiling = true;
    else batch.userData.isWall = true;
    keptMaterials.add(sample.material);
    entries.forEach((entry) => consumed.add(entry.mesh));
    root.add(batch);
    batches.push(batch);
  });

  consumed.forEach((mesh) => {
    detachKeepers(mesh, root);
    mesh.removeFromParent();
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (!keptMaterials.has(material)) disposeMaterialSafe(material);
    });
  });

  return batches;
}

const _doorInv = new THREE.Matrix4();
const _parentInv = new THREE.Matrix4();
const _scale = new THREE.Matrix4();
const _instance = new THREE.Matrix4();
const _unitBox = new THREE.BoxGeometry(1, 1, 1);
const _unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 12);

function hardwareScale(geometry) {
  const p = geometry?.parameters;
  if (!p) return null;
  if (geometry.type === 'BoxGeometry' && p.width > 0 && p.height > 0 && p.depth > 0) {
    _scale.makeScale(p.width, p.height, p.depth);
    return _unitBox;
  }
  if (
    geometry.type === 'CylinderGeometry'
    && p.radialSegments === 12
    && p.radiusTop > 0
    && p.radiusTop === p.radiusBottom
    && p.height > 0
  ) {
    _scale.makeScale(p.radiusTop, p.height, p.radiusTop);
    return _unitCylinder;
  }
  return null;
}

function isDockPanel(mesh) {
  return Boolean(mesh.userData?.isDockSkin);
}

function dockPanelMaterial(source) {
  const material = source.clone();
  material.map = null;
  material.normalMap = null;
  material.bumpMap = null;
  material.roughnessMap = null;
  material.userData.isDockPanelMaterial = true;
  material.needsUpdate = true;
  return material;
}

function fitDoorBatchBounds(batch) {
  batch.computeBoundingSphere();
  batch.frustumCulled = true;
}

function attachDoorBatch(door, batch, refs) {
  door.userData.hardwareRefs = refs;
  batch.instanceMatrix.needsUpdate = true;
  fitDoorBatchBounds(batch);
  batch.matrixAutoUpdate = false;
  door.add(batch);
}

/**
 * Each dock leaf stays a stack of horizontal panels, in its own color.
 * Rollers, grooves, and rails that share a finish are drawn once per door.
 * The batch stays on the door, so a click can still open it and a tour
 * only draws the doors in front of the camera.
 */
export function consolidateDoorHardware(root) {
  if (!root) return;
  root.updateMatrixWorld(true);
  const doors = [];
  root.traverse((obj) => {
    if (obj.userData?.isDoor && obj.userData?.doorId) doors.push(obj);
  });
  doors.forEach((door) => {
    const panels = [];
    const hardware = [];
    const nodes = [];
    door.traverse((obj) => nodes.push(obj));
    nodes.forEach((obj) => {
      if (!obj.isMesh || obj.isInstancedMesh || Array.isArray(obj.material)) return;
      if (isDockPanel(obj) && obj.geometry?.type === 'BoxGeometry') {
        panels.push(obj);
        return;
      }
      if (!isDockPanel(obj) && hardwareScale(obj.geometry)) hardware.push(obj);
    });

    _doorInv.copy(door.matrixWorld).invert();
    const refs = door.userData.hardwareRefs || [];

    const panelGroups = new Map();
    panels.forEach((mesh) => {
      const key = `${mesh.material.uuid}|${mesh.renderOrder || 0}`;
      const group = panelGroups.get(key);
      if (group) group.push(mesh);
      else panelGroups.set(key, [mesh]);
    });
    panelGroups.forEach((group) => {
      if (group.length < 2) return;
      const sample = group[0];
      const geometry = _unitBox.clone();
      const material = dockPanelMaterial(sample.material);
      const batch = new THREE.InstancedMesh(geometry, material, group.length);
      batch.name = 'dock_panel_batch';
      batch.userData.isDoorHardwareBatch = true;
      batch.userData.isDockSkin = true;
      batch.castShadow = false;
      batch.receiveShadow = false;
      batch.renderOrder = sample.renderOrder || 0;
      group.forEach((mesh, index) => {
        const parent = mesh.parent;
        hardwareScale(mesh.geometry);
        _parentInv.copy(parent.matrixWorld).invert();
        const local = _parentInv.clone().multiply(mesh.matrixWorld).multiply(_scale);
        refs.push({ batch, index, node: parent, local });
        _instance.copy(_doorInv).multiply(parent.matrixWorld).multiply(local);
        batch.setMatrixAt(index, _instance);
        mesh.removeFromParent();
        mesh.geometry.dispose();
      });
      const retired = sample.material;
      if (retired && retired !== material) disposeMaterialSafe(retired);
      attachDoorBatch(door, batch, refs);
    });

    const hardwareGroups = new Map();
    hardware.forEach((mesh) => {
      const key = [
        mesh.geometry.type,
        mesh.material.uuid,
        mesh.renderOrder || 0,
      ].join('|');
      const group = hardwareGroups.get(key);
      if (group) group.push(mesh);
      else hardwareGroups.set(key, [mesh]);
    });
    hardwareGroups.forEach((group) => {
      if (group.length < 2) return;
      const sample = group[0];
      const unit = hardwareScale(sample.geometry);
      const batch = new THREE.InstancedMesh(unit.clone(), sample.material, group.length);
      batch.name = 'door_hardware_batch';
      batch.userData.isDoorHardwareBatch = true;
      batch.castShadow = false;
      batch.receiveShadow = false;
      batch.renderOrder = sample.renderOrder || 0;
      group.forEach((mesh, index) => {
        const parent = mesh.parent;
        hardwareScale(mesh.geometry);
        _parentInv.copy(parent.matrixWorld).invert();
        const local = _parentInv.clone().multiply(mesh.matrixWorld).multiply(_scale);
        refs.push({ batch, index, node: parent, local });
        _instance.copy(_doorInv).multiply(parent.matrixWorld).multiply(local);
        batch.setMatrixAt(index, _instance);
        mesh.removeFromParent();
        mesh.geometry.dispose();
      });
      attachDoorBatch(door, batch, refs);
    });
  });
}

export function refreshDoorHardware(door) {
  const refs = door?.userData?.hardwareRefs;
  if (!refs?.length) return;
  door.updateMatrixWorld(true);
  _doorInv.copy(door.matrixWorld).invert();
  const touched = new Set();
  for (let i = 0; i < refs.length; i += 1) {
    const { batch, index, node, local } = refs[i];
    if (!node || !batch) continue;
    node.updateMatrixWorld();
    _instance.copy(_doorInv).multiply(node.matrixWorld).multiply(local);
    batch.setMatrixAt(index, _instance);
    touched.add(batch);
  }
  touched.forEach((batch) => {
    batch.instanceMatrix.needsUpdate = true;
    fitDoorBatchBounds(batch);
  });
}
