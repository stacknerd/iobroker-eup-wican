/* Script overview:
 * Decodes VW e-Up UDS responses received through a WiCAN MQTT bridge.
 * Reassembles ISO-TP messages, interprets supported diagnostic values,
 * and stores normalized vehicle data below the configured ioBroker state root.
 * Diagnostic requests are sent independently by the polling script.
 */

const CONFIG = {
    // BUILD-CONFIG-START
    rxState: 'mqtt.0.wican.MY_ID.can.rx', // WiCAN CAN receive state.
    txState: 'mqtt.0.wican.MY_ID.can.tx', // WiCAN CAN transmit state.
    statusState: 'mqtt.0.wican.MY_ID.can.status', // WiCAN connection status state.
    stateRoot: '0_userdata.0.MY_CAR', // Root path for processed vehicle states.
    // BUILD-CONFIG-END
    logging: {
        values: true, // Log successfully decoded values.
        rawRx: false, // Log every received MQTT message.
        rawFrames: false, // Log every received CAN frame.
        unknownDid: false, // Log unknown UDS responses.
        isoTp: false, // Log ISO-TP processing details.
        flowControl: false, // Log transmitted ISO-TP flow-control frames.
        warnings: true, // Log warning messages.
        errors: true // Log error messages.
    },

    isoTpTimeoutMs: 3000 // Timeout for incomplete ISO-TP responses.
};


/* ===================================
 *          State Definitions
 * ===================================*/

const STATES = {
    soc: {
        id: 'SOC',
        name: 'e-Up Batterie SOC',
        type: 'number',
        role: 'value.battery',
        unit: '%',
        def: 0
    },

    socAbsolute: {
        id: 'battery.socAbsolute',
        name: 'Absoluter BMS SOC',
        type: 'number',
        role: 'value.battery',
        unit: '%',
        def: 0
    },

    batteryVoltage: {
        id: 'battery.voltage',
        name: 'HV-Batteriespannung',
        type: 'number',
        role: 'value.voltage',
        unit: 'V',
        def: 0
    },

    batteryCurrent: {
        id: 'battery.current',
        name: 'HV-Batteriestrom',
        type: 'number',
        role: 'value.current',
        unit: 'A',
        def: 0
    },

    batteryPower: {
        id: 'battery.power',
        name: 'HV-Batterieleistung',
        type: 'number',
        role: 'value.power',
        unit: 'kW',
        def: 0
    },

    batteryTemperature: {
        id: 'battery.temperature',
        name: 'HV-Batterietemperatur',
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
        def: 0
    },

    cellVoltageMax: {
        id: 'battery.cells.voltageMax',
        name: 'Höchste Zellspannung',
        type: 'number',
        role: 'value.voltage',
        unit: 'V',
        def: 0
    },

    cellVoltageMin: {
        id: 'battery.cells.voltageMin',
        name: 'Niedrigste Zellspannung',
        type: 'number',
        role: 'value.voltage',
        unit: 'V',
        def: 0
    },

    cellVoltageDelta: {
        id: 'battery.cells.voltageDelta',
        name: 'Zellspannungsdifferenz',
        type: 'number',
        role: 'value.voltage',
        unit: 'V',
        def: 0
    },

    cellVoltageDeltaMv: {
        id: 'battery.cells.voltageDeltaMillivolt',
        name: 'Zellspannungsdifferenz',
        type: 'number',
        role: 'value',
        unit: 'mV',
        def: 0
    },

    chargeMode: {
        id: 'charging.mode',
        name: 'Lademodus',
        type: 'number',
        role: 'value',
        unit: '',
        def: 0
    },

    chargeModeText: {
        id: 'charging.modeText',
        name: 'Lademodus als Text',
        type: 'string',
        role: 'text',
        unit: '',
        def: 'nicht ladend'
    },

    charging: {
        id: 'charging.active',
        name: 'Ladevorgang aktiv',
        type: 'boolean',
        role: 'indicator',
        unit: '',
        def: false
    },

    chargePlugged: {
        id: 'charging.plugged',
        name: 'Ladestecker gesteckt',
        type: 'boolean',
        role: 'indicator',
        unit: '',
        def: false
    },

    chargeLocked: {
        id: 'charging.locked',
        name: 'Ladestecker verriegelt',
        type: 'boolean',
        role: 'indicator',
        unit: '',
        def: false
    },

    chargeSocketStatusRaw: {
        id: 'charging.socketStatusRaw',
        name: 'Ladebuchsenstatus Rohwert',
        type: 'number',
        role: 'value',
        unit: '',
        def: 0
    },

    chargeSocketTemperatureAc: {
        id: 'charging.socketTemperatureAc',
        name: 'Temperatur AC-Ladebuchse',
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
        def: 0
    },

    chargeSocketTemperatureDc: {
        id: 'charging.socketTemperatureDc',
        name: 'Temperatur DC-Ladebuchse',
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
        def: 0
    },

    energyChargedAh: {
        id: 'counters.chargedAh',
        name: 'Gesamt geladene Kapazität',
        type: 'number',
        role: 'value',
        unit: 'Ah',
        def: 0
    },

    energyDischargedAh: {
        id: 'counters.dischargedAh',
        name: 'Gesamt entladene Kapazität',
        type: 'number',
        role: 'value',
        unit: 'Ah',
        def: 0
    },

    energyChargedKwh: {
        id: 'counters.chargedKWh',
        name: 'Gesamt geladene Energie',
        type: 'number',
        role: 'value.energy',
        unit: 'kWh',
        def: 0
    },

    energyDischargedKwh: {
        id: 'counters.dischargedKWh',
        name: 'Gesamt entladene Energie',
        type: 'number',
        role: 'value.energy',
        unit: 'kWh',
        def: 0
    },

    online: {
        id: 'online',
        name: 'WiCAN online',
        type: 'boolean',
        role: 'indicator.connected',
        unit: '',
        def: false
    },

    lastUpdate: {
        id: 'lastUpdate',
        name: 'Letzte empfangene BMS-Aktualisierung',
        type: 'number',
        role: 'date',
        unit: '',
        def: 0
    },

    cellVoltageMaxIndex: {
        id: 'battery.cells.voltageMaxIndex',
        name: 'Zelle mit höchster Spannung',
        type: 'number',
        role: 'value',
        unit: '',
        def: 0
    },

    cellVoltageMinIndex: {
        id: 'battery.cells.voltageMinIndex',
        name: 'Zelle mit niedrigster Spannung',
        type: 'number',
        role: 'value',
        unit: '',
        def: 0
    },
};


/* ===================================
 *            Runtime State
 * ===================================*/

const isoTpSessions = new Map();

let lastCellVoltageMax = null;
let lastCellVoltageMin = null;

let rxProcessingQueue = Promise.resolve();
let udsMessageCounter = 0;


/* ===================================
 *            Initialization
 * ===================================*/

initializeStates()
    .then(async () => {
        subscribeRx();
        subscribeStatus();

        await initializeStatus();

        logMessage(
            'values',
            `WiCAN-RX-Auswertung gestartet: ${CONFIG.rxState}`
        );
    })
    .catch(error => {
        logMessage(
            'errors',
            `Initialisierung fehlgeschlagen: ${error.message}`,
            'error'
        );
    });

// Create all statically defined output states below the configured root.
async function initializeStates() {
    for (const definition of Object.values(STATES)) {
        const fullId = getStateId(definition.id);

        await createStateAsync(
            fullId,
            definition.def,
            {
                name: definition.name,
                type: definition.type,
                role: definition.role,
                unit: definition.unit,
                read: true,
                write: false
            }
        );
    }
}

// Read and publish the initial WiCAN online state.
async function initializeStatus() {
    const status = await getStateAsync(CONFIG.statusState);

    if (!status) {
        await setStateAsync(
            getStateId(STATES.online.id),
            false,
            true
        );

        return;
    }

    await updateOnlineStatus(status.val);
}

// Normalize and store a WiCAN connection-state update.
async function updateOnlineStatus(rawValue) {
    const online = parseOnlineStatus(rawValue);

    await setStateAsync(
        getStateId(STATES.online.id),
        online,
        true
    );

    logMessage(
        'values',
        `${getStateId(STATES.online.id)} = ${online}`
    );
}

// Subscribe to raw CAN messages received through the WiCAN MQTT state.
function subscribeRx() {
    on(
        {
            id: CONFIG.rxState,
            change: 'any'
        },
        obj => {
            const rawValue = obj.state.val;

            rxProcessingQueue = rxProcessingQueue
                .then(() => processRxMessage(rawValue))
                .catch(error => {
                    logMessage(
                        'errors',
                        `Fehler bei der RX-Verarbeitung: ${
                            error.stack || error.message
                        }`,
                        'error'
                    );
                });
        }
    );
}

// Subscribe to WiCAN connection-state changes.
function subscribeStatus() {
    on(
        {
            id: CONFIG.statusState,
            change: 'any'
        },
        async obj => {
            try {
                await updateOnlineStatus(obj.state.val);
            } catch (error) {
                logMessage(
                    'errors',
                    `WiCAN-Status konnte nicht verarbeitet werden: ${error.message}`,
                    'error'
                );
            }
        }
    );
}


/* ===================================
 *         MQTT and CAN Input
 * ===================================*/

// Parse one MQTT payload and process every CAN frame it contains.
async function processRxMessage(rawValue) {
    logMessage('rawRx', `RX MQTT: ${stringifySafe(rawValue)}`);

    const payload = typeof rawValue === 'string'
        ? JSON.parse(rawValue)
        : rawValue;

    const frames = extractFrames(payload);

    if (frames.length === 0) {
        logMessage(
            'warnings',
            `RX-Nachricht enthält keinen CAN-Frame: ${stringifySafe(payload)}`,
            'warn'
        );
        return;
    }

    for (const frame of frames) {
        await processCanFrame(frame);
    }
}

// Extract the supported frame-array variants from a WiCAN payload.
function extractFrames(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.frame)) {
        return payload.frame;
    }

    if (payload?.frame && typeof payload.frame === 'object') {
        return [payload.frame];
    }

    if (payload && payload.id !== undefined && payload.data !== undefined) {
        return [payload];
    }

    return [];
}

// Validate and route one raw CAN frame into ISO-TP processing.
async function processCanFrame(frame) {
    const canId = parseCanId(frame.id);
    const data = normalizeData(frame.data);

    if (!Number.isFinite(canId) || data.length === 0) {
        logMessage(
            'warnings',
            `Ungültiger CAN-Frame: ${stringifySafe(frame)}`,
            'warn'
        );
        return;
    }

    logMessage(
        'rawFrames',
        `CAN RX 0x${canId.toString(16).toUpperCase()}: ${toHex(data)}`
    );

    const udsMessage = processIsoTpFrame(canId, data);

    if (!udsMessage) {
        return;
    }

    await processUdsMessage(canId, udsMessage);
}


/* ===================================
 *          ISO-TP Processing
 * ===================================
 *
 * Supported ISO - TP frame types:
 * 0x0x = Single Frame
 * 0x1x = First Frame
 * 0x2x = Consecutive Frame
 *
 * Multi-frame responses require a Flow Control frame after the First Frame.
 * This decoder sends that frame through the configured WiCAN transmit state.
 */

// Process one ISO-TP frame and return a complete UDS payload when available.
function processIsoTpFrame(canId, frameData) {
    const pciType = frameData[0] >> 4;

    // Single Frame
    if (pciType === 0x0) {
        const payloadLength = frameData[0] & 0x0F;

        return frameData.slice(
            1,
            Math.min(1 + payloadLength, frameData.length)
        );
    }

    // First Frame
    if (pciType === 0x1) {
        if (frameData.length < 2) {
            return null;
        }

        const totalLength =
            ((frameData[0] & 0x0F) << 8) |
            frameData[1];

        const session = {
            totalLength,
            data: frameData.slice(2),
            nextSequence: 1,
            updatedAt: Date.now()
        };

        isoTpSessions.set(canId, session);

        logMessage(
            'isoTp',
            `ISO-TP Start 0x${canId.toString(16).toUpperCase()}, ` +
            `${totalLength} Bytes erwartet`
        );

        // Allow the ECU to send the remaining ISO-TP Consecutive Frames.
        sendIsoTpFlowControl(canId).catch(error => {
            logMessage(
                'errors',
                `Flow Control für 0x${canId
                    .toString(16)
                    .toUpperCase()} konnte nicht gesendet werden: ` +
                `${error.message}`,
                'error'
            );
        });

        return completeIsoTpSession(canId);
    }

    // Consecutive Frame
    if (pciType === 0x2) {
        const session = isoTpSessions.get(canId);

        if (!session) {
            logMessage(
                'warnings',
                `ISO-TP Folgeframe ohne Start von ` +
                `0x${canId.toString(16).toUpperCase()}`,
                'warn'
            );
            return null;
        }

        if (Date.now() - session.updatedAt > CONFIG.isoTpTimeoutMs) {
            isoTpSessions.delete(canId);

            logMessage(
                'warnings',
                `ISO-TP-Session für 0x${canId.toString(16).toUpperCase()} ` +
                `ist abgelaufen`,
                'warn'
            );

            return null;
        }

        const sequence = frameData[0] & 0x0F;
        const expected = session.nextSequence & 0x0F;

        if (sequence !== expected) {
            isoTpSessions.delete(canId);

            logMessage(
                'warnings',
                `Falsche ISO-TP-Sequenz von ` +
                `0x${canId.toString(16).toUpperCase()}: ` +
                `${sequence}, erwartet ${expected}`,
                'warn'
            );

            return null;
        }

        session.data.push(...frameData.slice(1));
        session.nextSequence = (session.nextSequence + 1) & 0x0F;
        session.updatedAt = Date.now();

        return completeIsoTpSession(canId);
    }

    // Flow Control frames do not contain UDS response data.
    if (pciType === 0x3) {
        logMessage(
            'isoTp',
            `ISO-TP Flow Control von 0x${canId.toString(16).toUpperCase()}`
        );

        return null;
    }

    // Accept payloads where WiCAN already removed the ISO-TP PCI byte.
    if (frameData[0] === 0x62 || frameData[0] === 0x7F) {
        return frameData;
    }

    return null;
}

// Complete and remove an ISO-TP session when all expected bytes arrived.
function completeIsoTpSession(canId) {
    const session = isoTpSessions.get(canId);

    if (!session || session.data.length < session.totalLength) {
        return null;
    }

    const result = session.data.slice(0, session.totalLength);
    isoTpSessions.delete(canId);

    logMessage(
        'isoTp',
        `ISO-TP vollständig von 0x${canId.toString(16).toUpperCase()}: ` +
        `${toHex(result)}`
    );

    return result;
}


/* ===================================
 *           UDS Processing
 * ===================================*/

// Validate a complete UDS response and dispatch every contained DID.
async function processUdsMessage(canId, uds) {
    if (!Array.isArray(uds) || uds.length === 0) {
        return;
    }

    // Assign a sequence number to each complete response so related log entries
    // can be identified across multiple decoded DIDs.
    const messageNumber = ++udsMessageCounter;

    const ecuHex = canId
        .toString(16)
        .toUpperCase();

    const messageTag = `UDS #${messageNumber} ECU 0x${ecuHex}`;

    logMessage(
        'isoTp',
        `${messageTag} vollständig: ${toHex(uds)}`
    );

    // Handle a negative UDS response.
    if (uds[0] === 0x7F) {
        const requestedService = uds[1];
        const responseCode = uds[2];

        logMessage(
            'warnings',
            `${messageTag}: Negative UDS-Antwort: ` +
            `Service 0x${hexByte(requestedService)}, ` +
            `NRC 0x${hexByte(responseCode)}`,
            'warn'
        );

        return;
    }

    // Continue only with a positive ReadDataByIdentifier response.
    if (uds[0] !== 0x62 || uds.length < 3) {
        logMessage(
            'unknownDid',
            `${messageTag}: Keine unterstützte ReadDataByIdentifier-Antwort: ` +
            `${toHex(uds)}`
        );

        return;
    }

    /* Multi-DID response layout:
     * 62 02 8C xx
     *    1E 32 xx xx ...
     *    1E 33 xx xx xx xx
     *
     * Byte 0 is 0x62; DID records begin at byte 1.
     */
    let offset = 1;

    while (offset + 2 <= uds.length) {
        const did = (uds[offset] << 8) | uds[offset + 1];

        const didHex = did
            .toString(16)
            .padStart(4, '0')
            .toUpperCase();

        const dataLength = getDidDataLength(canId, did);

        if (dataLength === null) {
            logMessage(
                'unknownDid',
                `${messageTag}: Unbekannter DID 0x${didHex} ` +
                `bei Offset ${offset}: ${toHex(uds.slice(offset))}`
            );

            // Without a known data length, the next DID boundary cannot be determined reliably.
            return;
        }

        const dataStart = offset + 2;
        const dataEnd = dataStart + dataLength;
        const availableLength = uds.length - dataStart;

        if (dataEnd > uds.length) {
            logMessage(
                'warnings',
                `${messageTag}: Unvollständige Antwort für DID ` +
                `0x${didHex}: ${dataLength} Datenbytes erwartet, ` +
                `${Math.max(availableLength, 0)} vorhanden. ` +
                `Restdaten: ${toHex(uds.slice(dataStart))}`,
                'warn'
            );

            return;
        }

        const valueData = uds.slice(dataStart, dataEnd);

        logMessage(
            'isoTp',
            `${messageTag} DID 0x${didHex}: ${toHex(valueData)}`
        );

        try {
            if (canId === 0x7ED) {
                await processBatteryManagementDid(did, valueData);
            } else if (canId === 0x7CF) {
                await processChargeManagementDid(did, valueData);
            } else {
                logMessage(
                    'unknownDid',
                    `${messageTag}: Nicht unterstützte ECU, ` +
                    `DID 0x${didHex}: ${toHex(valueData)}`
                );
            }
        } catch (error) {
            logMessage(
                'errors',
                `${messageTag}: Fehler beim Auswerten von DID ` +
                `0x${didHex}: ${error.message}`,
                'error'
            );
        }

        offset = dataEnd;
    }

    if (offset < uds.length) {
        logMessage(
            'warnings',
            `${messageTag}: Nicht ausgewertete Restdaten ab Offset ` +
            `${offset}: ${toHex(uds.slice(offset))}`,
            'warn'
        );
    }
}

// Decode and store one DID returned by the battery management ECU.
async function processBatteryManagementDid(did, data) {

    if (did >= 0x1E40 && did <= 0x1EA5) {
        requireLength(did, data, 2);

        const cellNumber = did - 0x1E40 + 1;
        const voltage = round(readUint16BE(data, 0) / 4096, 4);

        const relativeId =
            `battery.cells.individual.cell${String(cellNumber).padStart(3, '0')}`;

        const fullId = getStateId(relativeId);

        await ensureDynamicNumberState(
            fullId,
            `Zellspannung Zelle ${cellNumber}`,
            'V',
            'value.voltage'
        );

        await setStateAsync(fullId, voltage, true);

        logMessage(
            'values',
            `${fullId} = ${voltage} V`
        );

        return;
    }

    switch (did) {

        // 0x028C: Raw values from 0 to 255 represent 0 to 100 percent state of charge.
        case 0x028C: {
            requireLength(did, data, 1);

            const socAbsolute = round(data[0] / 2.55, 1);

            await updateValue('socAbsolute', socAbsolute);
            break;
        }

        // 0x1E3B: Unsigned 16-bit big-endian battery voltage with a factor of 1/4 V.
        case 0x1E3B: {
            requireLength(did, data, 2);

            const voltage = round(readUint16BE(data, 0) / 4, 2);

            await updateValue('batteryVoltage', voltage);
            await updateBatteryPower();
            break;
        }

        // 0x1E3D: High-voltage battery current using (raw value - 2044) / 4 * -1.
        case 0x1E3D: {
            requireLength(did, data, 2);

            const rawCurrent = readUint16BE(data, 0);
            const current = round((rawCurrent - 2044) / 4 * -1, 2);

            await updateValue('batteryCurrent', current);
            await updateBatteryPower();
            break;
        }

        // 0x1E33 - highest cell voltage
        case 0x1E33: {
            requireLength(did, data, 4);

            lastCellVoltageMax =
                round(readUint16BE(data, 0) / 4096, 4);

            const cellIndex = readUint16BE(data, 2);

            await updateValue('cellVoltageMax', lastCellVoltageMax);
            await updateValue('cellVoltageMaxIndex', cellIndex);
            await updateCellDelta();
            break;
        }

        // 0x1E34 - lowest cell voltage
        case 0x1E34: {
            requireLength(did, data, 4);

            lastCellVoltageMin =
                round(readUint16BE(data, 0) / 4096, 4);

            const cellIndex = readUint16BE(data, 2);

            await updateValue('cellVoltageMin', lastCellVoltageMin);
            await updateValue('cellVoltageMinIndex', cellIndex);
            await updateCellDelta();
            break;
        }

        // 0x2A0B: Signed 16-bit battery temperature with a factor of 1/64 degrees Celsius.
        case 0x2A0B: {
            requireLength(did, data, 2);

            const temperature =
                round(readInt16BE(data, 0) / 64, 2);

            await updateValue('batteryTemperature', temperature);
            break;
        }

        /* 0x1E32: Cumulative charge and discharge counters:
         * 0-3:   charged capacity
         * 4-7:   discharged capacity
         * 8-11:  charged energy
         * 12-15: discharged energy
         */
        case 0x1E32: {
            requireLength(did, data, 16);

            const chargedAhRaw = readInt32BE(data, 0);
            const dischargedAhRaw = readInt32BE(data, 4);
            const chargedKwhRaw = readInt32BE(data, 8);
            const dischargedKwhRaw = readInt32BE(data, 12);

            const chargedAh =
                round(Math.abs(chargedAhRaw * 0.0018204444), 3);

            const dischargedAh =
                round(Math.abs(dischargedAhRaw * 0.0018204444), 3);

            const chargedKwh =
                round(Math.abs(chargedKwhRaw * 0.0001165084), 3);

            const dischargedKwh =
                round(Math.abs(dischargedKwhRaw * 0.0001165084), 3);

            await updateValue('energyChargedAh', chargedAh);
            await updateValue('energyDischargedAh', dischargedAh);
            await updateValue('energyChargedKwh', chargedKwh);
            await updateValue('energyDischargedKwh', dischargedKwh);
            break;
        }

        default:
            logMessage(
                'unknownDid',
                `Unbekannter BMS-DID 0x${did
                    .toString(16)
                    .padStart(4, '0')
                    .toUpperCase()}: ${toHex(data)}`
            );
    }
}

// Decode and store one DID returned by the charge management ECU.
async function processChargeManagementDid(did, data) {
    switch (did) {

        // 0x1DD0: Displayed state of charge.
        case 0x1DD0: {
            requireLength(did, data, 1);

            const soc = round(data[0] / 2.0, 1);

            await updateValue('soc', soc);
            break;
        }

        /* 0x1DD6: High-voltage charging modes:
         * 0 = not charging
         * 1 = Type 2 / AC
         * 4 = CCS / DC
         */
        case 0x1DD6: {
            requireLength(did, data, 1);

            const mode = data[0];
            const modeText = getChargeModeText(mode);
            const charging = mode !== 0;

            await updateValue('chargeMode', mode);
            await updateValue('chargeModeText', modeText);
            await updateValue('charging', charging);
            break;
        }

        case 0x1DDA: {
            requireLength(did, data, 1);

            const statusRaw = data[0];

            // Bit 0 indicates a connected plug; bit 1 indicates a locked plug.
            const plugged = (statusRaw & 0x01) !== 0;
            const locked = (statusRaw & 0x02) !== 0;

            await updateValue('chargeSocketStatusRaw', statusRaw);
            await updateValue('chargePlugged', plugged);
            await updateValue('chargeLocked', locked);

            // OVMS conversion: AC = U16(byte 2, byte 3) / 10 - 55,
            // DC = U16(byte 4, byte 5) / 10 - 55. Decode only complete payloads.
            if (data.length >= 6) {
                const acTemperature =
                    round(readUint16BE(data, 2) / 10 - 55, 1);

                const dcTemperature =
                    round(readUint16BE(data, 4) / 10 - 55, 1);

                await updateValue(
                    'chargeSocketTemperatureAc',
                    acTemperature
                );

                await updateValue(
                    'chargeSocketTemperatureDc',
                    dcTemperature
                );
            }

            break;
        }

        default:
            logMessage(
                'unknownDid',
                `Unbekannter Lademanagement-DID 0x${did
                    .toString(16)
                    .padStart(4, '0')
                    .toUpperCase()}: ${toHex(data)}`
            );
    }
}

// Return the expected data length for a DID on a supported response CAN ID.
function getDidDataLength(canId, did) {
    if (canId === 0x7ED) {
        switch (did) {
            case 0x028C:
                return 1;  // Absolute BMS state of charge

            case 0x1E32:
                return 16; // Four signed Int32 values

            case 0x1E33:
                return 4;  // Maximum cell voltage and cell number

            case 0x1E34:
                return 4;  // Minimum cell voltage and cell number

            case 0x1E3B:
                return 2;  // Battery voltage

            case 0x1E3D:
                return 2;  // Battery current

            case 0x2A0B:
                return 2;  // Battery temperature

            default:
                if (did >= 0x1E40 && did <= 0x1EA5) {
                    return 2;
                }

                return null;
        }
    }

    if (canId === 0x7CF) {
        switch (did) {
            case 0x1DD0:
                return 1; // Displayed state of charge

            case 0x1DD6:
                return 2; // Charging mode

            case 0x1DDA:
                return 6; // Charging socket state and temperatures

            default:
                return null;
        }
    }

    return null;
}


/* ===================================
 *           Derived Values
 * ===================================*/

// Recalculate battery power from the latest voltage and current states.
async function updateBatteryPower() {
    const voltageState =
        await getStateAsync(getStateId(STATES.batteryVoltage.id));

    const currentState =
        await getStateAsync(getStateId(STATES.batteryCurrent.id));

    const voltage = Number(voltageState?.val);
    const current = Number(currentState?.val);

    if (!Number.isFinite(voltage) || !Number.isFinite(current)) {
        return;
    }

    // With the OVMS convention above, positive current usually means discharge
    // and negative current usually means charge.
    const power = round(voltage * current / 1000, 3);

    await updateValue('batteryPower', power);
}

// Recalculate the voltage delta between the highest and lowest cells.
async function updateCellDelta() {
    if (
        !Number.isFinite(lastCellVoltageMax) ||
        !Number.isFinite(lastCellVoltageMin)
    ) {
        return;
    }

    const deltaVolt =
        round(lastCellVoltageMax - lastCellVoltageMin, 4);

    const deltaMillivolt =
        round(deltaVolt * 1000, 1);

    await updateValue('cellVoltageDelta', deltaVolt);
    await updateValue('cellVoltageDeltaMv', deltaMillivolt);
}


/* ===================================
 *        ISO-TP Flow Control
 * ===================================*/

// Send a Continue To Send Flow Control frame to the responding ECU.
async function sendIsoTpFlowControl(responseCanId) {
    const requestCanIdByResponse = {
        0x7ED: 0x7E5, // BMS
        0x7CF: 0x765  // Charge management ECU
    };

    const requestCanId = requestCanIdByResponse[responseCanId];

    if (requestCanId === undefined) {
        logMessage(
            'warnings',
            `Keine Flow-Control-Ziel-ID für Antwort-ID ` +
            `0x${responseCanId.toString(16).toUpperCase()} bekannt`,
            'warn'
        );
        return;
    }

    const payload = {
        bus: '0',
        type: 'tx',
        frame: [
            {
                id: requestCanId,
                dlc: 8,
                rtr: false,
                extd: false,
                data: [
                    0x30, // Flow Status: Continue To Send
                    0x00, // Block Size: unlimited
                    0x00, // Separation Time
                    0x00,
                    0x00,
                    0x00,
                    0x00,
                    0x00
                ]
            }
        ]
    };

    await setStateAsync(
        CONFIG.txState,
        JSON.stringify(payload),
        false
    );

    logMessage(
        'flowControl',
        `ISO-TP Flow Control an ` +
        `0x${requestCanId.toString(16).toUpperCase()} gesendet`
    );
}


/* ===================================
 *          State Management
 * ===================================*/

// Store a decoded value and update its timestamp state.
async function updateValue(stateKey, value) {
    const definition = STATES[stateKey];

    if (!definition) {
        throw new Error(`Unbekannter State-Schlüssel: ${stateKey}`);
    }

    const fullId = getStateId(definition.id);

    await setStateAsync(fullId, value, true);
    await setStateAsync(
        getStateId(STATES.lastUpdate.id),
        Date.now(),
        true
    );

    logMessage(
        'values',
        `${fullId} = ${value}` +
        (definition.unit ? ` ${definition.unit}` : '')
    );
}

// Resolve a relative state ID below the configured state root.
function getStateId(relativeId) {
    return `${CONFIG.stateRoot}.${relativeId}`;
}


/* ===================================
 *         Utility Functions
 * ===================================*/

// Create a numeric state that is discovered dynamically at runtime.
async function ensureDynamicNumberState(
    id,
    name,
    unit = '',
    role = 'value'
) {
    if (existsObject(id)) {
        return;
    }

    await createStateAsync(
        id,
        0,
        {
            name,
            type: 'number',
            role,
            unit,
            read: true,
            write: false
        }
    );
}

// Return the human-readable label for a decoded charging mode.
function getChargeModeText(mode) {
    switch (mode) {
        case 0:
            return 'nicht ladend';

        case 1:
            return 'AC / Typ 2';

        case 4:
            return 'DC / CCS';

        default:
            return `unbekannt (${mode})`;
    }
}

// Ensure a DID payload contains the required number of bytes.
function requireLength(did, data, requiredLength) {
    if (data.length < requiredLength) {
        throw new Error(
            `DID 0x${did
                .toString(16)
                .padStart(4, '0')
                .toUpperCase()} enthält nur ${data.length} Bytes, ` +
            `${requiredLength} erforderlich`
        );
    }
}

// Parse a CAN identifier supplied as a number, decimal string, or hex string.
function parseCanId(value) {
    if (typeof value === 'number') {
        return value;
    }

    if (typeof value !== 'string') {
        return NaN;
    }

    const normalized = value.trim();

    if (/^0x/i.test(normalized)) {
        return parseInt(normalized, 16);
    }

    // WiCAN normally uses decimal values. Treat values containing A-F as hex.
    if (/[A-F]/i.test(normalized)) {
        return parseInt(normalized, 16);
    }

    return parseInt(normalized, 10);
}

// Normalize a CAN data field into an array of validated byte values.
function normalizeData(data) {
    if (Array.isArray(data)) {
        return data
            .map(parseDataByte)
            .filter(Number.isFinite);
    }

    // Also accept strings such as "04 62 02 8C 98 AA AA AA".
    if (typeof data === 'string') {
        return data
            .trim()
            .split(/[\s,;]+/)
            .map(value => parseInt(value.replace(/^0x/i, ''), 16))
            .filter(Number.isFinite);
    }

    return [];
}

// Parse and validate one CAN data byte.
function parseDataByte(value) {
    if (typeof value === 'number') {
        return value & 0xFF;
    }

    if (typeof value !== 'string') {
        return NaN;
    }

    const normalized = value.trim();

    if (/^0x/i.test(normalized)) {
        return parseInt(normalized, 16) & 0xFF;
    }

    // WiCAN JSON normally represents data bytes as decimal numbers.
    return parseInt(normalized, 10) & 0xFF;
}

// Normalize the different status payload formats emitted by WiCAN.
function parseOnlineStatus(rawValue) {
    if (rawValue === null || rawValue === undefined) {
        return false;
    }

    if (typeof rawValue === 'object') {
        return (
            String(rawValue?.status)
                .trim()
                .toLowerCase() === 'online'
        );
    }

    const text = String(rawValue).trim();

    if (text.toLowerCase() === 'online') {
        return true;
    }

    if (text.toLowerCase() === 'offline') {
        return false;
    }

    try {
        const parsed = JSON.parse(text);

        return (
            String(parsed?.status)
                .trim()
                .toLowerCase() === 'online'
        );
    } catch {
        return false;
    }
}

// Read an unsigned 16-bit big-endian integer from a byte array.
function readUint16BE(data, offset) {
    return (
        (data[offset] << 8) |
        data[offset + 1]
    ) >>> 0;
}

// Read a signed 16-bit big-endian integer from a byte array.
function readInt16BE(data, offset) {
    const value = readUint16BE(data, offset);

    return value & 0x8000
        ? value - 0x10000
        : value;
}

// Read a signed 32-bit big-endian integer from a byte array.
function readInt32BE(data, offset) {
    return (
        (data[offset] << 24) |
        (data[offset + 1] << 16) |
        (data[offset + 2] << 8) |
        data[offset + 3]
    );
}

// Round a number to the requested number of decimal places.
function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

// Format one byte as a two-character uppercase hexadecimal string.
function hexByte(value) {
    return Number(value)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase();
}

// Format a byte array as a space-separated hexadecimal string.
function toHex(data) {
    return data
        .map(value => hexByte(value))
        .join(' ');
}

// Serialize a value for logging without propagating JSON errors.
function stringifySafe(value) {
    try {
        return typeof value === 'string'
            ? value
            : JSON.stringify(value);
    } catch {
        return String(value);
    }
}

// Write a message when its logging category is enabled.
function logMessage(category, message, level = 'info') {
    if (!CONFIG.logging[category]) {
        return;
    }

    log(message, level);
}
