# Yezdi Adventure Rider Command

A buildless cockpit for the 2025 Yezdi Adventure Twin Headlamp. The bottom selector switches between **Blue TFT**, **Neon Compass**, and **Rally Daylight**. Style selection is saved per browser and origin. The dashboard opens in Demo mode. Demo values and route directions are simulated.

## Run on Windows

1. Extract this archive. Open PowerShell in the extracted folder containing `index.html`.
2. With Python 3 installed, run `py -m http.server 8080 --bind 127.0.0.1`. Open **http://localhost:8080/** in current desktop Chrome or Edge. Use Ctrl+C in PowerShell to stop the server.
3. Check that the three style buttons change the entire cockpit, and that reloading keeps your chosen style. Resize to a phone width such as 414 px and verify that the bottom bar stays accessible.
4. To check Bluetooth on Windows, turn on Bluetooth in Windows Settings and use a compatible BLE sensor advertising the standard Battery Service. With the sensor in range, open **Bluetooth**, select **Standard Battery Service**, then choose your sensor. The battery reading should come from the sensor. Speed, RPM, fuel, and other unavailable metrics should show dashes.
5. Use **Bluetooth → Disconnect** or turn the sensor off. Confirm readings clear. Select **Start demo** to return to simulation. Repeat with chooser cancellation and with Bluetooth disabled. Browser and OS behavior can vary when the adapter is off.
6. When Node.js is available, run `node --test telemetry.test.cjs` from the extracted folder to verify the decoders and chooser filters.

## Publish on GitHub Pages

1. Create a repository such as `yezdi-rider-command` on GitHub. A public repository works with GitHub Free.
2. Commit the extracted contents directly to the repository's `main` branch. `index.html`, `styles.css`, `app.js`, `telemetry.js`, and the three JPG files should appear at the repository root. Include `.nojekyll` if using Git. You can also upload the extracted files through GitHub's web interface. Preserve their directory structure.
3. Go to **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, then select **main** and **/(root)**. Select **Save**.
4. Wait for the Pages workflow in **Actions** to succeed. Open the HTTPS address under **Settings → Pages**, usually `https://YOUR-USERNAME.github.io/yezdi-rider-command/`. Use **Enforce HTTPS** if the setting is available. Local assets use relative URLs and work under the repository path.

[GitHub Pages publishing guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Test on iPhone in Bluefy

1. Install [Bluefy](https://apps.apple.com/in/app/bluefy-web-ble-browser/id1492822055) if available in your App Store region. Turn Bluetooth on and grant Bluefy Bluetooth access if prompted.
2. Paste the **published HTTPS URL** into Bluefy's own address bar. Open the full page. Try all dashboard styles in Demo mode first.
3. With the bike parked, start with a known BLE Battery Service test peripheral. Tap **Bluetooth → Choose BLE device**. Verify the battery display and disconnect behavior.
4. For an authorized custom peripheral, select **Custom read-only telemetry**, fill in the exact advertised name and verified service and characteristic UUIDs, and choose the peripheral in the browser picker. The selected characteristic must support reading, notifications, or indications.
5. If the picker is unavailable, confirm the HTTPS origin, Bluefy permission and Bluetooth access. If a device is absent, check that it advertises the selected service or exact name and isn't occupied by another client. iPhone Safari can display the demo and styles. The BLE workflow specifically targets Bluefy.

The official Yezdi app pairing for navigation and notifications does not establish a browser-accessible telemetry profile. Live readings from the stock cluster, concurrent use with the official app, and access to stock navigation are unverified. The browser connection requires its own permission. A stock cluster or common OBD adapter may use an incompatible protocol. The BLE-reading path does not send device commands or write characteristic values. Notification subscriptions use the browser's standard GATT mechanism. Confirm device compatibility while parked and use the factory instruments when riding.

## Custom characteristic data contract

The custom profile is intended for a documented, authorized telemetry bridge exposing one complete UTF-8 JSON object per GATT value, at most 512 bytes and within the peripheral's actual GATT payload capacity. The dashboard accepts partial updates and ignores unknown fields. Use these exact keys:

| Keys | Format |
| --- | --- |
| `speed`, `rpm`, `gear` | km/h, engine rpm, integer gear or `"N"` |
| `fuel`, `battery`, `voltage` | percentages from 0–100, and volts |
| `odo`, `range`, `tripA`, `tripB` | km |
| `mileageA`, `mileageB` | km/L |
| `health` | `"Normal"` or `"Warning"` |

Example: `{"speed":0,"rpm":1450,"gear":"N","fuel":71,"voltage":12.7}`.

The display clears live values on connection attempts and disconnection. Values also expire if updates stop. No route instructions are generated in BLE mode. Device configuration and ride readings are kept in page memory. Only the dashboard style is saved across reloads.

[Web Bluetooth device selection reference](https://developer.mozilla.org/en-US/docs/Web/API/Bluetooth/requestDevice)
