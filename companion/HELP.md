# Stage Display CEC

Controls a display via **HDMI-CEC** through a Raspberry Pi HTTP bridge.
Supports **power control**, **HDMI input switching** (1–4), and **volume control** (up / down / mute).

For full setup instructions — including the Raspberry Pi Flask service code, systemd configuration, and API reference — see the **[README on GitHub](https://github.com/benjahj/Cec-wake-tv)**.

---

## Prerequisites

Before adding this module, make sure the following are in place:

1. **Raspberry Pi** is powered on and connected to the display via HDMI.
2. **CEC is enabled** in the display's settings menu.
   - LG → **SimpLink**
   - Samsung → **Anynet+**
   - Sony → **BRAVIA Sync**
   - Other brands: look for "HDMI Control" or "CEC" in the display menu.
3. The **`stage-display-cec` Flask service** is running on the Pi (auto-starts on boot via systemd). You can verify it with:
   ```
   sudo systemctl status stage-display-cec
   ```
4. The Pi is reachable on your LAN. Test with:
   ```
   curl http://<PI_IP>:5000/display/status
   ```
   You should receive `{"power_state": "on"}` or `{"power_state": "standby"}`.

---

## Connection Settings

| Field | Default | Description |
|-------|---------|-------------|
| **Host** | *(required)* | IP address or hostname of the Raspberry Pi (e.g. `10.0.1.50`) |
| **Port** | `5000` | TCP port the Flask bridge listens on — change only if you modified the service |

> If the **Host** field is left empty, the module will show a **yellow BadConfig** indicator and will not attempt any connections until a host is provided.

---

## Actions

### Power Control

| Action | CEC Commands | Description |
|--------|-------------|-------------|
| **Display On** | `as` → `on 0` | Wakes the display from standby. Sends an Active Source broadcast first (opcode `0x82`), then Image View On (opcode `0x04`). LG SimpLink TVs wake on the Active Source alone. |
| **Display Off** | `standby 0` | Sends CEC Standby (opcode `0x36`). ⚠️ See note below. |

> **⚠️ Known limitation — older LG TVs:** Some older LG SimpLink TVs (CEC version 1.3a) **do not respond** to the CEC Standby command from external devices. The command is transmitted correctly, but the TV ignores it. This is a firmware limitation and cannot be worked around in software. Use the physical remote or an IR blaster to turn the TV off.

### HDMI Input Switching

| Action | Option | CEC Opcode | Description |
|--------|--------|------------|-------------|
| **Set HDMI Input** | HDMI 1–4 | Active Source (`0x82`) | Switches the TV to the selected HDMI port |

The CEC Active Source message tells the TV which physical HDMI port is now the active source. Physical addresses used:

| Port | Physical Address |
|------|-----------------|
| HDMI 1 | `10:00` |
| HDMI 2 | `20:00` |
| HDMI 3 | `30:00` |
| HDMI 4 | `40:00` |

### Volume Control

| Action | CEC Command | Description |
|--------|-------------|-------------|
| **Volume Up** | `volup` | Increases TV volume by one step |
| **Volume Down** | `voldown` | Decreases TV volume by one step |
| **Volume Mute / Unmute** | `mute` | Toggles mute on/off |

> **Note on timing:** The bridge uses a persistent `cec-client` daemon — commands no longer require a full CEC bus re-initialisation. Most commands return within **2–4 seconds**. The module uses a 15-second HTTP timeout for safety and will not show an error unless 3 consecutive polls fail.

---

## Feedbacks

Feedbacks automatically update whenever the display state changes.

| Feedback | Default Style | Active When |
|----------|---------------|-------------|
| **Display is ON** | 🟢 Green background, white text | `power_state` is `on` |
| **Display is in Standby** | 🟠 Orange background, white text | `power_state` is `standby` |

You can customise the colours in the feedback editor. Feedbacks are re-evaluated on every poll (every 10 seconds) and immediately after any action is triggered.

---

## Variables

| Variable | Description | Possible Values |
|----------|-------------|-----------------|
| `$(stagedisplaycec:power_state)` | Current CEC power state of the display | `on`, `standby`, `unknown`, `error` |

The variable is updated every **10 seconds** by polling the Pi bridge's `/display/status` endpoint, and immediately after any action is triggered (if no poll is currently in progress).

| Value | Meaning |
|-------|---------|
| `on` | Display is powered on and responding via CEC |
| `standby` | Display explicitly reported standby over CEC |
| `unknown` | CEC bus responded, but the power state string was not recognised. **On older LG TVs this is normal when the display is off** — the TV does not reply to power queries in standby. Treat `unknown` as "off / standby". |
| `error` | Pi bridge is unreachable (shown after 3 consecutive failed polls ≈ 30 seconds) |

---

## Module Status Indicators

| Indicator | Meaning |
|-----------|---------|
| 🟡 **Yellow — BadConfig** | Host field is empty. Enter the Pi's IP address. |
| 🔵 **Blue — Connecting** | Module has just started and is waiting for the first poll to complete. |
| 🟢 **Green — OK** | Pi bridge is reachable and returning a valid power state. |
| 🔴 **Red — ConnectionFailure** | Pi bridge has not responded to 3 consecutive polls (~30 seconds). Check the Pi is on and the Flask service is running. |

---

## Troubleshooting

**Module is red but the Pi is online**
→ Check that the Flask service is running: `sudo systemctl status stage-display-cec`
→ Check the port — default is `5000`. Make sure no firewall is blocking it.

**`power_state` stays `unknown`**
→ On older LG TVs this is **expected when the display is off**. The TV does not reply to CEC power queries in standby; `unknown` effectively means "off". If the TV is visibly on and you still see `unknown`, check that SimpLink is enabled in the TV menu and the HDMI cable is firmly connected.

**`Display Off` action has no effect**
→ Some older LG SimpLink TVs ignore the CEC Standby command. This is a firmware limitation. Use the TV's remote or an IR blaster to power it off.

**Actions do nothing**
→ Commands now typically complete in 2–4 seconds. If an action has no effect after 10 seconds, check the Companion log for errors.
→ Verify the service is running on the Pi: `sudo systemctl status stage-display-cec`

**HDMI input switching doesn't work**
→ Some TVs ignore the Active Source CEC message when they are in standby. Try sending **Display On** first, then switching the input.

