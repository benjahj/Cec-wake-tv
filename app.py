import subprocess
import threading
from flask import Flask, jsonify, abort

app = Flask(__name__)

# Global lock to prevent concurrent access to /dev/cec0.
# The CEC adapter is a single hardware resource — if two cec-client
# processes try to open it at the same time, the second one fails
# with errno=16 (EBUSY). This lock serialises all CEC calls so that
# only one cec-client process can run at a time.
_cec_lock = threading.Lock()

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


def run_cec(command):
    """Send a single cec-client command and return its stdout.

    Acquires _cec_lock before spawning cec-client so that only one CEC
    operation can be in flight at a time. Concurrent callers block here
    until the lock is released, preventing errno=16 (EBUSY) errors.

    Args:
        command (str): Interactive cec-client command, e.g. "on 0",
                       "standby 0", "pow 0", "volup", "mute", etc.

    Returns:
        str: stdout from cec-client, or empty string on timeout/error.
    """
    with _cec_lock:
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
    """Wake the display from standby.

    CEC command: on 0 — sends Image View On to logical address 0 (TV).

    Returns:
        JSON: {"success": true, "action": "on"}
    """
    output = run_cec("on 0")
    if output is not None:
        return jsonify({"success": True, "action": "on"})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


@app.route("/display/off", methods=["POST"])
def display_off():
    """Put the display into standby.

    CEC command: standby 0 — sends Standby to logical address 0 (TV).

    Returns:
        JSON: {"success": true, "action": "off"}
    """
    output = run_cec("standby 0")
    if output is not None:
        return jsonify({"success": True, "action": "off"})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


@app.route("/display/status", methods=["GET"])
def display_status():
    """Query the current power state of the display.

    CEC command: pow 0 — sends Give Device Power Status to the TV;
    the TV replies with its current power state in the cec-client output.

    Returns:
        JSON: {"power_state": "<on|standby|unknown|error>"}
    """
    output = run_cec("pow 0")
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
    output = run_cec("tx 1F:82:" + addr)
    if output is not None:
        return jsonify({"success": True, "action": "input", "input": number})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


@app.route("/display/volume/up", methods=["POST"])
def volume_up():
    """Increase the TV volume by one step.

    CEC command: volup (User Control Pressed Volume Up + Released).

    Returns:
        JSON: {"success": true, "action": "volume_up"}
    """
    output = run_cec("volup")
    if output is not None:
        return jsonify({"success": True, "action": "volume_up"})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


@app.route("/display/volume/down", methods=["POST"])
def volume_down():
    """Decrease the TV volume by one step.

    CEC command: voldown (User Control Pressed Volume Down + Released).

    Returns:
        JSON: {"success": true, "action": "volume_down"}
    """
    output = run_cec("voldown")
    if output is not None:
        return jsonify({"success": True, "action": "volume_down"})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


@app.route("/display/volume/mute", methods=["POST"])
def volume_mute():
    """Toggle mute on the TV.

    CEC command: mute (User Control Pressed Mute + Released).

    Returns:
        JSON: {"success": true, "action": "volume_mute"}
    """
    output = run_cec("mute")
    if output is not None:
        return jsonify({"success": True, "action": "volume_mute"})
    return jsonify({"success": False, "error": "cec-client failed"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

