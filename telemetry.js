/* Data decoders shared by the cockpit and the Windows verification script. */
(function (global) {
  "use strict";
  const limits = {
    speed: [0, 400], rpm: [0, 25000], fuel: [0, 100], battery: [0, 100],
    voltage: [0, 30], odo: [0, 9999999], range: [0, 3000], tripA: [0, 999999],
    tripB: [0, 999999], mileageA: [0, 150], mileageB: [0, 150]
  };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function decodeBattery(view) {
    if (view.byteLength !== 1 || view.getUint8(0) > 100) return {};
    return { battery: view.getUint8(0) };
  }

  function decodeJson(view) {
    if (view.byteLength < 2 || view.byteLength > 512) return {};
    let data;
    try {
      data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(view));
    } catch {
      return {};
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const result = {};
    for (const [key, [min, max]] of Object.entries(limits)) {
      const value = data[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) {
        result[key] = value;
      }
    }
    if (data.gear === "N" || (Number.isInteger(data.gear) && data.gear >= 1 && data.gear <= 8)) result.gear = data.gear;
    if (data.health === "Normal" || data.health === "Warning") result.health = data.health;
    return result;
  }

  function profile(kind, name, service, characteristic) {
    if (kind === "battery") return {
      service: "battery_service", characteristic: "battery_level",
      options: { filters: [{ services: ["battery_service"] }] }, decode: decodeBattery
    };
    const exactName = name.trim();
    const serviceId = service.trim().toLowerCase();
    const characteristicId = characteristic.trim().toLowerCase();
    if (kind !== "json" || !exactName || !uuid.test(serviceId) || !uuid.test(characteristicId)) {
      throw new Error("Enter an exact advertised device name and both full 128-bit UUIDs.");
    }
    return {
      service: serviceId, characteristic: characteristicId,
      options: { filters: [{ name: exactName }], optionalServices: [serviceId] }, decode: decodeJson
    };
  }

  global.RiderTelemetry = { decodeBattery, decodeJson, profile };
})(globalThis);
