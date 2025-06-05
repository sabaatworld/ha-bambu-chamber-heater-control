// MQTT and control configuration
let mqttTopic = "shelly-anvil-chamber-heater/set_temperature_threshold"; // MQTT topic for temperature threshold
let targetTemp = 0; // Default threshold temperature (heater off)
let lastMqttUpdate = 0; // Timestamp of last MQTT update
let hysteresis = 1; // Temperature hysteresis in °C to prevent rapid switching
let lastUpdateTime = Shelly.getComponentStatus("sys").uptime; // Initialize timer with current system uptime
let temperatureSensorComponentIds = ['temperature:100', 'temperature:101']; // Array of temperature sensor IDs

// Script parameters
let timerInterval = 5000; // Control loop interval in milliseconds
let failSafeTimeout = 600; // MQTT communication timeout in seconds
let maxTempDelta = 20; // Maximum allowed temperature difference between sensors in °C
let maxTargetTemp = 60; // Maximum allowed target temperature in °C

console.log("Script initialized. Default target temperature:", targetTemp);

/**
 * Calculates time elapsed since last MQTT update
 * @returns {number} Elapsed time in seconds
 */
function getElapsedTime() {
    let currentTime = Shelly.getComponentStatus("sys").uptime;
    let elapsed = currentTime >= lastUpdateTime ? (currentTime - lastUpdateTime) : 0;
    console.log("Elapsed time since last MQTT update:", elapsed, "seconds");
    return elapsed;
}

/**
 * Resets the MQTT update timer
 */
function resetTimer() {
    lastUpdateTime = Shelly.getComponentStatus("sys").uptime;
    console.log("Timer reset. New lastUpdateTime:", lastUpdateTime);
}

/**
 * Reads and processes temperature from sensors
 * @param {Function} callback - Callback function to handle the temperature value
 */
function getTemperature(callback) {
    let tempReadings = [];

    console.log("Fetching temperature readings from sensors...");

    // Attempt to read from each configured sensor
    for (let i = 0; i < temperatureSensorComponentIds.length; i++) {
        let sensorId = temperatureSensorComponentIds[i];
        try {
            let temp = Shelly.getComponentStatus(sensorId).tC;
            // Validate temperature reading
            if (temp !== undefined && !isNaN(temp)) {
                console.log("Sensor " + i + " (" + sensorId + ") Temperature:", temp, "°C");
                tempReadings.push(temp);
            } else {
                console.log("Error reading Sensor " + i + " (" + sensorId + "): Invalid reading");
            }
        } catch (e) {
            console.log("Error reading Sensor " + i + " (" + sensorId + "):", e);
        }
    }

    // Handle different scenarios based on available readings
    if (tempReadings.length === 0) {
        // No valid readings available
        console.log("No valid temperature readings available!");
        callback(null);
        return;
    }

    if (tempReadings.length === 1) {
        // Single sensor mode
        console.log("Only one sensor reading available. Using single sensor value:", tempReadings[0], "°C");
        callback(tempReadings[0]);
        return;
    }

    // Dual sensor mode
    if (tempReadings.length === 2) {
        let temp1 = tempReadings[0];
        let temp2 = tempReadings[1];

        // Check if temperature difference exceeds maximum allowed delta
        if (Math.abs(temp1 - temp2) >= maxTempDelta) {
            let maxTemp = Math.max(temp1, temp2);
            console.log("Temperature difference exceeds max delta. Using max value:", maxTemp, "°C");
            callback(maxTemp);
        } else {
            // Calculate average when readings are within acceptable range
            let avgTemp = (temp1 + temp2) / 2;
            console.log("Temperature difference within max delta. Using average:", avgTemp, "°C");
            callback(avgTemp);
        }
    }
}

/**
 * Main heater control function
 * Handles temperature reading and heater state management
 */
function controlHeater() {
    let relayState = Shelly.getComponentStatus("switch", 0).output;
    console.log("Checking heater control. Relay state:", relayState);

    // Safety check: Turn off heater if MQTT timeout or target temperature is 0
    if (getElapsedTime() > failSafeTimeout || targetTemp === 0) {
        console.log("MQTT failed or threshold is 0. Ensuring heater is OFF.");
        if (relayState) {
            console.log("Turning heater OFF.");
            Shelly.call("Switch.set", { id: 0, on: false });
        }
        return;
    }

    // Get current temperature and control heater
    getTemperature(function (temp) {
        // Safety check: Turn off heater if no valid temperature readings
        if (temp === null) {
            console.log("No valid temperature readings. Turning heater OFF for safety.");
            Shelly.call("Switch.set", { id: 0, on: false });
            return;
        }

        // Temperature control logic with hysteresis
        console.log("Deciding heater state with Temperature:", temp, "Threshold:", targetTemp);
        if (temp < targetTemp - hysteresis && !relayState) {
            // Turn on heater if temperature is below threshold minus hysteresis
            console.log("Temperature below threshold. Turning heater ON.");
            Shelly.call("Switch.set", { id: 0, on: true });
        } else if (temp >= targetTemp + hysteresis && relayState) {
            // Turn off heater if temperature is above threshold plus hysteresis
            console.log("Temperature above threshold. Turning heater OFF.");
            Shelly.call("Switch.set", { id: 0, on: false });
        } else {
            console.log("No change needed.");
        }
    });
}

// Subscribe to MQTT messages for temperature threshold updates
MQTT.subscribe(mqttTopic, function (topic, message) {
    console.log("MQTT message received:", message);
    let newThreshold = parseFloat(message);
    if (!isNaN(newThreshold)) {
        // Limit target temperature to maximum allowed value
        targetTemp = newThreshold > maxTargetTemp ? maxTargetTemp : newThreshold;
        resetTimer();
        console.log("Updated threshold from MQTT:", targetTemp, "°C and reset timer");
    } else {
        console.log("Invalid MQTT message received:", message);
    }
});

// Start the control loop
console.log("Starting control loop with interval of " + timerInterval + " ms.");
Timer.set(timerInterval, true, controlHeater);
