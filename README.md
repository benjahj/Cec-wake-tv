# companion-module-stagedisplay-cec

A [Bitfocus Companion](https://bitfocus.io/companion) module that controls an **LG display** via **HDMI-CEC** through a **Raspberry Pi HTTP bridge**.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Companion Module Setup](#companion-module-setup)
   - [Connection Settings](#connection-settings)
   - [Actions](#actions)
   - [Feedbacks](#feedbacks)
   - [Variables](#variables)
4. [Raspberry Pi Bridge Setup](#raspberry-pi-bridge-setup)
   - [Hardware Requirements](#hardware-requirements)
   - [OS & Dependencies](#os--dependencies)
   - [Flask Service Code](#flask-service-code)
   - [Running as a systemd Service](#running-as-a-systemd-service)
5. [API Reference](#api-reference)
6. [Development](#development)

---

## Overview

This module lets Bitfocus Companion (running on any machine) send **Display On** and **Display Off** commands to an LG display connected to a Raspberry Pi via HDMI. The Pi runs a small Flask HTTP server that translates REST calls into `cec-client` (HDMI-CEC) commands.

---

## Architecture

```
[Companion / Stream Deck]
        │
        │  HTTP (port 5000)
        ▼
[Raspberry Pi — stage-display-cec Flask service]
        │
        │  HDMI-CEC (cec-client)
        ▼
[LG Display]
```

The Companion module polls the Pi's `/display/status` endpoint every **5 seconds** to keep the power-state variable and feedbacks up to date.

---

## Companion Module Setup

### Connection Settings

| Field | Default | Description |
|-------|---------|-------------|
| Host | `10.0.1.44` | IP address or hostname of the Raspberry Pi |
| Port | `5000` | Port the Flask service listens on |

### Actions

| Action ID | Name | Description |
|-----------|------|-------------|
| `display_on` | Display On | Sends a CEC wake command — turns the LG display on |
| `display_off` | Display Off | Sends a CEC standby command — puts the LG display into standby |

### Feedbacks

| Feedback ID | Name | Style | Condition |
|-------------|------|-------|-----------|
| `display_is_on` | Display is ON | Green background | `power_state` is `on` |
| `display_is_standby` | Display is in Standby | Orange background | `power_state` is `standby` |

### Variables

| Variable | Description | Possible Values |
|----------|-------------|-----------------|
| `$(stagedisplaycec:power_state)` | Current CEC power state | `on`, `standby`, `unknown`, `error` |

---

## Raspberry Pi Bridge Setup

### Hardware Requirements

- Raspberry Pi (any model with HDMI out — Pi 3B+, Pi 4, Pi 5, Zero 2 W all work)
- HDMI cable connected to the LG display
- LG display with **SimpLink (CEC)** enabled in the display settings menu

### OS & Dependencies

```bash
# 1 — Update packages
sudo apt update && sudo apt upgrade -y

# 2 — Install cec-utils (provides cec-client)
sudo apt install -y cec-utils python3-pip

# 3 — Install Flask
pip3 install flask

# 4 — Verify CEC is working (should print your display info)
echo "scan" | cec-client -s -d 1
```

> **Tip:** Run `echo "pow 0" | cec-client -s -d 1` to check the display power status.
> You should see `power status: on` or `power status: standby`.

### Flask Service Code

Save this file as `/home/pi/stage-display-cec/app.py`:

```python
import subprocess
from flask import Flask, jsonify

app = Flask(__name__)


def run_cec(command: str) -> str:
    """Send a single cec-client command and return its stdout."""
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


@app.route("/display/on", methods=["POST"])
def display_on():
    """Wake the display via CEC 'on 0'."""
    output = run_cec("on 0")
    if output is not None:
        return jsonify({"success": True, "action": "on"})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


@app.route("/display/off", methods=["POST"])
def display_off():
    """Put the display into standby via CEC 'standby 0'."""
    output = run_cec("standby 0")
    if output is not None:
        return jsonify({"success": True, "action": "off"})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


@app.route("/display/status", methods=["GET"])
def display_status():
    """Query the display power state via CEC 'pow 0'."""
    output = run_cec("pow 0")
    if not output:
        return jsonify({"power_state": "error"})
    if "power status: on" in output:
        return jsonify({"power_state": "on"})
    if "power status: standby" in output:
        return jsonify({"power_state": "standby"})
    return jsonify({"power_state": "unknown"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
```

### Running as a systemd Service

This makes the Flask service start automatically on boot.

**1. Create the service file:**

```bash
sudo nano /etc/systemd/system/stage-display-cec.service
```

Paste the following:

```ini
[Unit]
Description=Stage Display CEC HTTP Bridge
After=network.target

[Service]
ExecStart=/usr/bin/python3 /home/pi/stage-display-cec/app.py
WorkingDirectory=/home/pi/stage-display-cec
StandardOutput=journal
StandardError=journal
Restart=always
RestartSec=5
User=pi

[Install]
WantedBy=multi-user.target
```

**2. Enable and start it:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable stage-display-cec
sudo systemctl start stage-display-cec

# Check it's running
sudo systemctl status stage-display-cec

# Watch logs live
sudo journalctl -u stage-display-cec -f
```

**3. Test it from any machine on the network:**

```bash
# Turn display on
curl -X POST http://10.0.1.44:5000/display/on

# Turn display off
curl -X POST http://10.0.1.44:5000/display/off

# Get power status
curl http://10.0.1.44:5000/display/status
```

---

## API Reference

All endpoints are served by the Flask service on the Raspberry Pi.

### `POST /display/on`

Wakes the display via CEC command `on 0`.

**Response (success):**
```json
{ "success": true, "action": "on" }
```

**Response (failure):**
```json
{ "success": false, "error": "cec-client failed" }
```

---

### `POST /display/off`

Puts the display into standby via CEC command `standby 0`.

**Response (success):**
```json
{ "success": true, "action": "off" }
```

**Response (failure):**
```json
{ "success": false, "error": "cec-client failed" }
```

---

### `GET /display/status`

Queries the display power state via CEC command `pow 0`.

**Response:**
```json
{ "power_state": "on" }
```

| `power_state` value | Meaning |
|---------------------|---------|
| `on` | Display is powered on |
| `standby` | Display is in standby mode |
| `unknown` | CEC responded but state was unreadable |
| `error` | Could not communicate via CEC |

---

## Development

### Prerequisites

- Node.js 22
- Yarn 4

### Install dependencies

```bash
yarn install
```

### Build (package for Companion)

```bash
yarn package
```

This uses `@companion-module/tools` (Webpack) to bundle `src/main.js` and the `companion/` folder into a `.tgz` that Companion can load.

### Module structure

```
companion-module-stagedisplay-cec/
├── companion/
│   ├── manifest.json       # Module metadata (id, name, runtime entrypoint)
│   └── HELP.md             # In-app help shown inside Companion
├── src/
│   ├── main.js             # Module entry — lifecycle, polling, HTTP requests
│   ├── actions.js          # Action definitions (Display On / Off)
│   ├── feedbacks.js        # Feedback definitions (green = on, orange = standby)
│   └── variables.js        # Variable definitions (power_state)
├── package.json
└── README.md
```

### Polling behaviour

The module polls `/display/status` every **5 seconds**. After sending an On or Off command it immediately re-polls so the feedback updates without waiting for the next cycle.

If the Pi is unreachable the module sets its status to `ConnectionFailure` and sets `power_state` to `error`.


