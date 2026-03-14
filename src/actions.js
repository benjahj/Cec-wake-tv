/**
 * actions.js — Companion Action Definitions
 * =========================================
 * Registers all actions that can be assigned to Stream Deck buttons or
 * triggered from Companion's button grid / triggers system.
 *
 * Each action calls self.sendCecCommand(path), which:
 *  1. POSTs to http://<pi-host>:<port>/display/<path>
 *  2. The Pi bridge translates the path into a cec-client command.
 *  3. After the command, the module re-polls /display/status to update state.
 *
 * Pi endpoint mapping:
 *  Action          → POST path           → cec-client command
 *  ─────────────────────────────────────────────────────────────
 *  display_on      → /display/on         → on 0
 *  display_off     → /display/off        → standby 0
 *  set_input (1)   → /display/input/1    → tx 1F:82:10:00
 *  set_input (2)   → /display/input/2    → tx 1F:82:20:00
 *  set_input (3)   → /display/input/3    → tx 1F:82:30:00
 *  set_input (4)   → /display/input/4    → tx 1F:82:40:00
 *  volume_up       → /display/volume/up  → volup
 *  volume_down     → /display/volume/down→ voldown
 *  volume_mute     → /display/volume/mute→ mute
 *
 * @param {ModuleInstance} self - The module instance (from main.js).
 */
module.exports = function (self) {
	self.setActionDefinitions({

		// -----------------------------------------------------------------
		// Power control
		// -----------------------------------------------------------------

		display_on: {
			name: 'Display On',
			description: 'Wake the display from standby via HDMI-CEC (CEC command: on 0)',
			options: [],
			callback: async () => {
				// CEC logical address 0 = TV. 'on 0' wakes it from standby.
				await self.sendCecCommand('on')
			},
		},

		display_off: {
			name: 'Display Off',
			description: 'Put the display into standby via HDMI-CEC (CEC command: standby 0)',
			options: [],
			callback: async () => {
				// 'standby 0' sends a CEC Standby message to the TV (logical address 0).
				await self.sendCecCommand('off')
			},
		},

		// -----------------------------------------------------------------
		// HDMI input switching
		// -----------------------------------------------------------------

		set_input: {
			name: 'Set HDMI Input',
			description: 'Switch the TV to a specific HDMI input (1–4) using CEC Active Source (opcode 0x82)',
			options: [
				{
					type: 'dropdown',
					id: 'input',
					label: 'HDMI Input',
					default: '1',
					choices: [
						{ id: '1', label: 'HDMI 1' },  // Physical address 10:00
						{ id: '2', label: 'HDMI 2' },  // Physical address 20:00
						{ id: '3', label: 'HDMI 3' },  // Physical address 30:00
						{ id: '4', label: 'HDMI 4' },  // Physical address 40:00
					],
				},
			],
			callback: async (action) => {
				// action.options.input is the string '1', '2', '3', or '4'
				// The Pi bridge converts the number to the correct CEC physical address.
				await self.sendCecCommand(`input/${action.options.input}`)
			},
		},

		// -----------------------------------------------------------------
		// Volume control
		// -----------------------------------------------------------------

		volume_up: {
			name: 'Volume Up',
			description: 'Increase TV volume by one step via HDMI-CEC (CEC shortcut: volup)',
			options: [],
			callback: async () => {
				await self.sendCecCommand('volume/up')
			},
		},

		volume_down: {
			name: 'Volume Down',
			description: 'Decrease TV volume by one step via HDMI-CEC (CEC shortcut: voldown)',
			options: [],
			callback: async () => {
				await self.sendCecCommand('volume/down')
			},
		},

		volume_mute: {
			name: 'Volume Mute / Unmute',
			description: 'Toggle mute on the TV via HDMI-CEC (CEC shortcut: mute)',
			options: [],
			callback: async () => {
				await self.sendCecCommand('volume/mute')
			},
		},
	})
}

