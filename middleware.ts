import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const BASIC_AUTH_USER = "admin";

function unauthorizedResponse() {
  return new NextResponse("Authentication Required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Secure Area"',
    },
  });
}

function parseBasicAuth(header: string) {
  const [scheme, value] = header.split(" ");

  if (scheme !== "Basic" || !value) {
    return null;
  }

  try {
    const decoded = atob(value);
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex === -1) {
      return null;
    }

    return {
      user: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const configuredPassword = process.env.BASIC_AUTH_PASSWORD?.trim();

  if (!configuredPassword) {
    return NextResponse.next();
  }

  const credentials = parseBasicAuth(request.headers.get("authorization") ?? "");

  if (credentials?.user === BASIC_AUTH_USER && credentials.password === configuredPassword) {
    return NextResponse.next();
  }

  return unauthorizedResponse();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
