'use strict';

const G = 9.80665;
const N_ROTORS = 4;
const MAX_PLANFORM_CM = 50;
const MIN_PLANFORM_CM = 20.32;
const PROJECT_MASS_CAP_KG = 5.65;
const SITE_ELEVATION_M = 1655;
const FLIGHT_HEIGHT_AGL_M = 2;
const ENDURANCE_MIN = 15;
const RPM_FOS = 1.5;
const DRIVE_EFFICIENCY = 0.80;
const N_RPM = 800;

// Thin Electric APC family model (embedded so GitHub Pages needs no separate data file).
const model = {
  K: 150000,
  D0: 12.290307,
  degreeCT: 2,
  degreeCP: 2,
  betaCT: [0.098658913512, -0.0590775, 0.003441136, 0.037751149, -0.000664438, 0.000717175],
  betaCP: [0.0568042664291, -0.053801168, -0.034142613, 0.030758658, 0.011287907, 0.024428234],
  lowCT: -0.0384650928402306,
  highCT: 0.0315759936418744,
  lowCP: -0.0360307790566141,
  highCP: 0.0381314292520521,
  Dmin_in: 4.0,
  Dmax_in: 26.0,
  rmin: 0.0266666666667
};

const baseline = {
  planform_cm: 50,
  D_cm: 20.32,
  designTWR: 1.50,
  chemistry: 'LiPo',
  batterySeries: 6,
  reserve_pct: 20,
  packSpecificEnergy_WhKg: 160
};

let S = { ...baseline };
let activeTab = 'STRUCT';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function maxRotorDiameterCm() { return S.planform_cm / 2; }
function packSpecificEnergy() { return S.packSpecificEnergy_WhKg; }
function nominalCellVoltage() { return S.chemistry === 'Li-ion' ? 3.6 : 3.7; }

function getGroups() {
  return {
    STRUCT: [
      ['planform_cm', 'Square planform side', [MIN_PLANFORM_CM, MAX_PLANFORM_CM, 0.1], 'cm'],
      ['D_cm', 'Rotor diameter', [10.16, maxRotorDiameterCm(), 0.01], 'cm']
    ],
    GNC: [
      ['designTWR', 'Design T/W', [1.10, 3.00, 0.01], '']
    ],
    PWR: [
      ['chemistry', 'Battery chemistry', ['LiPo', 'Li-ion'], 'selectText'],
      ['batterySeries', 'Pack voltage', [4, 6], 'selectSeries'],
      ['reserve_pct', 'Battery reserve', [0, 30, 1], '%'],
      ['packSpecificEnergy_WhKg', 'Pack specific energy', [100, 300, 1], 'Wh/kg']
    ]
  };
}

function init() {
  bind();
  renderInputs();
  update();
}

function bind() {
  document.querySelectorAll('#tabs button').forEach(button => {
    button.onclick = () => {
      activeTab = button.dataset.tab;
      document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b === button));
      renderInputs();
      update();
    };
  });

  document.querySelector('#resetBtn').onclick = () => {
    S = { ...baseline };
    renderInputs();
    update();
  };
}

function fmtInput(key, value) {
  if (key === 'planform_cm' || key === 'D_cm') return Number(value).toFixed(2).replace(/\.00$/, '');
  if (key === 'designTWR') return Number(value).toFixed(2);
  return Number(value).toFixed(0);
}

function numericControl(key, label, limits, unit) {
  const [min, max, step] = limits;
  const hint = key === 'D_cm' ? `max ${max.toFixed(2)} cm` : `${min}–${max}${unit ? ` ${unit}` : ''}`;
  return `
    <div class="control" data-control="${key}">
      <div class="control-top"><label>${label}</label><span class="unit">${unit}</span></div>
      <div class="range-pair">
        <input class="slider" data-key="${key}" data-role="range" type="range" min="${min}" max="${max}" step="${step}" value="${S[key]}">
        <input class="manual-number" data-key="${key}" data-role="number" type="number" min="${min}" max="${max}" step="${step}" value="${fmtInput(key, S[key])}">
      </div>
      <small data-hint="${key}">${hint}</small>
    </div>`;
}

function selectControl(key, label, options, type) {
  const optionHtml = options.map(v => {
    const value = String(v);
    const selected = String(S[key]) === value ? 'selected' : '';
    const text = type === 'selectSeries' ? `${v}S` : value;
    return `<option value="${value}" ${selected}>${text}</option>`;
  }).join('');
  return `<div class="control">
    <div class="control-top"><label>${label}</label></div>
    <select data-key="${key}" data-role="select">${optionHtml}</select>
  </div>`;
}

function renderInputs() {
  const container = document.querySelector('#inputContent');
  container.innerHTML = getGroups()[activeTab].map(([key, label, options, type]) => {
    if (type === 'selectText' || type === 'selectSeries') return selectControl(key, label, options, type);
    return numericControl(key, label, options, type);
  }).join('');

  container.querySelectorAll('[data-role="range"]').forEach(el => {
    el.addEventListener('input', () => setNumericValue(el.dataset.key, Number(el.value), 'range'));
  });

  container.querySelectorAll('[data-role="number"]').forEach(el => {
    el.addEventListener('input', () => {
      const v = Number(el.value);
      if (Number.isFinite(v) && v >= Number(el.min) && v <= Number(el.max)) setNumericValue(el.dataset.key, v, 'number');
    });
    el.addEventListener('change', () => {
      const v = clamp(Number(el.value), Number(el.min), Number(el.max));
      setNumericValue(el.dataset.key, v, 'number');
    });
  });

  container.querySelectorAll('[data-role="select"]').forEach(el => {
    el.addEventListener('change', () => {
      S[el.dataset.key] = el.dataset.key === 'chemistry' ? el.value : Number(el.value);
      update();
    });
  });
}

function setNumericValue(key, value, sourceRole) {
  if (!Number.isFinite(value)) return;

  if (key === 'planform_cm') {
    S.planform_cm = clamp(value, MIN_PLANFORM_CM, MAX_PLANFORM_CM);
    if (S.D_cm > maxRotorDiameterCm()) S.D_cm = maxRotorDiameterCm();
    updateRotorLimit();
  } else if (key === 'D_cm') {
    S.D_cm = clamp(value, 10.16, maxRotorDiameterCm());
  } else if (key === 'designTWR') {
    S.designTWR = clamp(value, 1.10, 3.00);
  } else if (key === 'reserve_pct') {
    S.reserve_pct = clamp(value, 0, 30);
  } else if (key === 'packSpecificEnergy_WhKg') {
    S.packSpecificEnergy_WhKg = clamp(value, 100, 300);
  }

  syncControl(key, sourceRole);
  if (key === 'planform_cm') syncControl('D_cm');
  update();
}

function syncControl(key, sourceRole = '') {
  document.querySelectorAll(`[data-key="${key}"]`).forEach(el => {
    if (el.dataset.role === sourceRole) return;
    if (el.dataset.role === 'number') el.value = fmtInput(key, S[key]);
    else el.value = S[key];
  });
}

function updateRotorLimit() {
  const max = maxRotorDiameterCm();
  document.querySelectorAll('[data-key="D_cm"]').forEach(el => {
    el.max = max;
    if (Number(el.value) > max) el.value = max;
  });
  const hint = document.querySelector('[data-hint="D_cm"]');
  if (hint) hint.textContent = `max ${max.toFixed(2)} cm`;
}

function atmosphereDensity(h_m) {
  const R = 287.05287, T0 = 288.15, p0 = 101325, L = 0.0065;
  const T = T0 - L * h_m;
  const p = p0 * Math.pow(T / T0, G / (R * L));
  return p / (R * T);
}

function evaluateFamily(D_in, r, beta, degree) {
  const u = Math.log(D_in / model.D0);
  if (degree === 1) return beta[0] + beta[1] * u + beta[2] * r;
  return beta[0] + beta[1] * u + beta[2] * r + beta[3] * u*u + beta[4] * u*r + beta[5] * r*r;
}

function performance(ctOffset = 0, cpOffset = 0) {
  const D_in = S.D_cm / 2.54;
  const D_m = S.D_cm / 100;
  const rho = atmosphereDensity(SITE_ELEVATION_M + FLIGHT_HEIGHT_AGL_M);
  const rpmStructural = model.K / D_in;
  const rpmSafe = rpmStructural / RPM_FOS;
  const rpmMin = Math.max(50, model.rmin * model.K / D_in);
  const RPM = [], thrust = [], shaftPower = [];

  for (let i = 0; i < N_RPM; i++) {
    const rpm = rpmMin + (rpmSafe - rpmMin) * i / (N_RPM - 1);
    const r = rpm * D_in / model.K;
    const CT = Math.max(evaluateFamily(D_in, r, model.betaCT, model.degreeCT) + ctOffset, Number.EPSILON);
    const CP = Math.max(evaluateFamily(D_in, r, model.betaCP, model.degreeCP) + cpOffset, Number.EPSILON);
    const rev_s = rpm / 60;
    RPM.push(rpm);
    thrust.push(CT * rho * rev_s**2 * D_m**4);
    shaftPower.push(CP * rho * rev_s**3 * D_m**5);
  }

  return { RPM, thrust, shaftPower, rpmSafe, totalMaxThrust_N: N_ROTORS * thrust.at(-1) };
}

function interpolateAtThrust(perf, targetThrust_N) {
  for (let i = 1; i < perf.thrust.length; i++) {
    if (targetThrust_N <= perf.thrust[i]) {
      const q = (targetThrust_N - perf.thrust[i-1]) / Math.max(perf.thrust[i] - perf.thrust[i-1], Number.EPSILON);
      return {
        rpm: perf.RPM[i-1] + q * (perf.RPM[i] - perf.RPM[i-1]),
        shaftPower_W: perf.shaftPower[i-1] + q * (perf.shaftPower[i] - perf.shaftPower[i-1])
      };
    }
  }
  return null;
}

function scenario(ctOffset, cpOffset, twr = S.designTWR, specificEnergy = S.packSpecificEnergy_WhKg) {
  const perf = performance(ctOffset, cpOffset);
  const mass = Math.min(PROJECT_MASS_CAP_KG, perf.totalMaxThrust_N / (twr * G));
  const thrustPerRotor = mass * G / N_ROTORS;
  const op = interpolateAtThrust(perf, thrustPerRotor);

  let power_W = NaN, energy_Wh = NaN, batteryMass_kg = NaN, nonBatteryMass_kg = NaN, operatingRPM = NaN;
  if (op) {
    operatingRPM = op.rpm;
    power_W = N_ROTORS * op.shaftPower_W / DRIVE_EFFICIENCY;
    energy_Wh = power_W * ENDURANCE_MIN / 60;
    const usableFraction = Math.max(0.01, 1 - S.reserve_pct / 100);
    batteryMass_kg = (energy_Wh / usableFraction) / specificEnergy;
    nonBatteryMass_kg = mass - batteryMass_kg;
  }
  return { perf, mass, operatingRPM, power_W, energy_Wh, batteryMass_kg, nonBatteryMass_kg };
}

function symmetricError(center, a, b) {
  if (![center, a, b].every(Number.isFinite)) return NaN;
  return Math.max(Math.abs(center - a), Math.abs(b - center));
}

function compute(twr = S.designTWR, specificEnergy = S.packSpecificEnergy_WhKg) {
  const central = scenario(0, 0, twr, specificEnergy);
  const conservative = scenario(model.lowCT, model.highCP, twr, specificEnergy);
  const optimistic = scenario(model.highCT, model.lowCP, twr, specificEnergy);
  return {
    central, conservative, optimistic,
    massError: symmetricError(central.mass, conservative.mass, optimistic.mass),
    powerError: symmetricError(central.power_W, conservative.power_W, optimistic.power_W),
    energyError: symmetricError(central.energy_Wh, conservative.energy_Wh, optimistic.energy_Wh),
    batteryError: symmetricError(central.batteryMass_kg, conservative.batteryMass_kg, optimistic.batteryMass_kg),
    remainingError: symmetricError(central.nonBatteryMass_kg, conservative.nonBatteryMass_kg, optimistic.nonBatteryMass_kg)
  };
}

function pm(center, err, digits, unit) {
  if (!Number.isFinite(center) || !Number.isFinite(err)) return '—';
  return `${center.toFixed(digits)} ± ${err.toFixed(digits)} ${unit}`;
}

function card(title, value, wide = false) {
  return `<div class="card ${wide ? 'wide' : ''}"><div class="card-title">${title}</div><div class="card-value">${value}</div></div>`;
}

function update() {
  S.planform_cm = clamp(S.planform_cm, MIN_PLANFORM_CM, MAX_PLANFORM_CM);
  S.D_cm = clamp(S.D_cm, 10.16, maxRotorDiameterCm());
  S.packSpecificEnergy_WhKg = clamp(S.packSpecificEnergy_WhKg, 100, 300);

  const R = compute();
  const C = R.central;
  const massText = pm(C.mass, R.massError, 2, 'kg');
  const batteryText = pm(C.batteryMass_kg, R.batteryError, 2, 'kg');
  const remainingText = pm(C.nonBatteryMass_kg, R.remainingError, 2, 'kg');
  const powerText = pm(C.power_W, R.powerError, 0, 'W');
  const energyText = pm(C.energy_Wh, R.energyError, 1, 'Wh');

  document.querySelector('#cards').innerHTML =
    card('MASS CEILING', massText, true) +
    card('ESTIMATED BATTERY MASS', batteryText) +
    card('NON-BATTERY MASS REMAINING', remainingText) +
    card('15-MIN PROPULSION', `${powerText}<br>${energyText}`, true);

  document.querySelector('#mobileMass').textContent = massText;
  document.querySelector('#mobileBattery').textContent = batteryText;
  document.querySelector('#mobileEnergy').textContent = energyText;
  renderVisual(R);
}

function renderVisual(R) {
  const titles = {
    STRUCT: ['STRUCT', 'Rotor packaging', ''],
    GNC: ['GNC', 'Mass ceiling vs T/W', ''],
    PWR: ['PWR', 'Battery mass vs specific energy', '']
  };
  const [eyebrow, title, sub] = titles[activeTab];
  document.querySelector('#viewEyebrow').textContent = eyebrow;
  document.querySelector('#viewTitle').textContent = title;
  document.querySelector('#viewSub').textContent = sub;

  const visual = document.querySelector('#visual');
  const insight = document.querySelector('#insightBar');

  if (activeTab === 'STRUCT') {
    visual.innerHTML = svgStructure();
    insight.innerHTML = `${S.planform_cm.toFixed(1)} cm square · ${S.D_cm.toFixed(2)} cm rotors · max rotor ${maxRotorDiameterCm().toFixed(2)} cm`;
  } else if (activeTab === 'GNC') {
    visual.innerHTML = svgGNC(R);
    insight.innerHTML = `T/W ${S.designTWR.toFixed(2)} → ${pm(R.central.mass, R.massError, 2, 'kg')}`;
  } else {
    visual.innerHTML = svgPower(R);
    const V = S.batterySeries * nominalCellVoltage();
    const I = R.central.power_W / V;
    const Ierr = R.powerError / V;
    insight.innerHTML = `${S.chemistry} ${S.batterySeries}S · ${V.toFixed(1)} V nominal · steady current ${pm(I, Ierr, 1, 'A')}`;
  }
}

function svgStructure() {
  const Lmax = MAX_PLANFORM_CM, L = S.planform_cm, D = S.D_cm, radius = D / 2;
  const centerOffset = L / 2 - radius, scale = 7.0, outerX = 85, outerY = 45;
  const outerPx = Lmax * scale, selectedPx = L * scale;
  const selectedX = outerX + (outerPx - selectedPx) / 2, selectedY = outerY + (outerPx - selectedPx) / 2;
  const cx0 = selectedX + selectedPx / 2, cy0 = selectedY + selectedPx / 2;
  const centers = [[-centerOffset,-centerOffset],[centerOffset,-centerOffset],[centerOffset,centerOffset],[-centerOffset,centerOffset]];
  const rotors = centers.map(([x,y], i) => {
    const cx = cx0 + x * scale, cy = cy0 + y * scale;
    return `<line x1="${cx0}" y1="${cy0}" x2="${cx}" y2="${cy}" class="arm"/><circle cx="${cx}" cy="${cy}" r="${radius*scale}" class="rotor"/><circle cx="${cx}" cy="${cy}" r="3" class="hub"/><text x="${cx+8}" y="${cy-8}" class="rotor-label">R${i+1}</text>`;
  }).join('');
  return `<svg viewBox="0 0 520 470" role="img" aria-label="Square planform with four rotors">
    <rect x="${outerX}" y="${outerY}" width="${outerPx}" height="${outerPx}" rx="8" class="envelope-max"/>
    <rect x="${selectedX}" y="${selectedY}" width="${selectedPx}" height="${selectedPx}" rx="8" class="envelope"/>
    ${rotors}<circle cx="${cx0}" cy="${cy0}" r="5" class="cg"/>
    <line x1="${selectedX}" y1="420" x2="${selectedX+selectedPx}" y2="420" class="dimension"/>
    <line x1="${selectedX}" y1="412" x2="${selectedX}" y2="428" class="dimension"/>
    <line x1="${selectedX+selectedPx}" y1="412" x2="${selectedX+selectedPx}" y2="428" class="dimension"/>
    <text x="260" y="448" text-anchor="middle" class="svg-note">${L.toFixed(1)} cm square · ${D.toFixed(2)} cm rotor</text>
  </svg>`;
}

function pathFromPoints(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
}

function svgGNC(R) {
  const x0 = 62, y0 = 340, w = 410, h = 255;
  const x = v => x0 + (v - 1.1) / (3.0 - 1.1) * w;
  const y = m => y0 - clamp(m, 0, PROJECT_MASS_CAP_KG) / PROJECT_MASS_CAP_KG * h;

  const central = [], low = [], high = [];
  for (let i = 0; i <= 60; i++) {
    const twr = 1.1 + (3.0 - 1.1) * i / 60;
    const r = compute(twr, S.packSpecificEnergy_WhKg);
    central.push([x(twr), y(r.central.mass)]);
    low.push([x(twr), y(Math.max(0, r.central.mass - r.massError))]);
    high.push([x(twr), y(Math.min(PROJECT_MASS_CAP_KG, r.central.mass + r.massError))]);
  }
  const band = [...high, ...low.slice().reverse()];
  const sx = x(S.designTWR), sy = y(R.central.mass);

  const yTicks = [0,1,2,3,4,5,5.65].map(v => `<line x1="${x0}" y1="${y(v)}" x2="${x0+w}" y2="${y(v)}" class="gridline"/><text x="${x0-12}" y="${y(v)+4}" text-anchor="end" class="axis-label">${v}</text>`).join('');
  const xTicks = [1.1,1.5,2.0,2.5,3.0].map(v => `<line x1="${x(v)}" y1="${y0}" x2="${x(v)}" y2="${y0+6}" class="axis"/><text x="${x(v)}" y="${y0+24}" text-anchor="middle" class="axis-label">${v.toFixed(1)}</text>`).join('');

  return `<svg viewBox="0 0 520 430" role="img" aria-label="Mass ceiling versus thrust-to-weight ratio">
    ${yTicks}<line x1="${x0}" y1="${y0}" x2="${x0+w}" y2="${y0}" class="axis"/><line x1="${x0}" y1="${y0-h}" x2="${x0}" y2="${y0}" class="axis"/>${xTicks}
    <path d="${pathFromPoints(band)} Z" class="plot-band"/>
    <path d="${pathFromPoints(central)}" class="plot-line"/>
    <line x1="${sx}" y1="${y0-h}" x2="${sx}" y2="${y0}" class="selected-line"/>
    <circle cx="${sx}" cy="${sy}" r="7" class="plot-dot"/>
    <text x="${x0}" y="45" class="axis-title">Mass ceiling (kg)</text>
    <text x="${x0+w}" y="392" text-anchor="end" class="axis-title">Design T/W</text>
    <text x="${Math.min(sx+10, 380)}" y="${Math.max(sy-14, 62)}" class="plot-label">${R.central.mass.toFixed(2)} ± ${R.massError.toFixed(2)} kg</text>
  </svg>`;
}

function svgPower(R) {
  const x0 = 62, y0 = 330, w = 410, h = 235;
  const x = e => x0 + (e - 100) / 200 * w;

  const reserveFrac = Math.max(0.01, 1 - S.reserve_pct / 100);
  const installed = R.central.energy_Wh / reserveFrac;
  const installedLow = Math.max(0, (R.central.energy_Wh - R.energyError) / reserveFrac);
  const installedHigh = (R.central.energy_Wh + R.energyError) / reserveFrac;
  const maxMass = Math.max(0.5, installedHigh / 100 * 1.15);
  const y = m => y0 - clamp(m, 0, maxMass) / maxMass * h;

  const central = [], low = [], high = [];
  for (let e = 100; e <= 300; e += 4) {
    central.push([x(e), y(installed / e)]);
    low.push([x(e), y(installedLow / e)]);
    high.push([x(e), y(installedHigh / e)]);
  }
  const band = [...high, ...low.slice().reverse()];
  const sx = x(S.packSpecificEnergy_WhKg), sy = y(R.central.batteryMass_kg);
  const yTicks = [0,0.25,0.5,0.75,1,1.25,1.5,2,2.5,3].filter(v => v <= maxMass + 0.001).map(v => `<line x1="${x0}" y1="${y(v)}" x2="${x0+w}" y2="${y(v)}" class="gridline"/><text x="${x0-12}" y="${y(v)+4}" text-anchor="end" class="axis-label">${v}</text>`).join('');
  const xTicks = [100,150,200,250,300].map(v => `<line x1="${x(v)}" y1="${y0}" x2="${x(v)}" y2="${y0+6}" class="axis"/><text x="${x(v)}" y="${y0+24}" text-anchor="middle" class="axis-label">${v}</text>`).join('');
  const lipoX = x(160), liionX = x(200);
  const V = S.batterySeries * nominalCellVoltage();
  const current = R.central.power_W / V, currentErr = R.powerError / V;

  return `<svg viewBox="0 0 520 430" role="img" aria-label="Battery mass versus pack specific energy">
    ${yTicks}<line x1="${x0}" y1="${y0}" x2="${x0+w}" y2="${y0}" class="axis"/><line x1="${x0}" y1="${y0-h}" x2="${x0}" y2="${y0}" class="axis"/>${xTicks}
    <line x1="${lipoX}" y1="${y0-h}" x2="${lipoX}" y2="${y0}" class="reference-line"/><text x="${lipoX-4}" y="78" text-anchor="end" class="ref-label">LiPo 160</text>
    <line x1="${liionX}" y1="${y0-h}" x2="${liionX}" y2="${y0}" class="reference-line"/><text x="${liionX+4}" y="94" class="ref-label">Li-ion 200</text>
    <path d="${pathFromPoints(band)} Z" class="plot-band"/>
    <path d="${pathFromPoints(central)}" class="plot-line"/>
    <line x1="${sx}" y1="${y0-h}" x2="${sx}" y2="${y0}" class="selected-line"/>
    <circle cx="${sx}" cy="${sy}" r="7" class="plot-dot"/>
    <text x="${x0}" y="45" class="axis-title">Battery mass (kg)</text>
    <text x="${x0+w}" y="382" text-anchor="end" class="axis-title">Pack specific energy (Wh/kg)</text>
    <text x="${Math.min(sx+10, 360)}" y="${Math.max(sy-14, 112)}" class="plot-label">${R.central.batteryMass_kg.toFixed(2)} ± ${R.batteryError.toFixed(2)} kg</text>
    <rect x="62" y="360" width="205" height="48" rx="9" class="mini-card"/><text x="76" y="380" class="mini-label">${S.batterySeries}S ${S.chemistry} · ${V.toFixed(1)} V nominal</text><text x="76" y="398" class="mini-value">${current.toFixed(1)} ± ${currentErr.toFixed(1)} A steady</text>
  </svg>`;
}

init();
