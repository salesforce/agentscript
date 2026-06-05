/**
 * TypeScript types for service-level objects (LLMProvider, InvokableClient)
 * derived from module_graph_runtime.schemas.service Pydantic models.
 */

export interface LLMProviderMetadata {
  platform: string;
  connection?: string;
  headers?: Record<string, string | null> | null;
  timeout?: number | null;
  api_key?: string | null;
}

export interface LLMProvider {
  name: string;
  description: string;
  metadata: LLMProviderMetadata;
}

export interface InvokableClient {
  name: string;
  type: string;
  label: string;
  metadata: Record<string, unknown>;
}
