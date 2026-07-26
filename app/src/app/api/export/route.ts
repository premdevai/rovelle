import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { exportAll, getBySlug, toMarkdown } from "@/lib/recipes";
import { toExportJSON } from "@/lib/rrf";
import { slugify } from "@/lib/slug";

/**
 * Export ships at launch, not as a promise (PRD §6.2). JSON is the RRF
 * document byte-for-byte, so export → import round-trips exactly.
 */
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const format = req.nextUrl.searchParams.get("format") === "md" ? "md" : "json";
  const slug = req.nextUrl.searchParams.get("slug");

  if (!slug) {
    if (format === "md") {
      return NextResponse.json({ error: "Whole-cookbook export is JSON only." }, { status: 400 });
    }
    return download(exportAll(user.id), "rovelle-cookbook.json", "application/json");
  }

  const found = getBySlug(user.id, slug);
  if (!found) return NextResponse.json({ error: "No such recipe." }, { status: 404 });

  return format === "md"
    ? download(toMarkdown(found.rrf), `${slugify(found.rrf.title)}.md`, "text/markdown")
    : download(toExportJSON(found.rrf), `${slugify(found.rrf.title)}.json`, "application/json");
}

function download(body: string, filename: string, type: string) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
