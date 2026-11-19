// Vehicle catalogue: original fictional vehicles. Shapes are parametric profiles (see shape.js).

export const ENGINES = {
  i3t: { name: '1.0 I3 турбо', cyl: 3, idle: 850, redline: 6300, inertia: 0.09, mass: 90, turbo: true, sound: 'i3',
    torque: [[800, 95], [1600, 160], [2500, 180], [4500, 172], [5800, 140], [6600, 110]] },
  i4: { name: '1.6 I4', cyl: 4, idle: 800, redline: 6600, inertia: 0.11, mass: 110, sound: 'i4',
    torque: [[800, 105], [2200, 135], [4200, 152], [5600, 148], [6800, 118]] },
  i4t: { name: '2.0 I4 турбо', cyl: 4, idle: 820, redline: 6500, inertia: 0.12, mass: 135, turbo: true, sound: 'i4',
    torque: [[800, 150], [1800, 290], [3000, 330], [5000, 320], [6000, 280], [6800, 220]] },
  v6: { name: '3.5 V6', cyl: 6, idle: 700, redline: 6800, inertia: 0.15, mass: 170, sound: 'v6',
    torque: [[700, 220], [2500, 300], [4500, 350], [6000, 330], [7000, 280]] },
  v8: { name: '5.0 V8', cyl: 8, idle: 650, redline: 7000, inertia: 0.2, mass: 210, sound: 'v8',
    torque: [[650, 330], [2500, 470], [4500, 540], [6000, 510], [7200, 430]] },
  v8s: { name: '6.2 V8 компрессор', cyl: 8, idle: 700, redline: 6900, inertia: 0.22, mass: 240, turbo: 'sc', sound: 'v8',
    torque: [[700, 420], [2200, 690], [4000, 800], [5800, 760], [7000, 620]] },
  i6d: { name: '3.0 I6 дизель', cyl: 6, idle: 700, redline: 4600, inertia: 0.22, mass: 230, turbo: true, sound: 'diesel',
    torque: [[700, 320], [1500, 560], [2500, 600], [3600, 520], [4700, 380]] },
  v8d: { name: '6.7 V8 дизель', cyl: 8, idle: 600, redline: 3600, inertia: 0.5, mass: 450, turbo: true, sound: 'bigdiesel',
    torque: [[600, 700], [1200, 1250], [1800, 1350], [2600, 1200], [3700, 850]] },
  i6dbus: { name: '9.0 I6 дизель', cyl: 6, idle: 550, redline: 2800, inertia: 0.8, mass: 700, turbo: true, sound: 'bigdiesel',
    torque: [[550, 900], [1100, 1600], [1600, 1700], [2200, 1450], [2900, 1000]] },
  ev: { name: 'Электромотор 220 кВт', cyl: 0, idle: 0, redline: 14000, inertia: 0.06, mass: 160, electric: true, sound: 'ev',
    torque: [[0, 420], [5500, 420], [9000, 290], [12000, 200], [14000, 160]] },
};

export function enginePowerKW(e) {
  let best = 0;
  for (let rpm = 500; rpm <= e.redline; rpm += 100) best = Math.max(best, (torqueAt(e, rpm) * rpm) / 9549);
  return best;
}

export function torqueAt(e, rpm) {
  const t = e.torque;
  if (rpm <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (rpm <= t[i][0]) {
      const a = t[i - 1], b = t[i];
      const f = (rpm - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * f;
    }
  }
  return t[t.length - 1][1];
}

export const TIRES = {
  street: { name: 'Дорожные', grip: 1.0, loose: 1.0, B: 9.5, C: 1.45, Bx: 11, Cx: 1.6, wear: 1 },
  sport: { name: 'Спортивные', grip: 1.14, loose: 0.9, B: 11.5, C: 1.5, Bx: 13, Cx: 1.65 },
  offroad: { name: 'Внедорожные', grip: 0.9, loose: 1.3, B: 8, C: 1.4, Bx: 9, Cx: 1.5 },
  drift: { name: 'Дрифт (жёсткие)', grip: 0.86, loose: 0.95, B: 8.5, C: 1.35, Bx: 10, Cx: 1.55 },
};

export const SUSPENSIONS = {
  comfort: { name: 'Комфорт', stiff: 0.85, damp: 0.9, arb: 0.7, lift: 0.0 },
  sport: { name: 'Спорт', stiff: 1.45, damp: 1.25, arb: 1.6, lift: -0.035 },
  offroad: { name: 'Внедорожный лифт', stiff: 0.8, damp: 1.0, arb: 0.5, lift: 0.08, travel: 1.35 },
  standard: { name: 'Стандарт', stiff: 1.0, damp: 1.0, arb: 1.0, lift: 0.0 },
};

export const WHEEL_STYLES = {
  spoke5: { name: '5 спиц', spokes: 5 },
  spoke10: { name: '10 спиц', spokes: 10 },
  mesh: { name: 'Сетка', spokes: 14 },
  steel: { name: 'Штампованные', spokes: 0 },
  deep: { name: 'Глубокие 6 спиц', spokes: 6 },
};

export const PAINTS = [
  '#b8141b', '#0f3d91', '#e8e8e8', '#1a1a1a', '#c9c9cc', '#f2c400', '#1f7a3a', '#ff6a00',
  '#6b2d8f', '#0aa5c2', '#7a1f1f', '#2c3e50', '#d4b483', '#ff3b8b', '#5d6d3b', '#ffffff',
];

// Shape profile notes: top = hull upper line (hood/beltline/deck), bottom = underside,
// roof = greenhouse top line (only where a cabin exists)
export const VEHICLES = {
  sedan: {
    name: 'Ardena S4', cls: 'Седан', desc: 'Семейный переднеприводный седан. Предсказуемый и прощающий ошибки.',
    mass: 1340, drive: 'FWD', engines: ['i4', 'i4t', 'v6', 'ev'], engine: 'i4', tires: 'street', suspension: 'standard',
    gears: [3.6, 2.1, 1.42, 1.08, 0.86, 0.71], reverse: 3.4, final: 4.0, brake: [2100, 1300], steer: 34,
    color: '#0f3d91', doors: 4, wheelStyle: 'spoke5', cd: 0.3, area: 2.2, engineZ: 'front',
    shape: {
      style: 'sedan', length: 4.62, width: 1.82, wheelbase: 2.72, frontOverhang: 0.95, rearOverhang: 0.95,
      wheelRadius: 0.32, tireWidth: 0.215, track: 1.56, roofWidth: 0.74, crown: 0.035,
      cornerFront: 0.42, cornerRear: 0.36,
      top: [[-2.31, 0.78], [-2.2, 0.94], [-1.98, 1.0], [-1.55, 1.02], [-0.9, 1.0], [0.86, 0.985], [1.55, 0.88], [2.1, 0.78], [2.31, 0.62]],
      bottom: [[-2.31, 0.4], [-2.0, 0.27], [-1.6, 0.17], [1.6, 0.17], [2.05, 0.25], [2.31, 0.33]],
      roof: [[-1.56, 1.02], [-1.05, 1.38], [-0.6, 1.45], [0.05, 1.45], [0.87, 0.985]],
      doorsZ: [[0.72, -0.18], [-0.2, -1.05]],
      hood: [0.88, 2.12], trunk: [-2.2, -1.57],
      glass: { ws: [0.07, 0.84], rw: [-1.52, -1.06], side: [-1.4, 0.66], pillars: [-0.19] },
      lights: { headY: 0.72, headX: 0.6, headW: 0.42, headH: 0.13, tailY: 0.86, tailX: 0.62, tailW: 0.36, tailH: 0.14 },
    },
  },
  hatch: {
    name: 'Brava 3', cls: 'Хэтчбек', desc: 'Лёгкий городской хэтчбек с турбо-тройкой. Вертлявый и задорный.',
    mass: 1080, drive: 'FWD', engines: ['i3t', 'i4', 'i4t'], engine: 'i3t', tires: 'street', suspension: 'standard',
    gears: [3.7, 2.15, 1.45, 1.1, 0.89, 0.75], reverse: 3.5, final: 4.1, brake: [1800, 1000], steer: 36,
    color: '#ff6a00', doors: 4, wheelStyle: 'spoke10', cd: 0.32, area: 2.05, engineZ: 'front',
    shape: {
      style: 'hatch', length: 4.0, width: 1.76, wheelbase: 2.52, frontOverhang: 0.82, rearOverhang: 0.66,
      wheelRadius: 0.305, tireWidth: 0.2, track: 1.52, roofWidth: 0.76, crown: 0.03,
      cornerFront: 0.42, cornerRear: 0.3,
      top: [[-1.92, 0.9], [-1.85, 0.97], [-1.6, 1.0], [0.68, 0.98], [1.3, 0.86], [1.78, 0.76], [2.08, 0.6]],
      bottom: [[-1.92, 0.4], [-1.7, 0.26], [-1.3, 0.16], [1.4, 0.16], [1.85, 0.25], [2.08, 0.32]],
      roof: [[-1.88, 0.98], [-1.83, 1.25], [-1.62, 1.44], [-1.2, 1.5], [-0.05, 1.5], [0.69, 0.98]],
      doorsZ: [[0.55, -0.32], [-0.34, -1.15]],
      hood: [0.7, 1.86], trunk: [-1.92, -1.55], hatchback: true, hatchHinge: -1.6,
      glass: { ws: [-0.03, 0.67], rw: [-1.86, -1.64], side: [-1.5, 0.52], pillars: [-0.33] },
      lights: { headY: 0.72, headX: 0.58, headW: 0.4, headH: 0.14, tailY: 1.02, tailX: 0.68, tailW: 0.14, tailH: 0.26 },
    },
  },
  sport: {
    name: 'Kestrel GT', cls: 'Спорткар', desc: 'Заднеприводное купе с атмосферным V8. Мощное, резкое, требует аккуратного газа.',
    mass: 1480, drive: 'RWD', engines: ['v8', 'v8s', 'v6', 'ev'], engine: 'v8', tires: 'sport', suspension: 'sport',
    gears: [3.1, 2.15, 1.6, 1.25, 1.0, 0.82], reverse: 3.0, final: 3.55, brake: [3000, 1900], steer: 30,
    color: '#b8141b', doors: 2, wheelStyle: 'deep', tcs: true, cd: 0.33, area: 2.0, downforce: 0.35, engineZ: 'front',
    shape: {
      style: 'sport', length: 4.5, width: 1.94, wheelbase: 2.66, frontOverhang: 0.98, rearOverhang: 0.86,
      wheelRadius: 0.335, tireWidth: 0.265, track: 1.62, roofWidth: 0.68, crown: 0.04, flare: 0.035,
      cornerFront: 0.45, cornerRear: 0.38,
      top: [[-2.19, 0.66], [-2.1, 0.86], [-1.9, 0.92], [-1.55, 0.9], [-0.8, 0.86], [0.42, 0.84], [1.2, 0.74], [1.9, 0.64], [2.31, 0.5]],
      bottom: [[-2.19, 0.32], [-1.9, 0.19], [-1.5, 0.12], [1.6, 0.12], [2.05, 0.18], [2.31, 0.24]],
      roof: [[-1.75, 0.91], [-0.95, 1.2], [-0.55, 1.25], [-0.1, 1.25], [0.44, 0.84]],
      doorsZ: [[0.36, -0.82]],
      hood: [0.46, 2.1], trunk: [-2.1, -1.78], spoiler: true,
      glass: { ws: [-0.08, 0.42], rw: [-1.7, -0.98], side: [-1.28, 0.33], pillars: [] },
      lights: { headY: 0.6, headX: 0.66, headW: 0.42, headH: 0.1, tailY: 0.78, tailX: 0.66, tailW: 0.42, tailH: 0.09 },
    },
  },
  suv: {
    name: 'Ridgeback 4x4', cls: 'Внедорожник', desc: 'Рамный полноприводный внедорожник. Высокий клиренс, длинные ходы подвески.',
    mass: 2050, drive: 'AWD', engines: ['v6', 'i6d', 'v8'], engine: 'i6d', tires: 'offroad', suspension: 'offroad',
    gears: [4.2, 2.5, 1.6, 1.2, 1.0, 0.8], reverse: 3.9, final: 3.7, brake: [2800, 1900], steer: 33,
    color: '#5d6d3b', doors: 4, wheelStyle: 'steel', cd: 0.42, area: 2.9, engineZ: 'front', roofRack: true,
    shape: {
      style: 'suv', length: 4.8, width: 1.95, wheelbase: 2.85, frontOverhang: 0.92, rearOverhang: 1.03,
      wheelRadius: 0.39, tireWidth: 0.255, track: 1.64, roofWidth: 0.82, crown: 0.025, flare: 0.04,
      cornerFront: 0.3, cornerRear: 0.22,
      top: [[-2.455, 1.08], [-2.41, 1.16], [-2.1, 1.2], [0.7, 1.2], [1.6, 1.13], [2.2, 1.08], [2.395, 0.95]],
      bottom: [[-2.455, 0.55], [-2.2, 0.4], [-1.85, 0.32], [1.75, 0.32], [2.15, 0.42], [2.395, 0.55]],
      roof: [[-2.43, 1.2], [-2.38, 1.7], [-2.2, 1.86], [-1.8, 1.9], [-0.1, 1.9], [0.72, 1.2]],
      doorsZ: [[0.6, -0.38], [-0.4, -1.4]],
      hood: [0.74, 2.2], trunk: [-2.455, -2.3], hatchback: true, hatchHinge: -2.22,
      glass: { ws: [-0.08, 0.7], rw: [-2.41, -2.24], side: [-2.28, 0.56], pillars: [-0.39, -1.42] },
      lights: { headY: 0.98, headX: 0.68, headW: 0.34, headH: 0.16, tailY: 1.25, tailX: 0.82, tailW: 0.13, tailH: 0.3 },
    },
  },
  pickup: {
    name: 'Hauler 2500', cls: 'Пикап', desc: 'Полноразмерный пикап. Тяжёлый, тяговитый, с открытым кузовом.',
    mass: 2350, drive: 'AWD', engines: ['v8', 'i6d', 'v8d'], engine: 'v8', tires: 'offroad', suspension: 'standard',
    gears: [4.0, 2.4, 1.55, 1.15, 0.95, 0.75], reverse: 3.8, final: 3.73, brake: [3000, 2200], steer: 32,
    color: '#7a1f1f', doors: 4, wheelStyle: 'spoke5', cd: 0.45, area: 3.2, engineZ: 'front',
    shape: {
      style: 'pickup', length: 5.6, width: 2.02, wheelbase: 3.5, frontOverhang: 1.0, rearOverhang: 1.1,
      wheelRadius: 0.4, tireWidth: 0.265, track: 1.7, roofWidth: 0.84, crown: 0.02, flare: 0.03,
      cornerFront: 0.28, cornerRear: 0.12,
      top: [[-2.85, 0.98], [-2.8, 1.02], [-2.5, 0.96], [-0.45, 0.96], [-0.36, 1.2], [1.2, 1.2], [2.2, 1.17], [2.65, 1.12], [2.75, 0.98]],
      bottom: [[-2.85, 0.6], [-2.6, 0.42], [-2.2, 0.34], [2.0, 0.34], [2.5, 0.44], [2.75, 0.56]],
      roof: [[-0.36, 1.2], [-0.33, 1.84], [-0.2, 1.9], [0.55, 1.9], [1.25, 1.2]],
      bed: { z0: -2.82, z1: -0.4, top: 1.22, floor: 0.96 },
      doorsZ: [[1.1, 0.12], [0.1, -0.33]],
      hood: [1.27, 2.62], trunk: null,
      glass: { ws: [0.57, 1.23], rw: [-0.355, -0.3], side: [-0.27, 1.06], pillars: [0.11] },
      lights: { headY: 1.0, headX: 0.7, headW: 0.36, headH: 0.18, tailY: 1.0, tailX: 0.92, tailW: 0.1, tailH: 0.34 },
    },
  },
  truck: {
    name: 'Atlas 7T', cls: 'Грузовик', desc: 'Среднетоннажный фургон. Медленный, массивный, сносит всё на пути.',
    mass: 6200, drive: 'RWD', engines: ['v8d', 'i6d'], engine: 'v8d', tires: 'street', suspension: 'standard',
    gears: [6.0, 3.5, 2.2, 1.5, 1.1, 0.85], reverse: 5.5, final: 4.6, brake: [7000, 7000], steer: 38,
    color: '#e8e8e8', doors: 2, wheelStyle: 'steel', cd: 0.7, area: 7.5, engineZ: 'front',
    shape: {
      style: 'truck', length: 7.4, width: 2.4, wheelbase: 4.3, frontOverhang: 1.25, rearOverhang: 1.85,
      wheelRadius: 0.5, tireWidth: 0.3, track: 1.95, roofWidth: 0.9, crown: 0.02,
      cornerFront: 0.25, cornerRear: 0.08,
      top: [[-4.0, 1.12], [1.5, 1.12], [1.56, 1.38], [3.1, 1.4], [3.38, 1.3], [3.4, 1.1]],
      bottom: [[-4.0, 0.72], [-3.7, 0.62], [2.9, 0.62], [3.4, 0.7]],
      roof: [[1.56, 1.38], [1.6, 2.85], [2.7, 2.92], [3.3, 1.42]],
      cargo: { z0: -4.0, z1: 1.38, top: 3.35, bottom: 1.12 },
      doorsZ: [[2.75, 1.68]],
      hood: null, trunk: null,
      glass: { ws: [2.72, 3.28], rw: null, side: [1.72, 2.7], pillars: [] },
      lights: { headY: 0.95, headX: 0.85, headW: 0.34, headH: 0.18, tailY: 0.95, tailX: 1.0, tailW: 0.22, tailH: 0.14 },
    },
  },
  bus: {
    name: 'Metro 12', cls: 'Автобус', desc: 'Городской низкопольный автобус. Огромный, тяжёлый и неповоротливый.',
    mass: 11500, drive: 'RWD', engines: ['i6dbus'], engine: 'i6dbus', tires: 'street', suspension: 'comfort',
    gears: [3.4, 1.9, 1.35, 1.0, 0.75], reverse: 4.0, final: 5.6, brake: [12000, 12000], steer: 42,
    color: '#f2c400', doors: 0, wheelStyle: 'steel', cd: 0.75, area: 8.5, engineZ: 'rear',
    shape: {
      style: 'bus', length: 11.6, width: 2.55, wheelbase: 5.9, frontOverhang: 2.6, rearOverhang: 3.1,
      wheelRadius: 0.5, tireWidth: 0.3, track: 2.05, roofWidth: 0.96, crown: 0.0,
      cornerFront: 0.3, cornerRear: 0.25, archGap: 0.06,
      top: [[-6.05, 1.05], [-5.98, 1.15], [5.48, 1.15], [5.55, 1.05]],
      bottom: [[-6.05, 0.62], [-5.6, 0.36], [5.0, 0.36], [5.55, 0.48]],
      roof: [[-6.0, 1.15], [-5.95, 2.9], [-5.7, 3.05], [5.2, 3.05], [5.5, 2.85], [5.54, 1.15]],
      doorsZ: [],
      hood: null, trunk: null,
      glass: { ws: [5.22, 5.535], rw: [-5.99, -5.93], side: [-5.75, 5.1], pillars: [-4.6, -3.45, -2.3, -1.15, 0, 1.15, 2.3, 3.45, 4.6], pillarW: 0.07 },
      lights: { headY: 0.75, headX: 0.95, headW: 0.3, headH: 0.16, tailY: 1.0, tailX: 1.1, tailW: 0.16, tailH: 0.35 },
    },
  },
};

// police variant re-uses the sedan body
VEHICLES.police = {
  ...VEHICLES.sedan,
  name: 'Ardena Interceptor', cls: 'Полиция', desc: 'Полицейский перехватчик на базе седана. Усиленный бампер и V8.',
  drive: 'RWD', engines: ['v8', 'v6'], engine: 'v8', tires: 'sport', suspension: 'sport', mass: 1560,
  color: '#1a1a1a', police: true, hidden: false, tcs: true, reinforced: true,
  gears: [3.2, 2.05, 1.45, 1.1, 0.88, 0.72], final: 3.6, brake: [2800, 1700],
};

export const VEHICLE_ORDER = ['sedan', 'hatch', 'sport', 'suv', 'pickup', 'truck', 'bus', 'police'];

export function defaultConfig(id) {
  const v = VEHICLES[id];
  return {
    id,
    color: v.color,
    engine: v.engine,
    tires: v.tires,
    suspension: v.suspension,
    drive: v.drive,
    transmission: 'auto',
    wheelStyle: v.wheelStyle,
    wheelScale: 1,
    abs: true,
    tcs: !!v.tcs,
  };
}
