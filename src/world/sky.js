// Sky, sun, ambient light, fog, environment reflections and time of day.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { clamp, lerp, smoothstep } from '../core/math.js';

export class Environment {
  constructor(renderer, scene, quality = 'high') {
    this.renderer = renderer;
    this.scene = scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5.5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    this.sun = new THREE.DirectionalLight('#fff4e0', 3);
    this.sun.castShadow = quality !== 'low';
    const sm = quality === 'ultra' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    this.shadowRange = quality === 'ultra' ? 90 : 70;
    const c = this.sun.shadow.camera;
    c.left = -this.shadowRange; c.right = this.shadowRange; c.top = this.shadowRange; c.bottom = -this.shadowRange;
    c.near = 1; c.far = 900;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight('#cfe4ff', '#5b5242', 1.0);
    scene.add(this.hemi);
    this.fog = new THREE.Fog('#b9cde0', 250, 2400);
    scene.fog = this.fog;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#4a5240' }));
    ground.position.y = -40;
    this.envScene.add(ground);
    this.envGround = ground;
    this.envRT = null;
    this.sunDir = new THREE.Vector3();
    this.night = 0;
    this.hours = 13;
    this.setTime(13);
  }

  setTime(hours) {
    this.hours = hours;
    // sun path: rises 6:00 east (+x), sets 20:00 west
    const t = (hours - 6) / 14;
    const elev = Math.sin(clamp(t, -0.3, 1.3) * Math.PI) * 62 - (t < 0 || t > 1 ? 10 : 0);
    const azim = lerp(-80, 80, t);
    const phi = THREE.MathUtils.degToRad(90 - elev);
    const theta = THREE.MathUtils.degToRad(azim + 180);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    for (const s of [this.sky, this.envSky]) s.material.uniforms.sunPosition.value.copy(this.sunDir);
    const day = smoothstep(-6, 10, elev);
    const golden = 1 - smoothstep(4, 25, elev);
    this.night = 1 - smoothstep(-8, 4, elev);
    this.sun.intensity = lerp(0.0, 3.2, day);
    this.sun.color.setRGB(1, lerp(0.95, 0.62, golden * day), lerp(0.88, 0.38, golden * day));
    this.hemi.intensity = lerp(0.18, 1.05, day);
    this.hemi.color.setRGB(lerp(0.3, 0.8, day), lerp(0.36, 0.89, day), lerp(0.6, 1.0, day));
    const fogDay = new THREE.Color('#b9cde0');
    const fogGold = new THREE.Color('#e0b48c');
    const fogNight = new THREE.Color('#0b1220');
    const fc = fogDay.clone().lerp(fogGold, golden * 0.7).lerp(fogNight, this.night);
    this.fog.color.copy(fc);
    this.envGround.material.color.setRGB(0.29 * (0.2 + day), 0.32 * (0.2 + day), 0.25 * (0.2 + day));
    if (this.night > 0.5) {
      // moonlight
      this.sun.intensity = 0.35;
      this.sun.color.set('#9fb4ff');
      this.sunDir.set(-0.4, 0.8, 0.3).normalize();
    }
    this.sky.visible = true;
    this.renderer.toneMappingExposure = lerp(0.62, 0.55, golden) * (1 + this.night * 0.4);
    // regenerate reflection environment
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = lerp(0.15, 1.0, day);
  }

  update(target) {
    // shadow box follows the focus point, snapped to texels to avoid shimmering
    const r = this.shadowRange;
    const texel = (2 * r) / this.sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel, tz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(tx, target.y, tz);
    this.sun.position.set(tx + this.sunDir.x * 400, target.y + this.sunDir.y * 400, tz + this.sunDir.z * 400);
    this.sun.target.updateMatrixWorld();
  }
}
