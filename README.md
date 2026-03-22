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

Copy `app.py` from this repository to the Pi (e.g. via `scp` or `git pull`):

```bash
scp app.py stage-display@<PI_IP>:/home/stage-display/stage-display-cec/app.py
```

The current `app.py` uses a **persistent `CecDaemon`** — see the [Stability Features](#stability-features) section for details.

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

Wakes the display. Sends two CEC commands via the persistent daemon:
1. `as` — Active Source (opcode `0x82`, broadcast): announces the Pi as the active source. LG SimpLink TVs with Auto Power Sync wake up on this alone.
2. `on 0` — Image View On (opcode `0x04`): belt-and-braces wake for TVs without Auto Power Sync.

**Success response — HTTP 200:**
```json
{ "success": true, "action": "on" }
```

---

### `POST /display/off`

Sends CEC Standby (opcode `0x36`) via the persistent daemon.

> **⚠️ Known limitation — older LG TVs:** Some older LG SimpLink TVs (CEC version 1.3a) do not respond to the CEC Standby opcode from external devices. The command is transmitted and acknowledged on the bus, but the TV stays on. This is a firmware limitation of those TV models and cannot be worked around in software.
> The `/display/on` endpoint works correctly on the same TVs.

**Success response — HTTP 200:**
```json
{ "success": true, "action": "off" }
```

---

### `GET /display/status`

Queries the current power state via CEC Give Device Power Status (opcode `0x8F`).

**Response — HTTP 200:**
```json
{ "power_state": "on" }
```

| `power_state` | Meaning |
|---------------|---------|
| `on` | Display is powered on and responding via CEC |
| `standby` | Display explicitly reported standby over CEC |
| `unknown` | CEC responded but the state string was not recognised. On older LG TVs this typically means the display is **off / in standby** (the TV does not reply to power queries when in standby, causing libCEC to report an unrecognised state). |
| `error` | The persistent CEC daemon returned no output (adapter not connected or crashed) |

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

Increases volume by one step. Sends CEC `volup` via the persistent daemon (User Control Pressed Volume Up + Released).

**Success response — HTTP 200:**
```json
{ "success": true, "action": "volume_up" }
```

---

### `POST /display/volume/down`

Decreases volume by one step. Sends CEC `voldown` via the persistent daemon (User Control Pressed Volume Down + Released).

**Success response — HTTP 200:**
```json
{ "success": true, "action": "volume_down" }
```

---

### `POST /display/volume/mute`

Toggles mute. Sends CEC `mute` via the persistent daemon (User Control Pressed Mute + Released).

**Success response — HTTP 200:**
```json
{ "success": true, "action": "volume_mute" }
```

---

## Stability Features

### Persistent CEC Daemon (`CecDaemon` class in `app.py`)

Every time `cec-client` starts it **negotiates a logical address on the CEC bus**. On LG SimpLink TVs with Auto Power Sync this negotiation is interpreted as "a device became active" and immediately wakes the TV — making it impossible to reliably send a standby command without re-waking the TV milliseconds later.

`CecDaemon` solves this by launching `cec-client` **once at service startup** and keeping it running as a background process. All subsequent commands are written to its `stdin` — no new bus negotiation, no spurious wake signal.

```
Flask starts
  └─ CecDaemon.__init__()
       └─ subprocess.Popen(["cec-client", "-d", "1"])
            └─ background reader thread drains stdout into _output[]
            └─ time.sleep(5)  ← wait for bus negotiation to complete

POST /display/on  ──► CecDaemon.send("as\non 0")   ← writes to existing stdin
POST /display/off ──► CecDaemon.send("standby 0")  ← writes to existing stdin
GET  /display/status ► CecDaemon.send("pow 0")     ← writes to existing stdin
```

If `cec-client` crashes, `_ensure_alive()` detects the dead process and restarts it before the next command.

The Companion module (`src/main.js`) includes several additional stability improvements.

### Poll Guard (`_pollBusy` flag)

With the persistent CecDaemon, status polls typically return in **2–3 seconds**. Without a guard, `setInterval` could still fire a new poll before the previous one completes if the Pi or network is slow.

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

On **older LG TVs** (CEC 1.3a / SimpLink) this is **expected behaviour when the TV is off**. The TV does not reply to CEC power queries while in standby, so libCEC reports an unrecognised state. The Companion module treats `unknown` as equivalent to `standby` for feedback purposes.

If you see `unknown` while the TV is **on**, check:
1. HDMI cable is firmly connected between the Pi and the display.
2. CEC / SimpLink is enabled in the TV's settings menu.
3. Run `echo "scan" | cec-client -s -d 1` on the Pi — the display should appear in the scan output.

### `Display Off` action has no effect on the TV

Some older LG SimpLink TVs (CEC 1.3a) **ignore the CEC Standby opcode** (`0x36`) from external devices. The Pi correctly transmits the frame and it is acknowledged on the bus, but the TV's firmware does not act on it. This is a known hardware limitation of those TV models.

**Workarounds:**
- Use the TV's physical remote or power button.
- Use an IR blaster if your setup supports it.
- Use RS-232 control if the TV has a serial port.

`Display On` works correctly on the same TVs via the Active Source broadcast (`0x82`).

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


