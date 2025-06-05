# Bambu Lab P1S XIC Chamber Heater Control Using Home Assistant

This document is intended to supplement the chamber heater setup shown on https://makerworld.com/en/models/1382144-p1s-diy-dual-chamber-heater-bracket-remix.

## Prerequisites

1. A working Home Assistant instance.
2. Plugin https://github.com/greghesp/ha-bambulab installed.
3. Your Bambu Lab printer configured using the above plugin. The code pieces below assume your printer's device name is `P1S`. If it's something different, you can simply search and replace `p1s` in entity IDs with something else.
4. You are using a Shelly 1 or Shelly 1PM to control your chamber heater.
   1. The scripts below assume that there are two DS18B20 temperature sensors connected to your Shelly device using the Shelly add-on.
   2. MQTT must be set up on your Shelly device to use the same MQTT server as Home Assistant.
5. Your Shelly device must be integrated into Home Assistant using the official plugin.

## Steps to Automate Chamber Heating

### Step 1: Update Print Start GCODE

Update the printer's start GCODE to pause the print just after bed leveling is completed. This will ensure that the print does not start before the chamber is heated fully. We will write Home Assistant automations to resume the print once the chamber is heated. Below is a snippet of the start GCODE.

```gcode
...
M623
;===== bed leveling end ================================

;===== Wait for Chamber Temperature ==================================
{if filament_type[initial_extruder]=="ABS" || filament_type[initial_extruder]=="ASA" || filament_type[initial_extruder]=="HIPS"}
    M400 U1 ; will be resumed by Home Assistant
{endif}
;===== Wait for Chamber Temperature End ================================

;===== home after wipe mouth============================
M1002 judge_flag g29_before_print_flag
M622 J0
...
```

### Step 2: Create Helpers in Home Assistant

1. Create a helper for tracking the current chamber temperature. This will be used by other HA automations.
    * Type: Template Sensor
    * Name: P1S Chamber Temperature
    * Unit of Measurement: °C
    * Template (use entity IDs of the temperature sensors exposed by Shelly HA integration)
        ```jinja
        {{ ((states('sensor.p1s_chamber_inner_temperature_temperature') | float) + (states('sensor.p1s_chamber_outer_temperature_temperature') | float)) / 2 }}
        ```

2. Create a helper for tracking the target chamber temperature. Here you can define what the heater's target temperature will be.
    * Type: Template Sensor
    * Name: P1S Chamber Target Temperature
    * Unit of Measurement: °C
    * Template
        ```jinja
        {{ 60 if not (
        is_state('sensor.p1s_print_type', 'idle') or
        is_state('sensor.p1s_print_type', 'unknown')
        ) and (
        is_state_attr('sensor.p1s_active_tray', 'type', 'ABS') or
        is_state_attr('sensor.p1s_active_tray', 'type', 'ASA') or
        is_state_attr('sensor.p1s_active_tray', 'type', 'HIPS') or
        is_state('sensor.p1s_bed_target_temperature', '100')
        ) else 0 }}
        ```

### Step 3: Create Automation in Home Assistant to Send Target Temperature to Shelly

Create an automation named `P1S Publish to Chamber Heater`. This will periodically send target temperature to Shelly using MQTT. It will send `0` to turn off the heaters.

```yml
alias: P1S Publish to Chamber Heater
description: ""
triggers:
  - trigger: time_pattern
    minutes: /1
  - trigger: state
    entity_id:
      - sensor.p1s_chamber_target_temperature
    from: null
    to: null
conditions: []
actions:
  - action: mqtt.publish
    metadata: {}
    data:
      topic: shelly-p1s-chamber-heater/set_temperature_threshold
      payload: "{{ states('sensor.p1s_chamber_target_temperature') | round(0) }}"
mode: single
```

### Step 4: Create Automation to Resume Print When Chamber is Heated

This automation named `P1S Wait For Chamber Temperature` will keep track of the current chamber temperature and resume your paused print when chamber temperature is reached.

```yml
alias: P1S Wait For Chamber Temperature
description: ""
triggers:
  - entity_id:
      - sensor.p1s_print_status
    to: pause
    trigger: state
  - seconds: /10
    trigger: time_pattern
conditions:
  - condition: or
    conditions:
      - condition: state
        entity_id: sensor.p1s_active_tray
        attribute: type
        state: ABS
      - condition: state
        entity_id: sensor.p1s_active_tray
        attribute: type
        state: ASA
      - condition: state
        entity_id: sensor.p1s_active_tray
        attribute: type
        state: HIPS
  - condition: state
    entity_id: sensor.p1s_current_layer
    state: "0"
  - condition: state
    entity_id: sensor.p1s_current_stage
    state: auto_bed_leveling
  - condition: state
    entity_id: sensor.p1s_print_status
    state: pause
  - condition: numeric_state
    entity_id: sensor.p1s_chamber_temperature
    above: sensor.p1s_chamber_target_temperature
actions:
  - metadata: {}
    data: {}
    target:
      entity_id: button.p1s_resume_printing
    action: button.press
mode: single
```

### Step 5: Add Script to Shelly to Control Heater

Add the script [heater_control.js](heater_control.js) from this repository to your Shelly device. Start and test the script. Inspect the debug console logs below the script editor. Once you are satisfied that the script is working as expected, set the script to `Run on startup`.

**This script has the following features:**

1. **Core Function**: Controls a chamber heater for a Bambu Lab 3D printer via a Shelly device, maintaining target temperatures received through MQTT from Home Assistant.

2. **Temperature Management**: Reads from up to two temperature sensors, using either a single reading or intelligently averaging/selecting between dual sensors, with hysteresis control to prevent rapid switching.

3. **Safety Features**: Implements multiple safeguards including automatic shutdown if MQTT communication fails (600s timeout), temperature readings are invalid, or readings between sensors differ significantly (>20°C).

4. **MQTT Integration**: Subscribes to a specific topic to receive target temperature updates from Home Assistant, with a configurable maximum temperature limit (60°C) to prevent overheating.

5. **Error Handling**: Gracefully handles sensor failures by logging errors, using available readings when possible, and defaulting to a safe state (heater off) when no valid temperature data is available.

## Starting Prints

When starting prints on your Bambu Lab printer, all you need to do is to ensure that you use the printer profile with the custom GCODE. The printer will execute the startup procedure and pause after bed leveling. The chamber will start heating as soon as the print job is started. Once the desired temperature is reached, the print will start automatically.

In case you are printing directly from MakerWorld or unable to use custom start GCODE, the only difference would be that the print would start without waiting for the chamber temperature.
