const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')

const POLL_INTERVAL_MS = 10000  // 10 s — CEC is slow, 5 s caused overlapping polls
const ERROR_THRESHOLD = 3       // consecutive failures before showing ConnectionFailure

class ModuleInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.powerState = 'unknown'
		this._pollTimer = null
		this._pollBusy = false      // prevents overlapping polls
		this._errorCount = 0        // debounce transient errors
	}

	async init(config) {
		this.config = config

		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()

		this._startPolling()
	}

	async destroy() {
		this._stopPolling()
		this.log('debug', 'Stage Display CEC module destroyed')
	}

	async configUpdated(config) {
		this.config = config
		this._stopPolling()
		this._startPolling()
	}

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

	_baseUrl() {
		const host = (this.config?.host || '').trim()
		const port = this.config?.port || 5000
		return `http://${host}:${port}`
	}

	_hostConfigured() {
		return !!(this.config?.host || '').trim()
	}

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
			// Refresh status after command only if a poll is not already running
			if (!this._pollBusy) {
				await this._pollStatus()
			}
		} catch (err) {
			this.log('error', `HTTP error sending '${action}': ${err.message}`)
			this._handleError()
		}
	}

	async _pollStatus() {
		if (!this._hostConfigured()) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}
		if (this._pollBusy) return   // skip — previous poll still running
		this._pollBusy = true

		const url = `${this._baseUrl()}/display/status`
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const body = await res.json()
			const state = body.power_state || 'unknown'
			this._errorCount = 0
			this._setPowerState(state)
			this.updateStatus(InstanceStatus.Ok)
		} catch (err) {
			this.log('warn', `Poll failed: ${err.message}`)
			this._handleError()
		} finally {
			this._pollBusy = false
		}
	}

	_handleError() {
		this._errorCount++
		if (this._errorCount >= ERROR_THRESHOLD) {
			this._setPowerState('error')
			this.updateStatus(InstanceStatus.ConnectionFailure, 'Cannot reach Raspberry Pi')
		}
		// Below threshold: stay in current state — transient hiccup
	}

	_setPowerState(state) {
		if (this.powerState !== state) {
			this.powerState = state
			this.setVariableValues({ power_state: state })
			this.checkFeedbacks('display_is_on', 'display_is_standby')
			this.log('debug', `Display power state: ${state}`)
		}
	}

	_startPolling() {
		if (!this._hostConfigured()) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}
		this.updateStatus(InstanceStatus.Connecting)
		this._errorCount = 0
		this._pollBusy = false
		this._pollStatus()  // immediate first poll
		this._pollTimer = setInterval(() => this._pollStatus(), POLL_INTERVAL_MS)
	}

	_stopPolling() {
		if (this._pollTimer) {
			clearInterval(this._pollTimer)
			this._pollTimer = null
		}
	}

	// -------------------------------------------------------------------------

	updateActions() { UpdateActions(this) }
	updateFeedbacks() { UpdateFeedbacks(this) }
	updateVariableDefinitions() { UpdateVariableDefinitions(this) }
}

runEntrypoint(ModuleInstance, [])

