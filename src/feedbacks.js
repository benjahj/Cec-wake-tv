const { combineRgb } = require('@companion-module/base')

module.exports = function (self) {
	self.setFeedbackDefinitions({
		display_is_on: {
			name: 'Display is ON',
			description: 'Button lights up when the display power state is on',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 180, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => {
				return self.powerState === 'on'
			},
		},

		display_is_standby: {
			name: 'Display is in Standby',
			description: 'Button lights up when the display power state is standby',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(180, 100, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => {
				return self.powerState === 'standby'
			},
		},
	})
}

