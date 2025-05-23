import { NextRequest, NextResponse } from "next/server";
import {
  getManifestResponse,
  getMockAccounts,
  getClientMetadata,
  generateToken,
  getUserFromCookie,
} from "@/lib/fedcm";
import { FedCMTokenRequest } from "@/types/fedcm";
import { isRequestHttps, isHttpsEnabled } from "@/utils/https";

// Common FedCM headers
const FEDCM_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Sec-Fetch-Dest, Authorization, X-Requested-With",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json",
};

// Define valid FedCM routes
type FedCMRoute =
  | "manifest"
  | "accounts"
  | "client-metadata"
  | "disconnect"
  | "token"
  | "config.json";

// Validate if the request is coming from the FedCM API
function validateFedCMRequest(
  request: NextRequest,
  expectedDest: string,
): boolean {
  const secFetchDest = request.headers.get("Sec-Fetch-Dest");

  // In development, we might want to bypass this check
  if (
    process.env.NODE_ENV === "development" &&
    process.env.BYPASS_SEC_FETCH_CHECK === "true"
  ) {
    return true;
  }

  return secFetchDest === expectedDest;
}

// Get the base URL for the application with proper protocol
function getBaseUrl(request: NextRequest): string {
  // Use the request to determine protocol if available
  const isHttps = request ? isRequestHttps(request) : isHttpsEnabled();
  const protocol = isHttps ? "https" : "http";

  return process.env.NEXT_PUBLIC_APP_FQDN
    ? `${protocol}://${process.env.NEXT_PUBLIC_APP_FQDN}`
    : "";
}

// Validate if the route is a valid FedCM route
function isValidFedCMRoute(route: string): route is FedCMRoute {
  const validRoutes: FedCMRoute[] = [
    "manifest",
    "accounts",
    "client-metadata",
    "disconnect",
    "token",
    "config.json",
  ];
  return validRoutes.includes(route as FedCMRoute);
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ route: string }> },
) {
  const params = await props.params;
  const route = params.route;

  // Enable CORS
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { headers: FEDCM_HEADERS, status: 204 });
  }

  if (!isValidFedCMRoute(route)) {
    return NextResponse.json(
      { error: "Invalid route" },
      { status: 400, headers: FEDCM_HEADERS },
    );
  }

  // Handle different FedCM API endpoints
  switch (route) {
    case "config.json":
    case "manifest":
      // Get base URL with proper protocol
      const baseUrl = getBaseUrl(request);
      // Manifest is public and doesn't need Sec-Fetch-Dest validation
      return NextResponse.json(getManifestResponse(baseUrl), {
        headers: FEDCM_HEADERS,
      });

    case "accounts":
      // Accounts endpoint must be called from FedCM API
      if (!validateFedCMRequest(request, "webidentity")) {
        return NextResponse.json(
          { error: "Unauthorized" },
          {
            status: 401,
            headers: FEDCM_HEADERS,
          },
        );
      }

      const accounts = await getMockAccounts();
      return NextResponse.json(accounts, {
        headers: FEDCM_HEADERS,
      });

    case "client-metadata":
      // Client metadata endpoint must be called from FedCM API
      if (!validateFedCMRequest(request, "webidentity")) {
        return NextResponse.json(
          { error: "Unauthorized" },
          {
            status: 401,
            headers: FEDCM_HEADERS,
          },
        );
      }

      // Extract client_id from URL query params
      const url = new URL(request.url);
      const clientId = url.searchParams.get("client_id") || "mockfedcm";

      if (!clientId) {
        return NextResponse.json(
          { error: "Missing client_id parameter" },
          {
            status: 400,
            headers: FEDCM_HEADERS,
          },
        );
      }

      const clientMetadata = getClientMetadata(clientId);
      return NextResponse.json(clientMetadata, {
        headers: FEDCM_HEADERS,
      });

    case "disconnect":
      // Disconnect endpoint must be called from FedCM API
      if (!validateFedCMRequest(request, "webidentity")) {
        return NextResponse.json(
          { error: "Unauthorized" },
          {
            status: 401,
            headers: FEDCM_HEADERS,
          },
        );
      }

      // Handle disconnect request from browser
      // This endpoint would typically clear approved client lists
      return NextResponse.json(
        { success: true },
        {
          headers: FEDCM_HEADERS,
        },
      );

    default:
      return NextResponse.json(
        { error: "Route not supported" },
        { status: 405, headers: FEDCM_HEADERS },
      );
  }
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ route: string }> },
) {
  const params = await props.params;
  const route = params.route;

  // Enable CORS
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { headers: FEDCM_HEADERS, status: 204 });
  }

  if (!isValidFedCMRoute(route)) {
    return NextResponse.json(
      { error: "Invalid route" },
      { status: 400, headers: FEDCM_HEADERS },
    );
  }

  // Handle token endpoint (the only POST endpoint)
  if (route === "token") {
    // Token endpoint must be called from FedCM API
    if (!validateFedCMRequest(request, "webidentity")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        {
          status: 401,
          headers: FEDCM_HEADERS,
        },
      );
    }

    // Validate content type
    const contentType = request.headers.get("content-type");
    if (!contentType?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.json(
        {
          error:
            "Invalid content type. Expected application/x-www-form-urlencoded",
        },
        {
          status: 415,
          headers: FEDCM_HEADERS,
        },
      );
    }

    try {
      const username = await getUserFromCookie();
      if (!username) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401, headers: FEDCM_HEADERS },
        );
      }

      // Parse form data
      const formData = await request.formData();
      const accountId = formData.get("account_id");
      const clientId = formData.get("client_id");
      const nonce = formData.get("nonce");
      const disclosureTextShown = formData.get("disclosure_text_shown");

      if (!accountId || !clientId || !nonce || !disclosureTextShown) {
        return NextResponse.json(
          {
            error:
              "Missing required fields: account_id, client_id, nonce, and disclosure_text_shown",
          },
          {
            status: 400,
            headers: FEDCM_HEADERS,
          },
        );
      }

      const data: FedCMTokenRequest = {
        account_id: accountId.toString(),
        client_id: clientId.toString(),
        nonce: nonce.toString(),
        disclosure_text_shown: disclosureTextShown.toString() === "true",
      };

      // For mock IdP, we accept any client_id and origin
      // Just verify that the account_id is one of our mock accounts
      const accounts = await getMockAccounts();
      const isValidAccount = accounts.accounts.some(
        (account) => account.id === data.account_id,
      );
      if (!isValidAccount) {
        return NextResponse.json(
          { error: "Invalid account_id" },
          {
            status: 400,
            headers: FEDCM_HEADERS,
          },
        );
      }
      // Generate token
      const token = generateToken(data.account_id, data.client_id);
      return NextResponse.json(
        { token },
        {
          headers: FEDCM_HEADERS,
        },
      );
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid request: " + error },
        {
          status: 400,
          headers: FEDCM_HEADERS,
        },
      );
    }
  }

  return NextResponse.json(
    { error: "Route not supported" },
    { status: 405, headers: FEDCM_HEADERS },
  );
}
