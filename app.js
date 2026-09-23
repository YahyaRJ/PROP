'use strict';

// ------------------------------------------------------------
// Fixed project / PROP assumptions
// ------------------------------------------------------------
const G = 9.80665;
const N_ROTORS = 4;
const MAX_PLANFORM_CM = 50;
const MIN_PLANFORM_CM = 20.32;          // 2 x 4 in; smallest square compatible with the modeled prop range
const PROJECT_MASS_CAP_KG = 5.65;
const SITE_ELEVATION_M = 1655;          // Boulder approximation
const FLIGHT_HEIGHT_AGL_M = 2;
const MAX_FLIGHT_SPEED_MPS = 0.5;
const ENDURANCE_MIN = 15;
const ENDURANCE_TRIM_TILT_DEG = 0;      // steady level flight with drag neglected => zero required horizontal thrust
const RPM_FOS = 1.5;
const DRIVE_EFFICIENCY = 0.80;          // motor + ESC + wiring
const N_RPM = 800;

const baseline = {
  planform_cm: 50,
  D_cm: 20.32,             // 8 in
  designTWR: 1.50,
  chemistry: 'LiPo',
  batterySeries: 6,
  reserve_pct: 20,
  packSpecificEnergy_WhKg: 160
};

let S = { ...baseline };
let model = null;
let activeTab = 'STRUCT';

function packSpecificEnergy() {
  return S.packSpecificEnergy_WhKg;
}

function nominalCellVoltage() {
  return S.chemistry === 'Li-ion' ? 3.6 : 3.7;
}

function maxRotorDiameterCm() {
  return S.planform_cm / 2;
}

function getGroups() {
  return {
    STRUCT: [
      ['Geometry', 'planform_cm', 'Square planform side', 'range', [MIN_PLANFORM_CM, MAX_PLANFORM_CM, 0.1],
        'cm · may be smaller than the 50 cm project maximum.'],
      ['Geometry', 'D_cm', 'Rotor diameter', 'range', [10.16, maxRotorDiameterCm(), 0.01],
        `cm · four rotors are assumed, so diameter is limited to half the selected square side (${maxRotorDiameterCm().toFixed(1)} cm).`]
    ],
    GNC: [
      ['Control reserve', 'designTWR', 'Design thrust-to-weight ratio', 'range', [1.10, 3.00, 0.01],
        'PROP uses this value to set the thrust-limited vehicle mass ceiling.']
    ],
    PWR: [
      ['Battery', 'chemistry', 'Battery chemistry', 'selectText', ['LiPo', 'Li-ion'],
        'Changes only the preliminary pack-mass estimate; use supplier data once a pack is selected.'],
      ['Battery', 'batterySeries', 'Pack voltage', 'selectSeries', [4, 6],
        '4S or 6S only. Voltage does not change the Wh-based pack-mass estimate.'],
      ['Battery', 'reserve_pct', 'Battery reserve after 15 min', 'range', [0, 30, 1],
        '% · energy intentionally left unused at the end of the 15-minute sizing case.'],
      ['Battery', 'packSpecificEnergy_WhKg', 'Pack specific energy', 'range', [100, 300, 5],
        'Wh/kg · enter the pack-level value PWR wants PROP to use. Chemistry recommendations are shown at the bottom of the page.']
    ]
  };
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const row = {};
    headers.forEach((h, i) => row[h] = values[i]);
    return row;
  });
}

function n(row, key) {
  const value = Number.parseFloat(row[key]);
  return Number.isFinite(value) ? value : NaN;
}

async function init() {
  try {
    const response = await fetch('data/thin_electric_model.csv');
    const rows = parseCSV(await response.text());
    const ct = rows.find(r => r.Metric === 'CT');
    const cp = rows.find(r => r.Metric === 'CP');

    model = {
      K: n(ct, 'K_rpm_in'),
      D0: n(ct, 'D0_in'),
      degreeCT: n(ct, 'Degree'),
      degreeCP: n(cp, 'Degree'),
      betaCT: ['Calibrated_b0','b_u','b_r','b_u2','b_ur','b_r2'].map(k => n(ct, k)),
      betaCP: ['Calibrated_b0','b_u','b_r','b_u2','b_ur','b_r2'].map(k => n(cp, k)),
      lowCT: n(ct, 'LowOffset'),
      highCT: n(ct, 'HighOffset'),
      lowCP: n(cp, 'LowOffset'),
      highCP: n(cp, 'HighOffset'),
      Dmin_in: n(ct, 'Dmin_in'),
      Dmax_in: n(ct, 'Dmax_in'),
      rmin: n(ct, 'rmin')
    };

    document.querySelector('#dbBadge').classList.add('ready');
    document.querySelector('#dbBadge').innerHTML = '<span class="dot"></span> Thin Electric model ready';
    bind();
    renderInputs();
    update();
  } catch (error) {
    document.querySelector('#dbBadge').innerHTML = '<span class="dot"></span> Model unavailable';
    document.querySelector('#visual').innerHTML = '<div class="error">Could not load the Thin Electric CSV. See README.md.</div>';
  }
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

function fmtValue(key, value) {
  if (key === 'batterySeries') return `${value}S`;
  if (key === 'chemistry') return value;
  const units = {
    planform_cm: ' cm', D_cm: ' cm', designTWR: '', reserve_pct: '%', packSpecificEnergy_WhKg: ' Wh/kg'
  };
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${units[key] || ''}`;
}

function renderInputs() {
  const container = document.querySelector('#inputContent');
  container.innerHTML = '';
  let lastSection = '';
  const groups = getGroups();

  groups[activeTab].forEach(([section, key, label, type, options, hint]) => {
    if (section !== lastSection) {
      container.insertAdjacentHTML('beforeend', `<div class="section-title">${section}</div>`);
      lastSection = section;
    }

    const wrap = document.createElement('div');
    wrap.className = 'control';
    let input = '';

    if (type === 'selectText') {
      input = `<select data-key="${key}">${options.map(v => `<option value="${v}" ${S[key] === v ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
    } else if (type === 'selectSeries') {
      input = `<select data-key="${key}">${options.map(v => `<option value="${v}" ${Number(S[key]) === Number(v) ? 'selected' : ''}>${v}S</option>`).join('')}</select>`;
    } else if (type === 'number') {
      input = `<input data-key="${key}" type="number" min="${options[0]}" max="${options[1]}" step="${options[2]}" value="${S[key]}">`;
    } else {
      input = `<input data-key="${key}" type="range" min="${options[0]}" max="${options[1]}" step="${options[2]}" value="${S[key]}">`;
    }

    wrap.innerHTML = `
      <div class="control-top">
        <label>${label}</label>
        <span class="value" data-value="${key}">${fmtValue(key, S[key])}</span>
      </div>
      ${input}
      <small>${hint}</small>`;
    container.appendChild(wrap);
  });

  container.querySelectorAll('[data-key]').forEach(input => {
    input.oninput = event => {
      const key = event.target.dataset.key;
      const isText = key === 'chemistry';
      let value = isText ? event.target.value : Number(event.target.value);

      if (!isText && !Number.isFinite(value)) return;
      S[key] = value;

      if (key === 'planform_cm') {
        S.D_cm = Math.min(S.D_cm, maxRotorDiameterCm());
        renderInputs();
      }

      const display = container.querySelector(`[data-value="${key}"]`);
      if (display) display.textContent = fmtValue(key, value);
      update();
    };
  });
}

function atmosphereDensity(h_m) {
  const R = 287.05287;
  const T0 = 288.15;
  const p0 = 101325;
  const L = 0.0065;
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

  return {
    RPM,
    thrust,
    shaftPower,
    rpmStructural,
    rpmSafe,
    totalMaxThrust_N: N_ROTORS * thrust.at(-1)
  };
}

function interpolateAtThrust(perf, targetThrust_N) {
  for (let i = 1; i < perf.thrust.length; i++) {
    if (targetThrust_N <= perf.thrust[i]) {
      const t0 = perf.thrust[i-1], t1 = perf.thrust[i];
      const q = (targetThrust_N - t0) / Math.max(t1 - t0, Number.EPSILON);
      return {
        rpm: perf.RPM[i-1] + q * (perf.RPM[i] - perf.RPM[i-1]),
        shaftPower_W: perf.shaftPower[i-1] + q * (perf.shaftPower[i] - perf.shaftPower[i-1])
      };
    }
  }
  return null;
}

function scenario(ctOffset, cpOffset) {
  const perf = performance(ctOffset, cpOffset);
  const appliedTWR = S.designTWR;
  const mass = Math.min(PROJECT_MASS_CAP_KG, perf.totalMaxThrust_N / (appliedTWR * G));

  // Steady level flight at constant 0.5 m/s has zero horizontal acceleration.
  // With vehicle drag explicitly neglected, horizontal force balance gives
  // T*sin(theta)=0, so the required trim tilt is theta=0 deg and T=mg.
  // The endurance point is therefore evaluated from the static/hover prop data.
  const thrustPerRotor = mass * G / N_ROTORS;
  const op = interpolateAtThrust(perf, thrustPerRotor);

  let power_W = NaN;
  let energy_Wh = NaN;
  let batteryMass_kg = NaN;
  let nonBatteryMass_kg = NaN;
  let operatingRPM = NaN;

  if (op) {
    operatingRPM = op.rpm;
    power_W = N_ROTORS * op.shaftPower_W / DRIVE_EFFICIENCY;
    energy_Wh = power_W * ENDURANCE_MIN / 60;
    const usableFraction = Math.max(0.01, 1 - S.reserve_pct / 100);
    const installedEnergy_Wh = energy_Wh / usableFraction;
    batteryMass_kg = installedEnergy_Wh / packSpecificEnergy();
    nonBatteryMass_kg = mass - batteryMass_kg;
  }

  return { perf, appliedTWR, mass, operatingRPM, power_W, energy_Wh, batteryMass_kg, nonBatteryMass_kg };
}

function symmetricError(center, a, b) {
  if (![center, a, b].every(Number.isFinite)) return NaN;
  return Math.max(Math.abs(center - a), Math.abs(b - center));
}

function compute() {
  const central = scenario(0, 0);
  const conservative = scenario(model.lowCT, model.highCP);
  const optimistic = scenario(model.highCT, model.lowCP);

  return {
    central,
    conservative,
    optimistic,
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

function card(title, value, sub, wide = false) {
  return `<div class="card ${wide ? 'wide' : ''}">
    <div class="card-title">${title}</div>
    <div class="card-value">${value}</div>
    <div class="card-sub">${sub}</div>
  </div>`;
}

function update() {
  if (!model) return;

  S.planform_cm = Math.max(MIN_PLANFORM_CM, Math.min(MAX_PLANFORM_CM, S.planform_cm));
  S.D_cm = Math.max(2.54 * model.Dmin_in, Math.min(maxRotorDiameterCm(), S.D_cm));
  S.packSpecificEnergy_WhKg = Math.max(100, Math.min(300, S.packSpecificEnergy_WhKg));

  const R = compute();
  const C = R.central;

  const massText = pm(C.mass, R.massError, 2, 'kg');
  const batteryText = pm(C.batteryMass_kg, R.batteryError, 2, 'kg');
  const remainingText = pm(C.nonBatteryMass_kg, R.remainingError, 2, 'kg');
  const powerText = pm(C.power_W, R.powerError, 0, 'W');
  const energyText = pm(C.energy_Wh, R.energyError, 1, 'Wh');

  document.querySelector('#cards').innerHTML =
    card('MASS CEILING', massText,
      'Thrust-limited mass with the 5.65 kg project cap applied.', true) +
    card('ESTIMATED BATTERY MASS', batteryText,
      `${S.chemistry} · ${S.reserve_pct.toFixed(0)}% reserve · PWR input ${packSpecificEnergy().toFixed(0)} Wh/kg.`) +
    card('NON-BATTERY MASS REMAINING', remainingText,
      'Mass ceiling minus PROP’s estimated endurance battery mass.') +
    card('15-MIN PROPULSION DEMAND', `${powerText}<br>${energyText}`,
      `Steady level 0.5 m/s at 2 m AGL. With drag neglected, the required trim tilt is ${ENDURANCE_TRIM_TILT_DEG.toFixed(0)}° and T = mg.`, true);

  document.querySelector('#mobileMass').textContent = massText;
  document.querySelector('#mobileBattery').textContent = batteryText;
  document.querySelector('#mobileEnergy').textContent = energyText;

  const planformPill = document.querySelector('#planformPill');
  if (planformPill) planformPill.textContent = `${S.planform_cm.toFixed(1)} × ${S.planform_cm.toFixed(1)} cm planform`;

  renderVisual(R);
}

function renderVisual(R) {
  const titles = {
    STRUCT: ['STRUCTURE VIEW', 'Rotor packaging', 'Four equal rotors inside the selected square planform.'],
    GNC: ['GNC VIEW', 'Thrust-to-weight sizing', 'One GNC input: design thrust-to-weight ratio.'],
    PWR: ['POWER VIEW', 'Energy handoff', 'Battery mass derived from PROP energy demand and PWR’s selected pack specific energy.']
  };

  const [eyebrow, title, sub] = titles[activeTab];
  document.querySelector('#viewEyebrow').textContent = eyebrow;
  document.querySelector('#viewTitle').textContent = title;
  document.querySelector('#viewSub').textContent = sub;

  const visual = document.querySelector('#visual');
  const insight = document.querySelector('#insightBar');

  if (activeTab === 'STRUCT') {
    visual.innerHTML = svgStructure();
    insight.innerHTML = `<b>${S.planform_cm.toFixed(1)} × ${S.planform_cm.toFixed(1)} cm selected.</b> ${S.D_cm.toFixed(2)} cm rotors use ${(100 * S.D_cm / maxRotorDiameterCm()).toFixed(0)}% of the geometric diameter limit. The project maximum remains 50 × 50 cm.`;
  } else if (activeTab === 'GNC') {
    visual.innerHTML = svgGNC(R);
    insight.innerHTML = `Design T/W <b>${S.designTWR.toFixed(2)}</b> · propulsion mass ceiling <b>${pm(R.central.mass, R.massError, 2, 'kg')}</b>.`;
  } else {
    visual.innerHTML = svgPower(R);
    const nominalV = S.batterySeries * nominalCellVoltage();
    insight.innerHTML = `<b>${S.chemistry} · ${S.batterySeries}S · ${nominalV.toFixed(1)} V nominal</b> · PWR input <b>${packSpecificEnergy().toFixed(0)} Wh/kg</b> · ${S.reserve_pct.toFixed(0)}% reserve.`;
  }
}

function svgStructure() {
  const Lmax = MAX_PLANFORM_CM;
  const L = S.planform_cm;
  const D = S.D_cm;
  const radius = D / 2;
  const centerOffset = L / 2 - radius;

  const scale = 7.0;
  const outerX = 85, outerY = 45;
  const outerPx = Lmax * scale;
  const selectedPx = L * scale;
  const selectedX = outerX + (outerPx - selectedPx) / 2;
  const selectedY = outerY + (outerPx - selectedPx) / 2;
  const cx0 = selectedX + selectedPx / 2;
  const cy0 = selectedY + selectedPx / 2;

  const centers = [
    [-centerOffset, -centerOffset],
    [ centerOffset, -centerOffset],
    [ centerOffset,  centerOffset],
    [-centerOffset,  centerOffset]
  ];

  const rotors = centers.map(([x, y], i) => {
    const cx = cx0 + x * scale;
    const cy = cy0 + y * scale;
    return `<line x1="${cx0}" y1="${cy0}" x2="${cx}" y2="${cy}" class="arm" />
      <circle cx="${cx}" cy="${cy}" r="${radius * scale}" class="rotor" />
      <circle cx="${cx}" cy="${cy}" r="3" class="hub" />
      <text x="${cx + 8}" y="${cy - 8}" class="rotor-label">R${i + 1}</text>`;
  }).join('');

  return `<svg viewBox="0 0 520 470" role="img" aria-label="Selected square planform with four rotors">
    <rect x="${outerX}" y="${outerY}" width="${outerPx}" height="${outerPx}" rx="8" class="envelope-max" />
    <rect x="${selectedX}" y="${selectedY}" width="${selectedPx}" height="${selectedPx}" rx="8" class="envelope" />
    ${rotors}
    <circle cx="${cx0}" cy="${cy0}" r="5" class="cg" />
    <line x1="${selectedX}" y1="420" x2="${selectedX + selectedPx}" y2="420" class="dimension" />
    <line x1="${selectedX}" y1="412" x2="${selectedX}" y2="428" class="dimension" />
    <line x1="${selectedX + selectedPx}" y1="412" x2="${selectedX + selectedPx}" y2="428" class="dimension" />
    <text x="260" y="448" text-anchor="middle" class="svg-note">${L.toFixed(1)} cm square · rotor diameter ${D.toFixed(2)} cm · max ${maxRotorDiameterCm().toFixed(2)} cm</text>
  </svg>`;
}

function svgGNC(R) {
  const scaleMin = 1.0;
  const scaleMax = 3.0;
  const x = value => 70 + (Math.max(scaleMin, Math.min(scaleMax, value)) - scaleMin) / (scaleMax - scaleMin) * 390;
  return `<svg viewBox="0 0 520 430" role="img" aria-label="Design thrust-to-weight gauge">
    <text x="70" y="88" class="svg-kicker">DESIGN THRUST-TO-WEIGHT RATIO</text>
    <line x1="70" y1="195" x2="460" y2="195" class="gauge-track" />
    <line x1="70" y1="195" x2="${x(S.designTWR)}" y2="195" class="gauge-fill" />
    <circle cx="${x(S.designTWR)}" cy="195" r="10" class="gauge-dot" />
    <text x="${x(S.designTWR)}" y="250" text-anchor="middle" class="svg-value">T/W ${S.designTWR.toFixed(2)}</text>
    <text x="70" y="315" class="svg-note">PROP mass ceiling</text>
    <text x="70" y="355" class="svg-big">${R.central.mass.toFixed(2)} kg</text>
    <text x="300" y="315" class="svg-note">Model uncertainty</text>
    <text x="300" y="355" class="svg-big">± ${R.massError.toFixed(2)} kg</text>
  </svg>`;
}

function svgPower(R) {
  const C = R.central;
  const requiredLow = Math.max(0, C.batteryMass_kg - R.batteryError);
  const requiredHigh = Math.max(requiredLow, C.batteryMass_kg + R.batteryError);
  const massScaleMax = Math.max(0.25, requiredHigh * 1.25);
  const x0 = 60, width = 400;
  const x = value => x0 + width * Math.max(0, Math.min(massScaleMax, value)) / massScaleMax;

  return `<svg viewBox="0 0 520 430" role="img" aria-label="Battery mass and propulsion energy handoff">
    <text x="60" y="70" class="svg-kicker">BATTERY MASS FROM PROPULSION ENERGY</text>
    <text x="60" y="105" class="svg-note">Estimated battery mass</text>
    <line x1="${x0}" y1="158" x2="${x0 + width}" y2="158" class="gauge-track" />
    <rect x="${x(requiredLow)}" y="144" width="${Math.max(3, x(requiredHigh) - x(requiredLow))}" height="28" rx="10" class="uncertainty-band" />
    <circle cx="${x(C.batteryMass_kg)}" cy="158" r="10" class="gauge-dot" />
    <text x="${x(C.batteryMass_kg)}" y="214" text-anchor="middle" class="svg-value">${C.batteryMass_kg.toFixed(2)} ± ${R.batteryError.toFixed(2)} kg</text>

    <text x="60" y="276" class="svg-note">15-minute propulsion power</text>
    <text x="60" y="314" class="svg-big">${Number.isFinite(C.power_W) ? `${C.power_W.toFixed(0)} ± ${R.powerError.toFixed(0)} W` : '—'}</text>
    <text x="285" y="276" class="svg-note">15-minute propulsion energy</text>
    <text x="285" y="314" class="svg-big">${Number.isFinite(C.energy_Wh) ? `${C.energy_Wh.toFixed(1)} ± ${R.energyError.toFixed(1)} Wh` : '—'}</text>

    <text x="60" y="370" class="svg-note">PWR input: ${S.chemistry} · ${S.batterySeries}S · ${packSpecificEnergy().toFixed(0)} Wh/kg · ${S.reserve_pct.toFixed(0)}% reserve</text>
    <text x="60" y="396" class="svg-note">Steady 0.5 m/s + no vehicle drag ⇒ trim tilt ${ENDURANCE_TRIM_TILT_DEG.toFixed(0)}°</text>
  </svg>`;
}

init();
