const assert = require("node:assert/strict");
const test = require("node:test");
require("./telemetry.js");
const { decodeBattery, decodeJson, profile } = globalThis.RiderTelemetry;
const view = bytes => new DataView(Uint8Array.from(bytes).buffer);
const json = value => view(new TextEncoder().encode(value));

test("standard battery characteristic requires one valid percentage byte", () => {
  assert.deepEqual(decodeBattery(view([0])), { battery: 0 });
  assert.deepEqual(decodeBattery(view([100])), { battery: 100 });
  for (const invalid of [[], [101], [22, 44]]) assert.deepEqual(decodeBattery(view(invalid)), {});
});

test("telemetry keeps valid fields and ignores invalid or unknown fields", () => {
  assert.deepEqual(decodeJson(json('{"speed":0,"rpm":1450,"gear":"N","fuel":101,"battery":"95","health":"Warning","route":"x"}')),
    { speed: 0, rpm: 1450, gear: "N", health: "Warning" });
  for (const invalid of ['{broken', '[]', 'null', JSON.stringify('a'.repeat(515))]) {
    assert.deepEqual(decodeJson(json(invalid)), {});
  }
  assert.deepEqual(decodeJson(view([0xc3, 0x28])), {});
});

test("chooser uses a service filter or an exact name and explicit service scope", () => {
  const service = "00000001-0000-4000-8000-000000000000";
  const characteristic = "00000002-0000-4000-8000-000000000000";
  assert.deepEqual(profile("battery").options, { filters: [{ services: ["battery_service"] }] });
  assert.deepEqual(profile("json", " Rider Bridge ", service, characteristic).options,
    { filters: [{ name: "Rider Bridge" }], optionalServices: [service] });
  assert.throws(() => profile("json", "", service, characteristic));
  assert.throws(() => profile("json", "Rider Bridge", "1234", characteristic));
});
