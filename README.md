# iobroker-eup-wican
ioBroker JavaScript scripts for retrieving and processing VW e-up! charging data via OBD (tested with "WiCAN PRO" by MeatPi electronics) and publishing it over MQTT.

## Use at your very own risk!

This project is provided “as is”, without warranty of any kind. Incorrect use of OBD commands, vehicle interfaces, MQTT configurations, or ioBroker scripts may cause communication errors, unexpected vehicle behavior, data loss, battery drain, or damage to vehicle components.

The scripts are intended for read-only data retrieval. Do not use them to send write commands to the vehicle unless you fully understand the possible consequences.

The author assumes no responsibility or liability for any damage, malfunction, data loss, costs, or other consequences resulting from the use of this project. By using these scripts, you accept full responsibility for all associated risks.

## Configure WiCAN

The following WiCAN settings are used by these scripts. Menu names may differ slightly between firmware versions.

### Network

In **Settings > AP Config**, select **AP+Station** mode and configure the station connection for your home Wi-Fi network. This allows WiCAN to remain accessible through its own access point while also connecting to the MQTT broker on your local network.

### MQTT

Configure the MQTT broker address, port, security settings, and credentials for your installation. Use a private or otherwise trusted broker; do not expose the vehicle interface through a public MQTT broker.

Use matching topics for the three WiCAN CAN states, for example:

```text
TX Topic:     wican/MY_ID/can/tx
RX Topic:     wican/MY_ID/can/rx
Status Topic: wican/MY_ID/can/status
```

Enable the checkboxes next to both **TX Topic** and **RX Topic**. The resulting ioBroker state IDs must match `txState`, `rxState`, and `statusState` in your build configuration. For an ioBroker MQTT instance named `mqtt.0`, the TX topic above normally appears as `mqtt.0.wican.MY_ID.can.tx`.

Leave **MQTT CAN Filter** empty. The scripts send the required diagnostic requests and decode the received CAN responses themselves.

### CAN

The tested setup uses the unchanged WiCAN CAN defaults shown below:

- CAN Bitrate: `500K`
- CAN Mode: `Normal`
- Port Type: `TCP`
- TCP/UDP Port: `35000`
- Protocol: `AutoPID`
- MQTT: `Enable`

### Automation

Automation is completely disabled in the tested setup. No vehicle-specific PID or additional MQTT topic is configured there. These features may be useful for other WiCAN applications, but they are not required by the scripts in this repository.

## Manual setup

For a simple installation, copy the three core files from `scripts/` into the ioBroker JavaScript adapter:

- `01_wican_polling.js`
- `02_wican_decoder.js`
- `03_evcc_cp_state.js`

The three core scripts handle polling and decoding. To expose their decoded vehicle states over MQTT, copy `04_evcc_mqtt_publish.js` as well. Its primary purpose is to make this data available to EVCC, using either the same broker as WiCAN or a separate broker.

In each copied script, edit only the installation-specific fields between these markers:

```js
// BUILD-CONFIG-START
// BUILD-CONFIG-END
```

Replace the example WiCAN state IDs, state root, MQTT instance, and topic root as applicable. The scripts are otherwise self-contained and can be enabled directly in ioBroker.

For installations that need multiple or repeatedly generated configurations, `build.js` provides an automated alternative as described in the next section.

## Build configured scripts

The build requires Node.js and has no additional dependencies.

1. Copy `config/example.cjs` to a new file such as `config/my-car.cjs`.
2. Replace the example values with the ioBroker states, MQTT instance, and MQTT topic used by your installation.
3. Run the build from the repository root:

   ```sh
   node build.js
   ```

Every `config/*.cjs` file produces a separate set of scripts under `built/<config-name>/`. For example, `config/my-car.cjs` produces `built/my-car/*.js`. Existing files in that output directory are overwritten. Local configuration files and generated scripts are excluded from Git; only `config/example.cjs` is tracked.

## Available vehicle data

The decoder creates the following ioBroker state tree below the configured `stateRoot`:

```text
<stateRoot>
|-- SOC                                      Displayed state of charge [%]
|-- online                                   WiCAN connection state [boolean]
|-- lastUpdate                               Last decoded value update [Unix timestamp in ms]
|-- battery
|   |-- socAbsolute                          Absolute BMS state of charge [%]
|   |-- voltage                              High-voltage battery voltage [V]
|   |-- current                              Battery current [A], positive while discharging
|   |-- power                                Calculated power [kW], positive while discharging
|   |-- temperature                          High-voltage battery temperature [°C]
|   `-- cells
|       |-- voltageMax                       Highest cell voltage [V]
|       |-- voltageMaxIndex                  Cell number with the highest voltage
|       |-- voltageMin                       Lowest cell voltage [V]
|       |-- voltageMinIndex                  Cell number with the lowest voltage
|       |-- voltageDelta                     Difference between highest and lowest cell [V]
|       `-- voltageDeltaMillivolt            Difference between highest and lowest cell [mV]
|-- charging
|   |-- active                               Charging active [boolean]
|   |-- mode                                 Charging mode: 0 = off, 1 = AC, 4 = DC
|   |-- modeText                             Human-readable charging mode
|   |-- plugged                              Charging plug connected [boolean]
|   |-- locked                               Charging plug locked [boolean]
|   |-- socketStatusRaw                      Raw charging socket status
|   |-- socketTemperatureAc                  AC socket temperature [°C]
|   |-- socketTemperatureDc                  DC socket temperature [°C]
|   |-- cpState                              EVCC control-pilot state: A, B, or C
|   `-- cpStateText                          Human-readable control-pilot state
`-- counters
    |-- chargedAh                            Cumulative charged capacity [Ah]
    |-- dischargedAh                         Cumulative discharged capacity [Ah]
    |-- chargedKWh                           Cumulative charged energy [kWh]
    `-- dischargedKWh                        Cumulative discharged energy [kWh]
```

The CP states are derived from the connection, plug, lock, and charging-mode states. In this implementation, `A` means not fully connected and locked, `B` means connected but not actively charging, and `C` means connected and actively charging.

Static states are created with default values when the decoder starts. Their presence alone does not confirm that a current vehicle response has been received; use `online` and `lastUpdate` to assess availability and freshness.

The decoder also supports dynamic individual-cell states named `battery.cells.individual.cell001` through `cell102`. The polling script does not currently request these DIDs, so these states are only created if matching responses are supplied separately.

### MQTT topic tree

The MQTT publishing script mirrors every state below `stateRoot` under `topicRoot`. It removes the ioBroker root and converts the remaining dot-separated path to MQTT topic levels:

```text
ioBroker:  0_userdata.0.MY_CAR.battery.voltage
MQTT:      MY_CAR/battery/voltage

ioBroker:  0_userdata.0.MY_CAR.charging.cpState
MQTT:      MY_CAR/charging/cpState
```

With the default script settings, existing values are published when the MQTT script starts, later changes are published automatically, and messages use the MQTT retain flag. Additional states placed below the configured `stateRoot` are mirrored as well.

## Configure EVCC

1. In EVCC, open **Configuration > Integrations**, enable MQTT, and connect EVCC to the broker used by `04_evcc_mqtt_publish.js` if this has not already been configured.
2. Open **Configuration > Vehicles**, add a vehicle, and select **Custom device**.
3. Use the following configuration as a starting point:

```yaml
title: e-up
icon: car
capacity: 32 # kWh

## required attributes

soc: # state of charge
  source: mqtt
  topic: MY_CAR/SOC

## optional attributes (read-only)

# limitsoc: # in-vehicle charge limit
#   source: const
#   value: 80 # %
status: # status [A..F]
  source: mqtt
  topic: MY_CAR/charging/cpState
# range: # range
#   source: const
#   value: 123 # km
# climater: # climate active
#   source: const
#   value: true
# getmaxcurrent: # max charge current
#   source: const
#   value: 16.0 # A
# finishtime: # finish time (RFC3339)
#   source: const
#   value: "2030-01-01T00:00:00Z"

## optional attributes (writeable)

# wakeup: # wake up vehicle
#   source: js
#   script: console.log(wakeup);
# chargeenable: # start/stop charging
#   source: js
#   script: console.log(chargeenable);
# maxcurrent: # set max charge current
#   source: js
#   script: console.log(maxcurrent);
```

4. Adjust the `soc` and `status` topics according to your configured `topicRoot` in `04_evcc_mqtt_publish.js`. Save the vehicle configuration and restart EVCC. The e-Up should then report its state of charge and connection status through MQTT.
