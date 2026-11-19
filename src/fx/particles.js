// CPU particle systems rendered as point sprites: tyre smoke, dust, sparks, glass shards, engine smoke, water splashes.
import * as THREE from 'three';

const VERT = `
attribute float size;
attribute vec4 pcolor;
varying vec4 vColor;
uniform float scale;
void main() {
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG_SOFT = `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  a *= 0.75 + 0.25 * sin(gl_PointCoord.x * 9.0 + gl_PointCoord.y * 7.0);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;
const FRAG_HARD = `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = 1.0 - smoothstep(0.2, 0.5, d);
  gl_FragColor = vec4(vColor.rgb * (1.0 + (1.0 - d * 2.0)), vColor.a * a);
}`;

class Pool {
  constructor(scene, max, frag, blending) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.bounce = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('pcolor', this.colAttr);
    this.geo.setAttribute('size', this.sizeAttr);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: frag,
      uniforms: { scale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, grow, r, g, b, a, grav = 0, drag = 0, bounce = 0) {
    let i;
    if (this.n < this.max) i = this.n++;
    else {
      // overwrite the oldest-ish
      i = Math.floor(Math.random() * this.max);
    }
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.grow[i] = grow;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.a0[i] = a; this.grav[i] = grav; this.drag[i] = drag; this.bounce[i] = bounce;
  }
  update(dt, terrain) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; }
          for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[j * 4 + k];
          this.size[i] = this.size[j]; this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
          this.grow[i] = this.grow[j]; this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.a0[i] = this.a0[j]; this.bounce[i] = this.bounce[j];
        }
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.bounce[i] > 0 && terrain) {
        const h = terrain.heightAt(this.pos[i * 3], this.pos[i * 3 + 2]) + 0.02;
        if (this.pos[i * 3 + 1] < h) {
          this.pos[i * 3 + 1] = h;
          this.vel[i * 3 + 1] = Math.abs(this.vel[i * 3 + 1]) * this.bounce[i];
          this.vel[i * 3] *= 0.6; this.vel[i * 3 + 2] *= 0.6;
        }
      }
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = this.a0[i] * Math.min(1, t * 2.2) * (this.grow[i] > 0 ? Math.min(1, (1 - t) * 6 + 0.2) : 1);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
  clear() { this.n = 0; }
}

export const DUST_COLORS = [
  null, [0.55, 0.5, 0.38], [0.58, 0.47, 0.34], [0.8, 0.74, 0.58], [0.92, 0.94, 0.97], [0.36, 0.28, 0.2],
];

export class Particles {
  constructor(scene) {
    this.smoke = new Pool(scene, 2500, FRAG_SOFT, THREE.NormalBlending);
    this.glow = new Pool(scene, 1500, FRAG_HARD, THREE.AdditiveBlending);
    this.shards = new Pool(scene, 1200, FRAG_HARD, THREE.NormalBlending);
    this.quality = 1;
  }
  setViewport(h, fov) {
    const s = h / (2 * Math.tan((fov * Math.PI) / 360));
    for (const p of [this.smoke, this.glow, this.shards]) p.mat.uniforms.scale.value = s;
  }
  tyreSmoke(x, y, z, vx, vz, amount) {
    if (Math.random() > amount * this.quality) return;
    const g = 0.78 + Math.random() * 0.12;
    this.smoke.emit(x, y + 0.15, z, vx * 0.25 + (Math.random() - 0.5), 0.5 + Math.random() * 0.6, vz * 0.25 + (Math.random() - 0.5), 2.4 + Math.random() * 1.6, 0.7, 2.4, g, g, g, 0.32 * Math.min(1, amount + 0.3), -0.25, 1.2);
  }
  dust(x, y, z, vx, vz, amount, col) {
    if (Math.random() > amount * this.quality) return;
    const c = col || DUST_COLORS[1];
    this.smoke.emit(x, y + 0.1, z, vx * 0.15 + (Math.random() - 0.5) * 1.5, 0.4 + Math.random(), vz * 0.15 + (Math.random() - 0.5) * 1.5, 1.4 + Math.random() * 1.4, 0.5, 1.8, c[0], c[1], c[2], 0.3, 0.05, 1.0);
  }
  sparks(x, y, z, vx, vy, vz, n) {
    for (let i = 0; i < n * this.quality; i++) {
      const s = 0.6 + Math.random() * 0.8;
      this.glow.emit(x, y, z, vx * s + (Math.random() - 0.5) * 4, vy + Math.random() * 3, vz * s + (Math.random() - 0.5) * 4, 0.25 + Math.random() * 0.45, 0.07 + Math.random() * 0.05, -0.05, 1.0, 0.65 + Math.random() * 0.3, 0.25, 1, 9.8, 0.8, 0.35);
    }
  }
  glass(x, y, z, vx, vy, vz, n) {
    for (let i = 0; i < n * this.quality; i++) {
      const c = 0.75 + Math.random() * 0.25;
      this.shards.emit(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.6,
        vx * 0.6 + (Math.random() - 0.5) * 4, vy + Math.random() * 3, vz * 0.6 + (Math.random() - 0.5) * 4,
        2.5 + Math.random() * 3, 0.035 + Math.random() * 0.03, 0, c * 0.85, c * 0.95, c, 0.9, 9.8, 0.3, 0.25);
    }
  }
  debrisBits(x, y, z, vx, vy, vz, n, col = [0.15, 0.15, 0.15]) {
    for (let i = 0; i < n * this.quality; i++) {
      this.shards.emit(x, y, z, vx * 0.5 + (Math.random() - 0.5) * 5, vy + Math.random() * 4, vz * 0.5 + (Math.random() - 0.5) * 5,
        2 + Math.random() * 2, 0.05 + Math.random() * 0.04, 0, col[0], col[1], col[2], 1, 9.8, 0.2, 0.3);
    }
  }
  engineSmoke(x, y, z, vx, vz, dark, amount) {
    if (Math.random() > amount * this.quality) return;
    const c = dark ? 0.12 + Math.random() * 0.1 : 0.85;
    this.smoke.emit(x, y, z, vx * 0.6 + (Math.random() - 0.5) * 0.4, 0.8 + Math.random() * 0.8, vz * 0.6 + (Math.random() - 0.5) * 0.4, 2 + Math.random() * 2, 0.4, 1.6, c, c, c, dark ? 0.55 : 0.35, -0.4, 0.8);
  }
  exhaust(x, y, z, vx, vz, amount) {
    if (Math.random() > amount * this.quality) return;
    this.smoke.emit(x, y, z, vx * 0.5, 0.3, vz * 0.5, 0.8 + Math.random() * 0.5, 0.15, 0.7, 0.7, 0.7, 0.72, 0.18, -0.2, 1.5);
  }
  splash(x, y, z, vx, vz, amount) {
    for (let i = 0; i < amount * this.quality; i++) {
      this.shards.emit(x, y, z, vx * 0.3 + (Math.random() - 0.5) * 3, 2 + Math.random() * 4, vz * 0.3 + (Math.random() - 0.5) * 3, 1 + Math.random(), 0.08 + Math.random() * 0.06, 0, 0.75, 0.85, 0.95, 0.7, 9.8, 0.4, 0);
    }
  }
  fire(x, y, z, amount) {
    if (Math.random() > amount * this.quality) return;
    this.glow.emit(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 1.5 + Math.random(), (Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 0.4, 0.5, -0.4, 1.0, 0.45 + Math.random() * 0.2, 0.1, 0.8, -1, 1.0);
  }
  update(dt, terrain) {
    this.smoke.update(dt, terrain);
    this.glow.update(dt, terrain);
    this.shards.update(dt, terrain);
  }
  clear() {
    this.smoke.clear(); this.glow.clear(); this.shards.clear();
  }
}
