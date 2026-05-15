// OAuth 2.0 Flow for Google Gemini

export interface GeminiOAuthTokens {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	token_type?: string;
}

export interface GeminiOAuthConfig {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	scopes: string[];
}

const DEFAULT_GEMINI_SCOPES = [
	'https://www.googleapis.com/auth/generative.language',
	'openid',
	'email',
];

/**
 * Gemini OAuth Manager
 * Handles OAuth 2.0 flow for Google Gemini authentication
 */
export class GeminiOAuth {
	private config: GeminiOAuthConfig;
	private tokens?: GeminiOAuthTokens;
	private tokenExpiresAt?: number;

	constructor(config: GeminiOAuthConfig) {
		this.config = {
			...config,
			scopes: config.scopes || DEFAULT_GEMINI_SCOPES,
		};
	}

	/**
	 * Generate the OAuth authorization URL
	 */
	getAuthorizationUrl(): string {
		const params = new URLSearchParams({
			client_id: this.config.clientId,
			redirect_uri: this.config.redirectUri,
			response_type: 'code',
			scope: this.config.scopes.join(' '),
			access_type: 'offline', // Enables refresh tokens
			prompt: 'consent', // Ensures we get a refresh token
		});

		return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
	}

	/**
	 * Exchange authorization code for access tokens
	 */
	async exchangeCodeForTokens(code: string): Promise<GeminiOAuthTokens> {
		const response = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				code,
				client_id: this.config.clientId,
				client_secret: this.config.clientSecret,
				redirect_uri: this.config.redirectUri,
				grant_type: 'authorization_code',
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OAuth token exchange failed: ${error}`);
		}

		const tokens = await response.json() as GeminiOAuthTokens;
		this.setTokens(tokens);
		return tokens;
	}

	/**
	 * Refresh access token using refresh token
	 */
	async refreshAccessToken(): Promise<GeminiOAuthTokens> {
		if (!this.tokens?.refresh_token) {
			throw new Error('No refresh token available. Please re-authenticate.');
		}

		const response = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				refresh_token: this.tokens.refresh_token,
				client_id: this.config.clientId,
				client_secret: this.config.clientSecret,
				grant_type: 'refresh_token',
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OAuth token refresh failed: ${error}`);
		}

		const newTokens = await response.json() as GeminiOAuthTokens;
		// Preserve refresh token if not returned
		if (!newTokens.refresh_token && this.tokens.refresh_token) {
			newTokens.refresh_token = this.tokens.refresh_token;
		}

		this.setTokens(newTokens);
		return newTokens;
	}

	/**
	 * Set tokens and calculate expiration
	 */
	setTokens(tokens: GeminiOAuthTokens): void {
		this.tokens = tokens;
		this.tokenExpiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;
	}

	/**
	 * Get current access token, refreshing if needed
	 */
	async getAccessToken(): Promise<string> {
		if (!this.tokens) {
			throw new Error('Not authenticated. Please complete OAuth flow.');
		}

		if (this.isTokenExpired()) {
			await this.refreshAccessToken();
		}

		return this.tokens.access_token;
	}

	/**
	 * Check if token is expired or will expire soon
	 */
	isTokenExpired(bufferSeconds: number = 300): boolean {
		if (!this.tokenExpiresAt) return true;
		return Date.now() >= (this.tokenExpiresAt - bufferSeconds * 1000);
	}

	/**
	 * Check if authenticated with valid tokens
	 */
	isAuthenticated(): boolean {
		return !!this.tokens && !this.isTokenExpired();
	}

	/**
	 * Clear all tokens (logout)
	 */
	clearTokens(): void {
		this.tokens = undefined;
		this.tokenExpiresAt = undefined;
	}

	/**
	 * Get tokens for storage
	 */
	getTokensForStorage(): Partial<GeminiOAuthTokens> {
		if (!this.tokens) return {};
		return {
			access_token: this.tokens.access_token,
			refresh_token: this.tokens.refresh_token,
			expires_in: this.tokenExpiresAt
				? Math.floor((this.tokenExpiresAt - Date.now()) / 1000)
				: this.tokens.expires_in,
		};
	}

	/**
	 * Restore tokens from storage
	 */
	restoreTokens(tokens: Partial<GeminiOAuthTokens>): void {
		if (tokens.access_token && tokens.refresh_token) {
			this.setTokens({
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token,
				expires_in: tokens.expires_in || 3600,
				token_type: tokens.token_type || 'Bearer',
			});
		}
	}
}

/**
 * In-memory OAuth callback handler for Obsidian
 * Since Obsidian plugins run in an embedded context,
 * we use a simpler approach with manual code entry
 */
export class GeminiOAuthManualFlow {
	private oauth: GeminiOAuth;
	private pendingResolve?: (code: string) => void;
	private pendingReject?: (error: Error) => void;

	constructor(config: GeminiOAuthConfig) {
		this.oauth = new GeminiOAuth(config);
	}

	/**
	 * Start OAuth flow - returns promise that resolves when user enters code
	 */
	async authenticate(): Promise<GeminiOAuthTokens> {
		// Open browser for OAuth
		const authUrl = this.oauth.getAuthorizationUrl();
		window.open(authUrl, '_blank');

		// Return promise that will be resolved when user enters code
		return new Promise((resolve, reject) => {
			this.pendingResolve = (code: string) => {
				this.oauth.exchangeCodeForTokens(code)
					.then(resolve)
					.catch(reject);
			};
			this.pendingReject = reject;
		});
	}

	/**
	 * Call this when user provides the authorization code
	 */
	async submitAuthorizationCode(code: string): Promise<void> {
		if (this.pendingResolve) {
			this.pendingResolve(code);
			this.pendingResolve = undefined;
			this.pendingReject = undefined;
		}
	}

	/**
	 * Get access token, refreshing if needed
	 */
	async getAccessToken(): Promise<string> {
		return this.oauth.getAccessToken();
	}

	/**
	 * Check if authenticated
	 */
	isAuthenticated(): boolean {
		return this.oauth.isAuthenticated();
	}

	/**
	 * Logout
	 */
	logout(): void {
		this.oauth.clearTokens();
	}

	/**
	 * Get tokens for storage
	 */
	getTokensForStorage(): Partial<GeminiOAuthTokens> {
		return this.oauth.getTokensForStorage();
	}

	/**
	 * Restore tokens from storage
	 */
	restoreTokens(tokens: Partial<GeminiOAuthTokens>): void {
		this.oauth.restoreTokens(tokens);
	}
}

/**
 * Default OAuth configuration for Gemini
 * Users need to provide their own client ID/secret from Google Cloud Console
 */
export function createDefaultGeminiOAuth(clientId: string, clientSecret: string): GeminiOAuthManualFlow {
	return new GeminiOAuthManualFlow({
		clientId,
		clientSecret,
		redirectUri: 'urn:ietf:wg:oauth:2.0:oob', // Out-of-band (manual code entry)
		scopes: DEFAULT_GEMINI_SCOPES,
	});
}
