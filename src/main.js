/**
 * main.js — Stage Display CEC Companion Module
 * =============================================
 * Entry point for the companion-module-stagedisplay-cec module.
 *
 * Responsibilities:
 *  - Manage the module lifecycle (init, destroy, configUpdated).
 *  - Periodically poll the Raspberry Pi Flask bridge for display power state.
 *  - Send CEC commands (power, input, volume) via HTTP POST to the Pi bridge.
 *  - Update Companion status, variables, and feedbacks based on poll results.
 *
 * Architecture:
 *  Companion → HTTP (fetch) → Pi Flask bridge (app.py) → cec-client → display
 *
 * Stability design:
 *  - Poll guard (_pollBusy): prevents concurrent overlapping HTTP polls.
 *  - Error debounce (_errorCount / ERROR_THRESHOLD): avoids flickering on
 *    transient network failures — only escalates to ConnectionFailure after
 *    ERROR_THRESHOLD consecutive failed polls.
 *  - Host validation: shows BadConfig immediately if host is unconfigured
 *    rather than crashing with a confusing URL error.
 */

const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')

/**
 * How often (in milliseconds) the module polls /display/status.
 * Set to 10 000 ms (10 s) because cec-client can take 5–15 s to respond,
 * meaning a shorter interval would cause polls to stack up.
 */
const POLL_INTERVAL_MS = 10000

/**
 * Number of consecutive poll failures required before the module transitions
 * to InstanceStatus.ConnectionFailure. This debounces transient errors
 * (e.g. a single dropped packet) so the Companion UI doesn't flicker.
 * At 10 s per poll, 3 failures ≈ ~30 seconds of silence before showing red.
 */
const ERROR_THRESHOLD = 3

class ModuleInstance extends InstanceBase {
	constructor(internal) {
		super(internal)

		/** @type {string} Last known CEC power state: 'on' | 'standby' | 'unknown' | 'error' */
		this.powerState = 'unknown'

		/** @type {NodeJS.Timeout|null} Handle for the setInterval polling timer */
		this._pollTimer = null

		/**
		 * Poll guard flag. Set to true while a /display/status fetch is in flight.
		 * If the interval fires while this is true, the new poll is skipped to
		 * prevent concurrent overlapping requests to the slow Pi bridge.
		 * @type {boolean}
		 */
		this._pollBusy = false

		/**
		 * Consecutive error counter used for debouncing. Incremented on each
		 * failed poll; reset to 0 on the first successful poll.
		 * @type {number}
		 */
		this._errorCount = 0
	}

	/**
	 * Called once by Companion when the module instance is created or re-enabled.
	 * Registers all actions/feedbacks/variables and starts the polling loop.
	 * @param {object} config - The user-supplied configuration (host, port).
	 */
	async init(config) {
		this.config = config

		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()

		this._startPolling()
	}

	/**
	 * Called by Companion when the module instance is disabled or removed.
	 * Always stop the polling timer here to avoid memory leaks and phantom requests.
	 */
	async destroy() {
		this._stopPolling()
		this.log('debug', 'Stage Display CEC module destroyed')
	}

	/**
	 * Called by Companion when the user saves new connection settings.
	 * Restarts the polling loop so the new host/port takes effect immediately.
	 * @param {object} config - The updated configuration.
	 */
	async configUpdated(config) {
		this.config = config
		this._stopPolling()
		this._startPolling()
	}

	/**
	 * Returns the connection settings fields shown in the Companion UI.
	 * These values are stored in this.config and passed to init/configUpdated.
	 * @returns {Array} Companion config field definitions.
	 */
	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Raspberry Pi IP / Hostname',
				width: 8,
				default: '',
			},
			{
				type: 'number',
				id: 'port',
				label: 'Port',
				width: 4,
				default: 5000,
				min: 1,
				max: 65535,
			},
		]
	}

	// -------------------------------------------------------------------------
	// HTTP helpers
	// -------------------------------------------------------------------------

	/**
	 * Builds the base URL for the Pi Flask bridge from the current config.
	 * Example: "http://10.0.100.81:5000"
	 * @returns {string}
	 */
	_baseUrl() {
		const host = (this.config?.host || '').trim()
		const port = this.config?.port || 5000
		return `http://${host}:${port}`
	}

	/**
	 * Returns true if a non-empty host has been entered in the config.
	 * Used to guard all network operations — avoids HTTP requests to "http://:5000".
	 * @returns {boolean}
	 */
	_hostConfigured() {
		return !!(this.config?.host || '').trim()
	}

	/**
	 * Sends a CEC command to the Pi bridge via HTTP POST and handles the response.
	 *
	 * Called by every action callback in actions.js.
	 *
	 * After a successful POST the module re-polls /display/status to immediately
	 * reflect the new state in feedbacks and variables — but only if no poll is
	 * already in progress (_pollBusy guard) to avoid request stacking.
	 *
	 * Timeout is 15 s because CEC power/input commands can take longer than a
	 * simple status query.
	 *
	 * @param {string} action - The URL path suffix after /display/.
	 *   Examples: 'on', 'off', 'input/2', 'volume/up'
	 */
	async sendCecCommand(action) {
		if (!this._hostConfigured()) {
			this.log('warn', 'No host configured — cannot send CEC command')
			return
		}
		const url = `${this._baseUrl()}/display/${action}`
		try {
			const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15000) })
			const body = await res.json()
			if (!body.success) {
				this.log('warn', `CEC command '${action}' returned failure: ${JSON.stringify(body)}`)
			} else {
				this.log('debug', `CEC command '${action}' sent OK`)
			}
			// Refresh status after command only if a poll is not already in flight.
			// This gives the UI an immediate update without racing concurrent requests.
			if (!this._pollBusy) {
				await this._pollStatus()
			}
		} catch (err) {
			this.log('error', `HTTP error sending '${action}': ${err.message}`)
			this._handleError()
		}
	}

	/**
	 * Polls the Pi bridge's /display/status endpoint and updates powerState.
	 *
	 * Poll guard: if _pollBusy is true, this method returns immediately without
	 * making a network request. This prevents setInterval from stacking up
	 * concurrent fetches when the Pi is slow to respond.
	 *
	 * On success:  resets _errorCount, updates powerState, sets status to Ok.
	 * On failure:  calls _handleError() to increment _errorCount.
	 * Always:      releases _pollBusy in the finally block.
	 */
	async _pollStatus() {
		if (!this._hostConfigured()) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}
		if (this._pollBusy) return   // skip — previous poll still in flight
		this._pollBusy = true

		const url = `${this._baseUrl()}/display/status`
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const body = await res.json()
			const state = body.power_state || 'unknown'
			this._errorCount = 0        // reset debounce counter on success
			this._setPowerState(state)
			this.updateStatus(InstanceStatus.Ok)
		} catch (err) {
			this.log('warn', `Poll failed: ${err.message}`)
			this._handleError()
		} finally {
			// Always release the lock, even if an exception was thrown
			this._pollBusy = false
		}
	}

	/**
	 * Error debounce handler.
	 *
	 * Increments _errorCount on each failure. Only escalates to
	 * InstanceStatus.ConnectionFailure once ERROR_THRESHOLD is reached.
	 * Below the threshold the module stays in its current state — useful
	 * for riding out brief network blips without alarming the operator.
	 */
	_handleError() {
		this._errorCount++
		if (this._errorCount >= ERROR_THRESHOLD) {
			this._setPowerState('error')
			this.updateStatus(InstanceStatus.ConnectionFailure, 'Cannot reach Raspberry Pi')
		}
		// Below threshold: stay in current state — transient hiccup, do nothing yet
	}

	/**
	 * Updates the internal powerState and propagates it to Companion.
	 *
	 * Only triggers variable/feedback updates when the state actually changes
	 * to avoid redundant Companion UI refreshes on every poll.
	 *
	 * @param {string} state - New power state value ('on' | 'standby' | 'unknown' | 'error').
	 */
	_setPowerState(state) {
		if (this.powerState !== state) {
			this.powerState = state
			// Update the $(stagedisplaycec:power_state) variable
			this.setVariableValues({ power_state: state })
			// Re-evaluate display_is_on and display_is_standby feedback conditions
			this.checkFeedbacks('display_is_on', 'display_is_standby')
			this.log('debug', `Display power state changed to: ${state}`)
		}
	}

	/**
	 * Starts (or restarts) the polling loop.
	 *
	 * If no host is configured, immediately sets BadConfig and returns without
	 * scheduling any polls.
	 *
	 * Otherwise:
	 *  1. Sets status to Connecting.
	 *  2. Resets debounce counters.
	 *  3. Fires an immediate first poll so status updates without waiting 10 s.
	 *  4. Sets up a repeating interval for subsequent polls.
	 */
	_startPolling() {
		if (!this._hostConfigured()) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}
		this.updateStatus(InstanceStatus.Connecting)
		this._errorCount = 0
		this._pollBusy = false
		this._pollStatus()  // immediate first poll — don't wait for the interval
		this._pollTimer = setInterval(() => this._pollStatus(), POLL_INTERVAL_MS)
	}

	/**
	 * Stops the polling interval and clears the timer reference.
	 * Safe to call multiple times — no-op if polling is already stopped.
	 */
	_stopPolling() {
		if (this._pollTimer) {
			clearInterval(this._pollTimer)
			this._pollTimer = null
		}
	}

	// -------------------------------------------------------------------------
	// Delegation to sub-modules
	// -------------------------------------------------------------------------

	/** Registers all action definitions from actions.js */
	updateActions() { UpdateActions(this) }

	/** Registers all feedback definitions from feedbacks.js */
	updateFeedbacks() { UpdateFeedbacks(this) }

	/** Registers all variable definitions from variables.js */
	updateVariableDefinitions() { UpdateVariableDefinitions(this) }
}

runEntrypoint(ModuleInstance, [])

