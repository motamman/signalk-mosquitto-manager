import * as fs from 'fs-extra';
import * as path from 'path';
import { Router } from 'express';
import { connect, MqttClient } from 'mqtt';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as net from 'net';
import {
  SignalKApp,
  SignalKPlugin,
  MosquittoManagerConfig,
  BrokerStatus,
  BrokerStats,
  BrokerSysStats,
  ProcessStats,
  ConfigFile,
  PluginState,
  TypedRequest,
  TypedResponse,
  StatusApiResponse,
  ConfigFilesApiResponse,
  ConfigFileContentApiResponse,
  ControlApiResponse,
  ApiResponse,
  MqttConnectionHealth,
  SysStatsCollector,
  HealthCheckResult,
  ServiceControlResult,
  PortCheckResult,
  SignalKMessage,
  ControlMethod,
  BrokerAction,
  MosquittoManagerError
} from './types';

const execAsync = promisify(exec);

// Global plugin state
let appInstance: SignalKApp;

export = function(app: SignalKApp): SignalKPlugin {
  // Store app instance for global access
  appInstance = app;
  
  const plugin: SignalKPlugin = {
    id: 'signalk-mosquitto-manager',
    name: 'SignalK Mosquitto Manager',
    description: 'Monitor and manage Mosquitto MQTT broker with webapp interface (TypeScript)',
    schema: {},
    start: () => {},
    stop: () => {},
    registerWithRouter: undefined
  };

  // Plugin state
  const state: PluginState = {
    mqttClient: null,
    monitoringClient: null,
    brokerStats: {
      status: {
        running: false,
        reachable: false,
        pid: null,
        uptime: null,
        lastCheck: new Date().toISOString(),
        connectionMethod: 'mqtt'
      },
      connectionCount: 0,
      logSize: 0,
      lastUpdated: new Date().toISOString()
    },
    configFiles: [],
    currentConfig: undefined,
    timers: [],
    connectionHealth: {
      connected: false,
      subscriptions: []
    },
    sysStatsCollector: null
  };

  plugin.start = function(options: Partial<MosquittoManagerConfig>): void {
    app.debug('Starting SignalK Mosquitto Manager plugin');
    
    const config: MosquittoManagerConfig = {
      enabled: options?.enabled !== false,
      monitorInterval: (options?.monitorInterval || 30) * 1000,
      brokerUrl: options?.brokerUrl || 'mqtt://localhost',
      brokerPort: options?.brokerPort || 1883,
      serviceName: options?.serviceName || 'mosquitto',
      configPath: options?.configPath || '/etc/mosquitto/mosquitto.conf',
      confDPath: options?.confDPath || path.join(app.getDataDirPath(), 'mosquitto-configs'),
      logPath: options?.logPath || '/var/log/mosquitto/mosquitto.log',
      sourceLabel: options?.sourceLabel || 'signalk-mosquitto-manager',
      enableWebInterface: options?.enableWebInterface !== false,
      enableStatistics: options?.enableStatistics !== false,
      enableSystemControl: options?.enableSystemControl !== false,
      useSystemdControl: options?.useSystemdControl !== false,
      useSysTopics: options?.useSysTopics !== false
    };

    state.currentConfig = config;
    plugin.config = config;

    if (!config.enabled) {
      app.debug('Mosquitto Manager plugin disabled');
      return;
    }

    // Ensure user config directory exists
    ensureConfigDirectory(config.confDPath);

    // Initialize monitoring
    initializeMonitoring(config);

    app.debug('SignalK Mosquitto Manager plugin started');
  };

  plugin.stop = function(): void {
    app.debug('Stopping SignalK Mosquitto Manager plugin');
    
    // Clear all timers
    state.timers.forEach(timer => clearInterval(timer));
    state.timers = [];

    // Disconnect MQTT clients
    if (state.mqttClient) {
      state.mqttClient.end();
      state.mqttClient = null;
    }

    if (state.monitoringClient) {
      state.monitoringClient.end();
      state.monitoringClient = null;
    }

    if (state.sysStatsCollector) {
      state.sysStatsCollector.client.end();
      state.sysStatsCollector = null;
    }

    app.debug('SignalK Mosquitto Manager plugin stopped');
  };

  // Initialize monitoring without bash dependencies
  function initializeMonitoring(config: MosquittoManagerConfig): void {
    // Start health monitoring
    const healthTimer = setInterval(() => {
      performHealthCheck(config);
    }, config.monitorInterval);
    
    state.timers.push(healthTimer);

    // Initialize $SYS topics monitoring if enabled
    if (config.useSysTopics) {
      initializeSysTopicsMonitoring(config);
    }

    // Initial health check
    performHealthCheck(config);

    app.debug(`Mosquitto monitoring initialized with ${config.monitorInterval / 1000}s interval`);
  }

  // Perform comprehensive health check without bash commands
  async function performHealthCheck(config: MosquittoManagerConfig): Promise<void> {
    const timestamp = new Date().toISOString();
    app.debug('Performing Mosquitto health check...');

    try {
      const health: HealthCheckResult = {
        mqtt: false,
        process: false,
        port: false,
        timestamp
      };

      // Check if MQTT port is accessible
      health.port = await checkPort(config.brokerPort);
      app.debug(`Port check result: ${health.port}`);
      
      // Check MQTT connection
      health.mqtt = await checkMqttConnection(config);
      app.debug(`MQTT connection check result: ${health.mqtt}`);

      // Check systemd service if enabled
      if (config.useSystemdControl) {
        health.systemd = await checkSystemdService(config.serviceName);
        app.debug(`Systemd check result: ${health.systemd}`);
      }

      // Update broker status
      updateBrokerStatus(health, timestamp);

      // Collect additional stats if broker is running
      if (health.mqtt || health.port) {
        app.debug('Collecting broker statistics...');
        await collectBrokerStatistics(config, timestamp);
      } else {
        app.debug('Skipping statistics collection - broker not reachable');
      }

      // Publish status to SignalK
      publishBrokerStatus(timestamp);

    } catch (error) {
      app.error('Error during health check:', (error as Error).message);
      
      // Update status with error
      state.brokerStats.status = {
        running: false,
        reachable: false,
        pid: null,
        uptime: null,
        lastCheck: timestamp,
        connectionMethod: 'mqtt',
        error: (error as Error).message
      };
    }
  }

  // Check if port is open without netstat/ss
  function checkPort(port: number, host: string = 'localhost'): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      
      socket.setTimeout(3000);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.on('error', () => {
        resolve(false);
      });
      
      socket.connect(port, host);
    });
  }

  // Check MQTT connection health
  function checkMqttConnection(config: MosquittoManagerConfig): Promise<boolean> {
    return new Promise((resolve) => {
      const client = connect(`${config.brokerUrl}:${config.brokerPort}`, {
        clientId: `${config.sourceLabel}-health-check-${Date.now()}`,
        connectTimeout: 5000,
        reconnectPeriod: 0
      });

      client.on('connect', () => {
        state.connectionHealth = {
          connected: true,
          connectedAt: new Date().toISOString(),
          subscriptions: []
        };
        client.end();
        resolve(true);
      });

      client.on('error', (error) => {
        state.connectionHealth = {
          connected: false,
          subscriptions: [],
          error: error.message
        };
        resolve(false);
      });

      setTimeout(() => {
        if (!client.connected) {
          client.end();
          resolve(false);
        }
      }, 5000);
    });
  }

  // Check systemd service status (optional - requires minimal permissions)
  async function checkSystemdService(serviceName: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`systemctl is-active ${serviceName}`);
      return stdout.trim() === 'active';
    } catch {
      return false;
    }
  }

  // Initialize $SYS topics monitoring for statistics
  function initializeSysTopicsMonitoring(config: MosquittoManagerConfig): void {
    app.debug(`Initializing $SYS topics monitoring for ${config.brokerUrl}:${config.brokerPort}`);
    
    const client = connect(`${config.brokerUrl}:${config.brokerPort}`, {
      clientId: `${config.sourceLabel}-sys-monitor`,
      clean: true
    });

    const sysTopics = [
      '$SYS/broker/uptime',
      '$SYS/broker/version',
      '$SYS/broker/clients/connected',
      '$SYS/broker/clients/total',
      '$SYS/broker/messages/received',
      '$SYS/broker/messages/sent',
      '$SYS/broker/bytes/received',
      '$SYS/broker/bytes/sent',
      '$SYS/broker/subscriptions/count',
      '$SYS/broker/retained messages/count',
      '$SYS/broker/stored messages/count',
      '$SYS/broker/publish/dropped',
      '$SYS/broker/publish/received'
    ];

    client.on('connect', () => {
      app.debug('Connected to $SYS topics for statistics monitoring');
      app.debug('Subscribing to topics:', sysTopics);
      
      client.subscribe(sysTopics, (err) => {
        if (err) {
          app.error('Failed to subscribe to $SYS topics:', err);
        } else {
          app.debug('Successfully subscribed to all $SYS topics');
        }
      });
      
      state.sysStatsCollector = {
        client,
        stats: new Map(),
        lastUpdated: new Date().toISOString(),
        isSubscribed: true
      };
    });

    client.on('message', (topic: string, message: Buffer) => {
      if (state.sysStatsCollector) {
        const value = message.toString();
        const parsedValue = parseSysTopicValue(topic, value);
        app.debug(`$SYS message received: ${topic} = ${value} (parsed: ${parsedValue})`);
        state.sysStatsCollector.stats.set(topic, parsedValue);
        state.sysStatsCollector.lastUpdated = new Date().toISOString();
      }
    });

    client.on('error', (error) => {
      app.error('$SYS topics monitoring error:', error.message);
    });

    client.on('disconnect', () => {
      app.debug('$SYS topics monitoring disconnected');
    });
  }

  // Parse $SYS topic values
  function parseSysTopicValue(topic: string, value: string): any {
    // Convert string values to appropriate types
    if (topic.includes('/count') || topic.includes('/received') || topic.includes('/sent') || 
        topic.includes('/dropped') || topic.includes('/clients/')) {
      return parseInt(value) || 0;
    }
    
    if (topic.includes('/uptime')) {
      return parseFloat(value) || 0;
    }
    
    return value;
  }

  // Update broker status based on health check
  function updateBrokerStatus(health: HealthCheckResult, timestamp: string): void {
    const wasRunning = state.brokerStats.status.running;
    
    state.brokerStats.status = {
      running: health.mqtt || health.port,
      reachable: health.port,
      pid: null, // Would need process monitoring for this
      uptime: state.sysStatsCollector?.stats.get('$SYS/broker/uptime') || null,
      lastCheck: timestamp,
      connectionMethod: health.mqtt ? 'mqtt' : (health.systemd ? 'systemd' : 'port'),
      activeState: health.systemd ? 'active' : (health.mqtt ? 'connected' : 'inactive')
    };

    // Log status changes
    if (wasRunning !== state.brokerStats.status.running) {
      const status = state.brokerStats.status.running ? 'started' : 'stopped';
      app.debug(`Mosquitto broker ${status}`);
    }
  }

  // Collect broker statistics
  async function collectBrokerStatistics(config: MosquittoManagerConfig, timestamp: string): Promise<void> {
    try {
      // Get $SYS stats if available
      if (state.sysStatsCollector?.stats.size) {
        app.debug(`Found ${state.sysStatsCollector.stats.size} $SYS statistics`);
        state.brokerStats.sysStats = extractSysStats(state.sysStatsCollector.stats);
        app.debug('Extracted sysStats:', JSON.stringify(state.brokerStats.sysStats, null, 2));
      } else {
        app.debug('No $SYS statistics available - collector:', !!state.sysStatsCollector, 'size:', state.sysStatsCollector?.stats.size || 0);
      }

      // Count connections by checking port
      const connectionCount = await countConnections(config.brokerPort);
      state.brokerStats.connectionCount = connectionCount;
      app.debug(`Connection count: ${connectionCount}`);

      // Get log file size if accessible
      try {
        if (await fs.pathExists(config.logPath)) {
          const stats = await fs.stat(config.logPath);
          state.brokerStats.logSize = stats.size;
          app.debug(`Log file size: ${stats.size} bytes`);
        } else {
          app.debug(`Log file not found: ${config.logPath}`);
        }
      } catch (error) {
        app.debug(`Could not access log file: ${(error as Error).message}`);
      }

      state.brokerStats.lastUpdated = timestamp;

    } catch (error) {
      app.error('Error collecting broker statistics:', (error as Error).message);
    }
  }

  // Extract statistics from $SYS topics
  function extractSysStats(statsMap: Map<string, any>): BrokerSysStats {
    return {
      uptime: statsMap.get('$SYS/broker/uptime') || 0,
      version: statsMap.get('$SYS/broker/version') || 'unknown',
      clientsConnected: statsMap.get('$SYS/broker/clients/connected') || 0,
      clientsTotal: statsMap.get('$SYS/broker/clients/total') || 0,
      messagesReceived: statsMap.get('$SYS/broker/messages/received') || 0,
      messagesSent: statsMap.get('$SYS/broker/messages/sent') || 0,
      bytesReceived: statsMap.get('$SYS/broker/bytes/received') || 0,
      bytesSent: statsMap.get('$SYS/broker/bytes/sent') || 0,
      subscriptionsCount: statsMap.get('$SYS/broker/subscriptions/count') || 0,
      retainedMessages: statsMap.get('$SYS/broker/retained messages/count') || 0,
      storedMessages: statsMap.get('$SYS/broker/stored messages/count') || 0,
      publishDropped: statsMap.get('$SYS/broker/publish/dropped') || 0,
      publishReceived: statsMap.get('$SYS/broker/publish/received') || 0
    };
  }

  // Count active connections (simplified approach)
  async function countConnections(port: number): Promise<number> {
    try {
      // This is a simplified count - could be enhanced with more sophisticated monitoring
      const { stdout } = await execAsync(`ss -tln | grep :${port} | wc -l`);
      return parseInt(stdout.trim()) || 0;
    } catch {
      return 0;
    }
  }

  // Publish broker status to SignalK
  function publishBrokerStatus(timestamp: string): void {
    try {
      const messages: SignalKMessage[] = [
        createSignalKMessage('system.mqtt.broker.status.running', state.brokerStats.status.running, timestamp, undefined, 'Broker running status'),
        createSignalKMessage('system.mqtt.broker.status.reachable', state.brokerStats.status.reachable, timestamp, undefined, 'Broker reachable status'),
        createSignalKMessage('system.mqtt.broker.status.lastCheck', state.brokerStats.status.lastCheck, timestamp, undefined, 'Last status check'),
        createSignalKMessage('system.mqtt.broker.connections.count', state.brokerStats.connectionCount, timestamp, undefined, 'Connection count')
      ];

      if (state.brokerStats.status.uptime) {
        messages.push(createSignalKMessage('system.mqtt.broker.status.uptime', state.brokerStats.status.uptime, timestamp, 's', 'Broker uptime'));
      }

      if (state.brokerStats.sysStats) {
        const stats = state.brokerStats.sysStats;
        messages.push(
          createSignalKMessage('system.mqtt.broker.stats.clientsConnected', stats.clientsConnected, timestamp, undefined, 'Connected clients'),
          createSignalKMessage('system.mqtt.broker.stats.messagesReceived', stats.messagesReceived, timestamp, undefined, 'Messages received'),
          createSignalKMessage('system.mqtt.broker.stats.messagesSent', stats.messagesSent, timestamp, undefined, 'Messages sent'),
          createSignalKMessage('system.mqtt.broker.stats.bytesReceived', stats.bytesReceived, timestamp, 'B', 'Bytes received'),
          createSignalKMessage('system.mqtt.broker.stats.bytesSent', stats.bytesSent, timestamp, 'B', 'Bytes sent')
        );
      }

      // Emit all messages
      messages.forEach(message => {
        if (message) {
          app.handleMessage(plugin.id, message);
        }
      });

      // Console summary
      const statusText = state.brokerStats.status.running ? 'Running' : 'Stopped';
      const connectionsText = state.brokerStats.connectionCount > 0 ? ` (${state.brokerStats.connectionCount} connections)` : '';
      console.log(`[${plugin.id}] Mosquitto: ${statusText}${connectionsText}`);

    } catch (error) {
      app.error('Error publishing broker status:', (error as Error).message);
    }
  }

  // Create SignalK message
  function createSignalKMessage(path: string, value: any, timestamp: string, units?: string, description?: string): SignalKMessage {
    const message: SignalKMessage = {
      context: 'vessels.self',
      updates: [{
        source: {
          label: state.currentConfig?.sourceLabel || 'signalk-mosquitto-manager',
          type: 'plugin'
        },
        timestamp,
        values: [{
          path,
          value
        }]
      }]
    };

    // Add metadata if provided
    if (units || description) {
      message.updates[0].meta = [{
        path,
        value: {
          ...(units && { units }),
          ...(description && { description })
        }
      }];
    }

    return message;
  }

  // Ensure config directory exists
  function ensureConfigDirectory(confDPath: string): void {
    try {
      fs.ensureDirSync(confDPath);
      app.debug(`Config directory ensured: ${confDPath}`);
    } catch (error) {
      app.error(`Failed to create config directory: ${(error as Error).message}`);
    }
  }

  // Configuration file management (user-space)
  async function listConfigFiles(): Promise<ConfigFile[]> {
    try {
      const confDPath = state.currentConfig?.confDPath;
      if (!confDPath || !await fs.pathExists(confDPath)) {
        return [];
      }

      const files = await fs.readdir(confDPath);
      const confFiles = files.filter(file => file.endsWith('.conf'));
      
      const configFiles: ConfigFile[] = [];
      
      for (const file of confFiles) {
        const filePath = path.join(confDPath, file);
        const stats = await fs.stat(filePath);
        
        configFiles.push({
          name: file,
          path: filePath,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          writable: true // User-space files are writable
        });
      }

      return configFiles.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      app.error('Error listing config files:', (error as Error).message);
      return [];
    }
  }

  // Read configuration file
  async function readConfigFile(fileName: string): Promise<string | null> {
    try {
      const confDPath = state.currentConfig?.confDPath;
      if (!confDPath) return null;

      const filePath = path.join(confDPath, fileName);
      if (await fs.pathExists(filePath)) {
        return await fs.readFile(filePath, 'utf8');
      }
      return null;
    } catch (error) {
      app.error('Error reading config file:', (error as Error).message);
      return null;
    }
  }

  // Write configuration file
  async function writeConfigFile(fileName: string, content: string): Promise<void> {
    const confDPath = state.currentConfig?.confDPath;
    if (!confDPath) {
      throw new MosquittoManagerError('Config directory not configured', 'CONFIG_DIR_NOT_SET');
    }

    const filePath = path.join(confDPath, fileName);
    
    try {
      // Create backup if file exists
      if (await fs.pathExists(filePath)) {
        const backupPath = `${filePath}.backup.${Date.now()}`;
        await fs.copy(filePath, backupPath);
        app.debug(`Backed up existing config to: ${backupPath}`);
      }

      await fs.writeFile(filePath, content, 'utf8');
      app.debug(`Configuration written to: ${filePath}`);
      
    } catch (error) {
      throw new MosquittoManagerError(`Failed to write config file: ${(error as Error).message}`, 'CONFIG_WRITE_ERROR');
    }
  }

  // Control broker (with multiple methods)
  async function controlBroker(action: BrokerAction, method: ControlMethod = 'auto'): Promise<ServiceControlResult> {
    app.debug(`Attempting to ${action} mosquitto broker using ${method} method...`);
    
    if (!state.currentConfig) {
      throw new MosquittoManagerError('Plugin not configured', 'NOT_CONFIGURED');
    }

    const config = state.currentConfig;
    
    try {
      let result: ServiceControlResult;

      if (method === 'systemd' || (method === 'auto' && config.useSystemdControl)) {
        result = await controlViaSystemd(action, config.serviceName);
      } else if (method === 'mqtt' || method === 'auto') {
        result = await controlViaMqtt(action, config);
      } else {
        throw new MosquittoManagerError(`Unsupported control method: ${method}`, 'UNSUPPORTED_METHOD');
      }

      // Wait a moment then check status
      setTimeout(() => performHealthCheck(config), 2000);
      
      return result;
      
    } catch (error) {
      throw new MosquittoManagerError(`Failed to ${action} broker: ${(error as Error).message}`, 'CONTROL_ERROR');
    }
  }

  // Control via systemd (requires appropriate permissions)
  async function controlViaSystemd(action: BrokerAction, serviceName: string): Promise<ServiceControlResult> {
    try {
      const command = `systemctl ${action} ${serviceName}`;
      const { stdout, stderr } = await execAsync(command);
      
      app.debug(`Systemd command executed: ${command}`);
      if (stderr) {
        app.debug(`Systemd stderr: ${stderr}`);
      }
      
      return {
        success: true,
        method: 'systemd' as const,
        message: `Broker ${action}ed successfully via systemd`
      };
    } catch (error) {
      const execError = error as any;
      let errorMessage = `Failed to ${action} via systemd: `;
      
      if (execError.code === 'ENOENT') {
        errorMessage += 'systemctl command not found';
      } else if (execError.stderr) {
        errorMessage += execError.stderr.trim();
      } else if (execError.message) {
        errorMessage += execError.message;
      } else {
        errorMessage += 'Unknown systemd error';
      }
      
      // Check for common permission issues
      if (errorMessage.includes('Permission denied') || errorMessage.includes('authentication')) {
        errorMessage += '. User may need sudo permissions for systemctl commands.';
      }
      
      app.debug(`Systemd control error: ${errorMessage}`);
      
      return {
        success: false,
        method: 'systemd' as const,
        message: `Failed to ${action} via systemd`,
        error: errorMessage
      };
    }
  }

  // Control via MQTT (send administrative commands)
  async function controlViaMqtt(action: BrokerAction, config: MosquittoManagerConfig): Promise<ServiceControlResult> {
    // MQTT-based control requires special broker configuration
    // This is a placeholder for future implementation
    
    app.debug(`MQTT control attempted for ${action} - not implemented`);
    
    return {
      success: false,
      method: 'mqtt' as const,
      message: `MQTT control not implemented`,
      error: `MQTT-based broker control for '${action}' is not yet implemented. This requires special broker administrative plugin configuration. Please use systemd method or manage the broker externally via system commands.`
    };
  }

  // Plugin webapp routes
  plugin.registerWithRouter = function(router: Router): void {
    const express = require('express');
    
    app.debug('registerWithRouter called for mosquitto manager');
    
    // API Routes
    
    // Get broker status and statistics
    router.get('/api/status', (_: TypedRequest, res: TypedResponse<StatusApiResponse>) => {
      app.debug('Status API called');
      app.debug('Current config:', JSON.stringify(state.currentConfig, null, 2));
      app.debug('Broker stats:', JSON.stringify(state.brokerStats, null, 2));
      app.debug('SysStats collector:', state.sysStatsCollector ? 'active' : 'inactive');
      
      res.json({
        success: true,
        status: state.brokerStats.status,
        stats: state.brokerStats,
        config: {
          serviceName: state.currentConfig?.serviceName || 'mosquitto',
          brokerUrl: state.currentConfig?.brokerUrl || 'mqtt://localhost',
          brokerPort: state.currentConfig?.brokerPort || 1883,
          useSystemdControl: state.currentConfig?.useSystemdControl || false,
          useSysTopics: state.currentConfig?.useSysTopics || false
        }
      });
    });

    // Control endpoints
    router.post('/api/control/:action', async (req: TypedRequest, res: TypedResponse<ControlApiResponse>) => {
      const action = req.params.action as BrokerAction;
      const method = req.body?.method as ControlMethod || 'auto';
      
      if (!['start', 'stop', 'restart', 'reload'].includes(action)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid action. Use start, stop, restart, or reload.',
          action,
          method
        });
      }

      try {
        const result = await controlBroker(action, method);
        
        if (result.success) {
          res.json({ 
            success: true, 
            message: result.message,
            action,
            method: result.method
          });
        } else {
          // Handle failed control operations
          res.status(400).json({ 
            success: false, 
            error: result.error || result.message || 'Control operation failed',
            action,
            method: result.method
          });
        }
      } catch (error) {
        const errorMessage = error instanceof MosquittoManagerError 
          ? error.message 
          : (error as Error).message || 'Unknown error occurred';
        
        res.status(500).json({ 
          success: false, 
          error: errorMessage,
          action,
          method
        });
      }
    });

    // Configuration file endpoints
    router.get('/api/config', async (_: TypedRequest, res: TypedResponse<ConfigFilesApiResponse>) => {
      try {
        const files = await listConfigFiles();
        res.json({ success: true, files });
      } catch (error) {
        res.status(500).json({ success: false, error: (error as Error).message, files: [] });
      }
    });

    router.get('/api/config/:filename', async (req: TypedRequest, res: TypedResponse<ConfigFileContentApiResponse>) => {
      try {
        const fileName = req.params.filename;
        const content = await readConfigFile(fileName);
        
        if (content !== null) {
          res.json({ 
            success: true, 
            fileName, 
            content, 
            writable: true 
          });
        } else {
          res.status(404).json({ 
            success: false, 
            error: 'File not found',
            fileName,
            content: '',
            writable: false
          });
        }
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: (error as Error).message,
          fileName: req.params.filename,
          content: '',
          writable: false
        });
      }
    });

    router.post('/api/config/:filename', async (req: TypedRequest, res: TypedResponse<ApiResponse>) => {
      try {
        const fileName = req.params.filename;
        const content = req.body.content;
        
        if (!content) {
          return res.status(400).json({ success: false, error: 'Content is required' });
        }

        await writeConfigFile(fileName, content);
        res.json({ success: true, message: 'Configuration saved successfully' });
        
      } catch (error) {
        res.status(500).json({ success: false, error: (error as Error).message });
      }
    });

    // Health check endpoint
    router.get('/api/health', async (_: TypedRequest, res: TypedResponse<ApiResponse>) => {
      try {
        if (state.currentConfig) {
          await performHealthCheck(state.currentConfig);
        }
        res.json({ 
          success: true, 
          message: 'Health check completed',
          ...state.connectionHealth
        });
      } catch (error) {
        res.status(500).json({ success: false, error: (error as Error).message });
      }
    });

    // Serve static files
    const publicPath = path.join(__dirname, '../public');
    if (fs.existsSync(publicPath)) {
      router.use(express.static(publicPath));
      app.debug('Static files served from:', publicPath);
    }

    app.debug('Mosquitto Manager web routes registered');
  };

  // Configuration schema
  plugin.schema = {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Enable Plugin',
        description: 'Enable/disable the Mosquitto manager functionality',
        default: true
      },
      monitorInterval: {
        type: 'number',
        title: 'Monitor Interval (seconds)',
        description: 'How often to check broker status',
        default: 30,
        minimum: 5
      },
      brokerUrl: {
        type: 'string',
        title: 'Broker URL',
        description: 'MQTT broker URL (without port)',
        default: 'mqtt://localhost'
      },
      brokerPort: {
        type: 'number',
        title: 'Broker Port',
        description: 'MQTT broker port',
        default: 1883
      },
      serviceName: {
        type: 'string',
        title: 'Service Name',
        description: 'Systemd service name for mosquitto',
        default: 'mosquitto'
      },
      configPath: {
        type: 'string',
        title: 'Main Config Path',
        description: 'Path to main mosquitto.conf file',
        default: '/etc/mosquitto/mosquitto.conf'
      },
      confDPath: {
        type: 'string',
        title: 'Config Directory',
        description: 'Path to directory for additional configurations (user-writable)',
        default: ''
      },
      logPath: {
        type: 'string',
        title: 'Log File Path',
        description: 'Path to mosquitto log file',
        default: '/var/log/mosquitto/mosquitto.log'
      },
      sourceLabel: {
        type: 'string',
        title: 'Source Label',
        description: 'Source label for SignalK data',
        default: 'signalk-mosquitto-manager'
      },
      enableWebInterface: {
        type: 'boolean',
        title: 'Enable Web Interface',
        description: 'Enable web interface for broker management',
        default: true
      },
      enableStatistics: {
        type: 'boolean',
        title: 'Enable Statistics',
        description: 'Collect and publish broker statistics',
        default: true
      },
      enableSystemControl: {
        type: 'boolean',
        title: 'Enable System Control',
        description: 'Allow starting/stopping broker via systemctl',
        default: true
      },
      useSystemdControl: {
        type: 'boolean',
        title: 'Use Systemd Control',
        description: 'Use systemctl for broker control (requires appropriate permissions)',
        default: false
      },
      useSysTopics: {
        type: 'boolean',
        title: 'Monitor $SYS Topics',
        description: 'Monitor broker statistics via $SYS topics',
        default: true
      }
    }
  };

  return plugin;
};