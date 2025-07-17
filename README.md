# SignalK Mosquitto Manager

A TypeScript-based SignalK plugin for monitoring and managing Mosquitto MQTT broker with **significantly reduced sudo requirements**.

## 🚀 Key Features

### **Reduced Sudo Dependencies**
- **MQTT $SYS topics monitoring** - No bash commands needed for statistics
- **Direct port health checks** - No `netstat` or `ss` commands required  
- **User-space configuration management** - Config files in SignalK data directory
- **Optional systemd integration** - Can run completely without sudo access

### **Comprehensive Monitoring**
- Real-time broker status and health monitoring
- Connection count and performance metrics
- Automatic broker discovery and connection testing
- Detailed statistics from $SYS topics
- SignalK data publishing for dashboard integration

### **Web Management Interface**
- Modern TypeScript-based web interface
- Real-time status updates
- Configuration file editor (user-space)
- Control broker via multiple methods
- Activity logging and monitoring

### **Multiple Control Methods**
- **Auto**: Automatically choose best available method
- **MQTT**: Direct MQTT-based monitoring (no sudo)
- **Systemd**: Optional systemd integration (requires permissions)
- **Port**: Basic port-based health checking

## Installation

Install directly from GitHub:

```bash
npm install motamman/signalk-mosquitto-manager
```

Or clone and install locally:

```bash
git clone https://github.com/motamman/signalk-mosquitto-manager.git
cd signalk-mosquitto-manager
npm install
npm run build
```

## Sudo Requirements Comparison

| Feature | Original Plugin | TypeScript Version | Sudo Required? |
|---------|----------------|-------------------|----------------|
| Broker Status | `systemctl status` | MQTT + Port Check | ❌ No |
| Statistics | `ps`, `ss` commands | $SYS Topics | ❌ No |
| Connection Count | `ss \| grep \| wc` | Port monitoring | ❌ No |
| Configuration | `/etc/mosquitto/` | User data directory | ❌ No |
| Start/Stop | `systemctl` | Optional | ⚠️ Optional |
| Log Reading | `/var/log/` | Optional | ⚠️ Optional |

## Configuration

### Basic Settings

```json
{
  "enabled": true,
  "monitorInterval": 30,
  "brokerUrl": "mqtt://localhost",
  "brokerPort": 1883,
  "useSysTopics": true,
  "useSystemdControl": false
}
```

### Sudo-Free Operation

For completely sudo-free operation, set:

```json
{
  "useSystemdControl": false,
  "useSysTopics": true,
  "confDPath": "/home/signalk/.signalk/mosquitto-configs"
}
```

This configuration:
- Uses MQTT $SYS topics for monitoring (no bash commands)
- Stores configs in user-writable directory
- Monitors via direct MQTT connections
- Provides all essential functionality without elevated permissions

### Optional Systemd Integration

If you want systemd control and have appropriate permissions:

```json
{
  "useSystemdControl": true,
  "enableSystemControl": true
}
```

## Configuration Options

| Option | Default | Description | Sudo Required? |
|--------|---------|-------------|----------------|
| `enabled` | `true` | Enable/disable plugin | ❌ |
| `monitorInterval` | `30` | Check interval (seconds) | ❌ |
| `brokerUrl` | `mqtt://localhost` | MQTT broker URL | ❌ |
| `brokerPort` | `1883` | MQTT broker port | ❌ |
| `serviceName` | `mosquitto` | Systemd service name | ⚠️ (if systemd used) |
| `confDPath` | `${dataDir}/mosquitto-configs` | Config directory | ❌ |
| `useSysTopics` | `true` | Monitor $SYS topics | ❌ |
| `useSystemdControl` | `false` | Enable systemctl commands | ⚠️ |
| `enableSystemControl` | `true` | Show control buttons | ❌ |

## Monitoring Methods

### 1. MQTT $SYS Topics (Recommended)
```typescript
// Subscribes to broker statistics topics
$SYS/broker/uptime
$SYS/broker/clients/connected  
$SYS/broker/messages/received
$SYS/broker/bytes/sent
// No bash commands needed!
```

### 2. Direct Port Monitoring
```typescript
// Tests if MQTT port is accessible
const socket = new net.Socket();
socket.connect(1883, 'localhost');
// No netstat/ss commands needed!
```

### 3. MQTT Connection Health
```typescript
// Direct MQTT client connection test  
const client = mqtt.connect('mqtt://localhost:1883');
client.on('connect', () => { /* healthy */ });
// No systemctl commands needed!
```

## Web Interface

Access the management interface at:
`http://your-signalk-server/plugins/signalk-mosquitto-manager/`

### Features:
- **Real-time Status**: Live broker status and health indicators
- **Statistics Dashboard**: Connections, messages, bytes transferred
- **Configuration Editor**: Edit config files in user-space
- **Control Panel**: Start/stop broker (if permissions allow)
- **Method Selection**: Choose monitoring/control method
- **Activity Logs**: Real-time operation logging

## SignalK Data Publishing

The plugin publishes broker data to SignalK:

```
vessels.self.system.mqtt.broker.status.running
vessels.self.system.mqtt.broker.status.reachable  
vessels.self.system.mqtt.broker.connections.count
vessels.self.system.mqtt.broker.stats.clientsConnected
vessels.self.system.mqtt.broker.stats.messagesReceived
vessels.self.system.mqtt.broker.stats.messagesSent
```

## Setting Up Sudo-Free Operation

### 1. User Configuration Directory
The plugin creates configs in the SignalK data directory:
```bash
~/.signalk/mosquitto-configs/
```

### 2. Mosquitto $SYS Topics
Ensure Mosquitto publishes statistics by adding to `mosquitto.conf`:
```
# Enable $SYS topics  
sys_interval 10
```

### 3. MQTT Access
Ensure the SignalK user can connect to MQTT:
```bash
# Test MQTT connection
mosquitto_pub -h localhost -t test -m "hello"
```

## Troubleshooting

### No Statistics Showing
1. Check if $SYS topics are enabled in Mosquitto
2. Verify MQTT connection in web interface
3. Check broker allows client connections

### Control Buttons Disabled  
1. Set `enableSystemControl: true` in config
2. For systemd control: ensure user permissions
3. Alternative: use external systemd user service

### Permission Errors
1. Check config directory is writable
2. Verify MQTT broker accessibility
3. Consider sudo-free configuration options

## Development

### Building
```bash
npm run build
```

### Development Mode
```bash
npm run dev
```

### Project Structure
```
src/
├── index.ts      # Main plugin logic  
└── types.ts      # TypeScript interfaces
public/
├── index.html    # Web interface
└── mosquitto.png # Icon
dist/             # Compiled JavaScript
```

## Comparison with Original

| Aspect | Original JS | TypeScript Version |
|--------|-------------|-------------------|
| Sudo Dependencies | High | Minimal |
| Type Safety | None | Full |
| Error Handling | Basic | Comprehensive |
| Monitoring Method | Bash commands | MQTT + Direct |
| Config Management | System files | User-space |
| Maintainability | Limited | Enhanced |

## Migration from Original

1. **Install TypeScript version**
2. **Update configuration** to use user directory
3. **Disable systemd control** if sudo-free desired
4. **Enable $SYS topics** in Mosquitto
5. **Test functionality** with reduced permissions

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch  
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

---

**This TypeScript version provides the same functionality as the original with significantly reduced sudo requirements, making it more suitable for containerized and security-conscious environments.**