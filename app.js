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
    const maxAge = active.bike ? (key === "speed" || key === "rpm" ? 6000 : 20000)
      : active.notify && dynamicKeys.has(key) ? 4500 : 12000;
    if (now - entry.at <= maxAge) data[key] = entry.value;
  }
  paint(data);
  if (active.bike) note.textContent = Object.keys(data).length
    ? "Live bike readings · Dashes indicate missing or expired data." : "Connected · Waiting for bike readings.";
  if (active.bike && !settings.hidden) message.textContent = bikeStatus(active);
}

function buttons() {
  discovery.disabled = !supported || session !== null || discovering;
  testBike.disabled = discovery.disabled;
  connectBike.disabled = discovery.disabled;
  notifyOnly.disabled = !!session || discovering;
  pairButton.disabled = !supported || session !== null || discovering;
  disconnectButton.disabled = session === null && mode === "demo";
  profileSelect.disabled = session !== null;
}

function clearSession() {
  const old = session;
  session = null;
  if (!old) return;
  for (const [channel, listener] of old.listeners ?? []) {
    channel.removeEventListener("characteristicvaluechanged", listener);
  }
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
  if (!supported || session || discovering) return;
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

const discovery = document.createElement("button");
discovery.type = "button";
discovery.textContent = "Find my bike";
discovery.disabled = !supported;
pairButton.parentNode.insertBefore(discovery, pairButton);
const discoveryHelp = document.createElement("p");
discoveryHelp.textContent = "Use Find my bike to see nearby BLE devices without a profile filter. Select your bike to check its advertised name.";
pairButton.parentNode.before(discoveryHelp);
let discovering = false;
discovery.addEventListener("click", async () => {
  if (!supported || session || discovering) return;
  discovering = true;
  buttons();
  message.textContent = "Looking for nearby BLE devices…";
  try {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
    message.textContent = "Found: " + (device.name || "Unnamed BLE device") +
      ". Discovery confirms visibility. A compatible profile is needed for telemetry.";
  } catch (error) {
    message.textContent = error.name === "NotFoundError"
      ? "No device selected. Check that the bike is on and advertising while parked."
      : "Discovery failed. " + (error.message || error.name);
  } finally {
    discovering = false;
    buttons();
  }
});



const yezdiTelemetryService = "d6328aea-d630-4a83-b51b-1da8e8da8400";
const testBike = document.createElement("button");
testBike.type = "button";
testBike.textContent = "Test MY YEZDI connection";
pairButton.parentNode.insertBefore(testBike, pairButton);

async function withBikeTimeout(operation) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out after 15 seconds.")), 15000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

testBike.addEventListener("click", async () => {
  if (!supported || session || discovering) return;
  discovering = true;
  buttons();
  let device;
  let connection;
  let phase = "Device selection";
  try {
    message.textContent = "Select MY YEZDI in the Bluetooth picker.";
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [yezdiTelemetryService]
    });
    if (device.name?.trim().toUpperCase() !== "MY YEZDI") {
      throw new Error("Select MY YEZDI for this test.");
    }
    phase = "BLE connection";
    message.textContent = "Opening the bike’s Bluetooth connection…";
    connection = device.gatt.connect();
    const gatt = await withBikeTimeout(connection);
    phase = "Telemetry service discovery";
    message.textContent = "Connected. Looking up the bike’s telemetry service…";
    const service = await withBikeTimeout(gatt.getPrimaryService(yezdiTelemetryService));
    phase = "Telemetry channel discovery";
    const channels = await withBikeTimeout(service.getCharacteristics());
    const readable = channels.filter(channel => channel.properties.read).length;
    const notifying = channels.filter(channel =>
      channel.properties.notify || channel.properties.indicate).length;
    message.textContent = "Connected to MY YEZDI. Found " + channels.length +
      " telemetry channels (" + readable + " readable, " + notifying +
      " with notifications or indications). Test complete. Ride values are still unverified.";
  } catch (error) {
    const detail = error?.message || String(error);
    message.textContent = phase + " failed: " + detail;
  } finally {
    const gatt = device?.gatt;
    if (gatt?.connected) gatt.disconnect();
    else if (connection) {
      void connection.then(late => {
        if (!discovering && !session && late.connected) late.disconnect();
      }, () => {});
    }
    discovering = false;
    buttons();
  }
});


const connectBike = document.createElement("button");
connectBike.type = "button";
connectBike.textContent = "Connect bike";
const notifyOnly = document.createElement("input");
notifyOnly.type = "checkbox";
const notifyLabel = document.createElement("label");
notifyLabel.append(notifyOnly, " Bike compatibility test · notifications only");
pairButton.parentNode.before(notifyLabel);
pairButton.parentNode.insertBefore(connectBike, discovery);

// The cluster returns eight channels in the same order used by the original console.
const distanceKm = (packet, offset) =>
  (packet.getUint8(offset) * 65536 + packet.getUint16(offset + 1)) / 10;
const bikeChannels = [
  [1, p => ({speed:p.getUint8(0)})],
  [2, p => ({rpm:p.getUint16(0)})],
  [3, p => ({fuel:p.getUint8(0) <= 7 ? Math.round(p.getUint8(0) * 100 / 7) : undefined,
    gear:["N",1,2,3,4,5,6][p.getUint8(1)]})],
  [3, p => ({odo:distanceKm(p,0) || undefined})],
  [6, p => ({tripA:distanceKm(p,0),tripB:distanceKm(p,3)})],
  [6, p => ({voltage:p.getUint8(5) ? p.getUint8(5) / 10 : undefined})],
  [3, p => ({range:p.getUint16(1) === 4095 ? undefined : p.getUint16(1)})],
  null
];

function bikeStatus(active) {
  const stats = active.stats;
  return "Packets: " + stats.reads + " read, " + stats.notifications + " notifications. " +
    "Errors: " + stats.failedReads + " reads, " + stats.failedSubscriptions +
    " subscriptions, " + stats.invalid + " invalid packets." +
    (stats.lastError ? " Last error: " + stats.lastError : "");
}

function describeBleError(error) {
  return error?.message || error?.name || String(error);
}

function receiveBikePacket(active, index, packet, source) {
  if (active !== session) return;
  if (packet instanceof ArrayBuffer || ArrayBuffer.isView(packet) && typeof packet.getUint8 !== "function") {
    packet = ArrayBuffer.isView(packet)
      ? new DataView(packet.buffer, packet.byteOffset, packet.byteLength) : new DataView(packet);
  }
  const [minimum, decode] = bikeChannels[index];
  if (typeof packet?.getUint8 !== "function" || packet.byteLength < minimum) {
    active.stats.invalid++;
    return;
  }
  active.stats[source]++;
  const at = performance.now();
  for (const [key, value] of Object.entries(decode(packet))) {
    if (value === undefined) delete active.data[key];
    else active.data[key] = {value, at};
  }
  tick();
}

async function pollBike(active) {
  if (active !== session || active.reading || active.pendingRead || active.notifyOnly) return;
  active.reading = true;
  try {
    for (const reader of active.readers) {
      if (active !== session) return;
      if (reader.next > performance.now()) continue;
      const key = ["speed", "rpm"][reader.index];
      if (reader.subscribed && key && performance.now() - (active.data[key]?.at ?? -Infinity) < 2000) continue;
      try {
        const pending = Promise.resolve(reader.channel.readValue());
        active.pendingRead = pending;
        void pending.then(() => { active.pendingRead = null; }, () => { active.pendingRead = null; });
        receiveBikePacket(active, reader.index, await withBikeTimeout(pending), "reads");
        reader.next = 0;
      } catch (error) {
        if (active !== session) return;
        active.stats.failedReads++;
        active.stats.lastError = "Channel " + (reader.index + 1) + " read: " + describeBleError(error);
        reader.next = performance.now() + 20000;
        if (active.pendingRead) return;
      }
    }
  } finally {
    active.reading = false;
  }
}

connectBike.addEventListener("click", async () => {
  if (!supported || session || discovering) return;
  const active = {data:{}, notify:true, bike:true, listeners:[], readers:[],
    notifyOnly:notifyOnly.checked, stats:{reads:0,notifications:0,failedReads:0,failedSubscriptions:0,invalid:0}};
  let phase = "Device selection";
  let connection;
  session = active;
  setMode("idle", "Connecting", "Waiting for the bike.");
  message.textContent = "Select MY YEZDI in the Bluetooth picker.";
  buttons();
  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices:true, optionalServices:[yezdiTelemetryService]
    });
    if (active !== session) return;
    if (device.name?.trim().toUpperCase() !== "MY YEZDI") {
      throw new Error("Select MY YEZDI in the picker.");
    }
    active.device = device;
    active.disconnected = () => {
      if (active === session) finish("MY YEZDI disconnected during " + phase.toLowerCase() + ". " + bikeStatus(active));
    };
    device.addEventListener("gattserverdisconnected", active.disconnected);
    phase = "BLE connection";
    message.textContent = "Opening the bike’s Bluetooth connection…";
    connection = device.gatt.connect();
    const gatt = await withBikeTimeout(connection);
    if (active !== session) {
      if (session?.device !== device && gatt.connected) gatt.disconnect();
      return;
    }
    phase = "Telemetry channel discovery";
    const service = await withBikeTimeout(gatt.getPrimaryService(yezdiTelemetryService));
    if (active !== session) return;
    const channels = await withBikeTimeout(service.getCharacteristics());
    if (active !== session) return;
    if (channels.length !== bikeChannels.length) throw new Error("Unexpected bike telemetry layout.");
    phase = "Telemetry setup";
    let subscriptions = 0;
    for (const [index, channel] of channels.entries()) {
      if (!bikeChannels[index]) continue;
      let subscribed = false;
      if (channel.properties.notify || channel.properties.indicate) {
        const listener = event => receiveBikePacket(active, index, event.target?.value ?? channel.value, "notifications");
        channel.addEventListener("characteristicvaluechanged", listener);
        active.listeners.push([channel, listener]);
        try {
          await withBikeTimeout(channel.startNotifications());
          subscribed = true;
          subscriptions++;
        } catch (error) {
          active.stats.failedSubscriptions++;
          active.stats.lastError = "Channel " + (index + 1) + " subscription: " + describeBleError(error);
          channel.removeEventListener("characteristicvaluechanged", listener);
        }
      }
      if (active !== session) return;
      if (!active.notifyOnly && channel.properties.read) active.readers.push({channel,index,subscribed,next:0});
    }
    if (!active.readers.length && !subscriptions) throw new Error("No readable telemetry channels.");
    phase = "live telemetry";
    setMode("live", "MY YEZDI connected", "Waiting for bike readings. Dashes indicate missing or expired data.");
    message.textContent = "MY YEZDI connected. Use Disconnect to end the session.";
    tick();
    closeSettings();
    void pollBike(active);
  } catch (error) {
    if (active === session) finish(phase + " failed: " + describeBleError(error) + ". " + bikeStatus(active));
    if (connection) void connection.then(late => {
      if (!session && !discovering && late.connected) late.disconnect();
    }, () => {});
  }
});

showDemo();
buttons();
setInterval(tick, 350);
setInterval(() => { if (session && mode === "live") { if (session.bike) pollBike(session); else poll(session); } }, 2500);
