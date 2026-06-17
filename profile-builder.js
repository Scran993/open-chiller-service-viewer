const els = {
  builderSummary: document.querySelector("#builderSummary"),
  profileNameInput: document.querySelector("#profileNameInput"),
  baudRate: document.querySelector("#baudRate"),
  serialFormat: document.querySelector("#serialFormat"),
  slaveId: document.querySelector("#slaveId"),
  addressOffset: document.querySelector("#addressOffset"),
  profileFileInput: document.querySelector("#profileFileInput"),
  downloadTemplateBtn: document.querySelector("#downloadTemplateBtn"),
  pasteCsvInput: document.querySelector("#pasteCsvInput"),
  loadPastedCsvBtn: document.querySelector("#loadPastedCsvBtn"),
  saveLocalProfileBtn: document.querySelector("#saveLocalProfileBtn"),
  exportProfileBtn: document.querySelector("#exportProfileBtn"),
  importReport: document.querySelector("#importReport"),
  previewFilterInput: document.querySelector("#previewFilterInput"),
  previewCount: document.querySelector("#previewCount"),
  previewGroups: document.querySelector("#previewGroups"),
  groupTemplate: document.querySelector("#groupTemplate"),
  valueTemplate: document.querySelector("#valueTemplate"),
  themeToggle: document.querySelector("#themeToggle"),
};

let registers = [];
let lastImport = { rows: 0, columns: [], warnings: [] };

const THEME_KEY = "modbusServiceViewer.theme.v1";
const LOCAL_PROFILES_KEY = "modbusServiceViewer.customProfiles.v1";

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

function normaliseHeader(header) {
  return String(header || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9/%]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function firstValue(row, keys) {
  const wanted = keys.map(normaliseHeader);
  for (const [key, value] of Object.entries(row)) {
    if (wanted.includes(normaliseHeader(key)) && value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function parseNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const match = text.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function parseBoolean(value, fallback = false) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  if (["false", "no", "0", "unsigned"].includes(text)) return false;
  return true;
}

function unitFromRange(range) {
  const text = String(range || "").trim();
  if (/^0\s+/.test(text) || text.includes("|")) return "";
  if (/^[a-zA-Z%]+$/.test(text)) return text;
  if (text.length <= 8 && !/[0-9]/.test(text)) return text;
  return "";
}

function deriveName(description, explicitName) {
  if (explicitName) return explicitName;
  const parts = String(description || "").split(/\s+-\s+/);
  return parts.length > 1 ? parts.slice(1).join(" - ") : description;
}

function deriveGroup(description, explicitGroup) {
  if (explicitGroup) return explicitGroup;
  const parts = String(description || "").split(/\s+-\s+/);
  return parts.length > 1 ? parts[0] : "Imported";
}

function buildNotes(row, range, address, access) {
  const explicit = firstValue(row, ["notes", "note", "comment", "comments"]);
  if (explicit) return explicit;
  return [
    range,
    String(address).includes("-") ? `Address range ${address}` : "",
    access ? `Access ${access}` : "",
    firstValue(row, ["source_page", "page"]) ? `Page ${firstValue(row, ["source_page", "page"])}` : "",
  ]
    .filter(Boolean)
    .join(" - ");
}

function mapCsvRegisterRow(row, index, warnings) {
  const description = firstValue(row, ["description", "descrizione", "label", "parameter", "variable", "object", "point", "object_name", "name"]);
  const explicitName = firstValue(row, ["name", "label", "parameter"]);
  const address = firstValue(row, ["register", "address", "adu", "modbus", "modbus_register", "modbus_address", "holding_register", "addr", "offset"]);
  const firstRegister = String(address).match(/\d+/)?.[0] || "";
  const register = Number(firstRegister);
  const range = firstValue(row, ["range", "enum", "values", "options"]);
  const access = firstValue(row, ["access", "read_write", "rw", "r_w", "read_write_status"]);
  const type = String(firstValue(row, ["type", "data_type", "datatype"])).toUpperCase();
  const scale = parseNumber(firstValue(row, ["scale", "gain", "multiplier", "factor", "resolution"])) ?? 1;
  const min = parseNumber(firstValue(row, ["min", "minimum", "low_limit", "lower_limit"]));
  const max = parseNumber(firstValue(row, ["max", "maximum", "high_limit", "upper_limit"]));
  const group = deriveGroup(description, firstValue(row, ["group", "section", "menu", "category", "folder"]));
  const name = deriveName(description, explicitName);

  if (!Number.isFinite(register)) {
    warnings.push(`Row ${index + 2}: skipped because no usable register/address was found.`);
    return null;
  }

  if (!name) warnings.push(`Row ${index + 2}: no name found, using Register ${register}.`);

  const item = {
    group,
    name: name || `Register ${register}`,
    register,
    function: String(firstValue(row, ["function", "fc", "function_code"]) || "03").replace(/^0x/i, "").padStart(2, "0"),
    scale,
    unit: firstValue(row, ["unit", "units", "uom"]) || unitFromRange(range),
    notes: buildNotes(row, range, address, access),
    bit: firstValue(row, ["bit", "bit_number"]),
    invalidRaw: firstValue(row, ["invalidRaw", "invalid_raw", "fault_raw", "na_raw"]),
    signed: firstValue(row, ["signed"]) ? parseBoolean(firstValue(row, ["signed"]), true) : !type.includes("UNSIGNED"),
  };

  if (access) {
    item.access = access;
    item.writable = /(^|\b)(rw|write|read_write|r\/w)(\b|$)/i.test(access) && !/read only|readonly|^r$/i.test(access);
  }
  if (min !== undefined) item.min = min;
  if (max !== undefined) item.max = max;
  if (range) item.enum = range;

  return item;
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
  if (!rows.length) return { rows: [], columns: [] };

  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, "").trim());
  const mappedRows = rows
    .filter((cells) => cells.some((value) => String(value).trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""])));
  return { rows: mappedRows, columns: headers };
}

function makeProfile() {
  return {
    name: els.profileNameInput.value.trim() || "New machine profile",
    connection: {
      protocol: "Modbus RTU",
      baudRate: Number(els.baudRate.value) || 19200,
      serial: els.serialFormat.value || "8N1",
      slaveId: Number(els.slaveId.value) || 1,
      offset: Number(els.addressOffset.value || 0),
    },
    registers,
  };
}

function setRegisters(rows, name = "", columns = []) {
  const warnings = [];
  const seen = new Set();
  registers = rows
    .map((row, index) => mapCsvRegisterRow(row, index, warnings))
    .filter(Boolean)
    .filter((row) => {
      const key = `${row.function}:${row.register}:${row.bit || ""}`;
      if (seen.has(key)) {
        warnings.push(`Duplicate point kept: ${row.name} uses F${row.function} register ${row.register}${row.bit ? ` bit ${row.bit}` : ""}.`);
      }
      seen.add(key);
      return true;
    });

  lastImport = { rows: rows.length, columns, warnings };
  if (name && !els.profileNameInput.value.trim()) els.profileNameInput.value = name;
  els.builderSummary.textContent = `${registers.length} points loaded`;
  renderImportReport();
  renderPreview();
}

function loadProfileObject(profile, name = "") {
  registers = Array.isArray(profile.registers) ? profile.registers : [];
  els.profileNameInput.value = profile.name || name || "";
  els.baudRate.value = profile.connection?.baudRate || 19200;
  els.serialFormat.value = profile.connection?.serial || "8N1";
  els.slaveId.value = profile.connection?.slaveId || 1;
  els.addressOffset.value = String(profile.connection?.offset ?? -1);
  lastImport = { rows: registers.length, columns: ["JSON profile"], warnings: [] };
  els.builderSummary.textContent = `${registers.length} points loaded`;
  renderImportReport();
  renderPreview();
}

function renderImportReport() {
  if (!els.importReport) return;
  const accessCount = registers.filter((reg) => reg.access).length;
  const writableCount = registers.filter((reg) => reg.writable).length;
  const rows = [
    `<strong>${registers.length}</strong> usable points from <strong>${lastImport.rows}</strong> imported rows.`,
    lastImport.columns.length ? `Detected columns: ${lastImport.columns.map((col) => `<code>${col}</code>`).join(", ")}` : "",
    accessCount ? `${accessCount} points include access metadata; ${writableCount} look writable.` : "No access/RW column detected.",
  ].filter(Boolean);
  const warnings = lastImport.warnings.slice(0, 8).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  els.importReport.innerHTML = `
    <div class="report-lines">${rows.map((line) => `<p>${line}</p>`).join("")}</div>
    ${warnings ? `<ul class="warning-list">${warnings}</ul>` : `<p class="ok-line">No import warnings.</p>`}
    ${lastImport.warnings.length > 8 ? `<p class="hint">${lastImport.warnings.length - 8} more warnings hidden.</p>` : ""}
  `;
}

function renderPreview() {
  els.previewGroups.textContent = "";
  const filter = els.previewFilterInput.value.trim().toLowerCase();
  const shown = registers.filter((reg) => [reg.group, reg.name, reg.unit, reg.notes, reg.register, reg.access, reg.enum].join(" ").toLowerCase().includes(filter));
  els.previewCount.textContent = `${shown.length}/${registers.length} points`;
  const grouped = new Map();
  for (const reg of shown) {
    if (!grouped.has(reg.group)) grouped.set(reg.group, []);
    grouped.get(reg.group).push(reg);
  }
  for (const [groupName, groupRegs] of grouped.entries()) {
    const groupEl = els.groupTemplate.content.cloneNode(true);
    groupEl.querySelector("h2").textContent = groupName;
    const grid = groupEl.querySelector(".value-grid");
    for (const reg of groupRegs) {
      const card = els.valueTemplate.content.cloneNode(true);
      card.querySelector("h3").textContent = reg.name;
      card.querySelector(".meta").textContent = makePreviewMeta(reg);
      grid.appendChild(card);
    }
    els.previewGroups.appendChild(groupEl);
  }
}

function makePreviewMeta(reg) {
  return [
    `Reg ${reg.register}`,
    `F${reg.function}`,
    `x${reg.scale}`,
    reg.unit || "",
    reg.access ? `Access ${reg.access}` : "",
    reg.min !== undefined || reg.max !== undefined ? `Range ${reg.min ?? ""}..${reg.max ?? ""}` : "",
    reg.enum ? `Enum ${reg.enum}` : "",
    reg.notes || "",
  ]
    .filter(Boolean)
    .join(" - ");
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

function safeFilename(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "modbus-profile";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadCsvTemplate() {
  const lines = [
    "group,name,register,function,scale,unit,notes,bit,invalidRaw,signed,access,min,max,enum",
    "Overview,Control probe,16480,03,0.1,C,Main control temperature,,,true,Read,,,",
    "Pressures,Suction pressure,8855,03,0.1,barA,Divide raw by 10,,,true,Read,,,",
    "Config,Liquid valve control type,7210,03,1,,0=Off 1=Liq 10=Other,,,true,RW,0,10,0=Off|1=Liq|10=Other",
    "Temperatures,Outlet water temp,21763,03,0.1,C,32767 means unavailable,,32767|32768|65535,true,Read,,,",
  ];
  download("modbus-profile-template.csv", lines.join("\n"), "text/csv");
}

function saveProfileToViewer() {
  const profile = makeProfile();
  if (!profile.registers.length) {
    els.builderSummary.textContent = "Load some points before saving";
    return;
  }
  const key = safeFilename(profile.name);
  let profiles = {};
  try {
    profiles = JSON.parse(localStorage.getItem(LOCAL_PROFILES_KEY) || "{}");
  } catch {
    profiles = {};
  }
  profiles[key] = profile;
  localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(profiles));
  els.builderSummary.textContent = `Saved to viewer: ${profile.name}`;
  if (els.importReport) {
    els.importReport.innerHTML = `<p class="ok-line">Saved. Go back to the viewer, refresh the page, then select <strong>Saved: ${escapeHtml(profile.name)}</strong>.</p>`;
  }
}

els.profileFileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    if (file.name.toLowerCase().endsWith(".json")) {
      loadProfileObject(JSON.parse(text), file.name.replace(/\.[^.]+$/, ""));
    } else {
      const parsed = parseCsv(text);
      setRegisters(parsed.rows, file.name.replace(/\.[^.]+$/, ""), parsed.columns);
    }
  } catch (error) {
    els.builderSummary.textContent = `Import failed: ${error.message}`;
  } finally {
    event.target.value = "";
  }
});

els.loadPastedCsvBtn.addEventListener("click", () => {
  const text = els.pasteCsvInput.value.trim();
  if (!text) {
    els.builderSummary.textContent = "Paste CSV rows first";
    return;
  }
  const parsed = parseCsv(text);
  setRegisters(parsed.rows, "", parsed.columns);
});

els.downloadTemplateBtn.addEventListener("click", downloadCsvTemplate);
els.previewFilterInput.addEventListener("input", renderPreview);
els.themeToggle.addEventListener("click", toggleTheme);
els.saveLocalProfileBtn.addEventListener("click", saveProfileToViewer);
els.exportProfileBtn.addEventListener("click", () => {
  const profile = makeProfile();
  download(`${safeFilename(profile.name)}.json`, JSON.stringify(profile, null, 2), "application/json");
});

renderImportReport();
renderPreview();
