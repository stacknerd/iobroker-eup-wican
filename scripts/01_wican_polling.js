/* Script overview:
 * Polls selected VW e-Up UDS data through a WiCAN MQTT bridge.
 * Prioritizes connection data in one serial polling loop.
 * Polling follows the WiCAN connection state and pauses while it is offline.
 */

const CONFIG = {
    // BUILD-CONFIG-START
    statusState: 'mqtt.0.wican.MY_ID.can.status', // WiCAN connection status state.
    txState: 'mqtt.0.wican.MY_ID.can.tx', // WiCAN CAN transmit state.
    // BUILD-CONFIG-END
    logging: {
        status: true, // Log WiCAN connection changes.
        requests: false, // Log transmitted diagnostic requests.
        warnings: true, // Log warning messages.
        errors: true // Log error messages.
    },

    requestSpacingMs: 300, // Minimum delay between diagnostic requests.
    fastPollIntervalMs: 10_000, // Poll interval for frequently updated vehicle data.
    slowPollIntervalMs: 60_000 // Poll interval for long-term vehicle data.
};


/* ===================================
 *        Diagnostic Definitions
 * ===================================*/

const ECU = {
    bms: {
        requestId: 0x7E5 // Decimal 2021
    },

    charging: {
        requestId: 0x765 // Decimal 1893
    }
};

/* Time-critical values:
 * Request the charging socket state first:
 * - plugged
 * - locked
 *
 * Request the charging mode immediately afterwards:
 * - not charging
 * - AC
 * - DC
 */
const CONNECTION_REQUESTS = [
    {
        name: 'Ladebuchsenstatus',
        ecu: ECU.charging,
        did: 0x1DDA
    },
    {
        name: 'Lademodus',
        ecu: ECU.charging,
        did: 0x1DD6
    }
];

// Charging mode and socket state are handled by CONNECTION_REQUESTS instead of this list.
const FAST_REQUESTS = [
    {
        name: 'SOC',
        ecu: ECU.bms,
        did: 0x028C
    },
    {
        name: 'Anzeige-SOC',
        ecu: ECU.charging,
        did: 0x1DD0
    },
    {
        name: 'HV-Batteriespannung',
        ecu: ECU.bms,
        did: 0x1E3B
    },
    {
        name: 'HV-Batteriestrom',
        ecu: ECU.bms,
        did: 0x1E3D
    },
    {
        name: 'Maximale Zellspannung',
        ecu: ECU.bms,
        did: 0x1E33
    },
    {
        name: 'Minimale Zellspannung',
        ecu: ECU.bms,
        did: 0x1E34
    },
    {
        name: 'Batterietemperatur',
        ecu: ECU.bms,
        did: 0x2A0B
    }
];

// Slowly polled values
const SLOW_REQUESTS = [
    {
        name: 'Lade- und Entladezähler',
        ecu: ECU.bms,
        did: 0x1E32
    }
];


/* ===================================
 *            Runtime State
 * ===================================*/

let wicanOnline = false;

let pollingTimer = null;
let requestInProgress = false;
let pollingGeneration = 0;
let pollingPhase = 0;
let fastRequestIndex = 0;
let fastRequestDueAt = [];
let slowRequestDueAt = 0;
let scriptStopping = false;


/* ===================================
 *       Connection Monitoring
 * ===================================*/

// React to WiCAN connection changes.
on(
    {
        id: CONFIG.statusState,
        change: 'any'
    },
    obj => {
        try {
            const online = parseOnlineStatus(obj.state.val);
            setWicanOnlineStatus(online);
        } catch (error) {
            logMessage(
                'errors',
                `WiCAN-Status konnte nicht verarbeitet werden: ${error.message}`,
                'error'
            );
        }
    }
);

// Initialize polling from the current WiCAN connection state.
initialize();

// Read the initial WiCAN connection state and initialize polling.
async function initialize() {
    try {
        const currentStatus =
            await getStateAsync(CONFIG.statusState);

        const online =
            parseOnlineStatus(currentStatus?.val);

        setWicanOnlineStatus(online);
    } catch (error) {
        logMessage(
            'errors',
            `Initialer WiCAN-Status konnte nicht gelesen werden: ${error.message}`,
            'error'
        );
    }
}

// Apply a connection-state change and start or stop polling as needed.
function setWicanOnlineStatus(online) {
    if (online === wicanOnline) {
        return;
    }

    wicanOnline = online;

    if (wicanOnline) {
        logMessage(
            'status',
            'WiCAN ist online – Polling wird gestartet.'
        );

        startPolling();
    } else {
        logMessage(
            'status',
            'WiCAN ist offline – Polling wird gestoppt.'
        );

        stopPolling();
    }
}

// Start one serial polling loop with the connection pair at the front.
function startPolling() {
    stopPolling();

    pollingPhase = 0;
    fastRequestIndex = 0;
    fastRequestDueAt = FAST_REQUESTS.map(() => 0);
    slowRequestDueAt = 0;

    runPollingStep(pollingGeneration);
}

// Stop the active polling timer and invalidate its loop generation.
function stopPolling() {
    pollingGeneration++;

    if (pollingTimer !== null) {
        clearTimeout(pollingTimer);
        pollingTimer = null;
    }
}

// Send one request and schedule exactly one following polling step.
async function runPollingStep(generation) {
    if (
        generation !== pollingGeneration ||
        !wicanOnline ||
        scriptStopping
    ) {
        return;
    }

    // A previous request can still finish during a quick offline/online transition.
    if (requestInProgress) {
        return;
    }

    requestInProgress = true;

    const request = selectNextRequest();

    try {
        await sendDidRequest(request);
    } catch (error) {
        logMessage(
            'errors',
            `Fehler beim Polling von ${request.name}: ${error.message}`,
            'error'
        );
    } finally {
        requestInProgress = false;

        if (!wicanOnline || scriptStopping) {
            return;
        }

        const currentGeneration = pollingGeneration;
        const delay = generation === currentGeneration
            ? CONFIG.requestSpacingMs
            : 0;

        pollingTimer = setTimeout(() => {
            pollingTimer = null;
            runPollingStep(currentGeneration);
        }, delay);
    }
}

// Select the connection pair first and at most one due background request after it.
function selectNextRequest() {
    if (pollingPhase < CONNECTION_REQUESTS.length) {
        return CONNECTION_REQUESTS[pollingPhase++];
    }

    pollingPhase = 0;

    const backgroundRequest = selectDueBackgroundRequest();

    if (backgroundRequest !== null) {
        return backgroundRequest;
    }

    return CONNECTION_REQUESTS[pollingPhase++];
}

// Select one due slow or fast request without creating queued work.
function selectDueBackgroundRequest() {
    const now = Date.now();

    if (slowRequestDueAt <= now) {
        slowRequestDueAt = now + CONFIG.slowPollIntervalMs;
        return SLOW_REQUESTS[0];
    }

    for (let offset = 0; offset < FAST_REQUESTS.length; offset++) {
        const index =
            (fastRequestIndex + offset) % FAST_REQUESTS.length;

        if (fastRequestDueAt[index] <= now) {
            fastRequestDueAt[index] =
                now + CONFIG.fastPollIntervalMs;
            fastRequestIndex =
                (index + 1) % FAST_REQUESTS.length;

            return FAST_REQUESTS[index];
        }
    }

    return null;
}

// Build and transmit one UDS ReadDataByIdentifier request.
async function sendDidRequest(request) {
    const didHigh =
        (request.did >> 8) & 0xFF;

    const didLow =
        request.did & 0xFF;

    const payload = {
        bus: '0',
        type: 'tx',
        frame: [
            {
                id: request.ecu.requestId,
                dlc: 8,
                rtr: false,
                extd: false,
                data: [
                    0x03,
                    0x22,
                    didHigh,
                    didLow,
                    0xAA,
                    0xAA,
                    0xAA,
                    0xAA
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
        'requests',
        `${request.name} abgefragt: ` +
        `ECU 0x${request.ecu.requestId
            .toString(16)
            .toUpperCase()}, ` +
        `DID 0x${request.did
            .toString(16)
            .padStart(4, '0')
            .toUpperCase()}`
    );
}

// Normalize the different status payload formats emitted by WiCAN.
function parseOnlineStatus(rawValue) {
    if (
        rawValue === null ||
        rawValue === undefined
    ) {
        return false;
    }

    let value = rawValue;

    if (typeof value === 'string') {
        const trimmed = value.trim();

        if (
            trimmed.toLowerCase() === 'online' ||
            trimmed.toLowerCase() === 'true'
        ) {
            return true;
        }

        try {
            value = JSON.parse(trimmed);
        } catch {
            return false;
        }
    }

    if (typeof value === 'object') {
        return (
            String(value?.status)
                .trim()
                .toLowerCase() === 'online'
        );
    }

    return value === true;
}


/* ===================================
 *         Utility Functions
 * ===================================*/

// Write a message when its logging category is enabled.
function logMessage(
    category,
    message,
    level = 'info'
) {
    if (!CONFIG.logging[category]) {
        return;
    }

    log(message, level);
}

// Clear polling timers when ioBroker stops the script.
onStop(() => {
    scriptStopping = true;
    wicanOnline = false;
    stopPolling();
}, 1000);
