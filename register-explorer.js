const state = {
  port: null,
  reader: null,
  writer: null,
  scanning: false,
  results: new Map(),
  snapshotA: null,
  snapshotB: null,
};

const THEME_KEY = "modbusServiceViewer.theme.v1";
const EXPLORER_SETTINGS_KEY = "modbusRegisterExplorer.settings.v1";

const els = {
  machineName: document.querySelector("#machineName"),
  baudRate: document.querySelector("#baudRate"),
  serialFormat: document.querySelector("#serialFormat"),
  slaveId: document.querySelector("#slaveId"),
  functionCode: document.querySelector("#functionCode"),
  connectBtn: document.querySelector("#connectBtn"),
  themeToggle: document.querySelector("#themeToggle"),
  portState: document.querySelector("#portState"),
  progressState: document.querySelector("#progressState"),
  foundCount: document.querySelector("#foundCount"),
  lastError: document.querySelector("#lastError"),
  preset: document.querySelector("#preset"),
  startRegister: document.querySelector("#startRegister"),
  endRegister: document.querySelector("#endRegister"),
  blockSize: document.querySelector("#blockSize"),
  delayMs: document.querySelector("#delayMs"),
  scanBtn: document.querySelector("#scanBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  downloadJsonBtn: document.querySelector("#downloadJsonBtn"),
  downloadCsvBtn: document.querySelector("#downloadCsvBtn"),
  snapshotA: document.querySelector("#snapshotA"),
  snapshotB: document.querySelector("#snapshotB"),
  compareBtn: document.querySelector("#compareBtn"),
  filterInput: document.querySelector("#filterInput"),
  clearBtn: document.querySelector("#clearBtn"),
  resultsBody: document.querySelector("#resultsBody"),
  compareBody: document.querySelector("#compareBody"),
  summary: document.querySelector("#summary"),
};

const PRESETS = {
  "w3000-service": { start: 1, end: 180, block: 10 },
  "w3000-compressors": { start: 40, end: 130, block: 10 },
  "w3000-alarms": { start: 140, end: 180, block: 10 },
  "t3c-live": { start: 8700, end: 8950, block: 10 },
  "t3c-condenser": { start: 9300, end: 9320, block: 5 },
  "mcx-live": { start: 16000, end: 22000, block: 10 },
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeToggle.textContent = theme === "dark" ? "Light" : "Dark";
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

function saveSettings() {
  localStorage.setItem(
    EXPLORER_SETTINGS_KEY,
    JSON.stringify({
      machineName: els.machineName.value,
      baudRate: Number(els.baudRate.value) || 19200,
      serialFormat: els.serialFormat.value || "8N1",
      slaveId: Number(els.slaveId.value) || 1,
      functionCode: els.functionCode.value,
      preset: els.preset.value,
      startRegister: Number(els.startRegister.value) || 0,
      endRegister: Number(els.endRegister.value) || 0,
      blockSize: Number(els.blockSize.value) || 10,
      delayMs: Number(els.delayMs.value) || 150,
    }),
  );
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPLORER_SETTINGS_KEY) || "{}");
    for (const [key, value] of Object.entries(saved)) {
      if (els[key] && value !== undefined) els[key].value = value;
    }
  } catch {}
}

function crc16Modbus(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc;
}

function parseSerialFormat(format = "8N1") {
  const clean = String(format || "8N1").trim().toUpperCase();
  const match = clean.match(/^8([NEO])([12])$/);
  const parity = { N: "none", E: "even", O: "odd" };
  if (!match) return { dataBits: 8, parity: "none", stopBits: 1 };
  return { dataBits: 8, parity: parity[match[1]], stopBits: Number(match[2]) };
}

function buildRequest(slaveId, fn, start, quantity) {
  const frame = new Uint8Array(8);
  frame[0] = slaveId;
  frame[1] = fn;
  frame[2] = (start >> 8) & 0xff;
  frame[3] = start & 0xff;
  frame[4] = (quantity >> 8) & 0xff;
  frame[5] = quantity & 0xff;
  const crc = crc16Modbus(frame.slice(0, 6));
  frame[6] = crc & 0xff;
  frame[7] = (crc >> 8) & 0xff;
  return frame;
}

function findModbusFrame(buffer, slaveId, fn, normalLength) {
  for (let start = 0; start <= buffer.length - 5; start += 1) {
    if (buffer[start] !== slaveId) continue;
    const code = buffer[start + 1];
    const length = code === (fn | 0x80) ? 5 : code === fn ? normalLength : 0;
    if (!length || buffer.length - start < length) continue;
    const frame = buffer.slice(start, start + length);
    const body = frame.slice(0, -2);
    const received = frame[frame.length - 2] | (frame[frame.length - 1] << 8);
    if (received === crc16Modbus(body)) return frame;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readModbusFrame(slaveId, fn, normalLength, timeoutMs = 2500) {
  let buffer = new Uint8Array(0);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const read = state.reader.read();
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Read timeout")), Math.max(1, deadline - Date.now())),
    );
    const { value, done } = await Promise.race([read, timeout]);
    if (done) throw new Error("Port closed");
    if (value) {
      const merged = new Uint8Array(buffer.length + value.length);
      merged.set(buffer, 0);
      merged.set(value, buffer.length);
      buffer = merged;
      const frame = findModbusFrame(buffer, slaveId, fn, normalLength);
      if (frame) return frame;
    }
  }
  if (buffer.length) throw new Error(`No valid CRC frame (${buffer.length} bytes heard)`);
  throw new Error("Read timeout");
}

function parseRegisterFrame(bytes, slaveId, fn) {
  if (bytes[0] !== slaveId) throw new Error("Wrong slave response");
  if (bytes[1] & 0x80) throw new Error(`Modbus exception ${bytes[2]}`);
  if (bytes[1] !== fn) throw new Error("Wrong function response");
  const values = [];
  const byteCount = bytes[2];
  for (let i = 0; i < byteCount; i += 2) values.push((bytes[3 + i] << 8) | bytes[4 + i]);
  return values;
}

function signed16(value) {
  return value > 32767 ? value - 65536 : value;
}

function hex16(value) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(4, "0")}`;
}

function noteForValue(raw) {
  if ([32767, 32768, 65535].includes(Number(raw))) return "unavailable/fault style value";
  if (Number(raw) === 0) return "zero";
  return "";
}

async function connect() {
  try {
    if (!("serial" in navigator)) throw new Error("Web Serial is not available in this browser.");
    if (state.port) {
      await disconnect();
      return;
    }
    els.portState.textContent = "Finding adapter...";
    const known = await navigator.serial.getPorts();
    state.port = known[0] || (await navigator.serial.requestPort());
    els.portState.textContent = "Opening...";
    const serial = parseSerialFormat(els.serialFormat.value);
    await state.port.open({
      baudRate: Number(els.baudRate.value) || 19200,
      dataBits: serial.dataBits,
      stopBits: serial.stopBits,
      parity: serial.parity,
      bufferSize: 255,
    });
    state.reader = state.port.readable.getReader();
    state.writer = state.port.writable.getWriter();
    els.portState.textContent = "Connected";
    els.connectBtn.textContent = "Disconnect";
    els.scanBtn.disabled = false;
    els.lastError.textContent = "None";
  } catch (error) {
    if (state.port) await disconnect().catch(() => {});
    els.portState.textContent = "Disconnected";
    els.lastError.textContent = error.message;
    console.error(error);
  }
}

async function disconnect() {
  state.scanning = false;
  if (state.reader) {
    await state.reader.cancel().catch(() => {});
    state.reader.releaseLock();
  }
  if (state.writer) state.writer.releaseLock();
  if (state.port) await state.port.close().catch(() => {});
  state.port = null;
  state.reader = null;
  state.writer = null;
  els.portState.textContent = "Disconnected";
  els.connectBtn.textContent = "Connect";
  els.scanBtn.disabled = true;
  els.stopBtn.disabled = true;
}

function renderResults() {
  const filter = els.filterInput.value.trim().toLowerCase();
  els.resultsBody.textContent = "";
  const rows = [...state.results.values()]
    .sort((a, b) => a.register - b.register)
    .filter((row) => [row.register, row.raw, row.signed, row.hex, row.notes].join(" ").toLowerCase().includes(filter));
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${row.register}</td><td>${row.raw}</td><td>${row.signed}</td><td>${row.hex}</td><td>${row.notes}</td>`;
    els.resultsBody.appendChild(tr);
  }
  els.foundCount.textContent = String(state.results.size);
  els.downloadJsonBtn.disabled = state.results.size === 0;
  els.downloadCsvBtn.disabled = state.results.size === 0;
}

async function readBlock(start, quantity) {
  const slaveId = Number(els.slaveId.value);
  const fn = Number(els.functionCode.value);
  const request = buildRequest(slaveId, fn, start, quantity);
  await state.writer.write(request);
  const responseLength = 5 + quantity * 2;
  const response = await readModbusFrame(slaveId, fn, responseLength, 3000);
  return parseRegisterFrame(response, slaveId, fn);
}

async function scanRange() {
  if (!state.port || state.scanning) return;
  saveSettings();
  state.scanning = true;
  els.scanBtn.disabled = true;
  els.stopBtn.disabled = false;
  els.lastError.textContent = "None";
  const start = Number(els.startRegister.value);
  const end = Number(els.endRegister.value);
  const blockSize = Math.max(1, Math.min(60, Number(els.blockSize.value) || 10));
  const delayMs = Math.max(0, Number(els.delayMs.value) || 0);
  let failures = 0;

  for (let address = start; address <= end && state.scanning; address += blockSize) {
    const quantity = Math.min(blockSize, end - address + 1);
    els.progressState.textContent = `${address}-${address + quantity - 1}`;
    try {
      const values = await readBlock(address, quantity);
      values.forEach((raw, index) => {
        const register = address + index;
        state.results.set(register, {
          register,
          raw,
          signed: signed16(raw),
          hex: hex16(raw),
          notes: noteForValue(raw),
        });
      });
      renderResults();
    } catch (error) {
      failures += 1;
      els.lastError.textContent = `${address}: ${error.message}`;
      if (/exception|timeout|crc/i.test(error.message) && blockSize > 1) {
        await scanSingles(address, address + quantity - 1, delayMs);
      }
    }
    if (delayMs) await sleep(delayMs);
  }

  state.scanning = false;
  els.scanBtn.disabled = false;
  els.stopBtn.disabled = true;
  els.progressState.textContent = `Done (${failures} failed blocks)`;
  renderResults();
}

async function scanSingles(start, end, delayMs) {
  for (let register = start; register <= end && state.scanning; register += 1) {
    try {
      const [raw] = await readBlock(register, 1);
      state.results.set(register, {
        register,
        raw,
        signed: signed16(raw),
        hex: hex16(raw),
        notes: noteForValue(raw),
      });
      renderResults();
    } catch {}
    if (delayMs) await sleep(delayMs);
  }
}

function makeSnapshot() {
  return {
    tool: "Modbus Register Explorer",
    createdAt: new Date().toISOString(),
    machine: els.machineName.value || "Unnamed machine",
    connection: {
      baudRate: Number(els.baudRate.value),
      slaveId: Number(els.slaveId.value),
      functionCode: els.functionCode.value,
    },
    range: {
      start: Number(els.startRegister.value),
      end: Number(els.endRegister.value),
      blockSize: Number(els.blockSize.value),
    },
    registers: [...state.results.values()].sort((a, b) => a.register - b.register),
  };
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeName() {
  return (els.machineName.value || "modbus-snapshot").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function downloadJson() {
  download(`${safeName()}-${Date.now()}.json`, JSON.stringify(makeSnapshot(), null, 2), "application/json");
}

function downloadCsv() {
  const rows = makeSnapshot().registers;
  const headers = ["register", "raw", "signed", "hex", "notes"];
  const lines = [headers.join(",")].concat(
    rows.map((row) => headers.map((header) => `"${String(row[header] ?? "").replaceAll('"', '""')}"`).join(",")),
  );
  download(`${safeName()}-${Date.now()}.csv`, lines.join("\n"), "text/csv");
}

async function loadSnapshot(input) {
  const file = input.files?.[0];
  if (!file) return null;
  return JSON.parse(await file.text());
}

function snapshotMap(snapshot) {
  const map = new Map();
  for (const row of snapshot?.registers || []) map.set(Number(row.register), Number(row.raw));
  return map;
}

function renderCompare() {
  if (!state.snapshotA || !state.snapshotB) return;
  const a = snapshotMap(state.snapshotA);
  const b = snapshotMap(state.snapshotB);
  const addresses = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);
  els.compareBody.textContent = "";
  let changes = 0;
  for (const register of addresses) {
    const av = a.get(register);
    const bv = b.get(register);
    if (av === bv) continue;
    changes += 1;
    const delta = av === undefined || bv === undefined ? "missing" : bv - av;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${register}</td><td>${av ?? ""}</td><td>${bv ?? ""}</td><td>${delta}</td>`;
    els.compareBody.appendChild(tr);
  }
  els.summary.textContent = `${changes} different registers between ${state.snapshotA.machine || "A"} and ${state.snapshotB.machine || "B"}`;
}

function applyPreset() {
  const preset = PRESETS[els.preset.value];
  if (!preset) return;
  els.startRegister.value = preset.start;
  els.endRegister.value = preset.end;
  els.blockSize.value = preset.block;
  saveSettings();
}

applyTheme(localStorage.getItem(THEME_KEY) || "light");
loadSettings();
applyPreset();

for (const field of [els.machineName, els.baudRate, els.serialFormat, els.slaveId, els.functionCode, els.startRegister, els.endRegister, els.blockSize, els.delayMs]) {
  field.addEventListener("input", saveSettings);
  field.addEventListener("change", saveSettings);
}

els.connectBtn.addEventListener("click", connect);
els.themeToggle.addEventListener("click", toggleTheme);
els.scanBtn.addEventListener("click", scanRange);
els.stopBtn.addEventListener("click", () => {
  state.scanning = false;
});
els.clearBtn.addEventListener("click", () => {
  state.results.clear();
  els.compareBody.textContent = "";
  els.progressState.textContent = "Idle";
  renderResults();
});
els.downloadJsonBtn.addEventListener("click", downloadJson);
els.downloadCsvBtn.addEventListener("click", downloadCsv);
els.filterInput.addEventListener("input", renderResults);
els.preset.addEventListener("change", () => {
  applyPreset();
  saveSettings();
});
els.snapshotA.addEventListener("change", async () => {
  state.snapshotA = await loadSnapshot(els.snapshotA);
  els.compareBtn.disabled = !(state.snapshotA && state.snapshotB);
});
els.snapshotB.addEventListener("change", async () => {
  state.snapshotB = await loadSnapshot(els.snapshotB);
  els.compareBtn.disabled = !(state.snapshotA && state.snapshotB);
});
els.compareBtn.addEventListener("click", renderCompare);
renderResults();
