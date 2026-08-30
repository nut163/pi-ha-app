export const RISK_LEVELS = ["READ", "LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const AUTONOMY_MODES = ["guided", "balanced", "autonomous"] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export type ProviderKind =
  | "anthropic"
  | "openai"
  | "openai-compatible"
  | "local";

export interface ProviderConfig {
  kind: ProviderKind;
  model: string;
  baseUrl?: string;
  displayName?: string;
  supportsReasoning?: boolean;
  temperature?: number;
}

export interface ProviderConfigWithSecret extends ProviderConfig {
  apiKey?: string;
}

export interface AppSettings {
  provider?: ProviderConfig;
  homeAssistantUrl?: string;
  autonomy: AutonomyMode;
  defaultWorkspace: string;
  retainSessionDays: number;
  automaticBackups: "meaningful" | "every-change" | "never";
  restrictedCapabilities: string[];
  theme: "system" | "light" | "dark";
}

export interface StoredState {
  setupCompleted: boolean;
  settings: AppSettings;
}

export interface HomeAssistantUser {
  id: string | null;
  name: string | null;
  displayName: string | null;
  isAdmin: boolean;
}

export type HealthStatus = "connected" | "available" | "degraded" | "unavailable";

export interface HealthCheck {
  key: string;
  label: string;
  status: HealthStatus;
  detail: string;
  checkedAt: string;
}

export interface CapabilityManifest {
  generatedAt: string;
  installation: "home-assistant-os" | "supervised" | "container" | "core" | "unknown";
  homeAssistantVersion: string | null;
  entityCount: number | null;
  automationCount: number | null;
  deviceCount: number | null;
  areaCount: number | null;
  capabilities: HealthCheck[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  active: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export type ActivityKind =
  | "status"
  | "tool-discovery"
  | "tool-execution"
  | "file-read"
  | "file-write"
  | "diff"
  | "entity-lookup"
  | "service-call"
  | "validation"
  | "restart"
  | "backup"
  | "error"
  | "rollback"
  | "approval";

export interface ActivityEvent {
  id: string;
  sessionId: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  status?: "running" | "success" | "warning" | "error" | "pending";
  risk?: RiskLevel;
  target?: string;
  diff?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  sessionId: string | null;
  user: HomeAssistantUser;
  requestedIntent: string;
  tool: string;
  operation: string;
  target: string;
  risk: RiskLevel;
  approval: "not-required" | "pending" | "approved" | "rejected";
  beforeState?: string;
  afterState?: string;
  result: "success" | "failure" | "rolled-back" | "pending" | "rejected";
  rollbackStatus: "not-needed" | "available" | "performed" | "failed";
  error?: string;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  user: HomeAssistantUser;
  title: string;
  explanation: string;
  operation: string;
  target: string;
  risk: RiskLevel;
  toolName: string;
  arguments: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  resolvedAt?: string;
}

export interface ToolDescriptor {
  name: string;
  title: string;
  description: string;
  risk: RiskLevel;
  source: "direct" | "ha-mcp";
  readOnly: boolean;
}

export interface ToolCallResult {
  content: string;
  structured?: unknown;
  activity?: Partial<ActivityEvent>;
  diff?: string;
}

export interface PendingApprovalResult {
  approvalRequired: true;
  approval: ApprovalRequest;
}

export type ToolExecutionResult = ToolCallResult | PendingApprovalResult;

export interface SessionRecord {
  summary: SessionSummary;
  messages: ChatMessage[];
  activity: ActivityEvent[];
  piSessionFile?: string;
}

export interface ProviderTestResult {
  provider: ProviderKind;
  model: string;
  checks: Array<{
    key: "api" | "model" | "streaming";
    label: string;
    ok: boolean;
    detail: string;
  }>;
  ok: boolean;
}

export interface ConnectionStatus {
  homeAssistantUrl?: string;
  tokenConfigured: boolean;
  mcpConfigured: boolean;
}

export interface AppBootstrap {
  setupCompleted: boolean;
  settings: Omit<AppSettings, "provider"> & { provider?: ProviderConfig };
  user: HomeAssistantUser;
  capabilityManifest: CapabilityManifest;
  health: HealthCheck[];
  connections: ConnectionStatus;
  sessions: SessionSummary[];
  pendingApprovals: ApprovalRequest[];
}
