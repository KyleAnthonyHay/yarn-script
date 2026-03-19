import { NextResponse } from "next/server";

const ASSEMBLYAI_TOKEN_URL = "https://streaming.assemblyai.com/v3/token";

export async function GET() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Missing ASSEMBLYAI_API_KEY. Add it to your local environment before starting a session.",
      },
      { status: 500 },
    );
  }

  const url = new URL(ASSEMBLYAI_TOKEN_URL);
  url.searchParams.set("expires_in_seconds", "300");
  url.searchParams.set("max_session_duration_seconds", "1800");

  const response = await fetch(url, {
    headers: {
      Authorization: apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const responseText = await response.text();
    return NextResponse.json(
      {
        error: `AssemblyAI token request failed: ${response.status} ${responseText}`,
      },
      { status: response.status },
    );
  }

  const payload = (await response.json()) as {
    token: string;
    expires_in_seconds: number;
  };

  return NextResponse.json(payload);
}
