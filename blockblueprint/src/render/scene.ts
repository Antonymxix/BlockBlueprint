import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VoxelGrid } from '../core/grid';
import { buildAtlasPixels, Atlas } from './textures';
import { LightField } from './light';
import { buildMeshes, MeshData } from './mesher';
import { hash2 } from '../core/rng';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Shared {
  uProgress: { value: number };
  uBlock: { value: number };
  uSkyAmb: { value: number };
}

function patchMaterial(mat: THREE.MeshLambertMaterial, sh: Shared): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uProgress = sh.uProgress;
    shader.uniforms.uBlock = sh.uBlock;
    shader.uniforms.uSkyAmb = sh.uSkyAmb;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aAo; attribute vec3 aBlock; attribute float aSky; attribute float aOrder;
varying float vAo; varying vec3 vBlock; varying float vSky; varying float vOrder;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vAo = aAo; vBlock = aBlock; vSky = aSky; vOrder = aOrder;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uProgress; uniform float uBlock; uniform float uSkyAmb;
varying float vAo; varying vec3 vBlock; varying float vSky; varying float vOrder;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
if (vOrder > uProgress) discard;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += pow(vBlock, vec3(1.7)) * uBlock * diffuseColor.rgb;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= mix(0.12, 1.0, vSky) * vAo;
reflectedLight.directDiffuse *= mix(0.7, 1.0, vAo);
totalEmissiveRadiance *= mix(0.55, 1.0, vAo);`,
      );
  };
}

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  g.setAttribute('aAo', new THREE.BufferAttribute(m.ao, 1));
  g.setAttribute('aBlock', new THREE.BufferAttribute(m.blockLight, 3));
  g.setAttribute('aSky', new THREE.BufferAttribute(m.skyLight, 1));
  g.setAttribute('aOrder', new THREE.BufferAttribute(m.order, 1));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

const SKY_VERT = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const SKY_FRAG = `
varying vec3 vDir;
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uStars; uniform vec3 uMoonDir;
float h31(vec3 p){ p = fract(p*vec3(443.8975,397.2973,491.1871)); p += dot(p, p.yzx+19.19); return fract((p.x+p.y)*p.z); }
void main(){
  vec3 d = normalize(vDir);
  float t = pow(clamp(d.y,0.0,1.0), 0.55);
  vec3 col = mix(uHorizon, uTop, t);
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 900.0) * 6.0 + pow(sd, 12.0) * 0.28 + pow(sd, 3.0) * 0.07);
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.8,0.85,1.0) * smoothstep(0.9993, 0.9996, md) * uStars;
  vec3 c = floor(d * 420.0);
  float s = step(0.9985, h31(c));
  col += vec3(1.0) * s * uStars * smoothstep(0.0, 0.25, d.y) * (0.5 + 0.5*h31(c+3.0));
  if (d.y < 0.0) col = mix(uHorizon, col, 0.0) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Preview {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.5, 900);
  readonly controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private sun = new THREE.DirectionalLight(0xffffff, 3);
  private hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6a5a40, 1);
  private moon = new THREE.DirectionalLight(0x8fa8ff, 0);
  private amb = new THREE.AmbientLight(0xffffff, 0.5);
  private skyMat: THREE.ShaderMaterial;
  private atlasTex: THREE.DataTexture;
  private atlas: Atlas;
  private shared: Shared = { uProgress: { value: 1e6 }, uBlock: { value: 0.4 }, uSkyAmb: { value: 1 } };
  private solidMat: THREE.MeshLambertMaterial;
  private cutMat: THREE.MeshLambertMaterial;
  private blendMat: THREE.MeshLambertMaterial;
  private house = new THREE.Group();
  private ground: THREE.Mesh | null = null;
  private clouds = new THREE.Group();
  private grid: VoxelGrid | null = null;
  private hour = 14;
  private center = new THREE.Vector3(0, 6, 0);
  private buildAnim: { t0: number; dur: number } | null = null;
  private maxOrder = 0;
  private raf = 0;
  private lastT = 0;
  stats = { faces: 0, ms: 0 };
  onBuildDone: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.atlas = buildAtlasPixels();
    const s = this.atlas.size;
    const flipped = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) flipped.set(this.atlas.pixels.subarray((s - 1 - y) * s * 4, (s - y) * s * 4), y * s * 4);
    this.atlasTex = new THREE.DataTexture(flipped, s, s, THREE.RGBAFormat);
    this.atlasTex.colorSpace = THREE.SRGBColorSpace;
    this.atlasTex.magFilter = THREE.NearestFilter;
    this.atlasTex.minFilter = THREE.NearestMipmapLinearFilter;
    this.atlasTex.generateMipmaps = true;
    this.atlasTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.atlasTex.needsUpdate = true;

    this.solidMat = new THREE.MeshLambertMaterial({ map: this.atlasTex, alphaTest: 0.5, side: THREE.FrontSide });
    this.cutMat = this.solidMat;
    this.blendMat = new THREE.MeshLambertMaterial({ map: this.atlasTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    patchMaterial(this.solidMat, this.shared);
    patchMaterial(this.blendMat, this.shared);

    // sky dome
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uSunCol: { value: new THREE.Color() },
        uStars: { value: 0 },
      },
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), this.skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.scene.add(sky);

    this.scene.fog = new THREE.Fog(0xbad2ee, 90, 360);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.amb, this.moon, this.moon.target, this.house, this.clouds);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.45;

    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.6, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.makeClouds();
    this.setTime(this.hour);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  resize(): void {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(2, el.clientWidth);
    const h = Math.max(2, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    if (w > 900) this.camera.setViewOffset(w, h, -170, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private makeClouds(): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
    for (let i = 0; i < 14; i++) {
      const grp = new THREE.Group();
      const n = 4 + Math.floor(hash2(i, 3, 5) * 6);
      for (let k = 0; k < n; k++) {
        const w = 8 + hash2(i, k, 7) * 14;
        const d = 6 + hash2(i, k, 9) * 10;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), mat);
        m.position.set((hash2(i, k, 11) - 0.5) * 26, hash2(i, k, 13) * 1.2, (hash2(i, k, 17) - 0.5) * 16);
        grp.add(m);
      }
      grp.position.set((hash2(i, 1, 21) - 0.5) * 520, 95 + hash2(i, 2, 23) * 30, (hash2(i, 3, 29) - 0.5) * 520);
      this.clouds.add(grp);
    }
    (this.clouds as THREE.Group & { mat?: THREE.Material }).mat = mat;
  }

  /** Time of day in hours (0-24). */
  setTime(h: number): void {
    this.hour = h;
    const ang = ((h - 6) / 12) * Math.PI; // 0 at sunrise, PI/2 noon, PI sunset
    const dir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.sin(ang), -Math.cos(ang) * 0.35 + 0.45).normalize();
    const elev = dir.y;
    const day = smooth(-0.08, 0.28, elev);
    const dusk = 1 - smooth(0.0, 0.5, Math.abs(elev)); // warm near horizon
    const warm = new THREE.Color(1.0, 0.55, 0.28);
    const white = new THREE.Color(1.0, 0.96, 0.9);
    const sunCol = white.clone().lerp(warm, dusk * smooth(-0.1, 0.05, elev));
    this.sun.color.copy(sunCol);
    this.sun.intensity = 5.4 * day * smooth(-0.02, 0.15, elev);
    this.sun.position.copy(dir).multiplyScalar(160).add(this.center);
    this.moon.position.copy(dir).multiplyScalar(-160).add(this.center);
    this.moon.intensity = 1.9 * (1 - day);
    this.hemi.intensity = lerp(0.28, 1.5, day);
    this.amb.intensity = lerp(0.75, 0.9, day);
    this.amb.color.set(0x7f95d8).lerp(new THREE.Color(0xfff4e6), day);
    this.hemi.color.set(0x9bb6e8).lerp(new THREE.Color(0xc8dcff), day);
    this.hemi.groundColor.set(0x1b1e2c).lerp(new THREE.Color(0x6a5a40), day);

    const topDay = new THREE.Color(0x3f86e0);
    const topNight = new THREE.Color(0x050914);
    const horDay = new THREE.Color(0xbfdcf5);
    const horNight = new THREE.Color(0x0e1530);
    const horDusk = new THREE.Color(0xff9a5a);
    const top = topNight.clone().lerp(topDay, day);
    const hor = horNight.clone().lerp(horDay, day).lerp(horDusk, dusk * 0.8 * smooth(-0.15, 0.1, elev));
    const u = this.skyMat.uniforms;
    u.uTop.value.copy(top);
    u.uHorizon.value.copy(hor);
    u.uSunDir.value.copy(dir);
    u.uMoonDir.value.copy(dir).multiplyScalar(-1);
    u.uSunCol.value.copy(sunCol);
    u.uStars.value = 1 - smooth(-0.15, 0.1, elev);
    (this.scene.fog as THREE.Fog).color.copy(hor);
    this.shared.uBlock.value = lerp(1.25, 0.1, day);
    this.renderer.toneMappingExposure = lerp(1.25, 0.95, day);
    this.bloom.strength = lerp(0.6, 0.25, day);
    const cm = (this.clouds as THREE.Group & { mat?: THREE.MeshBasicMaterial }).mat;
    if (cm) cm.color.set(0x0c1020).lerp(new THREE.Color(0xffffff), day).lerp(new THREE.Color(0xffc8a0), dusk * 0.5 * day);
  }

  get time(): number {
    return this.hour;
  }

  setHouse(grid: VoxelGrid, origin?: [number, number, number]): void {
    const t0 = performance.now();
    this.grid = grid;
    for (const ch of [...this.house.children]) {
      this.house.remove(ch);
      (ch as THREE.Mesh).geometry?.dispose();
    }
    const light = new LightField(grid);
    const res = buildMeshes(grid, light, this.atlas);
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.atlasTex, alphaTest: 0.5 });
    if (res.solid.indices.length) {
      const m = new THREE.Mesh(toGeometry(res.solid), this.solidMat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.customDepthMaterial = depthMat;
      m.frustumCulled = false;
      this.house.add(m);
    }
    if (res.blend.indices.length) {
      const m = new THREE.Mesh(toGeometry(res.blend), this.blendMat);
      m.receiveShadow = true;
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.house.add(m);
    }
    this.maxOrder = grid.h + 1;
    this.shared.uProgress.value = 1e6;
    this.buildGround(grid);

    const cx = grid.w / 2;
    const cz = grid.l / 2;
    const span = Math.max(grid.w, grid.l);
    this.controls.target.set(cx, 8, cz);
    this.sun.shadow.camera.left = -span * 0.75;
    this.sun.shadow.camera.right = span * 0.75;
    this.sun.shadow.camera.top = span * 0.75;
    this.sun.shadow.camera.bottom = -span * 0.75;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.position.set(cx, 6, cz);
    this.house.position.set(0, 0, 0);
    this.center.set(cx, 6, cz);
    this.moon.target.position.copy(this.center);
    this.setTime(this.hour);
    const target = new THREE.Vector3(cx, 8, cz);
    const off = this.camera.position.clone().sub(target);
    if (off.lengthSq() < 4) off.set(0.62, 0.62, 0.66);
    off.normalize().multiplyScalar(span * 1.25 + 18);
    this.camera.position.copy(target).add(off);
    this.controls.minDistance = 12;
    this.controls.maxDistance = span * 3.2;
    this.stats.faces = res.faces;
    this.stats.ms = performance.now() - t0;
    void origin;
  }

  private buildGround(grid: VoxelGrid): void {
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
    }
    const size = 900;
    const seg = 180;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cx = grid.w / 2;
    const cz = grid.l / 2;
    const gy = 2.98;
    const noise = (x: number, z: number) => {
      const n1 = Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017 + 0.4);
      const n2 = Math.sin(x * 0.033 + z * 0.029 + 1.0) * 0.35;
      return n1 + n2;
    };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      const dx = Math.max(0, Math.abs(x - cx) - grid.w / 2);
      const dz = Math.max(0, Math.abs(z - cz) - grid.l / 2);
      const dist = Math.hypot(dx, dz);
      const k = smooth(18, 120, dist);
      const h = noise(x, z) * 6 * k + (smooth(150, 420, dist) * 34 * Math.abs(noise(x * 1.3, z * 1.3)));
      pos.setXYZ(i, x, gy + h - (dist > 0 ? 0.6 : 0), z);
      const v = 0.82 + 0.18 * Math.sin(x * 0.7) * Math.cos(z * 0.6);
      const rock = smooth(10, 20, h);
      colors[i * 3] = lerp(0.3, 0.45, rock) * v;
      colors[i * 3 + 1] = lerp(0.52, 0.44, rock) * v;
      colors[i * 3 + 2] = lerp(0.22, 0.4, rock) * v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  playBuild(seconds = 7): void {
    this.shared.uProgress.value = 0;
    this.buildAnim = { t0: performance.now(), dur: seconds * 1000 };
  }

  private frame(t: number): void {
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    if (this.buildAnim) {
      const k = Math.min(1, (performance.now() - this.buildAnim.t0) / this.buildAnim.dur);
      const e = k * k * (3 - 2 * k) * 0.35 + k * 0.65;
      this.shared.uProgress.value = e * this.maxOrder;
      if (k >= 1) {
        this.buildAnim = null;
        this.shared.uProgress.value = 1e6;
        this.onBuildDone?.();
      }
    }
    for (const c of this.clouds.children) {
      c.position.x += dt * 1.6;
      if (c.position.x > 280) c.position.x = -280;
    }
    this.controls.update();
    this.composer.render();
  }

  /** Render once and return a PNG blob (works because preserveDrawingBuffer is on). */
  screenshot(): Promise<Blob> {
    this.composer.render();
    return new Promise((res, rej) => this.canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}
