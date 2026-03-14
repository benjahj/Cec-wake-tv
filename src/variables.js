/**
 * variables.js — Companion Variable Definitions
 * ==============================================
 * Registers the dynamic variables exposed by this module.
 * Variables can be used in button labels, triggers, and expressions
 * anywhere in Companion using the $(instanceLabel:variableId) syntax.
 *
 * Usage example in a button label:
 *   "Display: $(stagedisplaycec:power_state)"
 *
 * The variable value is set in main.js via:
 *   self.setVariableValues({ power_state: state })
 *
 * It is updated:
 *   - Every 10 seconds when the poll succeeds.
 *   - Immediately after any action completes and the post-action poll succeeds.
 *   - When the error threshold is reached (set to 'error').
 *
 * Possible values:
 *   'on'       — Display is powered on
 *   'standby'  — Display is in standby mode
 *   'unknown'  — CEC bus responded but state was not recognised
 *   'error'    — Pi bridge unreachable (after ERROR_THRESHOLD failed polls)
 *
 * @param {ModuleInstance} self - The module instance (from main.js).
 */
module.exports = function (self) {
	self.setVariableDefinitions([
		{
			variableId: 'power_state',
			name: 'Display Power State',
			// Note: the initial value is set when _setPowerState() is first
			// called after the initial poll in _startPolling().
		},
	])
}

