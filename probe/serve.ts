// cases/를 정적으로 서빙하고, 테스트 페이지에서 눌린 버튼을 기록하는 작은 서버다.
// 수집기·E2E·에이전트 실행기가 모두 이 서버 하나를 쓴다.
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../cases");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export interface Hit {
  case: string;
  el: string;
  at: number;
}

export interface CaseServer {
  url: string;
  hits: Hit[];
  /** 2층 과제 페이지가 저장한 상태. 채점은 이 값으로 한다 */
  state: Map<string, unknown>;
  reset(): void;
  close(): Promise<void>;
}

export function startServer(port = 0): Promise<CaseServer> {
  const hits: Hit[] = [];
  const state = new Map<string, unknown>();

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/hit") {
      hits.push({ case: url.searchParams.get("case") ?? "", el: url.searchParams.get("el") ?? "", at: Date.now() });
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === "/hits") {
      res.writeHead(200, { "content-type": TYPES[".json"] }).end(JSON.stringify(hits));
      return;
    }
    if (url.pathname.startsWith("/state/")) {
      const key = decodeURIComponent(url.pathname.slice("/state/".length));
      if (req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        try {
          state.set(key, JSON.parse(body || "null"));
        } catch {
          res.writeHead(400).end();
          return;
        }
        res.writeHead(204).end();
      } else {
        res.writeHead(200, { "content-type": TYPES[".json"] }).end(JSON.stringify(state.get(key) ?? null));
      }
      return;
    }
    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
    const file = path.join(ROOT, rel.endsWith(".html") || path.extname(rel) ? rel : path.join(rel, "index.html"));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      // 캐시가 끼면 버전 비교가 흐려지므로 항상 새로 받게 한다
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        url: `http://127.0.0.1:${actual}`,
        hits,
        state,
        reset() {
          hits.length = 0;
          state.clear();
        },
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// pnpm serve로 직접 띄우면 브라우저로 페이지를 눈으로 확인할 수 있다
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startServer(Number(process.env.PORT ?? 4310));
  console.log(`${s.url}/patterns/aria-hidden-ancestor.html`);
}
