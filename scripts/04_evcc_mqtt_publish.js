/* Script overview:
 * Publishes processed vehicle states from ioBroker to an MQTT broker.
 * Mirrors the configured state tree to a matching MQTT topic hierarchy.
 * Supports startup publishing, retained messages, and category-based logging.
 */

const CONFIG = {
    // BUILD-CONFIG-START
    stateRoot: '0_userdata.0.MY_CAR', // Root path of states published to MQTT.
    mqttPublishInstance: 'mqtt.0', // MQTT instance used to publish processed data.
    topicRoot: 'MY_CAR', // Root MQTT topic for published vehicle data.
    // BUILD-CONFIG-END
    publishOnStart: true, // Publish all existing values when the script starts.
    retain: true, // Publish MQTT messages with the retain flag.

    logging: {
        published: false, // Log successfully published values.
        skipped: true, // Log values skipped during publishing.
        errors: true // Log publishing errors.
    }
};


/* ===================================
 *          State Subscription
 * ===================================*/

// Subscribe only to data points below the configured state root.
const sourceIdPattern = new RegExp(
    `^${escapeRegExp(CONFIG.stateRoot)}\\.`
);
const sourceSelector = `state[id=${CONFIG.stateRoot}.*]`;

on(
    {
        id: sourceIdPattern,
        change: 'any'
    },
    async obj => {
        try {
            await publishState(obj.id, obj.state.val);
        } catch (error) {
            logMessage(
                'errors',
                `Fehler beim Veröffentlichen von ${obj.id}: ${error.message}`,
                'error'
            );
        }
    }
);

// Escape an ioBroker state root before using it in a regular expression.
function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


/* ===================================
 *             Publishing
 * ===================================*/

initialize();

// Publish existing values at startup when configured to do so.
async function initialize() {
    if (!CONFIG.publishOnStart) {
        return;
    }

    const publishJobs = [];

    $(sourceSelector).each(id => {
        publishJobs.push(publishCurrentValue(id));
    });

    await Promise.allSettled(publishJobs);
}

// Read and publish the current value of one ioBroker state.
async function publishCurrentValue(id) {
    try {
        const state = await getStateAsync(id);

        if (!state) {
            return;
        }

        await publishState(id, state.val);
    } catch (error) {
        logMessage(
            'errors',
            `Initialwert von ${id} konnte nicht veröffentlicht werden: ` +
            `${error.message}`,
            'error'
        );
    }
}

// Convert and publish one state update when its value is supported.
async function publishState(id, value) {
    const topic = stateIdToTopic(id);
    const message = valueToMqttPayload(value);

    if (topic === null || message === null) {
        logMessage(
            'skipped',
            `${id} wurde nicht veröffentlicht`
        );
        return;
    }

    await publishMqtt(topic, message);

    logMessage(
        'published',
        `${id} → ${topic} = ${message}`
    );
}


/* ===================================
 *      Topic and Payload Mapping
 * ===================================*/

// Convert a state ID below the configured root into an MQTT topic.
function stateIdToTopic(id) {
    const prefix = `${CONFIG.stateRoot}.`;

    if (!id.startsWith(prefix)) {
        return null;
    }

    const relativePath = id
        .slice(prefix.length)
        .split('.')
        .map(encodeTopicSegment)
        .join('/');

    if (!relativePath) {
        return null;
    }

    return `${CONFIG.topicRoot}/${relativePath}`;
}

// Replace reserved MQTT characters so object IDs cannot accidentally
// introduce topic separators or wildcards.
function encodeTopicSegment(segment) {
    return String(segment)
        .replaceAll('/', '_')
        .replaceAll('+', '_')
        .replaceAll('#', '_');
}

// Convert an ioBroker value into a publishable MQTT payload.
function valueToMqttPayload(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
    ) {
        return String(value);
    }

    // Preserve future object or array values as JSON when possible.
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
}


/* ===================================
 *           MQTT Transport
 * ===================================*/

// Send one message through the configured ioBroker MQTT instance.
function publishMqtt(topic, message) {
    return new Promise((resolve, reject) => {
        try {
            sendTo(
                CONFIG.mqttPublishInstance,
                'sendMessage2Client',
                {
                    topic,
                    message,
                    retain: CONFIG.retain
                },
                result => resolve(result)
            );
        } catch (error) {
            reject(error);
        }
    });
}


/* ===================================
 *              Logging
 * ===================================*/

// Write a message when its logging category is enabled.
function logMessage(category, message, level = 'info') {
    if (!CONFIG.logging[category]) {
        return;
    }

    log(message, level);
}
