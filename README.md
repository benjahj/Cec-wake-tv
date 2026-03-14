# companion-module-stagedisplay-cec

A [Bitfocus Companion](https://bitfocus.io/companion) module that controls a display via **HDMI-CEC** through a **Raspberry Pi HTTP bridge**.
Supports **power control**, **HDMI input switching** (1–4), and **volume control** (up / down / mute).

> **Hardware tested on:** Raspberry Pi Zero 2 W + LG display with SimpLink (CEC) enabled.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Hardware Requirements](#hardware-requirements)
4. [Raspberry Pi Bridge Setup](#raspberry-pi-bridge-setup)
   - [1. Install Dependencies](#1-install-dependencies)
   - [2. Deploy the Flask Service](#2-deploy-the-flask-service)
   - [3. Run as a systemd Service](#3-run-as-a-systemd-service)
   - [4. Verify the Bridge](#4-verify-the-bridge)
5. [Companion Module Setup (Self-hosted / Dev)](#companion-module-setup-self-hosted--dev)
   - [1. Clone and Install](#1-clone-and-install)
   - [2. Add the Module to Companion](#2-add-the-module-to-companion)
   - [3. Configure the Connection](#3-configure-the-connection)
6. [Companion Module Reference](#companion-module-reference)
   - [Actions](#actions)
   - [Feedbacks](#feedbacks)
   - [Variables](#variables)
7. [API Reference (Flask Bridge)](#api-reference-flask-bridge)
8. [Stability Features](#stability-features)
9. [Troubleshooting](#troubleshooting)
10. [Development](#development)

---

## Overview

This project consists of **two components** that work together:

| Component | Where it runs | What it does |
|-----------|--------------|--------------|
| **Flask bridge** (`app.py`) | Raspberry Pi (HDMI-connected to the display) | Translates HTTP REST calls into `cec-client` commands over the HDMI-CEC bus |
| **Companion module** (`src/`) | Bitfocus Companion server | Exposes actions, feedbacks and variables that Stream Deck buttons can use |

The module polls the Pi's `/display/status` endpoint every **10 seconds** to keep the `power_state` variable and feedbacks up to date. After any action is triggered, it immediately re-polls so the UI reflects the change without waiting for the next cycle.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Bitfocus Companion  (any machine/server)   │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │  companion-module-stagedisplay-cec   │   │
│  │  (this repo, loaded as a dev module) │   │
│  └──────────────┬───────────────────────┘   │
└─────────────────┼───────────────────────────┘
                  │  HTTP REST  (port 5000)
                  │  POST /display/on
                  │  POST /display/off
                  │  GET  /display/status
                  │  POST /display/input/<1-4>
                  │  POST /display/volume/up
                  │  POST /display/volume/down
                  │  POST /display/volume/mute
                  ▼
┌─────────────────────────────────────────────┐
│  Raspberry Pi  (connected via HDMI)         │
│                                             │
│  stage-display-cec  (Flask / systemd)       │
│  └─ app.py  →  cec-client subprocess        │
└─────────────────┬───────────────────────────┘
                  │  HDMI-CEC
                  ▼
┌─────────────────────────────────────────────┐
│  Display  (LG, Sony, Samsung, etc.)         │
│  CEC must be enabled in display settings    │
│  (SimpLink / Anynet+ / BRAVIA Sync …)       │
└─────────────────────────────────────────────┘
```

---

## Hardware Requirements

| Item | Notes |
|------|-------|
| Raspberry Pi | Any model with HDMI output. Tested on **Pi Zero 2 W**. Pi 3B+, Pi 4, Pi 5 also work. |
| HDMI cable | Full-size or micro-HDMI depending on Pi model. Must be plugged in at all times (CEC is carried over HDMI). |
| Display | Any HDMI display with CEC support. LG = **SimpLink**, Samsung = **Anynet+**, Sony = **BRAVIA Sync**. Must be **enabled in the display menu**. |

---

## Raspberry Pi Bridge Setup

### 1. Install Dependencies

SSH into the Pi and install the required packages. **Do not run `apt upgrade`** — it is not needed and takes a very long time on a Pi Zero.

```bash
# Install cec-utils (provides the cec-client binary) and Flask web framework
sudo apt install -y cec-utils python3-flask
```

Verify that `cec-client` is installed and the display is detected:

```bash
# Should print your display's name, vendor, and CEC address
echo "scan" | cec-client -s -d 1

# Check power state — expect "power status: on" or "power status: standby"
echo "pow 0" | cec-client -s -d 1
```

> **Note:** `cec-client` can take 5–15 seconds to respond because it initialises the CEC bus each time. This is normal.

---

### 2. Deploy the Flask Service

Create the project directory and save the service script:

```bash
mkdir -p /home/stage-display/stage-display-cec
nano /home/stage-display/stage-display-cec/app.py
```

Paste the complete `app.py` below:

```python
"""
stage-display-cec  —  HDMI-CEC HTTP bridge
==========================================
Translates HTTP REST calls into cec-client (HDMI-CEC) commands.

Endpoints
---------
POST /display/on              Wake the display (CEC: on 0)
POST /display/off             Standby the display (CEC: standby 0)
GET  /display/status          Query power state (CEC: pow 0)
POST /display/input/<1-4>     Switch HDMI input (CEC: Active Source tx)
POST /display/volume/up       Volume up (CEC: volup)
POST /display/volume/down     Volume down (CEC: voldown)
POST /display/volume/mute     Toggle mute (CEC: mute)

All responses are JSON.  Success shape: {"success": true, ...}
                          Error shape:   {"success": false, "error": "..."}
"""

import subprocess
from flask import Flask, jsonify

app = Flask(__name__)

# ---------------------------------------------------------------------------
# HDMI physical addresses for CEC Active Source (opcode 0x82)
# Format used in the CEC tx command:  1F:82:<high byte>:<low byte>
# HDMI 1 → 10:00   HDMI 2 → 20:00   HDMI 3 → 30:00   HDMI 4 → 40:00
# ---------------------------------------------------------------------------
HDMI_ADDRESSES = {
    1: "10:00",
    2: "20:00",
    3: "30:00",
    4: "40:00",
}


def run_cec(command: str) -> str:
    """
    Send a single cec-client command in single-shot mode (-s) and return stdout.

    Parameters
    ----------
    command : str
        The cec-client command string, e.g. "on 0", "pow 0", "volup".

    Returns
    -------
    str
        stdout from cec-client, or empty string on timeout / error.

    Notes
    -----
    -s  single-shot mode (run command then exit)
    -d 1  log level 1 (errors only — suppresses verbose CEC bus traffic)
    timeout=15  seconds; CEC initialisation alone can take 5-10 s on some TVs.
    """
    try:
        result = subprocess.run(
            ["cec-client", "-s", "-d", "1"],
            input=command + "\n",
            capture_output=True,
            text=True,
            timeout=15,
        )
        return result.stdout
    except subprocess.TimeoutExpired:
        return ""
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Power control
# ---------------------------------------------------------------------------

@app.route("/display/on", methods=["POST"])
def display_on():
    """Wake the display. CEC command: on 0  (broadcast to logical address 0 = TV)."""
    output = run_cec("on 0")
    if output is not None:
        return jsonify({"success": True, "action": "on"})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


@app.route("/display/off", methods=["POST"])
def display_off():
    """Put the display into standby. CEC command: standby 0."""
    output = run_cec("standby 0")
    if output is not None:
        return jsonify({"success": True, "action": "off"})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


@app.route("/display/status", methods=["GET"])
def display_status():
    """
    Query the display power state.

    CEC command: pow 0  (power status request to logical address 0 = TV).
    Parses the response string for "power status: on" or "power status: standby".
    """
    output = run_cec("pow 0")
    if not output:
        return jsonify({"power_state": "error"})
    if "power status: on" in output:
        return jsonify({"power_state": "on"})
    if "power status: standby" in output:
        return jsonify({"power_state": "standby"})
    return jsonify({"power_state": "unknown"})


# ---------------------------------------------------------------------------
# HDMI input switching
# ---------------------------------------------------------------------------

@app.route("/display/input/<int:number>", methods=["POST"])
def display_input(number):
    """
    Switch the TV to a specific HDMI input using the CEC Active Source opcode (0x82).

    The CEC tx command format is:
        tx 1F:82:<high>:<low>
    where 1F is the broadcast address, 82 is the Active Source opcode,
    and <high>:<low> is the physical address of the HDMI port.

    Parameters
    ----------
    number : int
        HDMI port number, 1 through 4.
    """
    if number not in HDMI_ADDRESSES:
        return jsonify({"success": False, "error": f"Invalid input {number}. Must be 1-4."}), 400
    addr = HDMI_ADDRESSES[number]
    output = run_cec(f"tx 1F:82:{addr}")
    if output is not None:
        return jsonify({"success": True, "action": f"input/{number}", "physical_address": addr})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


# ---------------------------------------------------------------------------
# Volume control
# ---------------------------------------------------------------------------

@app.route("/display/volume/up", methods=["POST"])
def volume_up():
    """Increase TV volume by one step. Uses the cec-client 'volup' shortcut."""
    output = run_cec("volup")
    if output is not None:
        return jsonify({"success": True, "action": "volume/up"})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


@app.route("/display/volume/down", methods=["POST"])
def volume_down():
    """Decrease TV volume by one step. Uses the cec-client 'voldown' shortcut."""
    output = run_cec("voldown")
    if output is not None:
        return jsonify({"success": True, "action": "volume/down"})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


@app.route("/display/volume/mute", methods=["POST"])
def volume_mute():
    """Toggle mute. Uses the cec-client 'mute' shortcut."""
    output = run_cec("mute")
    if output is not None:
        return jsonify({"success": True, "action": "volume/mute"})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


if __name__ == "__main__":
    # Listen on all interfaces so Companion can reach it over the LAN
    app.run(host="0.0.0.0", port=5000)
```

---

### 3. Run as a systemd Service

Create a systemd unit file so the Flask bridge starts automatically on every boot:

```bash
sudo nano /etc/systemd/system/stage-display-cec.service
```

Paste the following (adjust `User` and paths to match your Pi username):

```ini
[Unit]
Description=Stage Display CEC HTTP Bridge
# Wait for networking before starting
After=network.target

[Service]
# Full path to python3 and the app script
ExecStart=/usr/bin/python3 /home/stage-display/stage-display-cec/app.py
WorkingDirectory=/home/stage-display/stage-display-cec
# Pipe stdout/stderr to systemd journal (view with: journalctl -u stage-display-cec)
StandardOutput=journal
StandardError=journal
# Restart automatically if the process crashes
Restart=always
RestartSec=5
# Run as the Pi user — NOT root
User=stage-display

[Install]
WantedBy=multi-user.target
```

Enable, start, and verify the service:

```bash
# Tell systemd about the new unit file
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable stage-display-cec

# Start it now
sudo systemctl start stage-display-cec

# Confirm it is active (should show "active (running)")
sudo systemctl status stage-display-cec

# Follow live logs (Ctrl-C to exit)
sudo journalctl -u stage-display-cec -f
```

---

### 4. Verify the Bridge

Test every endpoint from any machine on the same network. Replace `<PI_IP>` with your Pi's IP address.

```bash
# Power on the display
curl -X POST http://<PI_IP>:5000/display/on

# Power off (standby)
curl -X POST http://<PI_IP>:5000/display/off

# Query current power state
curl http://<PI_IP>:5000/display/status
# → {"power_state": "on"}  or  {"power_state": "standby"}

# Switch to HDMI input 2
curl -X POST http://<PI_IP>:5000/display/input/2

# Volume up / down / mute
curl -X POST http://<PI_IP>:5000/display/volume/up
curl -X POST http://<PI_IP>:5000/display/volume/down
curl -X POST http://<PI_IP>:5000/display/volume/mute
```

---

## Companion Module Setup (Self-hosted / Dev)

This module is not published to the official Companion store. It is loaded as a **developer module** directly from the file system of the Companion server.

### 1. Clone and Install

SSH into the machine running Companion and run:

```bash
# Clone the repository into Companion's module dev folder
sudo git clone https://github.com/benjahj/Cec-wake-tv.git \
    /opt/companion-module-dev/wake-on-cec

# Fix ownership so the companion_admin user can read/write the folder
sudo chown -R companion_admin:companion_admin \
    /opt/companion-module-dev/wake-on-cec

# Install Node.js dependencies
cd /opt/companion-module-dev/wake-on-cec
npm install --ignore-engines
```

> **Why `--ignore-engines`?**
> The `package.json` engine field targets Node 22. Companion ships with Node 18.
> The `--ignore-engines` flag skips that check; the module works correctly on Node 18.

> **Why not `yarn`?**
> Companion's server environment typically uses npm. Yarn 4 PnP mode breaks module
> resolution in Companion's subprocess context. Use `npm install --ignore-engines`.

### 2. Add the Module to Companion

1. Open the Companion web UI (default: `http://<companion-server>:8000`).
2. Go to **Settings → Developer modules**.
3. Add the path `/opt/companion-module-dev/wake-on-cec` and click **Save**.
4. Restart Companion or click **Rescan modules**.

### 3. Configure the Connection

1. In the Companion UI, go to **Connections** and click **Add connection**.
2. Search for **Stage Display CEC** and add it.
3. Enter the Raspberry Pi's IP address and port (`5000`).
4. The status indicator should turn **green** once the Pi responds to the first poll.

> **Updating the module:**
> When a new version is pushed to GitHub, pull it on the Companion server and restart:
> ```bash
> cd /opt/companion-module-dev/wake-on-cec && git pull origin master
> ```
> Then disable and re-enable the module instance in the Companion UI to reload it.

---

## Companion Module Reference

### Actions

| Action | ID | Options | Description |
|--------|----|---------|-------------|
| **Display On** | `display_on` | — | Sends CEC `on 0` — wakes the display |
| **Display Off** | `display_off` | — | Sends CEC `standby 0` — puts display in standby |
| **Set HDMI Input** | `set_input` | HDMI 1 / 2 / 3 / 4 | Broadcasts CEC Active Source (0x82) for the selected port |
| **Volume Up** | `volume_up` | — | Sends CEC `volup` — increases volume by one step |
| **Volume Down** | `volume_down` | — | Sends CEC `voldown` — decreases volume by one step |
| **Volume Mute / Unmute** | `volume_mute` | — | Sends CEC `mute` — toggles mute |

After each action the module immediately re-polls `/display/status` (if no poll is already in progress) so feedbacks and variables update without waiting for the next 10-second cycle.

### Feedbacks

| Feedback | ID | Default Style | Condition |
|----------|----|---------------|-----------|
| **Display is ON** | `display_is_on` | Green background, white text | `power_state === 'on'` |
| **Display is in Standby** | `display_is_standby` | Orange background, white text | `power_state === 'standby'` |

Feedbacks are re-evaluated whenever the `power_state` changes (on poll or after action).

### Variables

| Variable | Description | Possible Values |
|----------|-------------|-----------------|
| `$(stagedisplaycec:power_state)` | Current CEC power state reported by the Pi | `on`, `standby`, `unknown`, `error` |

| Value | Meaning |
|-------|---------|
| `on` | Display is powered on |
| `standby` | Display is in standby |
| `unknown` | CEC bus responded but the state string was not recognised |
| `error` | Pi is unreachable (shown after 3 consecutive failed polls) |

---

## API Reference (Flask Bridge)

All endpoints are served by `app.py` running on the Raspberry Pi at port **5000**.
All responses are `application/json`.

---

### `POST /display/on`

Wakes the display. Internally runs: `echo "on 0" | cec-client -s -d 1`

**Success response — HTTP 200:**
```json
{ "success": true, "action": "on" }
```
**Error response — HTTP 500:**
```json
{ "success": false, "error": "cec-client failed" }
```

---

### `POST /display/off`

Puts the display into standby. Internally runs: `echo "standby 0" | cec-client -s -d 1`

**Success response — HTTP 200:**
```json
{ "success": true, "action": "off" }
```

---

### `GET /display/status`

Queries the current power state. Internally runs: `echo "pow 0" | cec-client -s -d 1`

**Response — HTTP 200:**
```json
{ "power_state": "on" }
```

| `power_state` | Meaning |
|---------------|---------|
| `on` | Display is powered on |
| `standby` | Display is in standby |
| `unknown` | CEC responded but state string was not recognised |
| `error` | `cec-client` returned no output (bus error / not connected) |

---

### `POST /display/input/<number>`

Switches the TV to the specified HDMI input using the CEC **Active Source** opcode (`0x82`).
`<number>` must be an integer between **1** and **4**.

| Input | CEC Physical Address | TX command sent |
|-------|---------------------|-----------------|
| 1 | `10:00` | `tx 1F:82:10:00` |
| 2 | `20:00` | `tx 1F:82:20:00` |
| 3 | `30:00` | `tx 1F:82:30:00` |
| 4 | `40:00` | `tx 1F:82:40:00` |

**Success response — HTTP 200:**
```json
{ "success": true, "action": "input/2", "physical_address": "20:00" }
```
**Invalid input — HTTP 400:**
```json
{ "success": false, "error": "Invalid input 5. Must be 1-4." }
```

---

### `POST /display/volume/up`

Increases volume by one step. Internally runs: `echo "volup" | cec-client -s -d 1`

**Success response — HTTP 200:**
```json
{ "success": true, "action": "volume/up" }
```

---

### `POST /display/volume/down`

Decreases volume by one step. Internally runs: `echo "voldown" | cec-client -s -d 1`

**Success response — HTTP 200:**
```json
{ "success": true, "action": "volume/down" }
```

---

### `POST /display/volume/mute`

Toggles mute. Internally runs: `echo "mute" | cec-client -s -d 1`

**Success response — HTTP 200:**
```json
{ "success": true, "action": "volume/mute" }
```

---

## Stability Features

The Companion module (`src/main.js`) includes several stability improvements to cope with the inherent slowness of HDMI-CEC and unreliable network conditions.

### Poll Guard (`_pollBusy` flag)

`cec-client` can take 5–15 seconds to respond. Without a guard, `setInterval` would fire new polls before old ones complete, causing a build-up of concurrent HTTP requests that overwhelm the Pi.

A `_pollBusy` flag is set to `true` at the start of every poll and released in a `finally` block. If the interval fires while a poll is still in progress, the new poll is silently skipped.

```
Interval fires → _pollBusy === true? → skip (return immediately)
                                      ↓ false
                              set _pollBusy = true
                              fetch /display/status  (up to 8 s timeout)
                              process result
                              finally: _pollBusy = false
```

### Error Debounce (`ERROR_THRESHOLD = 3`)

A single failed poll (e.g., a momentary network blip) does **not** immediately set the module status to `ConnectionFailure`. Instead, an `_errorCount` counter is incremented on every failure and only triggers `ConnectionFailure` after **3 consecutive failures** (~30 seconds at the 10-second poll interval).

A successful poll resets `_errorCount` to `0`.

This prevents the Companion UI from flickering between OK and error states due to transient issues.

### Host Validation

If the **Host** field is left blank in the connection settings, the module immediately sets its status to `BadConfig` (yellow indicator) instead of attempting HTTP requests to an invalid URL. Polling is not started until a host is configured.

### Extended Poll Interval (10 seconds)

The poll interval was increased from 5 s to **10 seconds** because `cec-client` itself takes several seconds to initialise, meaning a 5-second poll would frequently overlap with the previous one even under normal conditions.

### Extended Command Timeout (15 seconds)

POST commands (on, off, input, volume) use a **15-second** fetch timeout — longer than the 8-second status poll — because power and input commands involve more CEC bus activity and may take longer to complete.

---

## Troubleshooting

### Module shows `BadConfig` (yellow) in Companion

The **Host** field is empty. Enter the Raspberry Pi's IP address in the connection settings.

### Module shows `ConnectionFailure` (red) in Companion

The Companion server cannot reach the Pi. Check:
1. Pi is powered on and connected to the network.
2. The IP address in the connection settings is correct.
3. The Flask service is running: `sudo systemctl status stage-display-cec`
4. The Pi is reachable: `ping <PI_IP>` and `curl http://<PI_IP>:5000/display/status`

### `power_state` is always `unknown`

CEC is running but the TV is not responding to the power query. Check:
1. HDMI cable is firmly connected between the Pi and the display.
2. CEC is enabled in the display menu (SimpLink / Anynet+ / BRAVIA Sync).
3. Run `echo "scan" | cec-client -s -d 1` on the Pi — the display should appear in the scan output.

### `cec-client` not found on the Pi

```bash
sudo apt install -y cec-utils
```

### "Cannot find module '@companion-module/base'" in Companion logs

The `node_modules` folder is missing. Install dependencies:

```bash
cd /opt/companion-module-dev/wake-on-cec
sudo chown -R companion_admin:companion_admin .
npm install --ignore-engines
```

Then disable and re-enable the module in the Companion UI.

### "permission denied" when running `git pull` on the Companion server

```bash
sudo chown -R companion_admin:companion_admin /opt/companion-module-dev/wake-on-cec
```

### "dubious ownership" Git error on the Companion server

```bash
git config --global --add safe.directory /opt/companion-module-dev/wake-on-cec
```

---

## Development

### Prerequisites

- **Node.js 22** (or 18 with `--ignore-engines`)
- **npm** (or Yarn 4 on a local dev machine)

### Install dependencies

```bash
npm install --ignore-engines
# or, on a local machine with Node 22:
yarn install
```

### Module structure

```
companion-module-stagedisplay-cec/
├── companion/
│   ├── manifest.json       # Module metadata: id, name, version, runtime entrypoint
│   └── HELP.md             # In-app help text shown inside the Companion UI
├── src/
│   ├── main.js             # Module entry point — lifecycle, polling loop, HTTP client
│   ├── actions.js          # Action definitions (all 6 actions: power, input, volume)
│   ├── feedbacks.js        # Feedback definitions (display_is_on, display_is_standby)
│   └── variables.js        # Variable definitions (power_state)
├── package.json            # Dependencies and package manager config
├── package-lock.json       # npm lockfile
└── README.md               # This file
```

### Key constants in `src/main.js`

| Constant | Value | Purpose |
|----------|-------|---------|
| `POLL_INTERVAL_MS` | `10000` | How often (ms) the module polls `/display/status` |
| `ERROR_THRESHOLD` | `3` | Consecutive failures before `ConnectionFailure` is shown |

### Adding a new action

1. Add a new Flask route to `app.py` on the Pi.
2. Add the action definition to `src/actions.js` using `self.sendCecCommand('<path>')`.
3. No changes to `main.js` are needed — `sendCecCommand` handles all HTTP + error logic.
4. Commit, push, and `git pull` on both the local Companion server and the Pi.

### Commit and deploy workflow

```bash
# On your local machine
git add .
git commit -m "feat: describe your change"
git push origin master

# On the Companion server
cd /opt/companion-module-dev/wake-on-cec && git pull origin master
# Then disable + re-enable the module in the Companion UI
```


