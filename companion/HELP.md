# Stage Display CEC

Controls an **LG display** via **HDMI-CEC** through a Raspberry Pi HTTP bridge running the `stage-display-cec` Flask service.

For full setup instructions including the Raspberry Pi service code, see the [README on GitHub](https://github.com/benjahj/Cec-wake-tv).

---

## Prerequisites

1. Raspberry Pi powered on and connected to the LG display via HDMI.
2. **SimpLink (CEC)** enabled in the LG display settings menu.
3. The `stage-display-cec` Flask service running on the Pi (auto-starts on boot via systemd).

---

## Connection Settings

| Field | Default | Description |
|-------|---------|-------------|
| Host | `10.0.1.44` | IP address or hostname of the Raspberry Pi |
| Port | `5000` | Port the Flask service listens on |

---

## Actions

| Action | Description |
|--------|-------------|
| **Display On** | Sends a CEC `on 0` command — wakes the LG display |
| **Display Off** | Sends a CEC `standby 0` command — puts the LG display into standby |

After each action the module immediately re-polls the display status so feedbacks and variables update without delay.

---

## Feedbacks

| Feedback | Style | Condition |
|----------|-------|-----------|
| **Display is ON** | Green background, white text | `power_state` is `on` |
| **Display is in Standby** | Orange background, white text | `power_state` is `standby` |

---

## Variables

| Variable | Description | Possible Values |
|----------|-------------|-----------------|
| `$(stagedisplaycec:power_state)` | Current CEC power state | `on`, `standby`, `unknown`, `error` |

The variable is updated every **5 seconds** by polling the Pi bridge, and immediately after any action.

| Value | Meaning |
|-------|---------|
| `on` | Display is powered on |
| `standby` | Display is in standby mode |
| `unknown` | CEC responded but state was unreadable |
| `error` | Could not reach the Raspberry Pi bridge |

