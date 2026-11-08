export interface AnalysisTarget {
  id: string;
  sessionId: string;
  type: TargetType;
  path: string;
  metadata: Record<string, unknown>;
  hashes: TargetHashes;
  authorization: TargetAuthorization;
  addedAt: string;
  role: TargetRole;
}

export interface TargetHashes {
  sha256: string;
  md5?: string;
  sha1?: string;
}

export interface TargetAuthorization {
  type: AuthorizationType;
  description: string;
  grantedBy?: string;
  grantedAt?: string;
  scope: string[];
  limitations: string[];
  documentReference?: string;
  verified: boolean;
}

export type TargetType = 'binary' | 'android' | 'web' | 'js' | 'dotnet' | 'network';
export type TargetRole = 'primary' | 'secondary' | 'reference';
export type AuthorizationType = 'owner' | 'explicit-permission' | 'public' | 'authorized-testing';