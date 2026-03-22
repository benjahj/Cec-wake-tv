import subprocess
import threading
import time
from flask import Flask, jsonify, abort

app = Flask(__name__)

# Physical addresses for HDMI inputs (CEC Active Source opcode 0x82).
# Port number maps to the two-byte physical address used in the CEC
# raw frame "tx 1F:82:<addr>".
#   HDMI 1 = 10:00  (physical address 1.0.0.0)
#   HDMI 2 = 20:00  (physical address 2.0.0.0)
#   HDMI 3 = 30:00  (physical address 3.0.0.0)
#   HDMI 4 = 40:00  (physical address 4.0.0.0)
HDMI_ADDRESSES = {
    1: "10:00",
    2: "20:00",
    3: "30:00",
    4: "40:00",
}


class CecDaemon:
    """Persistent cec-client process that avoids per-request bus init.

    Root cause of the LG SimpLink standby failure:
      Every time cec-client starts with ``-s`` it negotiates a logical
      address on the CEC bus.  That negotiation traffic is seen by the TV
      as "a device became active on HDMI 2", which triggers Auto Power
      Sync and puts the TV in the 'in transition standby to on' state.
      Any Standby command sent while the TV is mid-transition is ignored.

    Solution: keep cec-client running permanently so that the one-time
    bus negotiation happens at service startup only.  Subsequent commands
    are written to the already-running process's stdin — no new bus
    negotiation, no spurious wake signal.
    """

    #: Seconds to wait for cec-client to claim a logical address at boot.
    STARTUP_WAIT = 5.0
    #: Default seconds to collect cec-client output after each command.
    COMMAND_WAIT = 2.5

    def __init__(self):
        self._lock = threading.Lock()
        self._proc = None
        self._output = []
        self._out_lock = threading.Lock()
        self._start()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _start(self):
        """Launch cec-client in interactive mode and wait for CEC init."""
        try:
            self._proc = subprocess.Popen(
                ["cec-client", "-d", "1"],   # no -s → interactive daemon
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,    # merge stderr into stdout
                text=True,
                bufsize=1,                   # line-buffered
            )
            reader = threading.Thread(target=self._reader, daemon=True)
            reader.start()
            # Wait for cec-client to claim a logical address before we
            # start sending commands.
            time.sleep(self.STARTUP_WAIT)
        except Exception:
            self._proc = None

    def _reader(self):
        """Background thread: drain cec-client stdout into _output."""
        try:
            for line in iter(self._proc.stdout.readline, ""):
                with self._out_lock:
                    self._output.append(line)
        except Exception:
            pass

    def _ensure_alive(self):
        """Restart cec-client if it has died unexpectedly."""
        if self._proc is None or self._proc.poll() is not None:
            self._start()

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def send(self, command, wait=None):
        """Write *command* to cec-client and return collected output.

        Args:
            command (str): One or more newline-separated cec-client
                           commands, e.g. ``"pow 0"`` or ``"as\\non 0"``.
            wait (float):  Seconds to collect output. Defaults to
                           COMMAND_WAIT.

        Returns:
            str: Collected stdout/stderr from cec-client, or ``""`` on
                 error.
        """
        if wait is None:
            wait = self.COMMAND_WAIT
        with self._lock:
            self._ensure_alive()
            if self._proc is None:
                return ""
            # Discard output from previous commands.
            with self._out_lock:
                self._output.clear()
            try:
                self._proc.stdin.write(command + "\n")
                self._proc.stdin.flush()
            except Exception:
                return ""
            time.sleep(wait)
            with self._out_lock:
                return "".join(self._output)


# Single persistent CEC daemon — initialised once when Flask loads.
_cec = CecDaemon()


@app.route("/display/on", methods=["POST"])
def display_on():
    """Wake the display from standby.

    Sends two CEC commands to the persistent cec-client daemon:
      1. as   — Active Source (opcode 0x82, broadcast): announces the Pi
                as the active HDMI source. Old LG SimpLink TVs with Auto
                Power Sync wake up and switch to the Pi's input on this.
      2. on 0 — Image View On (opcode 0x04): belt-and-braces wake-up for
                TVs that do not implement Auto Power Sync.

    Because _cec is a persistent daemon these commands do NOT trigger a
    fresh CEC bus negotiation — no spurious wake signal for display/off.

    Returns:
        JSON: {"success": true, "action": "on"}
    """
    _cec.send("as\non 0", wait=3.0)
    return jsonify({"success": True, "action": "on"})


@app.route("/display/off", methods=["POST"])
def display_off():
    """Put the display into standby.

    Sends only the Standby CEC command (opcode 0x36) — no Active Source.

    Old LG SimpLink TVs with Auto Power Sync treat an Active Source
    broadcast as a wake signal and enter 'in transition standby to on'.
    Any Standby sent while the TV is mid-transition is ignored.  With the
    persistent daemon the CEC bus is already settled; Standby arrives
    without a preceding wake signal and the TV accepts it.

    Returns:
        JSON: {"success": true, "action": "off"}
    """
    _cec.send("standby 0", wait=2.0)
    return jsonify({"success": True, "action": "off"})


@app.route("/display/status", methods=["GET"])
def display_status():
    """Query the current power state of the display.

    CEC command: pow 0 — Give Device Power Status to the TV.
    The TV replies with its current state in the cec-client output.

    Returns:
        JSON: {"power_state": "<on|standby|unknown|error>"}
    """
    output = _cec.send("pow 0", wait=2.0)
    if not output:
        return jsonify({"power_state": "error"})
    if "power status: on" in output:
        return jsonify({"power_state": "on"})
    if "power status: standby" in output:
        return jsonify({"power_state": "standby"})
    return jsonify({"power_state": "unknown"})


@app.route("/display/input/<int:number>", methods=["POST"])
def display_input(number):
    """Switch the TV to a specific HDMI input using CEC Active Source.

    CEC command: tx 1F:82:<physical-address>
      Opcode 0x82 = Active Source, broadcast to all devices (1F).

    Args:
        number (int): HDMI input number, 1–4.

    Returns:
        JSON: {"success": true, "action": "input", "input": <number>}
              or 400 if number is out of range.
    """
    if number not in HDMI_ADDRESSES:
        abort(400, description="Invalid input. Must be 1-4.")
    addr = HDMI_ADDRESSES[number]
    _cec.send("tx 1F:82:" + addr)
    return jsonify({"success": True, "action": "input", "input": number})


@app.route("/display/volume/up", methods=["POST"])
def volume_up():
    """Increase the TV volume by one step.

    CEC command: volup (User Control Pressed Volume Up + Released).

    Returns:
        JSON: {"success": true, "action": "volume_up"}
    """
    _cec.send("volup")
    return jsonify({"success": True, "action": "volume_up"})


@app.route("/display/volume/down", methods=["POST"])
def volume_down():
    """Decrease the TV volume by one step.

    CEC command: voldown (User Control Pressed Volume Down + Released).

    Returns:
        JSON: {"success": true, "action": "volume_down"}
    """
    _cec.send("voldown")
    return jsonify({"success": True, "action": "volume_down"})


@app.route("/display/volume/mute", methods=["POST"])
def volume_mute():
    """Toggle mute on the TV.

    CEC command: mute (User Control Pressed Mute + Released).

    Returns:
        JSON: {"success": true, "action": "volume_mute"}
    """
    _cec.send("mute")
    return jsonify({"success": True, "action": "volume_mute"})


if __name__ == "__main__":
    # threaded=True lets Flask handle Companion's status polls and manual
    # control commands concurrently.  CecDaemon._lock still serialises the
    # actual CEC writes so only one command is on the bus at a time.
    app.run(host="0.0.0.0", port=5000, threaded=True)

