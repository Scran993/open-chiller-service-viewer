const state = {
  profile: null,
  registers: [],
  visibleIds: new Set(),
  currentProfileKey: null,
  port: null,
  reader: null,
  writer: null,
  polling: false,
  logging: false,
  logRows: [],
  errors: 0,
  values: new Map(),
};

const APP_VERSION = "20260617-w3000-serial";
const LOCAL_PROFILE_PREFIX = "local:";
const LOCAL_PROFILES_KEY = "modbusServiceViewer.customProfiles.v1";
const VISIBLE_POINTS_KEY = "modbusServiceViewer.visiblePoints.v1";
const CONNECTION_SETTINGS_KEY = "modbusServiceViewer.connectionSettings.v1";
const THEME_KEY = "modbusServiceViewer.theme.v1";

const DEFAULT_PROFILES = [
  { name: "KTK ASHP/B2/01 field view", path: "profiles/ktk-ashp-b2-01-quick.json", source: "built-in" },
  { name: "KTK ASHP/B2/01 expanded field view", path: "profiles/ktk-ashp-b2-01-expanded.json", source: "built-in" },
  { name: "KTK T3C turbo chiller field view", path: "profiles/ktk-t3c.json", source: "built-in" },
  { name: "MEHITS W3000 / MEHP-iB field view", path: "profiles/mehits-w3000-mehp-ib.json", source: "built-in" },
  { name: "MEHITS W3000 NX/LN non-Turbocor field view", path: "profiles/mehits-w3000-nx-ln.json", source: "built-in" },
  { name: "Daikin EWAT Modbus", path: "profiles/daikin-ewat.json", source: "built-in" },
  { name: "Geoclima GEOUCH50", path: "profiles/geoclima-geouch50.json", source: "built-in" },
];

const els = {
  profileSelect: document.querySelector("#profileSelect"),
  profileSummary: document.querySelector("#profileSummary"),
  baudRate: document.querySelector("#baudRate"),
  serialFormat: document.querySelector("#serialFormat"),
  slaveId: document.querySelector("#slaveId"),
  pollMs: document.querySelector("#pollMs"),
  addressOffset: document.querySelector("#addressOffset"),
  connectBtn: document.querySelector("#connectBtn"),
  pollBtn: document.querySelector("#pollBtn"),
  readOnceBtn: document.querySelector("#readOnceBtn"),
  portState: document.querySelector("#portState"),
  lastPoll: document.querySelector("#lastPoll"),
  errorCount: document.querySelector("#errorCount"),
  valueCount: document.querySelector("#valueCount"),
  lastError: document.querySelector("#lastError"),
  keyValues: document.querySelector("#keyValues"),
  groups: document.querySelector("#groups"),
  groupTemplate: document.querySelector("#groupTemplate"),
  valueTemplate: document.querySelector("#valueTemplate"),
  filterInput: document.querySelector("#filterInput"),
  logBtn: document.querySelector("#logBtn"),
  snapshotBtn: document.querySelector("#snapshotBtn"),
  downloadLogBtn: document.querySelector("#downloadLogBtn"),
  logState: document.querySelector("#logState"),
  pointFilterInput: document.querySelector("#pointFilterInput"),
  pointChecklist: document.querySelector("#pointChecklist"),
  shownPointSummary: document.querySelector("#shownPointSummary"),
  showAllBtn: document.querySelector("#showAllBtn"),
  showNoneBtn: document.querySelector("#showNoneBtn"),
  showServiceBtn: document.querySelector("#showServiceBtn"),
  themeToggle: document.querySelector("#themeToggle"),
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (els.themeToggle) els.themeToggle.textContent = theme === "dark" ? "Light" : "Dark";
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

applyTheme(localStorage.getItem(THEME_KEY) || "light");

function getSavedConnectionSettings() {
  try {
    return JSON.parse(localStorage.getItem(CONNECTION_SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveConnectionSettings() {
  localStorage.setItem(
    CONNECTION_SETTINGS_KEY,
    JSON.stringify({
      profileKey: state.currentProfileKey || "",
      baudRate: Number(els.baudRate.value) || 19200,
      serialFormat: els.serialFormat.value || "8N1",
      slaveId: Number(els.slaveId.value) || 1,
      pollMs: Number(els.pollMs.value) || 1000,
      offset: Number(els.addressOffset.value || 0),
    }),
  );
}

function applyConnectionSettings(profileConnection = {}) {
  const saved = getSavedConnectionSettings();
  const useSaved = saved.profileKey && saved.profileKey === state.currentProfileKey;
  els.baudRate.value = useSaved ? saved.baudRate ?? 19200 : profileConnection.baudRate ?? 19200;
  const serialFormat = useSaved ? saved.serialFormat ?? "8N1" : profileConnection.serial ?? "8N1";
  els.serialFormat.value = [...els.serialFormat.options].some((option) => option.value === serialFormat) ? serialFormat : "8N1";
  els.slaveId.value = useSaved ? saved.slaveId ?? 1 : profileConnection.slaveId ?? 1;
  els.pollMs.value = useSaved ? saved.pollMs ?? 1000 : profileConnection.pollMs ?? Number(els.pollMs.value || 1000);
  els.addressOffset.value = String(useSaved ? saved.offset ?? 0 : profileConnection.offset ?? 0);
}

function parseSerialFormat(format = "8N1") {
  const clean = String(format || "8N1").trim().toUpperCase();
  const match = clean.match(/^8([NEO])([12])$/);
  const parity = { N: "none", E: "even", O: "odd" };
  if (!match) return { dataBits: 8, parity: "none", stopBits: 1 };
  return { dataBits: 8, parity: parity[match[1]], stopBits: Number(match[2]) };
}

function crc16Modbus(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return crc;
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

function parseResponse(bytes, slaveId, fn) {
  if (bytes.length < 5) throw new Error("Short response");
  const body = bytes.slice(0, -2);
  const received = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);
  const expected = crc16Modbus(body);
  if (received !== expected) throw new Error("CRC mismatch");
  if (bytes[0] !== slaveId) throw new Error("Wrong slave response");
  if (bytes[1] & 0x80) throw new Error(`Modbus exception ${bytes[2]}`);
  if (bytes[1] !== fn) throw new Error("Wrong function response");
  const byteCount = bytes[2];
  if (fn === 1 || fn === 2) {
    const bits = [];
    for (let i = 0; i < byteCount; i += 1) {
      const byte = bytes[3 + i];
      for (let bit = 0; bit < 8; bit += 1) bits.push((byte >> bit) & 1);
    }
    return bits;
  }
  const values = [];
  for (let i = 0; i < byteCount; i += 2) {
    values.push((bytes[3 + i] << 8) | bytes[4 + i]);
  }
  return values;
}

function signed16(value) {
  return value > 32767 ? value - 65536 : value;
}

function applyScale(raw, reg) {
  const signed = reg.signed === false ? raw : signed16(raw);
  if (Array.isArray(reg.invalidRaw)) {
    const invalids = reg.invalidRaw.map(Number);
    if (invalids.includes(Number(raw)) || invalids.includes(Number(signed))) return "Fault/NA";
  }
  if (Number(reg.function) === 1 || Number(reg.function) === 2) return raw;
  if (reg.bit !== null && reg.bit !== undefined && reg.bit !== "") {
    const bit = Number(reg.bit);
    return (raw >> bit) & 1;
  }
  const value = signed * Number(reg.scale || 1);
  return Number.isInteger(value) ? value : Number(value.toFixed(3));
}

function showError(message) {
  state.errors += 1;
  els.errorCount.textContent = state.errors;
  els.lastError.textContent = message;
}

function responseTimeoutMs() {
  const pollMs = Number(els.pollMs.value) || 1000;
  return Math.min(Math.max(pollMs + 1000, 3000), 8000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function readModbusFrame(slaveId, fn, normalLength, timeoutMs = 1200) {
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
  if (buffer.length) {
    throw new Error(`No valid CRC frame (${buffer.length} bytes heard)`);
  }
  throw new Error("Read timeout");
}

function formatReadError(block, error) {
  const at = `F${String(block.fn).padStart(2, "0")} reg ${block.start}`;
  if (/Read timeout/i.test(error.message)) {
    const selectedSlave = Number(els.slaveId.value);
    return `${at} no reply on slave ${selectedSlave}. Check the top-bar slave ID, A/B polarity, baud, and that no other Modbus tool is using the adapter.`;
  }
  return `${at} ${error.message}`;
}

function groupReadBlocks(registers) {
  const offset = Number(els.addressOffset.value || 0);
  const sorted = [...registers]
    .map((reg) => ({ ...reg, requestRegister: Number(reg.register) + offset }))
    .sort((a, b) => a.function - b.function || a.requestRegister - b.requestRegister);
  const blocks = [];
  for (const reg of sorted) {
    const last = blocks[blocks.length - 1];
    if (
      last &&
      last.fn === Number(reg.function) &&
      reg.requestRegister <= last.start + last.quantity &&
      reg.requestRegister - last.start < 80
    ) {
      last.quantity = Math.max(last.quantity, reg.requestRegister - last.start + 1);
      last.items.push(reg);
    } else {
      blocks.push({
        fn: Number(reg.function),
        start: Number(reg.requestRegister),
        quantity: 1,
        items: [reg],
      });
    }
  }
  return blocks;
}

function getShownRegisters() {
  return state.registers.filter((reg) => state.visibleIds.has(reg.id));
}

async function readBlock(block) {
  const slaveId = Number(els.slaveId.value);
  const request = buildRequest(slaveId, block.fn, block.start, block.quantity);
  await state.writer.write(request);
  const responseLength = block.fn === 1 || block.fn === 2 ? 5 + Math.ceil(block.quantity / 8) : 5 + block.quantity * 2;
  const response = await readModbusFrame(slaveId, block.fn, responseLength, responseTimeoutMs());
  const values = parseResponse(response, slaveId, block.fn);
  for (const reg of block.items) {
    const raw = values[reg.requestRegister - block.start];
    state.values.set(reg.id, { raw, value: applyScale(raw, reg), at: new Date() });
  }
}

async function readBlockWithRetry(block) {
  try {
    await readBlock(block);
    return true;
  } catch (firstError) {
    if (!/Read timeout|No valid CRC frame/i.test(firstError.message)) throw firstError;
    await sleep(150);
    await readBlock(block);
    return true;
  }
}

async function readAll() {
  if (!state.port) return;
  const registers = getShownRegisters();
  const blocks = groupReadBlocks(registers);
  let ok = 0;
  for (const block of blocks) {
    try {
      await readBlockWithRetry(block);
      ok += 1;
    } catch (error) {
      showError(formatReadError(block, error));
      console.error(error);
    }
    await sleep(100);
  }
  els.lastPoll.textContent = `${new Date().toLocaleTimeString()} (${ok}/${blocks.length} blocks)`;
  renderValues();
  maybeLog();
}

async function pollLoop() {
  while (state.polling) {
    await readAll();
    await new Promise((resolve) => setTimeout(resolve, Number(els.pollMs.value)));
  }
}

async function connect() {
  try {
    if (!("serial" in navigator)) {
      throw new Error("Web Serial is not available in this browser. Use Chrome, Edge, or Brave with Web Serial enabled.");
    }
    if (state.port) {
      await disconnect();
      return;
    }
    els.portState.textContent = "Finding adapter...";
    const knownPorts = await navigator.serial.getPorts();
    state.port = knownPorts[0];
    if (!state.port) {
      els.portState.textContent = "Choose adapter...";
      state.port = await navigator.serial.requestPort();
    }
    els.portState.textContent = "Opening port...";
    const serial = parseSerialFormat(els.serialFormat.value);
    await state.port.open({
      baudRate: Number(els.baudRate.value),
      dataBits: serial.dataBits,
      stopBits: serial.stopBits,
      parity: serial.parity,
      bufferSize: 255,
    });
    state.reader = state.port.readable.getReader();
    state.writer = state.port.writable.getWriter();
    els.portState.textContent = "Connected";
    els.lastError.textContent = "None";
    els.connectBtn.textContent = "Disconnect";
    els.pollBtn.disabled = false;
    els.readOnceBtn.disabled = false;
    await readAll();
  } catch (error) {
    if (state.port) await disconnect().catch(() => {});
    els.portState.textContent = "Disconnected";
    showError(error.message);
    console.error(error);
  }
}

async function disconnect() {
  state.polling = false;
  els.pollBtn.textContent = "Start";
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
  els.connectBtn.textContent = "Connect & read";
  els.pollBtn.disabled = true;
  els.readOnceBtn.disabled = true;
}

function normalizeRegister(row, index) {
  const mapped = mapCsvRegisterRow(row);
  return {
    id: mapped.id || `${mapped.group || "Custom"}-${mapped.name || "Register"}-${mapped.register}-${index}`,
    group: mapped.group || "Custom",
    name: mapped.name || `Register ${mapped.register}`,
    register: Number(mapped.register),
    bit: mapped.bit === undefined || mapped.bit === "" || mapped.bit === null ? null : Number(mapped.bit),
    function: String(mapped.function || "03").padStart(2, "0"),
    scale: Number(mapped.scale || 1),
    unit: mapped.unit || "",
    notes: mapped.notes || "",
    invalidRaw: Array.isArray(mapped.invalidRaw)
      ? mapped.invalidRaw
      : String(mapped.invalidRaw || "")
          .split("|")
          .filter(Boolean)
          .map(Number),
    signed: mapped.signed !== "false",
  };
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return "";
}

function unitFromRange(range) {
  const text = String(range || "").trim();
  if (/^0\s+/.test(text) || text.includes("|")) return "";
  if (/^[a-zA-Z%]+$/.test(text)) return text;
  if (text.length <= 8 && !/[0-9]/.test(text)) return text;
  return "";
}

function mapCsvRegisterRow(row) {
  const description = firstValue(row, ["name", "description", "point", "object_name", "label"]);
  const address = firstValue(row, ["register", "address", "modbus_address", "addr", "offset"]);
  const firstRegister = String(address).match(/\d+/)?.[0] || address;
  const range = firstValue(row, ["range", "notes", "enum", "values"]);
  const readWrite = firstValue(row, ["read_write", "rw", "access"]);
  const type = String(firstValue(row, ["type", "data_type", "datatype"])).toUpperCase();
  const parts = String(description || "").split(/\s+-\s+/);
  const group = firstValue(row, ["group", "section", "category"]) || (parts.length > 1 ? parts[0] : "Imported");
  const name = firstValue(row, ["name"]) || (parts.length > 1 ? parts.slice(1).join(" - ") : description);
  const notes =
    firstValue(row, ["notes"]) ||
    [range, String(address).includes("-") ? `Address range ${address}` : "", readWrite ? `Access ${readWrite}` : "", row.source_page ? `Page ${row.source_page}` : ""]
      .filter(Boolean)
      .join(" - ");
  return {
    ...row,
    group,
    name,
    register: firstRegister,
    function: firstValue(row, ["function", "fc", "function_code"]) || "03",
    scale: firstValue(row, ["scale", "gain", "multiplier"]) || "1",
    unit: firstValue(row, ["unit", "units"]) || unitFromRange(range),
    notes,
    signed: row.signed !== undefined && row.signed !== "" ? row.signed : String(!type.includes("UNSIGNED")),
  };
}

function resetLiveState(registerCount = state.registers.length) {
  state.values.clear();
  state.errors = 0;
  els.errorCount.textContent = "0";
  els.valueCount.textContent = `0/${registerCount}`;
  els.lastError.textContent = "None";
  els.lastPoll.textContent = "Never";
}

function applyProfile(profile, key = null) {
  state.profile = {
    name: profile.name || "Custom machine",
    connection: profile.connection || {},
    registers: profile.registers || [],
  };
  state.currentProfileKey = key;
  state.registers = state.profile.registers.filter((row) => row.register !== undefined && row.register !== "").map(normalizeRegister);
  applyVisibleSelection(profile.visibleIds);
  resetLiveState(getShownRegisters().length);
  applyConnectionSettings(state.profile.connection);
  els.profileSummary.textContent = `${state.profile.name} - ${getShownRegisters().length}/${state.registers.length} shown`;
  renderPointPicker();
  renderValues();
}

function makeCurrentProfile() {
  const name = state.profile?.name || "Custom machine";
  return {
    name,
    connection: {
      protocol: "Modbus RTU",
      baudRate: Number(els.baudRate.value),
      serial: els.serialFormat.value || "8N1",
      slaveId: Number(els.slaveId.value),
      offset: Number(els.addressOffset.value || 0),
    },
    visibleIds: [...state.visibleIds],
    registers: state.registers.map(({ id, requestRegister, ...reg }) => reg),
  };
}

function selectionStorageKey() {
  return state.currentProfileKey || state.profile?.name || "custom";
}

function getVisibleSelections() {
  try {
    return JSON.parse(localStorage.getItem(VISIBLE_POINTS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveVisibleSelection() {
  const selections = getVisibleSelections();
  selections[selectionStorageKey()] = [...state.visibleIds];
  localStorage.setItem(VISIBLE_POINTS_KEY, JSON.stringify(selections));
}

function applyVisibleSelection(profileVisibleIds) {
  const available = new Set(state.registers.map((reg) => reg.id));
  const saved = getVisibleSelections()[selectionStorageKey()];
  const preferred = Array.isArray(profileVisibleIds) ? profileVisibleIds : saved;
  let selected = Array.isArray(preferred) ? preferred.filter((id) => available.has(id)) : [...available];
  if (!Array.isArray(preferred) && state.registers.length > 80) {
    const servicePattern = /pressure|temp|water|suction|discharge|superheat|subcool|evaporat|condens|probe/i;
    const serviceIds = state.registers
      .filter((reg) => servicePattern.test([reg.group, reg.name, reg.unit, reg.notes].join(" ")))
      .map((reg) => reg.id);
    if (serviceIds.length) selected = serviceIds;
  }
  state.visibleIds = new Set(selected);
}

function setVisibleIds(ids) {
  state.visibleIds = new Set(ids);
  saveVisibleSelection();
  els.profileSummary.textContent = `${state.profile?.name || "Profile"} - ${getShownRegisters().length}/${state.registers.length} shown`;
  renderPointPicker();
  renderValues();
}

function selectServicePoints() {
  const include = /pressure|temp|water|suction|discharge|superheat|subcool|probe|demand|rpm|speed|power|alarm|enable|state|setpoint/i;
  const avoid = /fan|condenser|reference|maximum|minimum|heater|pump|lls/i;
  const ids = state.registers
    .filter((reg) => {
      const text = [reg.group, reg.name, reg.unit, reg.notes].join(" ");
      const isCoreCompressor = /compressor/i.test(reg.group) && include.test(text);
      const isCoreOverview = /overview/i.test(reg.group) && /alarm|enable|state|demand|power|sensor|setpoint/i.test(text);
      return (isCoreCompressor || isCoreOverview || include.test(text)) && !avoid.test(text);
    })
    .map((reg) => reg.id);
  setVisibleIds(ids);
}

function getLocalProfiles() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PROFILES_KEY) || "{}");
  } catch {
    return {};
  }
}

function setLocalProfiles(profiles) {
  localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(profiles));
}

function refreshLocalProfileOptions(selectedKey = state.currentProfileKey) {
  els.profileSelect.querySelectorAll("option[data-local='true']").forEach((option) => option.remove());
  const localProfiles = getLocalProfiles();
  for (const [key, profile] of Object.entries(localProfiles).sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    const option = document.createElement("option");
    option.value = `${LOCAL_PROFILE_PREFIX}${key}`;
    option.dataset.local = "true";
    option.textContent = `Saved: ${profile.name}`;
    els.profileSelect.appendChild(option);
  }
  if (selectedKey && [...els.profileSelect.options].some((option) => option.value === selectedKey)) {
    els.profileSelect.value = selectedKey;
  }
}

async function loadProfileManifest() {
  let profiles = DEFAULT_PROFILES;
  try {
    const response = await fetch(`profile-manifest.json?v=${APP_VERSION}`, { cache: "no-store" });
    if (response.ok) profiles = JSON.parse((await response.text()).replace(/^\uFEFF/, ""));
  } catch {
    profiles = DEFAULT_PROFILES;
  }

  els.profileSelect.textContent = "";
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.path;
    option.textContent = profile.source === "user" ? `User: ${profile.name}` : profile.name;
    els.profileSelect.appendChild(option);
  }
  if ([...els.profileSelect.options].some((option) => option.value === "profiles/ktk-ashp-b2-01-quick.json")) {
    els.profileSelect.value = "profiles/ktk-ashp-b2-01-quick.json";
  }
  refreshLocalProfileOptions();
}

function saveCurrentProfile() {
  const profile = makeCurrentProfile();
  const key =
    state.currentProfileKey?.startsWith(LOCAL_PROFILE_PREFIX)
      ? state.currentProfileKey.slice(LOCAL_PROFILE_PREFIX.length)
      : `${Date.now()}-${profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile"}`;
  const profiles = getLocalProfiles();
  profiles[key] = profile;
  setLocalProfiles(profiles);
  state.currentProfileKey = `${LOCAL_PROFILE_PREFIX}${key}`;
  refreshLocalProfileOptions(state.currentProfileKey);
  els.profileSummary.textContent = `${profile.name} - ${state.registers.length} registers (saved)`;
}

function deleteCurrentLocalProfile() {
  if (!state.currentProfileKey?.startsWith(LOCAL_PROFILE_PREFIX)) {
    els.profileSummary.textContent = "Only saved profiles can be deleted here";
    return;
  }
  const key = state.currentProfileKey.slice(LOCAL_PROFILE_PREFIX.length);
  const profiles = getLocalProfiles();
  delete profiles[key];
  setLocalProfiles(profiles);
  state.currentProfileKey = null;
  refreshLocalProfileOptions();
  els.profileSummary.textContent = "Saved profile deleted";
}

function createBlankProfile() {
  applyProfile({
    name: "New machine profile",
    connection: {
      protocol: "Modbus RTU",
      baudRate: Number(els.baudRate.value) || 19200,
      serial: els.serialFormat.value || "8N1",
      slaveId: Number(els.slaveId.value) || 1,
    },
    registers: [],
  });
  els.profileSelect.value = "";
}

function loadCsvRows(rows, name = "Imported CSV profile") {
  const cleanRows = rows.map(mapCsvRegisterRow).filter((row) => row.register !== undefined && row.register !== "");
  applyProfile({
    name,
    connection: {
      protocol: "Modbus RTU",
      baudRate: Number(els.baudRate.value) || 19200,
      serial: els.serialFormat.value || "8N1",
      slaveId: Number(els.slaveId.value) || 1,
    },
    registers: cleanRows,
  });
  els.profileSummary.textContent = `${state.profile.name} - ${cleanRows.length} imported registers. Press Save to keep it on this laptop, or Export JSON to share it.`;
}

function downloadCsvTemplate() {
  const lines = [
    "group,name,register,function,scale,unit,notes,bit,invalidRaw,signed",
    "Overview,Control probe,16480,03,0.1,C,Main control temperature,,,true",
    "Pressures,Suction pressure,8855,03,0.1,barA,Divide raw by 10,,,true",
    "Alarms,General alarm,20481,03,1,,Packed bit from alarm word,8,,true",
    "Temperatures,Outlet water temp,21763,03,0.1,C,32767 means unavailable,,32767|32768|65535,true",
  ];
  download("modbus-profile-template.csv", lines.join("\n"), "text/csv");
}

async function loadSelectedProfile(value) {
  if (value.startsWith(LOCAL_PROFILE_PREFIX)) {
    const key = value.slice(LOCAL_PROFILE_PREFIX.length);
    const profile = getLocalProfiles()[key];
    if (!profile) throw new Error("Saved profile not found");
    applyProfile(profile, value);
    return;
  }
  await loadProfile(value);
}

async function loadProfile(url) {
  state.polling = false;
  els.pollBtn.textContent = "Start";
  const profileUrl = new URL(url, window.location.href);
  profileUrl.searchParams.set("v", APP_VERSION);
  let response;
  try {
    response = await fetch(profileUrl.href, { cache: "no-store" });
  } catch (error) {
    const hint =
      window.location.protocol === "file:"
        ? "Open the app from http://localhost:8765/ rather than the HTML file."
        : "Refresh the localhost page and try again.";
    throw new Error(`Failed to fetch ${profileUrl.pathname}. ${hint}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${profileUrl.pathname}`);
  const profile = await response.json();
  applyProfile(profile, url);
}

function renderValues() {
  els.keyValues.textContent = "";
  els.groups.textContent = "";
  const filter = els.filterInput.value.trim().toLowerCase();
  const regs = getShownRegisters().filter((reg) =>
    [reg.group, reg.name, reg.unit, reg.notes].join(" ").toLowerCase().includes(filter),
  );
  const keyRegs = chooseKeyRegisters(regs);
  const keyIds = new Set(keyRegs.map((reg) => reg.id));
  for (const reg of keyRegs) {
    els.keyValues.appendChild(createValueCard(reg, true));
  }
  if (!keyRegs.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Tick pressures, temperatures, power, or status points to build the dashboard.";
    els.keyValues.appendChild(empty);
  }
  const grouped = new Map();
  for (const reg of regs.filter((item) => !keyIds.has(item.id))) {
    if (!grouped.has(reg.group)) grouped.set(reg.group, []);
    grouped.get(reg.group).push(reg);
  }
  for (const [groupName, groupRegs] of grouped.entries()) {
    const groupEl = els.groupTemplate.content.cloneNode(true);
    groupEl.querySelector("h2").textContent = groupName;
    const grid = groupEl.querySelector(".value-grid");
    for (const reg of groupRegs) {
      grid.appendChild(createValueCard(reg));
    }
    els.groups.appendChild(groupEl);
  }
  els.valueCount.textContent = `${getShownRegisters().filter((reg) => state.values.has(reg.id)).length}/${getShownRegisters().length}`;
}

function keyScore(reg) {
  const text = [reg.group, reg.name, reg.unit, reg.notes].join(" ").toLowerCase();
  let score = 0;
  if (/alarm|fault|status|state|enable|on\/off/.test(text)) score += 7;
  if (/pressure|suction|discharge|bar|pe\b/.test(text)) score += 10;
  if (/temp|temperature|probe|water|s2|s4/.test(text)) score += 9;
  if (/power|capacity|demand|opening|percent|%/.test(text)) score += 6;
  if (/setpoint|reference|nominal/.test(text)) score += 3;
  if (/hour|index|reset|serial|address|page/.test(text)) score -= 6;
  return score;
}

function chooseKeyRegisters(regs) {
  return [...regs]
    .map((reg, index) => ({ reg, index, score: keyScore(reg) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8)
    .map((item) => item.reg);
}

function createValueCard(reg, key = false) {
  const fragment = els.valueTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".value-card");
  const live = state.values.get(reg.id);
  if (key) card.classList.add("key-card");
  card.querySelector("h3").textContent = reg.name;
  const bitText = reg.bit !== null && reg.bit !== undefined ? `.${String(reg.bit).padStart(2, "0")}` : "";
  card.querySelector(".meta").textContent = `${reg.group} - Reg ${reg.register}${bitText} F${reg.function} x${reg.scale}${reg.notes ? ` - ${reg.notes}` : ""}`;
  card.querySelector(".value").textContent = live ? `${live.value}${reg.unit ? ` ${reg.unit}` : ""}` : "--";
  return fragment;
}

function renderPointPicker() {
  els.pointChecklist.textContent = "";
  const filter = els.pointFilterInput.value.trim().toLowerCase();
  const regs = state.registers.filter((reg) =>
    [reg.group, reg.name, reg.unit, reg.notes, reg.register].join(" ").toLowerCase().includes(filter),
  );
  els.shownPointSummary.textContent = `${getShownRegisters().length}/${state.registers.length} shown`;
  for (const reg of regs) {
    const label = document.createElement("label");
    label.className = "point-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.visibleIds.has(reg.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.visibleIds.add(reg.id);
      else state.visibleIds.delete(reg.id);
      saveVisibleSelection();
      els.profileSummary.textContent = `${state.profile?.name || "Profile"} - ${getShownRegisters().length}/${state.registers.length} shown`;
      renderValues();
      renderPointPicker();
    });
    const text = document.createElement("span");
    text.textContent = reg.name;
    const meta = document.createElement("small");
    meta.textContent = `${reg.group} - Reg ${reg.register} F${reg.function}${reg.unit ? ` - ${reg.unit}` : ""}`;
    text.appendChild(meta);
    label.append(checkbox, text);
    els.pointChecklist.appendChild(label);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted && ch === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && ch === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (cell || row.length) {
        row.push(cell);
        rows.push(row);
      }
      row = [];
      cell = "";
      if (ch === "\r" && next === "\n") i += 1;
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some(Boolean))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
}

function download(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportProfile() {
  const profile = makeCurrentProfile();
  const safeName = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "modbus-profile";
  download(`${safeName}.json`, JSON.stringify(profile, null, 2), "application/json");
}

function maybeLog() {
  if (!state.logging) return;
  const at = new Date().toISOString();
  for (const reg of getShownRegisters()) {
    const live = state.values.get(reg.id);
    if (!live) continue;
    state.logRows.push({
      at,
      group: reg.group,
      name: reg.name,
      register: reg.register,
      bit: reg.bit ?? "",
      value: live.value,
      unit: reg.unit,
      raw: live.raw,
    });
  }
  els.logState.textContent = `${state.logRows.length} rows captured`;
  els.downloadLogBtn.disabled = state.logRows.length === 0;
}

function downloadLog() {
  const headers = ["at", "group", "name", "register", "bit", "value", "unit", "raw"];
  const lines = [headers.join(",")].concat(
    state.logRows.map((row) =>
      headers
        .map((h) => `"${String(row[h] ?? "").replaceAll('"', '""')}"`)
        .join(","),
    ),
  );
  download(`service-log-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`, lines.join("\n"), "text/csv");
}

function downloadSnapshot() {
  const at = new Date().toISOString();
  const headers = ["at", "profile", "group", "name", "register", "bit", "value", "unit", "raw", "notes"];
  const rows = getShownRegisters().map((reg) => {
    const live = state.values.get(reg.id);
    return {
      at,
      profile: state.profile?.name || "",
      group: reg.group,
      name: reg.name,
      register: reg.register,
      bit: reg.bit ?? "",
      value: live?.value ?? "",
      unit: reg.unit,
      raw: live?.raw ?? "",
      notes: reg.notes,
    };
  });
  const lines = [headers.join(",")].concat(
    rows.map((row) => headers.map((header) => `"${String(row[header] ?? "").replaceAll('"', '""')}"`).join(",")),
  );
  download(`service-snapshot-${at.slice(0, 19).replaceAll(":", "-")}.csv`, lines.join("\n"), "text/csv");
}

els.connectBtn.addEventListener("click", connect);
els.pollBtn.addEventListener("click", () => {
  state.polling = !state.polling;
  els.pollBtn.textContent = state.polling ? "Stop" : "Start";
  if (state.polling) pollLoop();
});
els.readOnceBtn.addEventListener("click", readAll);
els.profileSelect.addEventListener("change", () =>
  loadSelectedProfile(els.profileSelect.value).catch((error) => {
    console.error(error);
    state.registers = [];
    state.values.clear();
    renderValues();
    els.profileSummary.textContent = `Could not load profile: ${error.message}`;
  }),
);
els.filterInput.addEventListener("input", renderValues);
els.pointFilterInput.addEventListener("input", renderPointPicker);
for (const field of [els.baudRate, els.serialFormat, els.slaveId, els.pollMs, els.addressOffset]) {
  field.addEventListener("change", saveConnectionSettings);
  field.addEventListener("input", saveConnectionSettings);
}
els.showAllBtn.addEventListener("click", () => setVisibleIds(state.registers.map((reg) => reg.id)));
els.showNoneBtn.addEventListener("click", () => setVisibleIds([]));
els.showServiceBtn.addEventListener("click", selectServicePoints);
els.themeToggle.addEventListener("click", toggleTheme);
els.snapshotBtn.addEventListener("click", downloadSnapshot);
els.downloadLogBtn.addEventListener("click", downloadLog);
els.logBtn.addEventListener("click", () => {
  state.logging = !state.logging;
  els.logBtn.textContent = state.logging ? "Stop log" : "Start log";
  els.logState.textContent = state.logging ? "Logging every successful poll" : "Not logging";
});
loadProfileManifest()
  .then(() => loadSelectedProfile(els.profileSelect.value))
  .catch((error) => {
    console.error(error);
    els.profileSummary.textContent = `Could not load profile: ${error.message}`;
  });
