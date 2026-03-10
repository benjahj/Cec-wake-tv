module.exports = function (self) {
	self.setActionDefinitions({
		display_on: {
			name: 'Display On',
			description: 'Wake the LG display via HDMI-CEC',
			options: [],
			callback: async () => {
				await self.sendCecCommand('on')
			},
		},

		display_off: {
			name: 'Display Off',
			description: 'Put the LG display into standby via HDMI-CEC',
			options: [],
			callback: async () => {
				await self.sendCecCommand('off')
			},
		},
	})
}

