import crypto from "node:crypto";

type GoogleClientConfig = {
  spreadsheetId: string;
  serviceAccountEmail: string;
  privateKey: string;
};

type AccessTokenCache = {
  token: string;
  expiresAt: number;
};

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function toSheetRange(sheetName: string, range: string): string {
  const escapedSheetName = sheetName.replace(/'/g, "''");
  return `'${escapedSheetName}'!${range}`;
}

export class GoogleSheetsClient {
  private tokenCache: AccessTokenCache | null = null;

  constructor(private readonly config: GoogleClientConfig) {}

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    if (this.tokenCache && this.tokenCache.expiresAt > now + 60) {
      return this.tokenCache.token;
    }

    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(
      JSON.stringify({
        iss: this.config.serviceAccountEmail,
        scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now,
      }),
    );

    const assertion = `${header}.${payload}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(assertion);
    signer.end();
    const signature = base64Url(signer.sign(this.config.privateKey));

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${assertion}.${signature}`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google OAuth failed: ${response.status} ${errorText}`);
    }

    const payloadJson = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.tokenCache = {
      token: payloadJson.access_token,
      expiresAt: now + payloadJson.expires_in,
    };

    return payloadJson.access_token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.config.spreadsheetId}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Sheets request failed: ${response.status} ${errorText}`);
    }

    return (await response.json()) as T;
  }

  async getRows(sheetName: string): Promise<string[][]> {
    const range = encodeURIComponent(toSheetRange(sheetName, "A:ZZ"));
    const payload = await this.request<{ values?: string[][] }>(`/values/${range}`);
    return payload.values ?? [];
  }

  async getSheetRange(sheetName: string, rangeA1: string): Promise<string[][]> {
    const range = encodeURIComponent(toSheetRange(sheetName, rangeA1));
    const payload = await this.request<{ values?: string[][] }>(`/values/${range}`);
    return payload.values ?? [];
  }

  async getSheetTitles(): Promise<string[]> {
    const payload = await this.request<{
      sheets?: Array<{
        properties?: {
          title?: string;
        };
      }>;
    }>("");

    return (payload.sheets ?? [])
      .map((sheet) => sheet.properties?.title?.trim() ?? "")
      .filter((title) => title.length > 0);
  }

  async ensureSheetExists(sheetName: string): Promise<boolean> {
    const titles = await this.getSheetTitles();

    if (titles.includes(sheetName)) {
      return false;
    }

    await this.request<{ replies?: unknown[] }>(`:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      }),
    });

    return true;
  }

  async updateRows(range: string, values: string[][]): Promise<void> {
    const encoded = encodeURIComponent(range);
    await this.request(`/values/${encoded}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values,
      }),
    });
  }

  async appendRows(range: string, values: string[][]): Promise<void> {
    const encoded = encodeURIComponent(range);
    await this.request(`/values/${encoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values,
      }),
    });
  }
}
