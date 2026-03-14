/**
 * feedbacks.js — Companion Feedback Definitions
 * ==============================================
 * Registers boolean feedbacks that change button appearance based on the
 * current display power state (self.powerState).
 *
 * Feedbacks are re-evaluated by Companion whenever self.checkFeedbacks() is
 * called. This happens in two places in main.js:
 *  1. After every successful /display/status poll (up to every 10 seconds).
 *  2. Immediately after any action completes and the post-action poll succeeds.
 *
 * Both feedbacks read the same property (self.powerState) but check for
 * different values, allowing separate visual states for ON and STANDBY.
 *
 * @param {ModuleInstance} self - The module instance (from main.js).
 */

const { combineRgb } = require('@companion-module/base')

module.exports = function (self) {
	self.setFeedbackDefinitions({

		/**
		 * display_is_on
		 * Active when the display is fully powered on (power_state === 'on').
		 * Default style: bright green background with white text.
		 * Assign this feedback to a "Display On" button to show it's lit when on.
		 */
		display_is_on: {
			name: 'Display is ON',
			description: 'Button lights up green when the display power state is on',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 180, 0),    // green
				color: combineRgb(255, 255, 255),  // white text
			},
			options: [],
			callback: () => {
				return self.powerState === 'on'
			},
		},

		/**
		 * display_is_standby
		 * Active when the display is in standby (power_state === 'standby').
		 * Default style: amber/orange background with white text.
		 * Assign this feedback to a "Display Off" button to show standby state.
		 */
		display_is_standby: {
			name: 'Display is in Standby',
			description: 'Button lights up orange when the display power state is standby',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(180, 100, 0),  // amber/orange
				color: combineRgb(255, 255, 255),  // white text
			},
			options: [],
			callback: () => {
				return self.powerState === 'standby'
			},
		},
	})
}

