import { NextResponse } from "next/server";
import {
  getDashboardSnapshot,
  getDefaultDeviceId,
} from "@/lib/dashboard";
import { isValidDeviceId } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get("deviceId") ?? getDefaultDeviceId();

  if (!isValidDeviceId(deviceId)) {
    return NextResponse.json(
      { error: "Invalid deviceId." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const snapshot = await getDashboardSnapshot(deviceId);
  const status = !snapshot.configured ? 503 : snapshot.error ? 500 : 200;

  return NextResponse.json(snapshot, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
