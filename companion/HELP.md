# Stage Display CEC

Controls a display via **HDMI-CEC** through a Raspberry Pi HTTP bridge running the `stage-display-cec` Flask service. Supports power control, HDMI input switching, and volume control.

For full setup instructions including the Raspberry Pi service code, see the [README on GitHub](https://github.com/benjahj/Cec-wake-tv).

---

## Prerequisites

1. Raspberry Pi powered on and connected to the display via HDMI.
2. **CEC** enabled in the display settings menu (often called SimpLink, Anynet+, BRAVIA Sync, etc.).
3. The `stage-display-cec` Flask service running on the Pi (auto-starts on boot via systemd).

---

## Connection Settings

| Field | Default | Description |
|-------|---------|-------------|
| Host | *(required)* | IP address or hostname of the Raspberry Pi |
| Port | `5000` | Port the Flask service listens on |

---

## Actions

### Power

| Action | Description |
|--------|-------------|
| **Display On** | Sends a CEC `on 0` command — wakes the display |
| **Display Off** | Sends a CEC `standby 0` command — puts the display into standby |

### HDMI Input

| Action | Options | Description |
|--------|---------|-------------|
| **Set HDMI Input** | HDMI 1–4 | Broadcasts a CEC Active Source message to switch the TV to the selected input |

### Volume

| Action | Description |
|--------|-------------|
| **Volume Up** | Increases TV volume by one step via CEC |
| **Volume Down** | Decreases TV volume by one step via CEC |
| **Volume Mute / Unmute** | Toggles mute on the TV via CEC |

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

