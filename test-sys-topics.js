#!/usr/bin/env node

// Quick test script to check if Mosquitto broker is publishing $SYS topics
const mqtt = require('mqtt');

console.log('Testing Mosquitto $SYS topics...');

const client = mqtt.connect('mqtt://localhost:1883', {
  clientId: 'sys-topic-test'
});

const sysTopics = [
  '$SYS/broker/uptime',
  '$SYS/broker/version',
  '$SYS/broker/clients/connected',
  '$SYS/broker/clients/total'
];

client.on('connect', () => {
  console.log('Connected to MQTT broker');
  console.log('Subscribing to $SYS topics...');
  
  client.subscribe(sysTopics, (err) => {
    if (err) {
      console.error('Failed to subscribe:', err);
    } else {
      console.log('Subscribed successfully');
      console.log('Waiting for messages...');
    }
  });

  // Auto-disconnect after 10 seconds
  setTimeout(() => {
    console.log('Test timeout - disconnecting');
    client.end();
  }, 10000);
});

client.on('message', (topic, message) => {
  console.log(`✓ ${topic}: ${message.toString()}`);
});

client.on('error', (error) => {
  console.error('Connection error:', error.message);
  process.exit(1);
});

client.on('disconnect', () => {
  console.log('Disconnected');
  process.exit(0);
});