// ===== Configuration & Constants =====
const MQTT_CONFIG = {
    brokerUrl: 'wss://broker.hivemq.com:8884/mqtt',
    topics: {
        cmd: "orca/skripsi/cmd",
        mode: "orca/skripsi/mode",
        web: "orca/skripsi/web",
        car: "orca/skripsi/car/status",
        esp32: "orca/skripsi/esp32/status"
    }
}

const COMMAND_INTERVAL = 100
const DEADZONE_ANGLE = 30
const PAD_MAX_ANGLE = 90
const GAUGE_MAX_ANGLE = 180
const ESP32_DATA_TIMEOUT = 3000 // ms

const ICON_LIGHT_ON = "💡"
const ICON_LIGHT_OFF = /* html */ `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor"
    class="bi bi-lightbulb-off" viewBox="0 0 16 16">
    <path fill-rule="evenodd"
        d="M2.23 4.35A6 6 0 0 0 2 6c0 1.691.7 3.22 1.826 4.31.203.196.359.4.453.619l.762 1.769A.5.5 0 0 0
        5.5 13a.5.5 0 0 0 0 1 .5.5 0 0 0 0 1l.224.447a1 1 0 0 0 .894.553h2.764a1 1 0 0 0 .894-.553L10.5
        15a.5.5 0 0 0 0-1 .5.5 0 0 0 0-1 .5.5 0 0 0 .288-.091L9.878 12H5.83l-.632-1.467a3 3 0 0 0-.676-.941
        4.98 4.98 0 0 1-1.455-4.405zm1.588-2.653.708.707a5 5 0 0 1 7.07 7.07l.707.707a6 6 0 0
        0-8.484-8.484zm-2.172-.051a.5.5 0 0 1 .708 0l12 12a.5.5 0 0 1-.708.708l-12-12a.5.5 0 0 1 0-.708"/>
</svg>`

const COMMAND_ICONS = { 'F': '⬆️', 'B': '⬇️', 'L': '⬅️', 'R': '➡️' }

const CONTROL_BUTTONS_DATA = [
    { id: "forwardBtn", command: "F", icon: "⬆️" },
    { id: "backwardBtn", command: "B", icon: "⬇️" },
    { id: "leftBtn", command: "L", icon: "⬅️" },
    { id: "rightBtn", command: "R", icon: "➡️" }
]

const GAUGE_ZONES = [
    { strokeStyle: "#2874a6", min: -180, max: -90 },
    { strokeStyle: "#3498db", min: -90, max: -30 },
    { strokeStyle: "#dcdcdc", min: -30, max: 30 },
    { strokeStyle: "#3498db", min: 30, max: 90 },
    { strokeStyle: "#2874a6", min: 90, max: 180 }
]

const GAUGE_OPTIONS = {
    angle: -0.25,
    lineWidth: 0.2,
    radiusScale: 0.9,
    pointer: { length: 0.5, strokeWidth: 0.03, color: '#333333' },
    limitMax: true,
    limitMin: true,
    strokeColor: '#E0E0E0',
    highDpiSupport: true,
}

const GAUGE_TEXT_COLORS = {
    NEUTRAL: '#333333',
    ACTIVE: '#3498db',
    OUTER: '#2874a6'
}


// ===== Application State =====
let mqttClient = null
let isLightOn = false
let repeatCommandIntervalId = null
let lockedCommandIntervalId = null
let lockedButtonId = null
let rollGauge = null
let pitchGauge = null
let areGaugesInitialized = false
let rollValueEl, pitchValueEl
let rollAnimationId = null
let pitchAnimationId = null
let isCarOnline = false
let isEsp32Online = false
let esp32DataTimeoutId = null


// ===== DOM Elements (will be assigned after DOM loads) =====
let controlsArea, gestureToggle, gestureToggleLabel, lockToggle, lockIcon, lockText,
    feedbackDisplay, lightBtn, lightIcon, hornBtn, orientationPad, orientationCard,
    padIndicator, padIcons, connectionStatus, statusDot, statusText, middleControlsWrapper


// ===== Core Functions =====
function initMQTT() {
    mqttClient = mqtt.connect(MQTT_CONFIG.brokerUrl)

    mqttClient.on('connect', () => {
        console.log("MQTT Connected")
        mqttClient.subscribe(Object.values(MQTT_CONFIG.topics)) // Subscribe to all topics at once
        updateConnectionStatus()
    })

    mqttClient.on('error', (err) => {
        console.error("MQTT Error:", err)
        updateConnectionStatus()
    })

    mqttClient.on('close', () => {
        console.log("MQTT Connection Closed")
        updateConnectionStatus()
    })

    mqttClient.on('message', handleMqttMessage)
}

function sendCommand(char) {
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(MQTT_CONFIG.topics.cmd, char)
    }
}

function publishGestureMode(isInGestureMode) {
    const payload = isInGestureMode ? "gesture" : "manual"
    mqttClient.publish(MQTT_CONFIG.topics.mode, payload, { retain: true })
}

function stopAllCommands() {
    clearInterval(lockedCommandIntervalId)
    clearInterval(repeatCommandIntervalId)
    lockedCommandIntervalId = null
    repeatCommandIntervalId = null

    if (lockedButtonId) {
        document.getElementById(lockedButtonId)?.classList.remove("btn-locked")
        lockedButtonId = null
    }
    sendCommand("S")
    updateFeedbackDisplay("")
}


// ===== UI Update Functions =====
function updateGestureModeUI(isInGestureMode) {
    controlsArea.classList.toggle('gesture-mode-active', isInGestureMode)

    if (isInGestureMode) {
        if (!areGaugesInitialized) {
            setTimeout(() => {
                initGauges()
                areGaugesInitialized = true
            }, 0) // Ensure the canvas is rendered first
        }

        setTimeout(syncDashboardHeights, 50)
    } else {
        if (middleControlsWrapper) {
            middleControlsWrapper.style.height = null
        }
    }
}

function updateGestureToggleLabel() {
    const isInGestureMode = gestureToggle.checked
    gestureToggleLabel.textContent = isInGestureMode ? "Gesture Mode" : "Manual Mode"
    feedbackDisplay.classList.toggle("manual-mode", !isInGestureMode) // Add class for manual mode
}

function updateLockUI() {
    const isLocked = lockToggle.checked
    lockIcon.textContent = isLocked ? "🔒" : "🔓"
    lockText.textContent = isLocked ? "Locked" : "Unlocked"
    lockToggle.setAttribute('aria-checked', isLocked)
}

function updateFeedbackDisplay(icon) {
    feedbackDisplay.textContent = icon || "🔄️"
    feedbackDisplay.style.color = icon ? "#ecf0f1" : "transparent"
}

function updateOrientationDisplay(data) {
    if (rollValueEl) {
        animateValue('rollAnimationId', rollValueEl, data.roll)
        updateValueColor(rollValueEl, data.roll)
    }

    if (pitchValueEl) {
        animateValue('pitchAnimationId', pitchValueEl, data.pitch)
        updateValueColor(pitchValueEl, data.pitch)
    }
}

function update2DPad(roll, pitch) {
    const isActive = Math.abs(roll) > DEADZONE_ANGLE || Math.abs(pitch) > DEADZONE_ANGLE
    padIndicator.classList.toggle('indicator-active', isActive)
    updateIconHighlight(roll, pitch)

    const clampedRoll = Math.max(-PAD_MAX_ANGLE, Math.min(PAD_MAX_ANGLE, roll))
    const clampedPitch = Math.max(-PAD_MAX_ANGLE, Math.min(PAD_MAX_ANGLE, pitch))

    const xPos = 50 - (clampedRoll / PAD_MAX_ANGLE) * 50
    const yPos = 50 + (clampedPitch / PAD_MAX_ANGLE) * 50

    padIndicator.style.left = `${xPos}%`
    padIndicator.style.top = `${yPos}%`
}

function updateIconHighlight(roll, pitch) {
    Object.values(padIcons).forEach(icon => icon.classList.remove('icon-active'))

    // Activate icons based on roll and pitch
    if (pitch < -DEADZONE_ANGLE && pitch >= -PAD_MAX_ANGLE) padIcons.up.classList.add('icon-active')
    else if (pitch > DEADZONE_ANGLE && pitch <= PAD_MAX_ANGLE) padIcons.down.classList.add('icon-active')

    if (roll > DEADZONE_ANGLE && roll <= PAD_MAX_ANGLE) padIcons.left.classList.add('icon-active')
    else if (roll < -DEADZONE_ANGLE && roll >= -PAD_MAX_ANGLE) padIcons.right.classList.add('icon-active')
}

function resetGestureDisplays() {
    stopAllCommands() // stop all commands when esp32 goes offline
    updateOrientationDisplay({ roll: 0, pitch: 0 }) // reset roll and pitch values

    if (areGaugesInitialized) { // reset gauges
        rollGauge.set(0)
        pitchGauge.set(0)
    }

    update2DPad(0, 0) // reset pad indicator position
}


// ===== Gauge and Height Sync Functions =====
function createGauge(elementId, range) {
    const gaugeEl = document.getElementById(elementId)
    if (!gaugeEl) return null

    // Create new Gauge
    const finalOptions = { ...GAUGE_OPTIONS, staticZones: GAUGE_ZONES }

    const gauge = new Gauge(gaugeEl).setOptions(finalOptions)
    gauge.maxValue = range
    gauge.setMinValue(-range)
    gauge.set(0)
    return gauge
}

function initGauges() {
    rollGauge = createGauge('roll-gauge', GAUGE_MAX_ANGLE)
    pitchGauge = createGauge('pitch-gauge', GAUGE_MAX_ANGLE)
}

function updateValueColor(textElement, value) {
    const absValue = Math.abs(value) // Use absolute value for color logic

    if (absValue > 90) {
        textElement.style.color = GAUGE_TEXT_COLORS.OUTER
    } else if (absValue > 30) {
        textElement.style.color = GAUGE_TEXT_COLORS.ACTIVE
    } else {
        textElement.style.color = GAUGE_TEXT_COLORS.NEUTRAL
    }
}

function syncDashboardHeights() {
    if (gestureToggle.checked && orientationPad && orientationCard && middleControlsWrapper) {
        const padHeight = orientationPad.offsetHeight
        orientationCard.style.height = `${padHeight}px`
        middleControlsWrapper.style.height = `${padHeight}px`
    }
}


// ===== Event Handlers =====
function handleControlPress(button, buttonId, command, icon) {
    const isLockMode = lockToggle.checked
    if (isLockMode) {
        if (lockedButtonId === buttonId) {
            stopAllCommands()
        } else {
            stopAllCommands()
            sendCommand(command)
            lockedCommandIntervalId = setInterval(() => sendCommand(command), COMMAND_INTERVAL)
            lockedButtonId = buttonId
            button.classList.add("btn-locked")
            updateFeedbackDisplay(icon)
        }
    } else {
        clearInterval(repeatCommandIntervalId)
        sendCommand(command)
        repeatCommandIntervalId = setInterval(() => sendCommand(command), COMMAND_INTERVAL)
        updateFeedbackDisplay(icon)
    }
}

function handleControlRelease() {
    if (!lockToggle.checked && repeatCommandIntervalId) {
        stopAllCommands()
    }
}

function handleMqttMessage(topic, message) {
    const payload = message.toString()

    if (topic === MQTT_CONFIG.topics.mode) { // Handle different topics
        const isInGestureMode = payload === "gesture"
        gestureToggle.checked = isInGestureMode
        updateGestureModeUI(isInGestureMode)
        updateGestureToggleLabel()

    } else if (topic === MQTT_CONFIG.topics.web) { // Handle web data
        // === WATCHDOG LOGIC START ===
        clearTimeout(esp32DataTimeoutId)

        esp32DataTimeoutId = setTimeout(() => {
            isEsp32Online = false
            resetGestureDisplays()
            updateConnectionStatus()
        }, ESP32_DATA_TIMEOUT)

        isEsp32Online = true
        // === WATCHDOG LOGIC END ===

        try { // process web data
            const data = JSON.parse(payload)

            // Validate data structure
            const isDataValid = typeof data.roll === 'number' && isFinite(data.roll) &&
                typeof data.pitch === 'number' && isFinite(data.pitch)

            if (isDataValid) { // Update UI with valid data
                updateOrientationDisplay(data)
                update2DPad(data.roll, data.pitch)
                if (rollGauge) rollGauge.set(data.roll)
                if (pitchGauge) pitchGauge.set(data.pitch)
            } else { // Log warning for invalid data
                console.warn("Received invalid sensor data:", data)
            }

        } catch (err) {
            console.error("JSON Parse Error:", err)
        }

    } else if (topic === MQTT_CONFIG.topics.cmd) { // Handle command feedback
        if (gestureToggle.checked) {
            const icon = COMMAND_ICONS[payload] || ""
            updateFeedbackDisplay(icon)
        }

    } else if (topic === MQTT_CONFIG.topics.esp32) { // Handle ESP32 status
        const wasOnline = isEsp32Online
        isEsp32Online = (payload === 'online')
        console.log(`ESP32 status is now: ${isEsp32Online ? 'Online' : 'Offline'}`)

        if (wasOnline && !isEsp32Online) { // If ESP32 went offline
            resetGestureDisplays()
        }
        updateConnectionStatus()

    } else if (topic === MQTT_CONFIG.topics.car) { // Handle car status
        isCarOnline = (payload === 'online')
        console.log(`Car status is now: ${isCarOnline ? 'Online' : 'Offline'}`)
        updateConnectionStatus()
    }
}

function animateValue(stateKey, element, endValue) {
    // Clear any existing animation frame
    if (window[stateKey]) {
        cancelAnimationFrame(window[stateKey])
    }

    const startValue = parseFloat(element.textContent) || 0
    const duration = 300 // ms
    let startTime = null

    // this function called on each animation frame
    const step = (currentTime) => {
        if (!startTime) {
            startTime = currentTime
        }

        const elapsedTime = currentTime - startTime
        const progress = Math.min(elapsedTime / duration, 1)

        const displayValue = startValue + (endValue - startValue) * progress
        element.textContent = displayValue.toFixed(1)

        // if the animation is not complete, request the next frame
        if (progress < 1) {
            window[stateKey] = requestAnimationFrame(step)
        } else {
            // make sure the final value is set
            element.textContent = endValue.toFixed(1)
            window[stateKey] = null
        }
    }

    // start the animation
    window[stateKey] = requestAnimationFrame(step)
}

function updateConnectionStatus() {
    if (!mqttClient || !mqttClient.connected) { // If MQTT client is not connected
        connectionStatus.className = 'status-disconnected'
        statusText.textContent = 'Disconnected'
        isEsp32Online = false
        isCarOnline = false
        clearTimeout(esp32DataTimeoutId)
        return
    }

    const isInGestureMode = gestureToggle.checked // check gesture toggle state

    if (isInGestureMode) { // gesture mode logic
        if (!isEsp32Online) {
            connectionStatus.className = 'status-waiting'
            statusText.textContent = 'Waiting for ESP32-C3'

        } else if (!isCarOnline) {
            connectionStatus.className = 'status-waiting'
            statusText.textContent = 'Waiting for RC Car'

        } else {
            connectionStatus.className = 'status-connected'
            statusText.textContent = 'Connected'
        }
    } else { // manual mode logic
        if (!isCarOnline) {
            connectionStatus.className = 'status-waiting'
            statusText.textContent = 'Waiting for RC Car'
        } else {
            connectionStatus.className = 'status-connected'
            statusText.textContent = 'Connected'
        }
    }
}


// ===== Application Start =====
document.addEventListener('DOMContentLoaded', () => {
    // 1. Assign DOM elements to variables
    controlsArea = document.querySelector('.controls-area')
    gestureToggle = document.getElementById("gestureToggle")
    gestureToggleLabel = document.getElementById("gestureToggleLabel")
    rollValueEl = document.getElementById("roll-value")
    pitchValueEl = document.getElementById("pitch-value")
    lockToggle = document.getElementById("lockToggle")
    lockIcon = document.querySelector("#lockToggleLabel .lock-icon")
    lockText = document.querySelector("#lockToggleLabel .lock-text")
    feedbackDisplay = document.getElementById("feedbackDisplay")
    lightBtn = document.getElementById("lightBtn")
    lightIcon = document.getElementById("lightIcon")
    hornBtn = document.getElementById("hornBtn")
    orientationPad = document.querySelector('.orientation-pad')
    orientationCard = document.querySelector('.card-orientation-dashboard')
    padIndicator = document.getElementById('pad-indicator')
    padIcons = {
        up: document.getElementById('icon-up'),
        down: document.getElementById('icon-down'),
        left: document.getElementById('icon-left'),
        right: document.getElementById('icon-right')
    }
    connectionStatus = document.getElementById("connectionStatus")
    statusDot = connectionStatus.querySelector(".status-dot")
    statusText = connectionStatus.querySelector(".status-text")
    middleControlsWrapper = document.querySelector('.middle-controls-wrapper')

    // 2. Set up event listeners
    gestureToggle.addEventListener("change", () => {
        setTimeout(stopAllCommands, 600) // stop all commands in 600ms

        const isInGestureMode = gestureToggle.checked
        updateGestureToggleLabel()
        publishGestureMode(isInGestureMode)
        updateGestureModeUI(isInGestureMode)
        updateConnectionStatus()
    })

    lockToggle.addEventListener("change", () => {
        updateLockUI()
        stopAllCommands()
    })

    lightBtn.addEventListener("click", () => {
        isLightOn = !isLightOn
        sendCommand(isLightOn ? "W" : "w")
        lightIcon.innerHTML = isLightOn ? ICON_LIGHT_OFF : ICON_LIGHT_ON
    })

    hornBtn.addEventListener("click", () => sendCommand("V"))

    // Set up control buttons
    CONTROL_BUTTONS_DATA.forEach(buttonData => {
        const buttonElement = document.getElementById(buttonData.id)
        if (buttonElement) {
            const pressHandler = (e) => {
                e.preventDefault()
                if (gestureToggle.checked) return
                handleControlPress(buttonElement, buttonData.id, buttonData.command, buttonData.icon)
            }

            const releaseHandler = (e) => {
                e.preventDefault()
                if (gestureToggle.checked) return
                handleControlRelease()
            }

            buttonElement.addEventListener("pointerdown", pressHandler)
            buttonElement.addEventListener("pointerup", releaseHandler)
            buttonElement.addEventListener("pointerleave", releaseHandler)
        }
    })

    // Set up window resize listener
    let resizeTimer
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(syncDashboardHeights, 100)
    })

    // 3. Initialize the application
    initMQTT()
    updateLockUI()
    updateGestureToggleLabel()
    updateFeedbackDisplay("")
    updateConnectionStatus()
})