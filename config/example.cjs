module.exports = {
    statusState: 'mqtt.0.wican.MY_ID.can.status', // WiCAN connection status state.
    txState: 'mqtt.0.wican.MY_ID.can.tx', // WiCAN CAN transmit state.
    rxState: 'mqtt.0.wican.MY_ID.can.rx', // WiCAN CAN receive state.
    stateRoot: '0_userdata.0.MY_CAR', // Root path for processed vehicle states.
    mqttPublishInstance: 'mqtt.0', // MQTT instance used to publish processed data.
    topicRoot: 'MY_CAR' // Root MQTT topic for published vehicle data.
};
