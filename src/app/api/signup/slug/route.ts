import { NextResponse } from "next/server";
import { getTenant, platformDomain } from "@/lib/tenant";
import { slugProblem, suggestSlug } from "@/lib/signup";

/** ?s=<slug> → is the address free? ?name=<business name> → a suggestion. */
export async function GET(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const name = sp.get("name");
  let slug = (sp.get("s") ?? "").trim().toLowerCase();
  if (!slug && name) slug = suggestSlug(name);
  let problem = await slugProblem(slug);
  // A suggestion that is taken gets a number on the end.
  if (problem && !sp.get("s") && name) {
    for (let i = 2; i < 10 && problem; i++) {
      const tryIt = `${slug.slice(0, 27)}-${i}`;
      if (!(await slugProblem(tryIt))) {
        slug = tryIt;
        problem = null;
      }
    }
  }
  const port = process.env.PUBLIC_PORT;
  return NextResponse.json({ slug, ok: !problem, problem, host: `${slug}.${platformDomain()}${port ? `:${port}` : ""}` });
}
