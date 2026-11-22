import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { localRedirect } from "@/lib/redirect";
import { getPlatformSession } from "@/lib/platform-auth";
import { googleConfigured, googleStartUrl } from "@/lib/google";

/** "Continue with Google" on the console. ?intent=link connects Google to the console login signed in. */
export async function GET(req: Request) {
  if (await getTenant()) return localRedirect("/");
  if (!googleConfigured()) return localRedirect("/platform/login?notice=google-off");
  const intent = new URL(req.url).searchParams.get("intent") === "link" ? "link" : "signin";
  let uid: string | undefined;
  if (intent === "link") {
    const s = await getPlatformSession();
    if (!s) return localRedirect("/platform/login");
    uid = s.platformUserId;
  }
  return NextResponse.redirect(await googleStartUrl({ k: "console", intent, uid }), 303);
}
