"use strict";
const byId = id => document.getElementById(id);
const root = document.documentElement;
const cockpit = document.querySelector(".cockpit");
const values = [...document.querySelectorAll("[data-value]")];
const styleButtons = [...document.querySelectorAll(".switcher button")];
const fuelDots = Array.from({ length: 7 }, () => document.createElement("i"));
document.querySelector(".fuel-dots").append(...fuelDots);

const pairButton = byId("pair");
const disconnectButton = byId("disconnect");
const modeBadge = byId("source");
const note = byId("note");
const settings = byId("settings");
const message = byId("connection-message");
const profileSelect = byId("profile");
const supported = typeof navigator.bluetooth?.requestDevice === "function" && window.isSecureContext;
let session = null;
let mode = "demo";
let started = performance.now();
const dynamicKeys = new Set(["speed", "rpm", "gear", "health", "fuel", "voltage"]);
const sample = { speed:86, rpm:4850, gear:4, fuel:71, battery:82, voltage:12.7,
  health:"Normal", odo:12486, range:238, tripA:126.4, tripB:348.2, mileageA:29.5, mileageB:28.7 };

function chooseStyle(style) {
  if (!styleButtons.some(button => button.dataset.style === style)) return;
  root.dataset.style = style;
  for (const button of styleButtons) button.setAttribute("aria-pressed", String(button.dataset.style === style));
  try { localStorage.setItem("rider-style", style); } catch {}
}

try { chooseStyle(localStorage.getItem("rider-style")); } catch {}
for (const button of styleButtons) button.addEventListener("click", () => chooseStyle(button.dataset.style));

function paint(data) {
  for (const field of values) {
    const key = field.dataset.value;
    const value = data[key];
    const decimals = ["voltage", "tripA", "tripB", "mileageA", "mileageB"].includes(key) ? 1 : 0;
    field.textContent = typeof value === "number"
      ? value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : value ?? "—";
    if (key === "health") field.dataset.health = value?.toLowerCase() ?? "";
  }
  cockpit.style.setProperty("--speed", Math.min((data.speed ?? 0) / 160, 1) * 75 + "%"
  );
  cockpit.style.setProperty("--speed-linear", Math.min((data.speed ?? 0) / 160, 1) * 100 + "%");
  cockpit.style.setProperty("--rpm", Math.min((data.rpm ?? 0) / 9000, 1) * 100 + "%");
  const filled = Math.round((data.fuel ?? 0) * 7 / 100);
  fuelDots.forEach((dot, index) => dot.classList.toggle("on", index < filled));
}

function setMode(next, badge, description) {
  mode = next;
  modeBadge.dataset.mode = next;
  modeBadge.textContent = badge;
  note.textContent = description;
  byId("direction").textContent = next === "demo" ? "Keep right onto NH 44" : "No navigation source";
  byId("turn").hidden = next !== "demo";
  if (next !== "demo") paint({});
}

function showDemo() {
  started = performance.now();
  setMode("demo", "Demo mode", "Simulated ride · Values and directions are for preview.");
  paint(sample);
}

function tick() {
  const now = performance.now();
  if (mode === "demo") {
    const seconds = (now - started) / 1000;
    const wave = Math.sin(seconds / 8);
    paint({ ...sample, speed:86 + 15 * wave, rpm:4850 + 760 * wave, gear:wave > .8 ? 5 : 4,
      tripA:126.4 + seconds / 42, tripB:348.2 + seconds / 42 });
    return;
  }
  const active = session;
  if (!active || mode !== "live") return;
  const data = {};
  for (const [key, entry] of Object.entries(active.data)) {
    const maxAge = active.notify && dynamicKeys.has(key) ? 4500 : 12000;
    if (now - entry.at <= maxAge) data[key] = entry.value;
  }
  paint(data);
}

function buttons() {
  pairButton.disabled = !supported || session !== null;
  disconnectButton.disabled = session === null && mode === "demo";
  profileSelect.disabled = session !== null;
}

function clearSession() {
  const old = session;
  session = null;
  if (!old) return;
  old.characteristic?.removeEventListener("characteristicvaluechanged", old.changed);
  old.device?.removeEventListener("gattserverdisconnected", old.disconnected);
  if (old.device?.gatt?.connected) old.device.gatt.disconnect();
}

function finish(text) {
  clearSession();
  setMode("idle", "BLE offline", "Live readings are unavailable. Use Bluetooth to connect or start the demo.");
  message.textContent = text;
  buttons();
}

function consume(active, view) {
  if (active !== session || !view) return;
  const at = performance.now();
  const decoded = active.profile.decode(view);
  if (!Object.keys(decoded).length) return;
  for (const [key, value] of Object.entries(decoded)) active.data[key] = { value, at };
  tick();
}

async function poll(active) {
  if (active !== session || !active.read || active.reading) return;
  active.reading = true;
  try { consume(active, await active.characteristic.readValue()); }
  catch { if (active === session && !active.device?.gatt?.connected) finish("BLE device disconnected."); }
  finally { active.reading = false; }
}

async function connect() {
  if (!supported || session) return;
  let profile;
  try {
    profile = RiderTelemetry.profile(profileSelect.value, byId("device-name").value,
      byId("service").value, byId("characteristic").value);
  } catch (error) {
    message.textContent = error.message;
    return;
  }
  const active = { profile, data:{}, notify:false, read:false, reading:false };
  session = active;
  setMode("idle", "Connecting", "Waiting for a BLE device.");
  message.textContent = "Choose your test device or verified telemetry device.";
  buttons();
  try {
    const device = await navigator.bluetooth.requestDevice(profile.options);
    if (active !== session) return;
    active.device = device;
    active.disconnected = () => { if (active === session) finish("BLE device disconnected."); };
    device.addEventListener("gattserverdisconnected", active.disconnected);
    const server = await device.gatt.connect();
    if (active !== session) {
      if (session?.device !== device && server.connected) server.disconnect();
      return;
    }
    const service = await server.getPrimaryService(profile.service);
    if (active !== session) return;
    const characteristic = await service.getCharacteristic(profile.characteristic);
    if (active !== session) return;
    active.characteristic = characteristic;
    active.read = characteristic.properties.read;
    const canNotify = characteristic.properties.notify || characteristic.properties.indicate;
    if (!active.read && !canNotify) throw new Error("This characteristic does not offer reads or notifications.");
    active.changed = event => consume(active, event.target.value);
    if (canNotify) {
      characteristic.addEventListener("characteristicvaluechanged", active.changed);
      try {
        await characteristic.startNotifications();
        active.notify = true;
      } catch (error) {
        if (!active.read) throw error;
        characteristic.removeEventListener("characteristicvaluechanged", active.changed);
      }
    }
    if (active !== session) return;
    await poll(active);
    if (active !== session) return;
    const batteryOnly = profile.service === "battery_service";
    setMode("live", batteryOnly ? "BLE · Battery test" : "BLE connected",
      batteryOnly ? "Battery test · This reading belongs to the selected BLE device."
        : "Live BLE · Dashes indicate missing or expired readings.");
    tick();
    message.textContent = batteryOnly ? "Connected to Battery Service." : "Connected to the configured telemetry characteristic.";
    closeSettings();
  } catch (error) {
    if (active !== session) return;
    const cancelled = error.name === "NotFoundError" && !active.device;
    finish(cancelled ? "No device selected. Check Bluetooth or start demo mode."
      : "Connection failed. " + (error.message || error.name));
  }
}

function openSettings() {
  settings.hidden = false;
  for (const element of [document.querySelector("main"), document.querySelector("nav")]) {
    element.setAttribute("inert", "");
  }
  byId("close").focus();
}

function closeSettings() {
  settings.hidden = true;
  for (const element of [document.querySelector("main"), document.querySelector("nav")]) {
    element.removeAttribute("inert");
  }
  byId("connect").focus();
}

byId("support").textContent = supported
  ? "Bluetooth is available in this browser. Device selection requires a tap below."
  : "BLE is unavailable here. Use the HTTPS site in Bluefy on iPhone or a supported Chrome/Edge browser on Windows.";
byId("connect").addEventListener("click", openSettings);
byId("close").addEventListener("click", closeSettings);
profileSelect.addEventListener("change", () => { byId("custom").hidden = profileSelect.value !== "json"; });
pairButton.addEventListener("click", connect);
disconnectButton.addEventListener("click", () => finish("BLE session ended."));
byId("demo").addEventListener("click", () => {
  clearSession();
  message.textContent = "";
  showDemo();
  buttons();
  closeSettings();
});
settings.addEventListener("click", event => { if (event.target === settings) closeSettings(); });
settings.addEventListener("keydown", event => {
  if (event.key === "Escape") closeSettings();
  if (event.key !== "Tab") return;
  const controls = [...settings.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled)")]
    .filter(element => element.getClientRects().length);
  if (event.shiftKey && document.activeElement === controls[0]) {
    event.preventDefault();
    controls.at(-1).focus();
  } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
    event.preventDefault();
    controls[0].focus();
  }
});
window.addEventListener("pagehide", () => {
  if (session) finish("BLE session ended when the page closed.");
});
showDemo();
buttons();
setInterval(tick, 350);
setInterval(() => { if (session && mode === "live") poll(session); }, 2500);
