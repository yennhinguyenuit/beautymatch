// Local-only UI preview. All /api routes deliberately fail; use ?demo=1 to explore.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = resolve(repo, "beautymatch/public");
const port = Number(process.env.PORT || 4173);
const types = {
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/") {
    res.writeHead(302, { Location: "/beautymatch/result?demo=1" });
    res.end();
    return;
  }
  if (
    url.pathname === "/beautymatch/result" ||
    url.pathname === "/beautymatch/dashboard"
  ) {
    const page = url.pathname.endsWith("dashboard") ? "dashboard" : "result";
    const html = (
      await readFile(
        resolve(repo, "beautymatch/templates/beautymatch_app.html"),
        "utf8",
      )
    )
      .replace("{{ bm_page }}", page)
      .replace("{{ csrf_token|e }}", "");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  if (url.pathname.startsWith("/assets/beautymatch/")) {
    const target = resolve(
      assets,
      decodeURIComponent(url.pathname.slice("/assets/beautymatch/".length)),
    );
    if (!target.startsWith(assets + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const file = await readFile(target);
      res.writeHead(200, {
        "Content-Type": types[extname(target)] || "application/octet-stream",
      });
      res.end(file);
      return;
    } catch {
      res.writeHead(404);
      res.end("Asset not found");
      return;
    }
  }
  if (url.pathname.startsWith("/api/")) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ exc_type: "PreviewOnly" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    '<!doctype html><html lang="vi"><meta charset="utf-8"><title>BeautyMatch preview</title><p>Trang này thuộc Frappe CRM. Mở site Frappe để đăng nhập hoặc tư vấn.</p><a href="/beautymatch/result?demo=1">Trở về bản minh họa</a></html>',
  );
});
server.listen(port, "127.0.0.1", () =>
  process.stdout.write(
    `BeautyMatch preview: http://127.0.0.1:${port}/beautymatch/result?demo=1\n`,
  ),
);
