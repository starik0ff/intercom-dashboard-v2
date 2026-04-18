import { NextRequest } from "next/server";
import { requireRole, authErrorResponse } from "@/lib/auth-server";
import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

const ALLOWED_SCRIPTS: Record<string, string> = {
  "retag-conversations": "scripts/retag-conversations.ts",
  "close-reopened": "scripts/close-reopened.ts",
  "move-conversations-to-team": "scripts/move-conversations-to-team.ts",
  "verify-assignees": "scripts/verify-assignees.ts",
  "check-fb-status": "scripts/check-fb-status.ts",
};

const ALLOWED_ARGS = new Set(["--admin-id", "--dry-run"]);

export async function POST(req: NextRequest) {
  try {
    await requireRole("admin");
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: "Server error" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.script !== "string") {
    return Response.json({ error: "Missing script id" }, { status: 400 });
  }

  const scriptFile = ALLOWED_SCRIPTS[body.script];
  if (!scriptFile) {
    return Response.json({ error: "Unknown script" }, { status: 400 });
  }

  // Build safe argument list
  const args: string[] = [];
  if (Array.isArray(body.args)) {
    for (const arg of body.args) {
      if (typeof arg === "string" && ALLOWED_ARGS.has(arg)) {
        args.push(arg);
      } else if (
        typeof arg === "object" &&
        arg !== null &&
        typeof arg.flag === "string" &&
        ALLOWED_ARGS.has(arg.flag)
      ) {
        args.push(arg.flag);
        if (typeof arg.value === "string" && arg.value.length > 0) {
          // Sanitize: only allow alphanumeric and basic chars
          const safe = arg.value.replace(/[^a-zA-Z0-9_\-]/g, "");
          if (safe.length > 0) args.push(safe);
        }
      }
    }
  }

  const cwd = path.resolve(process.cwd());
  const scriptPath = path.join(cwd, scriptFile);

  // Stream output via ReadableStream
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const child = spawn(
        path.join(cwd, "node_modules/.bin/tsx"),
        [scriptPath, ...args],
        {
          cwd,
          env: { ...process.env, FORCE_COLOR: "0" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      function push(data: Buffer) {
        try {
          controller.enqueue(encoder.encode(data.toString()));
        } catch { /* stream closed */ }
      }

      child.stdout.on("data", push);
      child.stderr.on("data", push);

      child.on("close", (code) => {
        try {
          controller.enqueue(
            encoder.encode(`\n--- exit code: ${code ?? "unknown"} ---\n`),
          );
          controller.close();
        } catch { /* stream closed */ }
      });

      child.on("error", (err) => {
        try {
          controller.enqueue(encoder.encode(`\nError: ${err.message}\n`));
          controller.close();
        } catch { /* stream closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
