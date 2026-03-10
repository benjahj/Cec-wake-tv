# Stage Display CEC

Controls an LG display via HDMI-CEC through a Raspberry Pi HTTP bridge running the `stage-display-cec` service.

## Setup

1. Make sure the Raspberry Pi is powered on and connected to the LG display via HDMI.
2. Ensure SimpLink (CEC) is enabled in the LG display settings menu.
3. The `stage-display-cec` Flask service must be running on the Pi (auto-starts on boot via systemd).

## Connection Settings

| Field | Default | Description |
|-------|---------|-------------|
| Host | `10.0.1.44` | IP address or hostname of the Raspberry Pi |
| Port | `5000` | Port the Flask service listens on |

## Actions

| Action | Description |
|--------|-------------|
| Display On | Sends a CEC wake command — turns the LG display on |
| Display Off | Sends a CEC standby command — puts the LG display into standby |

## Feedbacks

| Feedback | Description |
|----------|-------------|
| Display is ON | Button lights up green when the display power state is `on` |

## Variables

| Variable | Description |
|----------|-------------|
| `$(stagedisplaycec:power_state)` | Current CEC power state: `on`, `standby`, `unknown`, or `error` |

