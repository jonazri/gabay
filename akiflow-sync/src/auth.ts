import { readFileSync, writeFileSync, existsSync } from 'fs';
import { logger } from './logger.js';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface PusherAuthResponse {
  auth: string;
  channel_data?: string;
}

export class AkiflowAuth {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private refreshToken: string,
    private envPath: string,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    return this.refresh();
  }

  async refresh(): Promise<string> {
    const resp = await fetch('https://web.akiflow.com/oauth/refreshToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: '1', refresh_token: this.refreshToken }),
    });
    if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status}`);

    const data = await resp.json() as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    if (data.refresh_token && data.refresh_token !== this.refreshToken) {
      logger.info('[auth] refresh token rotated, updating .env');
      this.refreshToken = data.refresh_token;
      this.updateEnvFile(data.refresh_token);
    }

    return this.accessToken;
  }

  async getUserId(): Promise<string> {
    // Extract user ID from the JWT access token's `sub` claim — no extra API call needed.
    // The /user/me endpoint is a frontend route requiring cookie auth, not Bearer tokens.
    const token = await this.getAccessToken();
    const payload = token.split('.')[1];
    if (!payload) throw new Error('Invalid access token format');
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')) as { sub: string };
    if (!decoded.sub) throw new Error('No sub claim in access token');
    return decoded.sub;
  }

  async authorizePusherChannel(
    channelName: string,
    socketId: string,
  ): Promise<PusherAuthResponse> {
    const resp = await this.fetchWithAuth(
      'https://web.akiflow.com/api/pusherAuth',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_name: channelName, socket_id: socketId }),
      },
    );
    if (!resp.ok) throw new Error(`Pusher auth failed: ${resp.status}`);
    return resp.json() as Promise<PusherAuthResponse>;
  }

  async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    const resp = await fetch(url, {
      ...options,
      headers: { ...options.headers as Record<string, string>, Authorization: `Bearer ${token}` },
    });

    if (resp.status === 401) {
      await this.refresh();
      const newToken = await this.getAccessToken();
      return fetch(url, {
        ...options,
        headers: { ...options.headers as Record<string, string>, Authorization: `Bearer ${newToken}` },
      });
    }

    return resp;
  }

  private updateEnvFile(newRefreshToken: string): void {
    if (!existsSync(this.envPath)) return;
    try {
      let content = readFileSync(this.envPath, 'utf-8');
      content = content.replace(
        /^AKIFLOW_REFRESH_TOKEN=.*/m,
        `AKIFLOW_REFRESH_TOKEN=${newRefreshToken}`,
      );
      writeFileSync(this.envPath, content);
    } catch (e) {
      logger.error('[auth] failed to update .env with new refresh token:', e);
    }
  }
}
