/**
 * Light presentation post-FX for the 3D viewer:
 * soft GTAO (crevice contact) + SMAA + OutputPass.
 * No bloom / vignette — those made the model look fake earlier.
 */
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { THREE_CONFIG } from './threeConfig';

function presentationEnabled() {
  return THREE_CONFIG.PRESENTATION?.POST_FX !== false;
}

export function setupPresentationPostFx(instance) {
  if (!presentationEnabled()) {
    instance.composer = null;
    instance._gtaoPass = null;
    return;
  }

  const width = instance.container.clientWidth || 1;
  const height = instance.container.clientHeight || 1;
  const cfg = THREE_CONFIG.PRESENTATION || {};

  const composer = new EffectComposer(instance.renderer);
  composer.setPixelRatio(instance.renderer.getPixelRatio());
  composer.setSize(width, height);
  composer.addPass(new RenderPass(instance.scene, instance.camera));

  if (cfg.AO !== false) {
    const gtaoPass = new GTAOPass(instance.scene, instance.camera, width, height);
    gtaoPass.output = GTAOPass.OUTPUT.Default;
    // Keep AO gentle — just enough to ground corners
    gtaoPass.blendIntensity = cfg.AO_BLEND ?? 0.38;
    gtaoPass.updateGtaoMaterial({
      radius: cfg.AO_RADIUS ?? 2.2,
      distanceExponent: 1.0,
      thickness: 1.0,
      scale: 1.0,
      samples: cfg.AO_SAMPLES ?? 8,
      distanceFallOff: 1.0,
      screenSpaceRadius: false,
    });
    gtaoPass.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 5,
      radiusExponent: 1,
      rings: 2,
      samples: 8,
    });
    composer.addPass(gtaoPass);
    instance._gtaoPass = gtaoPass;
  } else {
    instance._gtaoPass = null;
  }

  composer.addPass(new SMAAPass());
  composer.addPass(new OutputPass());

  instance.composer = composer;
  instance._bloomPass = null;
  instance._vignettePass = null;
}

export function resizePresentationPostFx(instance, width, height) {
  if (!instance.composer) return;
  instance.composer.setPixelRatio(instance.renderer.getPixelRatio());
  instance.composer.setSize(width, height);
  if (instance._gtaoPass) {
    instance._gtaoPass.setSize(width, height);
  }
}

export function updatePresentationAoClip(instance) {
  if (!instance._gtaoPass || typeof instance.getModelBounds !== 'function') return;
  try {
    const b = instance.getModelBounds();
    const pad = 50;
    const box = new instance.THREE.Box3(
      new instance.THREE.Vector3(b.minX - pad, -5, b.minZ - pad),
      new instance.THREE.Vector3(b.maxX + pad, 90, b.maxZ + pad)
    );
    instance._gtaoPass.setSceneClipBox(box);
  } catch (e) {
    // Non-fatal
  }
}

export function renderPresentationPostFx(instance) {
  if (instance.composer) {
    instance.composer.render();
  } else {
    instance.renderer.render(instance.scene, instance.camera);
  }
}

export function disposePresentationPostFx(instance) {
  if (instance.composer) {
    instance.composer.passes?.forEach((pass) => {
      if (typeof pass.dispose === 'function') pass.dispose();
    });
    instance.composer = null;
  }
  instance._gtaoPass = null;
  instance._bloomPass = null;
  instance._vignettePass = null;
}
