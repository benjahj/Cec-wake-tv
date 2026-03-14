module.exports = function (self) {
	self.setActionDefinitions({
		display_on: {
			name: 'Display On',
			description: 'Wake the display via HDMI-CEC',
			options: [],
			callback: async () => {
				await self.sendCecCommand('on')
			},
		},

		display_off: {
			name: 'Display Off',
			description: 'Put the display into standby via HDMI-CEC',
			options: [],
			callback: async () => {
				await self.sendCecCommand('off')
			},
		},

		set_input: {
			name: 'Set HDMI Input',
			description: 'Switch the TV to a specific HDMI input (1–4)',
			options: [
				{
					type: 'dropdown',
					id: 'input',
					label: 'HDMI Input',
					default: '1',
					choices: [
						{ id: '1', label: 'HDMI 1' },
						{ id: '2', label: 'HDMI 2' },
						{ id: '3', label: 'HDMI 3' },
						{ id: '4', label: 'HDMI 4' },
					],
				},
			],
			callback: async (action) => {
				await self.sendCecCommand(`input/${action.options.input}`)
			},
		},

		volume_up: {
			name: 'Volume Up',
			description: 'Increase TV volume by one step via HDMI-CEC',
			options: [],
			callback: async () => {
				await self.sendCecCommand('volume/up')
			},
		},

		volume_down: {
			name: 'Volume Down',
			description: 'Decrease TV volume by one step via HDMI-CEC',
			options: [],
			callback: async () => {
				await self.sendCecCommand('volume/down')
			},
		},

		volume_mute: {
			name: 'Volume Mute / Unmute',
			description: 'Toggle mute on the TV via HDMI-CEC',
			options: [],
			callback: async () => {
				await self.sendCecCommand('volume/mute')
			},
		},
	})
}

