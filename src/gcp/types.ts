// GCP connector types — the service-account credential shape, the runtime
// connector status, and the v1 scope constants.
//
// Curtis v1 connects ONE Google Cloud project with READ-ONLY Cloud Storage
// tools (gcp__storage__*). Auth is a service-account key: Curtis signs a JWT
// with the key's private key (WebCrypto, RS256) and exchanges it at the
// OAuth2 token endpoint for a short-lived bearer token. No browser OAuth
// dance — the same flow `gcloud` service accounts use, and it works on
// mobile because nothing but HTTPS + WebCrypto is involved.

/** Parsed service-account key (the JSON file Google's console downloads).
 *  Only the fields Curtis needs; the rest of the file is ignored. */
export interface GcpServiceAccount {
	/** svc-acct@project.iam.gserviceaccount.com — the JWT issuer. */
	clientEmail: string;
	/** PKCS#8 PEM — the JWT signing key. */
	privateKey: string;
	/** Default project for bucket listing; informational elsewhere. */
	projectId: string;
	/** OAuth2 token endpoint — normally https://oauth2.googleapis.com/token,
	 *  but the key file is authoritative. */
	tokenUri: string;
}

export type GcpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Runtime connector state surfaced in the settings UI. Not persisted. */
export interface GcpConnectorStatus {
	state: GcpConnectionState;
	error?: string;
	/** Epoch ms when the cached access token expires (connected only). */
	tokenExpiresAt?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Least-privilege scope for v1: read-only Cloud Storage, nothing else. */
export const GCP_STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

/** Refresh the cached access token this long before its exp — clock skew
 *  between this machine and Google's token endpoint eats into the margin. */
export const GCP_TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;

/** Tool-name prefix — classifyTool maps it to the 'gcp' agent ACL class. */
export const GCP_TOOL_PREFIX = 'gcp__';
