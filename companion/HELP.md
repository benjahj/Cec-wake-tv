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

| Action | CEC Command | Description |
|--------|-------------|-------------|
| **Display On** | `on 0` | Wakes the display from standby |
| **Display Off** | `standby 0` | Puts the display into standby (low-power) mode |

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

> **Note on timing:** CEC commands are inherently slow — `cec-client` can take 5–15 seconds to complete because it initialises the CEC bus on every call. This is normal behaviour. The module uses a 15-second HTTP timeout for commands and will not show an error unless 3 consecutive polls fail.

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
| `standby` | Display is in standby mode |
| `unknown` | CEC bus responded, but the power state string was not recognised |
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
→ CEC is working but the TV is not answering the power query. Ensure CEC is enabled in the display menu and the HDMI cable is firmly connected.

**Actions do nothing**
→ CEC commands can take up to 15 seconds. Wait and check the Companion log for any error messages.
→ Verify the action works from the Pi directly: `echo "on 0" | cec-client -s -d 1`

**HDMI input switching doesn't work**
→ Some TVs ignore the Active Source CEC message when they are in standby. Try sending **Display On** first, then switching the input.

