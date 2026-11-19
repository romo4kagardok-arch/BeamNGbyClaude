// DOM-based menus: main menu, mode setup, garage/tuning, settings, pause, results, map, sandbox panel.
import { VEHICLES, VEHICLE_ORDER, ENGINES, TIRES, SUSPENSIONS, WHEEL_STYLES, PAINTS, enginePowerKW } from '../vehicle/defs.js';
import { CRASH_SCENARIOS, fmtTime } from '../modes/modes.js';
import { CONTROLS_HELP } from '../core/input.js';
import { PROP_DEFS } from '../world/dynamics.js';
import { storeGet } from '../core/storage.js';

const h = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};

export class Menu {
  constructor(root, game) {
    this.game = game;
    this.root = h('div', { class: 'menu-root' });
    root.appendChild(this.root);
    this.screen = null;
    this.modal = null;
    this.sandboxPanel = null;
    this.helpEl = null;
  }

  click() { this.game.audio.init(); }

  clear() {
    this.root.innerHTML = '';
    this.screen = null;
  }

  isOpen() { return !!this.screen || !!this.modal; }

  panel(title, body, opts = {}) {
    this.clear();
    const p = h('div', { class: 'panel ' + (opts.cls || '') },
      h('div', { class: 'panel-head' },
        opts.back !== false ? h('button', { class: 'btn ghost back', onclick: () => { this.click(); (opts.onBack || (() => this.openMain()))(); } }, '← Назад') : null,
        h('h2', {}, title)),
      body);
    this.root.appendChild(p);
    this.screen = p;
    return p;
  }

  // ---------------- main ----------------
  openMain() {
    const g = this.game;
    g.enterMenu();
    this.clear();
    const sel = g.selectedVehicle();
    const def = VEHICLES[sel.id];
    const items = [
      ['Свободная езда', 'Открытый мир без заданий', () => this.openFree()],
      ['Краш-тест', 'Полигон: стены, столбы, лобовые удары', () => this.openCrashMenu()],
      ['Гонка', 'Кольцо Ветров против ИИ-соперников', () => this.openRace()],
      ['Испытание на время', 'Чекпоинты на трассах мира', () => this.openTrial()],
      ['Погоня', 'Уйти от полиции или задержать нарушителя', () => this.openChase()],
      ['Песочница', 'Спавн техники и объектов, управление физикой', () => this.openSandbox()],
      ['Редактор', 'Свои трамплины и полосы препятствий', () => { this.clear(); g.openEditor(); }],
    ];
    const main = h('div', { class: 'main-menu' },
      h('div', { class: 'logo' }, h('div', { class: 'logo-title' }, 'CRUMPLE', h('span', {}, 'ZONE')), h('div', { class: 'logo-sub' }, 'симулятор мягкой физики · node-beam')),
      h('div', { class: 'main-cols' },
        h('div', { class: 'mode-list' }, items.map(([t, d, fn]) => h('button', { class: 'mode-btn', onclick: () => { this.click(); fn(); } }, h('b', {}, t), h('small', {}, d)))),
        h('div', { class: 'side-col' },
          h('div', { class: 'car-card' },
            h('div', { class: 'car-card-cls' }, def.cls),
            h('div', { class: 'car-card-name' }, def.name),
            h('div', { class: 'car-card-desc' }, def.desc),
            h('div', { class: 'car-card-stats' }, statLine(sel)),
            h('button', { class: 'btn primary', onclick: () => { this.click(); this.openGarage(); } }, 'Гараж и тюнинг')),
          h('div', { class: 'row-btns' },
            h('button', { class: 'btn', onclick: () => { this.click(); this.openSettings(); } }, 'Настройки'),
            h('button', { class: 'btn', onclick: () => { this.click(); this.openHelp(); } }, 'Управление')))),
      h('div', { class: 'touch-note' }, 'Для управления нужна клавиатура или геймпад.'),
      h('div', { class: 'footer' }, 'Оригинальная игра. Все модели, звуки и текстуры генерируются процедурно. Кликните по экрану игры, чтобы работала клавиатура.'));
    this.root.appendChild(main);
    this.screen = main;
  }

  timeSelect(id = 'tod') {
    const cur = this.game.settings.timeOfDay;
    return h('label', { class: 'field' }, 'Время суток',
      h('select', { id }, [['8', 'Утро'], ['13', 'День'], ['18.6', 'Закат'], ['22.5', 'Ночь']].map(([v, t]) => h('option', { value: v, selected: Math.abs(+v - cur) < 0.5 }, t))));
  }

  spawnSelect(def = 'city') {
    return h('div', { class: 'spawn-grid' }, Object.entries(this.game.map.spawns).map(([k, s]) =>
      h('label', { class: 'spawn-opt' }, h('input', { type: 'radio', name: 'spawn', value: k, checked: k === def }), h('span', {}, s.name))));
  }

  openFree() {
    const body = h('div', { class: 'form' },
      h('h3', {}, 'Место появления'), this.spawnSelect('city'),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, 'Трафик (машин ИИ)', h('input', { type: 'range', min: 0, max: 16, value: this.game.settings.traffic, id: 'traffic', oninput: (e) => (e.target.nextSibling.textContent = e.target.value) }), h('span', {}, String(this.game.settings.traffic))),
        this.timeSelect()),
      h('button', { class: 'btn primary big', onclick: () => {
        this.click();
        const spawn = this.root.querySelector('input[name=spawn]:checked').value;
        const traffic = +this.root.querySelector('#traffic').value;
        this.game.settings.traffic = traffic;
        this.game.settings.timeOfDay = +this.root.querySelector('#tod').value;
        this.game.saveSettings();
        this.game.startMode('free', { spawn, traffic });
      } }, 'Поехали'));
    this.panel('Свободная езда', body);
  }

  openCrashMenu() {
    this.closeResults(true);
    const g = this.game;
    const body = h('div', { class: 'form' },
      h('div', { class: 'scen-grid' }, Object.entries(CRASH_SCENARIOS).map(([k, s]) =>
        h('button', { class: 'scen-btn', onclick: () => {
          this.click();
          const other = this.root.querySelector('#other').value;
          g.settings.autoSlowmo = this.root.querySelector('#slowmo').checked;
          g.saveSettings();
          g.startMode('crash', { scenario: k, otherId: other });
        } }, h('b', {}, s.name)))),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, 'Второй автомобиль (лобовое/бок)', h('select', { id: 'other' }, VEHICLE_ORDER.map((id) => h('option', { value: id, selected: id === 'sedan' }, VEHICLES[id].name)))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'slowmo', checked: g.settings.autoSlowmo }), 'Автозамедление в момент удара')),
      h('p', { class: 'hint' }, 'Автомобиль разгоняется автоматически и держит полосу до удара. После удара появится отчёт. J — замедление, C — камера (попробуйте «Кино»).'));
    this.panel('Краш-тест — сценарии', body, { cls: 'wide' });
  }

  openRace() {
    const g = this.game;
    const body = h('div', { class: 'form' },
      h('div', { class: 'row' },
        h('label', { class: 'field' }, 'Кругов', h('select', { id: 'laps' }, [1, 2, 3, 5].map((n) => h('option', { value: n, selected: n === 3 }, String(n))))),
        h('label', { class: 'field' }, 'Соперников', h('select', { id: 'opp' }, [1, 2, 3, 4, 5].map((n) => h('option', { value: n, selected: n === 3 }, String(n))))),
        h('label', { class: 'field' }, 'Сложность', h('select', { id: 'diff' }, [['0.82', 'Лёгкая'], ['0.92', 'Средняя'], ['1.0', 'Сложная']].map(([v, t]) => h('option', { value: v, selected: v === '0.92' }, t))))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'mixed' }), 'Смешанный состав машин (иначе — такие же, как у вас)'),
      this.timeSelect(),
      h('button', { class: 'btn primary big', onclick: () => {
        this.click();
        g.settings.timeOfDay = +this.root.querySelector('#tod').value;
        g.startMode('race', { laps: +this.root.querySelector('#laps').value, opponents: +this.root.querySelector('#opp').value, difficulty: +this.root.querySelector('#diff').value, mixed: this.root.querySelector('#mixed').checked });
      } }, 'На старт'));
    this.panel('Гонка — Кольцо Ветров', body);
  }

  openTrial() {
    const g = this.game;
    const sel = g.selectedVehicle();
    const body = h('div', { class: 'form' },
      h('div', { class: 'scen-grid' }, g.map.trials.map((t) => {
        const best = parseFloat(storeGet('cz_best_' + t.id + '_' + sel.id, 'Infinity'));
        return h('button', { class: 'scen-btn', onclick: () => { this.click(); g.startMode('trial', { trial: t.id }); } },
          h('b', {}, t.name), h('small', {}, `${t.gates.length} чекпоинтов · рекорд (${VEHICLES[sel.id].name}): ${fmtTime(best)}`));
      })));
    this.panel('Испытание на время', body);
  }

  openChase() {
    const g = this.game;
    const body = h('div', { class: 'form' },
      h('div', { class: 'scen-grid' },
        h('button', { class: 'scen-btn', onclick: () => { this.click(); g.startMode('chase', { variant: 'escape', cops: +this.root.querySelector('#cops').value }); } }, h('b', {}, 'Уйти от полиции'), h('small', {}, 'Ваша машина из гаража против патрулей')),
        h('button', { class: 'scen-btn', onclick: () => { this.click(); g.startMode('chase', { variant: 'pursuit', suspect: this.root.querySelector('#suspect').value }); } }, h('b', {}, 'Задержать нарушителя'), h('small', {}, 'Вы — полицейский перехватчик'))),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, 'Патрулей', h('select', { id: 'cops' }, [1, 2, 3, 4].map((n) => h('option', { value: n, selected: n === 3 }, String(n))))),
        h('label', { class: 'field' }, 'Машина нарушителя', h('select', { id: 'suspect' }, ['sport', 'sedan', 'hatch', 'suv', 'pickup'].map((id) => h('option', { value: id }, VEHICLES[id].name))))));
    this.panel('Погоня', body);
  }

  openSandbox() {
    const body = h('div', { class: 'form' },
      h('h3', {}, 'Место'), this.spawnSelect('proving'), this.timeSelect(),
      h('button', { class: 'btn primary big', onclick: () => {
        this.click();
        this.game.settings.timeOfDay = +this.root.querySelector('#tod').value;
        this.game.startMode('sandbox', { spawn: this.root.querySelector('input[name=spawn]:checked').value });
      } }, 'Открыть песочницу'));
    this.panel('Песочница', body);
  }

  // ---------------- garage ----------------
  openGarage(onDone) {
    const g = this.game;
    if (!onDone) g.enterMenu(true); // from the pause menu the running mode stays alive
    const sel = g.selectedVehicle();
    let id = sel.id;
    const render = () => {
      const cfg = g.garage[id];
      const def = VEHICLES[id];
      const list = h('div', { class: 'veh-list' }, VEHICLE_ORDER.map((vid) => h('button', { class: 'veh-item' + (vid === id ? ' active' : ''), onclick: () => { this.click(); id = vid; g.selectVehicle(id); render(); } }, h('small', {}, VEHICLES[vid].cls), h('b', {}, VEHICLES[vid].name))));
      const upd = (k, v) => { cfg[k] = v; g.saveGarage(); g.refreshShowcase(); stats.replaceChildren(statLine({ id, cfg })); };
      const select = (label, key, opts) => h('label', { class: 'field' }, label, h('select', { onchange: (e) => upd(key, e.target.value) }, opts.map(([v, t]) => h('option', { value: v, selected: cfg[key] === v }, t))));
      const stats = h('div', { class: 'car-card-stats' }, statLine({ id, cfg }));
      const colors = h('div', { class: 'swatches' }, PAINTS.map((c) => h('button', { class: 'swatch' + (cfg.color === c ? ' active' : ''), style: `background:${c}`, onclick: () => { this.click(); upd('color', c); render(); } })),
        h('input', { type: 'color', value: cfg.color, oninput: (e) => { cfg.color = e.target.value; g.saveGarage(); g.recolorShowcase(cfg.color); } }));
      const tune = h('div', { class: 'tune' },
        h('div', { class: 'car-card-cls' }, def.cls), h('div', { class: 'car-card-name' }, def.name), h('div', { class: 'car-card-desc' }, def.desc), stats,
        h('h3', {}, 'Цвет кузова'), colors,
        h('h3', {}, 'Тюнинг'),
        h('div', { class: 'tune-grid' },
          select('Двигатель', 'engine', def.engines.map((e) => [e, `${ENGINES[e].name} (${Math.round(enginePowerKW(ENGINES[e]) * 1.36)} л.с.)`])),
          select('Коробка передач', 'transmission', [['auto', 'Автомат'], ['manual', 'Механика (Q/E)']]),
          select('Привод', 'drive', [['FWD', 'Передний'], ['RWD', 'Задний'], ['AWD', 'Полный']]),
          select('Подвеска', 'suspension', Object.entries(SUSPENSIONS).map(([k, s]) => [k, s.name])),
          select('Шины', 'tires', Object.entries(TIRES).map(([k, s]) => [k, s.name])),
          select('Диски', 'wheelStyle', Object.entries(WHEEL_STYLES).map(([k, s]) => [k, s.name])),
          h('label', { class: 'field' }, 'Размер колёс', h('input', { type: 'range', min: 0.9, max: 1.12, step: 0.02, value: cfg.wheelScale, onchange: (e) => upd('wheelScale', +e.target.value) })),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: cfg.abs, onchange: (e) => upd('abs', e.target.checked) }), 'ABS'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: cfg.tcs, onchange: (e) => upd('tcs', e.target.checked) }), 'Антипробуксовка')),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn', onclick: () => { this.click(); g.resetGarage(id); render(); } }, 'Сбросить тюнинг'),
          h('button', { class: 'btn primary', onclick: () => { this.click(); g.selectVehicle(id); if (onDone) onDone(); else this.openMain(); } }, onDone ? 'Готово' : 'Выбрать')));
      const body = h('div', { class: 'garage' }, list, h('div', { class: 'garage-gap' }), tune);
      this.panel('Гараж', body, { cls: 'garage-panel', onBack: () => (onDone ? onDone() : this.openMain()) });
    };
    render();
  }

  // ---------------- settings / help ----------------
  openSettings(onBack) {
    const g = this.game, s = g.settings;
    const body = h('div', { class: 'form' },
      h('div', { class: 'row' },
        h('label', { class: 'field' }, 'Качество графики', h('select', { onchange: (e) => { s.quality = e.target.value; g.saveSettings(); g.applyQuality(); } }, [['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое'], ['ultra', 'Ультра']].map(([v, t]) => h('option', { value: v, selected: s.quality === v }, t)))),
        h('label', { class: 'field' }, 'Масштаб разрешения', h('select', { onchange: (e) => { s.resScale = +e.target.value; g.saveSettings(); g.applyQuality(); } }, [[0.5, '50%'], [0.75, '75%'], [1, '100%'], [1.5, '150%']].map(([v, t]) => h('option', { value: v, selected: s.resScale === v }, t))))),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, 'Громкость', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.volume, oninput: (e) => { s.volume = +e.target.value; g.audio.setVolume(s.volume); g.saveSettings(); } })),
        h('label', { class: 'field' }, 'Поле зрения', h('input', { type: 'range', min: 50, max: 80, step: 1, value: s.fov, oninput: (e) => { s.fov = +e.target.value; g.cam.baseFov = s.fov; g.saveSettings(); } }))),
      h('div', { class: 'row' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.showFps, onchange: (e) => { s.showFps = e.target.checked; g.hud.showFps = s.showFps; g.saveSettings(); } }), 'Показывать FPS'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.autoSlowmo, onchange: (e) => { s.autoSlowmo = e.target.checked; g.saveSettings(); } }), 'Автозамедление в краш-тестах'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.kmh, onchange: (e) => { s.kmh = e.target.checked; g.saveSettings(); } }), 'км/ч')),
      h('label', { class: 'field' }, 'Время суток', h('input', { type: 'range', min: 5, max: 23.5, step: 0.25, value: s.timeOfDay, onchange: (e) => { s.timeOfDay = +e.target.value; g.saveSettings(); g.setTimeOfDay(s.timeOfDay); } })),
      h('p', { class: 'hint' }, 'Физика: XPBD, шаг 1 мс (1000 Гц). На слабых машинах уменьшите качество и масштаб разрешения.'));
    this.panel('Настройки', body, { onBack: onBack || (() => this.openMain()) });
  }

  openHelp(onBack) {
    const body = h('div', { class: 'help-grid' }, CONTROLS_HELP.map(([k, t]) => h('div', { class: 'help-row' }, h('kbd', {}, k), h('span', {}, t))));
    this.panel('Управление', body, { onBack: onBack || (() => this.openMain()) });
  }

  toggleHelpOverlay() {
    if (this.helpEl) { this.helpEl.remove(); this.helpEl = null; return; }
    this.helpEl = h('div', { class: 'help-overlay' }, h('h3', {}, 'Управление (F1 — скрыть)'), h('div', { class: 'help-grid' }, CONTROLS_HELP.map(([k, t]) => h('div', { class: 'help-row' }, h('kbd', {}, k), h('span', {}, t)))));
    document.body.appendChild(this.helpEl);
  }

  // ---------------- pause ----------------
  openPause() {
    const g = this.game;
    g.setPaused(true);
    const resume = () => { this.click(); this.clear(); g.setPaused(false); };
    const canTeleport = g.modeId === 'free' || g.modeId === 'sandbox' || g.modeId === 'editorTest';
    const body = h('div', { class: 'pause-list' },
      h('button', { class: 'btn primary', onclick: resume }, 'Продолжить'),
      h('button', { class: 'btn', onclick: () => { resume(); g.player && g.player.repair(); } }, 'Починить автомобиль (R)'),
      h('button', { class: 'btn', onclick: () => { resume(); g.mode && g.mode.respawn(); } }, 'Вернуть на старт (T)'),
      h('button', { class: 'btn', onclick: () => { resume(); g.restartMode(); } }, 'Перезапустить режим'),
      canTeleport ? h('button', { class: 'btn', onclick: () => { this.click(); this.openMap(); } }, 'Карта / телепорт') : null,
      h('button', { class: 'btn', onclick: () => { this.click(); this.openGarage(() => { this.clear(); g.swapPlayerVehicle(); g.setPaused(false); }); } }, 'Сменить автомобиль'),
      h('button', { class: 'btn', onclick: () => { this.click(); this.openSettings(() => this.openPause()); } }, 'Настройки'),
      h('button', { class: 'btn', onclick: () => { this.click(); this.openHelp(() => this.openPause()); } }, 'Управление'),
      g.modeId === 'editorTest' ? h('button', { class: 'btn', onclick: () => { this.click(); this.clear(); g.setPaused(false); g.backToEditor(); } }, 'Вернуться в редактор') : null,
      h('button', { class: 'btn danger', onclick: () => { this.click(); g.setPaused(false); this.openMain(); } }, 'Главное меню'));
    this.panel('Пауза', body, { back: false, cls: 'narrow' });
  }

  openMap() {
    const g = this.game;
    const img = g.mapImage;
    const wrap = h('div', { class: 'map-wrap' });
    const c = document.createElement('canvas');
    c.width = c.height = 720;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 720, 720);
    const S = 720 / g.map.T.size;
    const toPx = (x, z) => [(x + g.map.T.size / 2) * S, (z + g.map.T.size / 2) * S];
    ctx.font = 'bold 13px sans-serif';
    for (const [k, s] of Object.entries(g.map.spawns)) {
      const [px, py] = toPx(s.x, s.z);
      ctx.fillStyle = '#ffd000'; ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.strokeText(s.name, px + 8, py + 4); ctx.fillText(s.name, px + 8, py + 4);
    }
    if (g.player) {
      const [px, py] = toPx(g.player.body.com[0], g.player.body.com[2]);
      ctx.fillStyle = '#ff3020'; ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.fill();
    }
    c.addEventListener('click', (e) => {
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 720 / S - g.map.T.size / 2;
      const z = ((e.clientY - r.top) / r.height) * 720 / S - g.map.T.size / 2;
      // snap to nearest spawn if close, else teleport to point
      let best = null, bd = 30;
      for (const s of Object.values(g.map.spawns)) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
      const t = best || { x, z, yaw: g.player ? g.player.yaw : 0 };
      this.clear();
      g.setPaused(false);
      g.teleportPlayer(t.x, t.z, t.yaw);
    });
    wrap.appendChild(c);
    this.panel('Карта — нажмите, чтобы переместиться', h('div', {}, wrap, h('p', { class: 'hint' }, 'Жёлтые точки — точки появления. Клик в любое место карты переместит туда автомобиль.')), { onBack: () => this.openPause(), cls: 'wide' });
  }

  // ---------------- results ----------------
  showResults(title, rows, buttons) {
    this.closeResults(true);
    const m = h('div', { class: 'modal' },
      h('div', { class: 'modal-box' },
        h('h2', {}, title),
        h('table', { class: 'res-table' }, rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b)))),
        h('div', { class: 'row-btns' }, buttons.map(([t, fn]) => h('button', { class: 'btn', onclick: () => { this.click(); this.closeResults(true); fn(); } }, t)))));
    document.body.appendChild(m);
    this.modal = m;
  }
  closeResults(silent) {
    if (this.modal) { this.modal.remove(); this.modal = null; }
  }

  // ---------------- sandbox panel ----------------
  showSandboxPanel(on) {
    if (this.sandboxPanel) { this.sandboxPanel.remove(); this.sandboxPanel = null; }
    if (!on) return;
    const g = this.game;
    const sel = h('select', { id: 'sb-veh' }, VEHICLE_ORDER.map((id) => h('option', { value: id }, VEHICLES[id].name)));
    const ai = h('select', { id: 'sb-ai' }, [['parked', 'Стоит'], ['drive', 'Едет по кольцевой'], ['chase', 'Преследует меня'], ['ram', 'Таранит (на полной)']].map(([v, t]) => h('option', { value: v }, t)));
    const props = h('div', { class: 'sb-props' }, Object.entries(PROP_DEFS).map(([k, d]) => h('button', { class: 'btn small', onclick: () => g.sandboxSpawnProp(k) }, d.name)));
    const slider = (label, min, max, step, val, fn) => h('label', { class: 'field' }, label, h('input', { type: 'range', min, max, step, value: val, oninput: (e) => fn(+e.target.value) }));
    const p = h('div', { class: 'sandbox-panel' },
      h('h3', {}, 'Песочница'),
      h('div', { class: 'sb-sec' }, h('b', {}, 'Техника'), sel, ai, h('button', { class: 'btn small primary', onclick: () => g.sandboxSpawnVehicle(sel.value, ai.value) }, 'Создать перед собой')),
      h('div', { class: 'sb-sec' }, h('b', {}, 'Объекты'), props),
      h('div', { class: 'sb-sec' }, h('b', {}, 'Физика'),
        slider('Гравитация', -25, 0, 0.5, g.world.gravity, (v) => { g.world.gravity = v; }),
        slider('Скорость времени', 0.05, 1, 0.05, g.world.timeScale, (v) => { g.world.timeScale = v; }),
        slider('Время суток', 5, 23.5, 0.25, g.settings.timeOfDay, (v) => g.setTimeOfDay(v))),
      h('div', { class: 'sb-sec' },
        h('button', { class: 'btn small', onclick: () => g.repairAll() }, 'Починить всё'),
        h('button', { class: 'btn small', onclick: () => g.sandboxClear() }, 'Удалить созданное'),
        h('button', { class: 'btn small', onclick: () => g.resetWorldObjects() }, 'Восстановить мир'),
        h('button', { class: 'btn small', onclick: () => { g.world.paused = !g.world.paused; } }, 'Пауза физики')),
      h('div', { class: 'hint' }, 'Tab — пересесть в другую машину'));
    document.body.appendChild(p);
    this.sandboxPanel = p;
  }
}

function statLine(sel) {
  const def = VEHICLES[sel.id];
  const e = ENGINES[sel.cfg.engine] || ENGINES[def.engine];
  const kw = enginePowerKW(e);
  const hp = Math.round(kw * 1.36);
  const tq = Math.round(e.torque.reduce((m, p) => Math.max(m, p[1]), 0));
  const drive = { FWD: 'передний', RWD: 'задний', AWD: 'полный' }[sel.cfg.drive || def.drive];
  return `${hp} л.с. · ${tq} Н·м · ${def.mass} кг · ${(hp / (def.mass / 1000)).toFixed(0)} л.с./т · привод ${drive}`;
}
