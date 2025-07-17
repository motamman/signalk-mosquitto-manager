import { Request, Response } from 'express';
import { MqttClient } from 'mqtt';

// SignalK App interface
export interface SignalKApp {
  debug: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  handleMessage: (pluginId: string, message: SignalKMessage) => void;
  getDataDirPath: () => string;
  savePluginOptions: (options: any, callback: (error?: Error) => void) => void;
}

// SignalK Plugin interface
export interface SignalKPlugin {
  id: string;
  name: string;
  description: string;
  schema: any;
  start: (options: Partial<MosquittoManagerConfig>) => void;
  stop: () => void;
  registerWithRouter?: (router: any) => void;
  config?: MosquittoManagerConfig;
}

// Mosquitto Manager Configuration
export interface MosquittoManagerConfig {
  enabled: boolean;
  monitorInterval: number;
  brokerUrl: string;
  brokerPort: number;
  serviceName: string;
  configPath: string;
  confDPath: string;
  logPath: string;
  sourceLabel: string;
  enableWebInterface: boolean;
  enableStatistics: boolean;
  enableSystemControl: boolean;
  useSystemdControl: boolean;
  useSysTopics: boolean;
}

// Broker Status
export interface BrokerStatus {
  running: boolean;
  reachable: boolean;
  pid: number | null;
  uptime: number | null;
  lastCheck: string;
  connectionMethod: 'mqtt' | 'systemd' | 'process' | 'port';
  loadState?: string;
  activeState?: string;
  subState?: string;
  error?: string;
}

// Broker Statistics from $SYS topics
export interface BrokerSysStats {
  uptime: number;
  version: string;
  clientsConnected: number;
  clientsTotal: number;
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
  subscriptionsCount: number;
  retainedMessages: number;
  storedMessages: number;
  publishDropped: number;
  publishReceived: number;
}

// Process Statistics
export interface ProcessStats {
  pid: number;
  cpu: number;
  memory: number;
  memoryVSZ: number;
  memoryRSS: number;
  uptime: number;
}

// Combined Broker Statistics
export interface BrokerStats {
  status: BrokerStatus;
  sysStats?: BrokerSysStats;
  processStats?: ProcessStats;
  connectionCount: number;
  logSize: number;
  lastUpdated: string;
}

// Configuration File Management
export interface ConfigFile {
  name: string;
  path: string;
  size: number;
  modified: string;
  writable: boolean;
  content?: string;
}

// MQTT Connection Health
export interface MqttConnectionHealth {
  connected: boolean;
  connectedAt?: string;
  lastPing?: string;
  pingLatency?: number;
  subscriptions: string[];
  error?: string;
}

// Plugin State
export interface PluginState {
  mqttClient: MqttClient | null;
  monitoringClient: MqttClient | null;
  brokerStats: BrokerStats;
  configFiles: ConfigFile[];
  currentConfig?: MosquittoManagerConfig;
  timers: NodeJS.Timeout[];
  connectionHealth: MqttConnectionHealth;
  sysStatsCollector: SysStatsCollector | null;
}

// $SYS Topics Statistics Collector
export interface SysStatsCollector {
  client: MqttClient;
  stats: Map<string, any>;
  lastUpdated: string;
  isSubscribed: boolean;
}

// SignalK Message structures
export interface SignalKMessage {
  context: string;
  updates: SignalKUpdate[];
}

export interface SignalKUpdate {
  source: SignalKSource;
  timestamp: string;
  values: SignalKValue[];
  meta?: SignalKMeta[];
}

export interface SignalKSource {
  label: string;
  type: string;
}

export interface SignalKValue {
  path: string;
  value: any;
}

export interface SignalKMeta {
  path: string;
  value: {
    units?: string;
    description?: string;
  };
}

// API Request/Response types
export interface TypedRequest<T = any> extends Request {
  body: T;
}

export interface TypedResponse<T = any> extends Response {
  json: (obj: T) => this;
}

// API Response types
export interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface StatusApiResponse extends ApiResponse {
  status: BrokerStatus;
  stats?: BrokerStats;
  config: {
    serviceName: string;
    brokerUrl: string;
    brokerPort: number;
    useSystemdControl: boolean;
    useSysTopics: boolean;
  };
}

export interface ConfigFilesApiResponse extends ApiResponse {
  files: ConfigFile[];
}

export interface ConfigFileContentApiResponse extends ApiResponse {
  fileName: string;
  content: string;
  writable: boolean;
}

export interface ControlApiResponse extends ApiResponse {
  action: string;
  method: ControlMethod;
}

// Service Control
export interface ServiceControlResult {
  success: boolean;
  method: 'systemd' | 'mqtt' | 'process' | 'port';
  message: string;
  error?: string;
}

// Health Check Result
export interface HealthCheckResult {
  mqtt: boolean;
  process: boolean;
  systemd?: boolean;
  port: boolean;
  timestamp: string;
}

// Configuration validation
export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// File system operations
export interface FileOperationResult {
  success: boolean;
  path: string;
  operation: 'read' | 'write' | 'delete' | 'backup';
  error?: string;
}

// Network port check
export interface PortCheckResult {
  port: number;
  open: boolean;
  protocol: 'tcp' | 'udp';
  timestamp: string;
}

// Mosquitto control methods
export type ControlMethod = 'systemd' | 'mqtt' | 'process' | 'port' | 'auto';
export type BrokerAction = 'start' | 'stop' | 'restart' | 'reload' | 'status';

// $SYS topic mapping
export interface SysTopicMapping {
  [key: string]: {
    path: string;
    transform?: (value: string) => any;
    units?: string;
    description?: string;
  };
}

// Monitoring configuration
export interface MonitoringConfig {
  enabled: boolean;
  interval: number;
  healthCheck: boolean;
  sysTopics: boolean;
  processStats: boolean;
  connectionCount: boolean;
}

// Error types
export class MosquittoManagerError extends Error {
  public code: string;
  public details?: any;

  constructor(message: string, code: string, details?: any) {
    super(message);
    this.name = 'MosquittoManagerError';
    this.code = code;
    this.details = details;
  }
}

// Utility types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequiredKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

// Event types for plugin communication
export interface PluginEvent {
  type: 'status_change' | 'stats_update' | 'config_change' | 'error';
  timestamp: string;
  data: any;
}

// Configuration backup
export interface ConfigBackup {
  timestamp: string;
  files: {
    [filename: string]: string;
  };
  metadata: {
    version: string;
    createdBy: string;
  };
}