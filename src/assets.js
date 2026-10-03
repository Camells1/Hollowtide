// Loads every model, texture, the sky lighting and the sounds before the game starts.
// All assets are CC0 (see assets/SOURCES.md).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const A = { models: {}, tex: {}, env: null, sounds: {} };

const MODELS = ['adventurer', 'hooded', 'matt', 'crab', 'chest', 'shipwreck', 'ship_small', 'palm1', 'palm2', 'palm3', 'rock1', 'rock2', 'rocks', 'rock_large', 'ocean_chest',
  'column1', 'column2', 'column_round', 'arch', 'pedestal', 'stag_statue', 'fox_statue', 'seaweed', 'coral', 'fish', 'clownfish', 'bonfire', 'tent', 'barrel', 'anchor', 'dock'];
// Texture sets: [name, id] (each has _diff, _nor, _rough)
const TEXTURES = [['sand', 'coast_sand_01'], ['mud', 'coral_mud_01'], ['grass', 'sparse_grass'], ['rock', 'rock_wall_02'],
  ['brick', 'seaworn_sandstone_brick'], ['moss', 'mossy_sandstone'], ['stone', 'old_sandstone_02'], ['planks', 'weathered_planks']];
const SOUNDS = ['wave1.flac', 'wave2.flac', 'wave3.flac', 'wave4.flac', 'gull1.wav', 'gull2.wav', 'gull3.wav', 'underwater.ogg', 'bubbles_loop.ogg', 'swim_loop.ogg',
  ...[1, 2, 3, 4, 5, 6].map(n => `splash0${n}.ogg`), 'bubble01.ogg', 'bubble02.ogg', 'bubble03.ogg',
  ...['grass', 'sand', 'stone', 'wood'].flatMap(s => [0, 1, 2, 3, 4].map(n => `step_${s}00${n}.ogg`)),
  ...[0, 1, 2].flatMap(n => [`hit00${n}.ogg`, `bite00${n}.ogg`, `bell00${n}.ogg`]),
  'creak1.ogg', 'creak2.ogg', 'latch.ogg', 'coins1.ogg', 'coins2.ogg', 'swing1.ogg', 'swing2.ogg', 'cloth.ogg', 'leather.ogg', 'chop.ogg',
  'ui_click.ogg', 'ui_confirm.ogg', 'ui_error.ogg', 'ui_bong.ogg', 'ui_drop.ogg'];

export async function loadAll(renderer, audioCtx, onProgress) {
  const gltf = new GLTFLoader(), texLoader = new THREE.TextureLoader();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const total = MODELS.length + TEXTURES.length * 3 + SOUNDS.length + 1;
  let done = 0;
  const tick = () => onProgress?.(++done / total);

  const models = MODELS.map(name => gltf.loadAsync(`assets/models/${name}.glb`).then(g => { A.models[name] = g; tick(); }));
  const texs = TEXTURES.flatMap(([name, id]) => ['diff', 'nor', 'rough'].map(kind => texLoader.loadAsync(`assets/tex/${id}_${kind}.jpg`).then(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso;
    if (kind === 'diff') t.colorSpace = THREE.SRGBColorSpace;
    (A.tex[name] ||= {})[kind] = t; tick();
  })));
  const env = new RGBELoader().loadAsync('assets/env/sky_1k.hdr').then(hdr => {
    const pm = new THREE.PMREMGenerator(renderer);
    A.env = pm.fromEquirectangular(hdr).texture; hdr.dispose(); pm.dispose(); tick();
  });
  const sounds = SOUNDS.map(f => fetch(`assets/sfx/${f}`).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(buf => { A.sounds[f.replace(/\.\w+$/, '')] = buf; tick(); }).catch(() => tick()));
  await Promise.all([...models, ...texs, env, ...sounds]);
}

// A material set for a texture: repeat = tiles per metre-ish (applied per use)
export function texMat(name, repeat = 1, extra = {}) {
  const t = A.tex[name];
  const clone = tex => { const c = tex.clone(); c.repeat.set(repeat, repeat); c.needsUpdate = true; return c; };
  return new THREE.MeshStandardMaterial({ map: clone(t.diff), normalMap: clone(t.nor), roughnessMap: clone(t.rough), roughness: 1, ...extra });
}

// A ready-to-place copy of a model, scaled so its height (or longest side) is `size` metres,
// standing on y = 0 and centred on x/z. Skinned models are cloned with their skeletons.
export function instance(name, size, by = 'height') {
  const g = A.models[name];
  const obj = (g.animations?.length ? SkeletonUtils.clone(g.scene) : g.scene.clone(true));
  // Bones only know where they are after a world-matrix update; without it a rigged model measures wrong
  obj.updateMatrixWorld(true);
  obj.traverse(o => { if (o.isSkinnedMesh) { o.boundingBox = null; o.boundingSphere = null; } });
  let box = new THREE.Box3().setFromObject(obj);
  if (![box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite)) {
    // Some rigs can't be measured through their bones: use the rest-pose shape instead
    box = new THREE.Box3(); const tmp = new THREE.Box3();
    obj.traverse(o => { if (!o.isMesh) return; o.geometry.computeBoundingBox(); box.union(tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); if (o.isSkinnedMesh) { o.boundingBox = null; o.boundingSphere = null; } });
  }
  const dim = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = size / (by === 'height' ? dim.y : Math.max(dim.x, dim.y, dim.z));
  obj.scale.multiplyScalar(k);
  obj.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  const box2 = { min: { x: -dim.x * k / 2, y: 0, z: -dim.z * k / 2 }, max: { x: dim.x * k / 2, y: dim.y * k, z: dim.z * k / 2 } };
  const root = new THREE.Group(); root.add(obj);
  root.userData.radius = Math.max(box2.max.x - box2.min.x, box2.max.z - box2.min.z) / 2;
  root.userData.height = box2.max.y - box2.min.y;
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = !o.isSkinnedMesh; } });
  return root;
}

export const clips = name => A.models[name]?.animations || [];
