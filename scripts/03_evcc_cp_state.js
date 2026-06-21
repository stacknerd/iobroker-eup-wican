/* Script overview:
 * Derives EVCC control-pilot states from processed WiCAN charging data.
 * Tracks connection, plug, lock, and charging-mode changes under one state root.
 * Publishes normalized CP state codes and human-readable descriptions.
 */

const CONFIG = {
    // BUILD-CONFIG-START
    stateRoot: '0_userdata.0.MY_CAR', // Root path for processed vehicle states.
    // BUILD-CONFIG-END
    updateIntervalMs: 30_000, // Interval for periodic CP state updates.
    logging: false // Log calculated CP state details.
};


/* ===================================
 *             State Paths
 * ===================================*/

const STATE_IDS = {
    online: `${CONFIG.stateRoot}.online`,
    chargeMode: `${CONFIG.stateRoot}.charging.mode`,
    plugged: `${CONFIG.stateRoot}.charging.plugged`,
    locked: `${CONFIG.stateRoot}.charging.locked`,
    cpState: `${CONFIG.stateRoot}.charging.cpState`,
    cpStateText: `${CONFIG.stateRoot}.charging.cpStateText`
};


/* ===================================
 *            Runtime State
 * ===================================*/

let cpUpdateTimer = null;
let wicanOnline = false;
let chargeMode = null;
let plugged = null;
let locked = null;


/* ===================================
 *            Initialization
 * ===================================*/

// Start the state processor and report initialization failures.
main().catch(error => {
    log(
        `CP-Auswertung konnte nicht gestartet werden: ${error.message}`,
        'error'
    );
});

// Create output states, subscribe to inputs, and start periodic updates.
async function main() {
    await createStateAsync(
        STATE_IDS.cpState,
        'A',
        {
            name: 'EVCC Control-Pilot-Zustand',
            type: 'string',
            role: 'text',
            read: true,
            write: false
        }
    );

    await createStateAsync(
        STATE_IDS.cpStateText,
        'unbekannt',
        {
            name: 'EVCC Control-Pilot-Zustand Beschreibung',
            type: 'string',
            role: 'text',
            read: true,
            write: false
        }
    );

    subscribeStates();

    await initializeValues();

    cpUpdateTimer = setInterval(() => {
        updateCpState().catch(error => {
            log(
                `CP-State konnte nicht aktualisiert werden: ${error.message}`,
                'error'
            );
        });
    }, CONFIG.updateIntervalMs);
}


/* ===================================
 *          State Subscriptions
 * ===================================*/

// Subscribe to every input that can affect the calculated CP state.
function subscribeStates() {
    on(
        {
            id: STATE_IDS.online,
            change: 'any'
        },
        async obj => {
            try {
                wicanOnline = parseOnlineStatus(obj.state.val);

                // Preserve the last valid CP state while WiCAN is offline.
                if (wicanOnline) {
                    await updateCpState();
                } else {
                    logDebug(
                        'WiCAN offline – letzter CP-State bleibt erhalten'
                    );
                }
            } catch (error) {
                log(
                    `WiCAN-Status konnte nicht verarbeitet werden: ${error.message}`,
                    'error'
                );
            }
        }
    );

    on(
        {
            id: STATE_IDS.chargeMode,
            change: 'any'
        },
        async obj => {
            try {
                const value = Number(obj.state.val);

                chargeMode = Number.isFinite(value)
                    ? value
                    : null;

                await updateCpState();
            } catch (error) {
                log(
                    `Lademodus konnte nicht verarbeitet werden: ${error.message}`,
                    'error'
                );
            }
        }
    );

    on(
        {
            id: STATE_IDS.plugged,
            change: 'any'
        },
        async obj => {
            try {
                plugged = parseBoolean(obj.state.val);
                await updateCpState();
            } catch (error) {
                log(
                    `Plugged-Status konnte nicht verarbeitet werden: ${error.message}`,
                    'error'
                );
            }
        }
    );

    on(
        {
            id: STATE_IDS.locked,
            change: 'any'
        },
        async obj => {
            try {
                locked = parseBoolean(obj.state.val);
                await updateCpState();
            } catch (error) {
                log(
                    `Locked-Status konnte nicht verarbeitet werden: ${error.message}`,
                    'error'
                );
            }
        }
    );
}

// Load all input values once during startup.
async function initializeValues() {
    const [
        statusState,
        chargeModeState,
        pluggedState,
        lockedState
    ] = await Promise.all([
        getStateAsync(STATE_IDS.online),
        getStateAsync(STATE_IDS.chargeMode),
        getStateAsync(STATE_IDS.plugged),
        getStateAsync(STATE_IDS.locked)
    ]);

    wicanOnline = parseOnlineStatus(statusState?.val);

    const modeValue = Number(chargeModeState?.val);

    chargeMode = Number.isFinite(modeValue)
        ? modeValue
        : null;

    plugged = parseBoolean(pluggedState?.val);
    locked = parseBoolean(lockedState?.val);

    await updateCpState();
}


/* ===================================
 *        CP State Calculation
 * ===================================
 * 
 * CP state mapping:
 * plugged  locked  charging  result
 * false    false   any       A
 * true     false   any       A
 * false    true    any       A
 * true     true    no        B
 * true     true    yes       C
 */

async function updateCpState() {

    // An offline WiCAN does not prove that the vehicle was disconnected,
    // so retain the last valid CP state.
    if (!wicanOnline) {
        return;
    }

    // Wait until both socket-state inputs are known.
    if (plugged === null || locked === null) {
        logDebug(
            `CP-Auswertung wartet auf Statuswerte: ` +
            `plugged=${plugged}, locked=${locked}`
        );

        return;
    }

    const connected =
        plugged === true &&
        locked === true;

    const charging =
        chargeMode === 1 ||
        chargeMode === 4;

    let cpState;

    if (!connected) {

        // State A applies until both plugged and locked are true.
        cpState = 'A';
    } else if (charging) {

        // The vehicle is connected, locked, and actively charging.
        cpState = 'C';
    } else {

        // The vehicle is connected and locked but not actively charging.
        cpState = 'B';
    }

    const text = getCpStateText(cpState);

    // Refresh output states periodically even when the value is unchanged.
    await setStateAsync(
        STATE_IDS.cpState,
        cpState,
        true
    );

    await setStateAsync(
        STATE_IDS.cpStateText,
        text,
        true
    );

    logDebug(
        `EVCC CP-State: ${cpState} – ${text} ` +
        `(online=${wicanOnline}, ` +
        `plugged=${plugged}, ` +
        `locked=${locked}, ` +
        `mode=${chargeMode})`
    );
}


/* ===================================
 *            Value Parsing
 * ===================================*/

// Normalize the supported WiCAN online-state representations.
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

// Normalize boolean state values received in different representations.
function parseBoolean(value) {
    if (value === true || value === 1) {
        return true;
    }

    if (value === false || value === 0) {
        return false;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value
        .trim()
        .toLowerCase();

    if (
        normalized === 'true' ||
        normalized === '1' ||
        normalized === 'on' ||
        normalized === 'yes'
    ) {
        return true;
    }

    if (
        normalized === 'false' ||
        normalized === '0' ||
        normalized === 'off' ||
        normalized === 'no'
    ) {
        return false;
    }

    return null;
}

// Return the human-readable description for an EVCC CP state code.
function getCpStateText(state) {
    switch (state) {
        case 'A':
            return 'kein Fahrzeug angeschlossen';

        case 'B':
            return 'Fahrzeug angeschlossen, nicht ladebereit';

        case 'C':
            return 'Fahrzeug angeschlossen und ladebereit';

        case 'D':
            return 'ladebereit, Lüftung erforderlich';

        case 'E':
            return 'Fehler';

        case 'F':
            return 'Fehler oder keine CP-Verbindung';

        default:
            return 'unbekannt';
    }
}


/* ===================================
 *        Logging and Shutdown
 * ===================================*/

// Write CP calculation details when debug logging is enabled.
function logDebug(message) {
    if (CONFIG.logging) {
        log(message, 'info');
    }
}

// Clear the periodic update timer when ioBroker stops the script.
onStop(() => {
    if (cpUpdateTimer !== null) {
        clearInterval(cpUpdateTimer);
        cpUpdateTimer = null;
    }
}, 1000);
