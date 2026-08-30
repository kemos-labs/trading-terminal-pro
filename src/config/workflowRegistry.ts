import registryDocument from '../../packages/contracts/src/workflows.json';

export type DeskId =
  | 'home'
  | 'vol'
  | 'positioning'
  | 'desk'
  | 'crypto'
  | 'rates'
  | 'ksa'
  | 'academy';

export interface DeskDefinition {
  id: DeskId;
  label: string;
  hotkey: string;
  defaultWorkflowId: string;
}

export interface WorkflowDefinition {
  id: string;
  desk: DeskId;
  title: string;
  purpose: string;
  deepLink: string;
  code: string;
  apiOps: string[];
  mcpTools: string[];
}

export interface WorkflowRegistryDocument {
  version: 1;
  desks: DeskDefinition[];
  workflows: WorkflowDefinition[];
}

/**
 * Canonical machine-readable product registry. The JSON source is also used by
 * OpenAPI, MCP, generation checks, and end-to-end workflow discovery.
 */
export const WORKFLOW_REGISTRY_DOCUMENT =
  registryDocument as WorkflowRegistryDocument;

export const DESK_REGISTRY: readonly DeskDefinition[] =
  WORKFLOW_REGISTRY_DOCUMENT.desks;

export const WORKFLOW_REGISTRY: readonly WorkflowDefinition[] =
  WORKFLOW_REGISTRY_DOCUMENT.workflows;

export function workflowsForDesk(desk: DeskId): readonly WorkflowDefinition[] {
  return WORKFLOW_REGISTRY.filter((workflow) => workflow.desk === desk);
}

export function workflowById(id: string): WorkflowDefinition | undefined {
  return WORKFLOW_REGISTRY.find((workflow) => workflow.id === id);
}

export function defaultWorkflowForDesk(desk: DeskId): WorkflowDefinition | undefined {
  const definition = DESK_REGISTRY.find((item) => item.id === desk);
  return definition ? workflowById(definition.defaultWorkflowId) : undefined;
}

export function deepLinkFor(desk: DeskId, sectionId?: string): string {
  if (sectionId) {
    const exact = WORKFLOW_REGISTRY.find(
      (workflow) => workflow.desk === desk && workflow.id === sectionId,
    );
    if (exact) return exact.deepLink;
  }
  return defaultWorkflowForDesk(desk)?.deepLink ?? `/?desk=${desk}`;
}
