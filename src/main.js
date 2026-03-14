const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')

const POLL_INTERVAL_MS = 5000

class ModuleInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.powerState = 'unknown'
		this._pollTimer = null
	}

	async init(config) {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting)

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
		const host = this.config?.host || ''
		const port = this.config?.port || 5000
		return `http://${host}:${port}`
	}

	async sendCecCommand(action) {
		const url = `${this._baseUrl()}/display/${action}`
		try {
			const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10000) })
			const body = await res.json()
			if (!body.success) {
				this.log('warn', `CEC command '${action}' returned failure: ${JSON.stringify(body)}`)
			} else {
				this.log('debug', `CEC command '${action}' sent OK`)
			}
			// Refresh status immediately after command
			await this._pollStatus()
		} catch (err) {
			this.log('error', `HTTP error sending '${action}': ${err.message}`)
			this._setStatus('error')
		}
	}

	async _pollStatus() {
		const url = `${this._baseUrl()}/display/status`
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const body = await res.json()
			const state = body.power_state || 'unknown'
			this._setPowerState(state)
			this.updateStatus(InstanceStatus.Ok)
		} catch (err) {
			this.log('warn', `Poll failed: ${err.message}`)
			this._setStatus('error')
		}
	}

	_setPowerState(state) {
		if (this.powerState !== state) {
			this.powerState = state
			this.setVariableValues({ power_state: state })
			this.checkFeedbacks('display_is_on', 'display_is_standby')
			this.log('debug', `Display power state: ${state}`)
		}
	}

	_setStatus(type) {
		if (type === 'error') {
			this.powerState = 'error'
			this.setVariableValues({ power_state: 'error' })
			this.checkFeedbacks('display_is_on', 'display_is_standby')
			this.updateStatus(InstanceStatus.ConnectionFailure, 'Cannot reach Raspberry Pi')
		}
	}

	_startPolling() {
		this._pollStatus() // immediate first poll
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

