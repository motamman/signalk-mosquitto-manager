# SignalK Mosquitto Manager Setup Guide

## Current Status
Your plugin is working for **monitoring** but missing **statistics** because Mosquitto $SYS topics aren't enabled.

## Required: Enable Mosquitto $SYS Topics

### 1. Check Current Mosquitto Configuration
```bash
# Find your mosquitto configuration file
sudo find /etc -name "mosquitto.conf" 2>/dev/null

# Common locations:
# /etc/mosquitto/mosquitto.conf
# /etc/mosquitto/conf.d/default.conf
```

### 2. Add $SYS Topics Configuration
Edit your main Mosquitto configuration file and add:

```conf
# Enable $SYS topic publishing every 10 seconds
sys_interval 10

# Optional: Customize $SYS topic retention
# sys_topic_retain true
```

### 3. Restart Mosquitto
```bash
sudo systemctl restart mosquitto
sudo systemctl status mosquitto
```

### 4. Test $SYS Topics Are Working
```bash
# Test if $SYS topics are now available
mosquitto_sub -h localhost -t '$SYS/broker/uptime' -C 1

# Should return a number like: 3600.45
```

## Expected Results After Setup

Once $SYS topics are enabled, your web interface should show:

- **Service**: mosquitto
- **Uptime**: 2h 15m (actual uptime)
- **Connected Clients**: actual number
- **Messages Received**: actual count
- **Messages Sent**: actual count  
- **Bytes Received**: actual bytes with units
- **Bytes Sent**: actual bytes with units

## Alternative: Basic Monitoring Only

If you can't enable $SYS topics, the plugin will still provide:
- Broker running/stopped status
- Port accessibility checking
- Connection health monitoring
- Basic connection counting
- Configuration file management

## Troubleshooting

### $SYS Topics Not Working
1. Check Mosquitto logs: `sudo journalctl -u mosquitto -f`
2. Verify config syntax: `sudo mosquitto_sub -t '$SYS/#' -C 5`
3. Check permissions: ensure Mosquitto can read config

### Statistics Still Missing
1. Check SignalK debug logs for "$SYS" messages
2. Verify broker URL/port in plugin config
3. Ensure no firewall blocking MQTT connections

### Service Name Still Shows "-"
This indicates the plugin configuration isn't being read properly. Check your SignalK plugin settings include:

```json
{
  "enabled": true,
  "serviceName": "mosquitto",
  "brokerUrl": "mqtt://localhost",
  "brokerPort": 1883,
  "useSysTopics": true
}
```