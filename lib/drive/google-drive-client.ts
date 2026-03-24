import crypto from "node:crypto";

type GoogleDriveClientConfig = {
  serviceAccountEmail: string;
  privateKey: string;
};

type AccessTokenCache = {
  token: string;
  expiresAt: number;
};

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  webViewLink?: string;
};

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export class GoogleDriveClient {
  private tokenCache: AccessTokenCache | null = null;

  constructor(private readonly config: GoogleDriveClientConfig) {}

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    if (this.tokenCache && this.tokenCache.expiresAt > now + 60) {
      return this.tokenCache.token;
    }

    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(
      JSON.stringify({
        iss: this.config.serviceAccountEmail,
        scope: "https://www.googleapis.com/auth/drive",
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

  private async request<T>(path: string, init?: RequestInit, baseUrl = "https://www.googleapis.com/drive/v3"): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Drive request failed: ${response.status} ${errorText}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private async uploadMultipart<T>(
    method: "POST" | "PATCH",
    metadata: Record<string, unknown>,
    content: string,
    fileId?: string,
  ): Promise<T> {
    const boundary = `capucinne_${crypto.randomUUID()}`;
    const body =
      `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${content}\r\n` +
      `--${boundary}--`;

    const path = fileId
      ? `/files/${encodeURIComponent(fileId)}?uploadType=multipart&supportsAllDrives=true`
      : "/files?uploadType=multipart&supportsAllDrives=true";

    return this.request<T>(path, {
      method,
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }, "https://www.googleapis.com/upload/drive/v3");
  }

  async getFile(fileId: string, fields = "id,name,mimeType,parents,modifiedTime,webViewLink"): Promise<DriveFile> {
    return this.request<DriveFile>(
      `/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`,
    );
  }

  async listFiles(args: { query: string; fields?: string; pageSize?: number }): Promise<DriveFile[]> {
    const payload = await this.request<{
      files?: DriveFile[];
    }>(
      `/files?corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true&pageSize=${args.pageSize ?? 1000}&q=${encodeURIComponent(
        args.query,
      )}&fields=${encodeURIComponent(`files(${args.fields ?? "id,name,mimeType,parents,modifiedTime,webViewLink"})`)}`,
    );

    return payload.files ?? [];
  }

  async findChildByName(parentId: string, name: string, mimeType?: string): Promise<DriveFile | null> {
    const mimeQuery = mimeType ? ` and mimeType='${mimeType}'` : "";
    const files = await this.listFiles({
      query: `'${parentId}' in parents and trashed=false and name='${name.replace(/'/g, "\\'")}'${mimeQuery}`,
      pageSize: 10,
    });

    return files[0] ?? null;
  }

  async ensureFolder(parentId: string, name: string): Promise<DriveFile> {
    const existing = await this.findChildByName(parentId, name, "application/vnd.google-apps.folder");

    if (existing) {
      return existing;
    }

    return this.request<DriveFile>("/files?supportsAllDrives=true", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    });
  }

  async downloadTextFile(fileId: string): Promise<string> {
    const token = await this.getAccessToken();
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Drive file download failed: ${response.status} ${errorText}`);
    }

    return response.text();
  }

  async createJsonFile(parentId: string, name: string, content: unknown): Promise<DriveFile> {
    return this.uploadMultipart<DriveFile>(
      "POST",
      {
        name,
        parents: [parentId],
        mimeType: "application/json",
      },
      JSON.stringify(content, null, 2),
    );
  }

  async updateJsonFile(fileId: string, name: string, content: unknown): Promise<DriveFile> {
    return this.uploadMultipart<DriveFile>(
      "PATCH",
      {
        name,
        mimeType: "application/json",
      },
      JSON.stringify(content, null, 2),
      fileId,
    );
  }
}

export type { DriveFile };
