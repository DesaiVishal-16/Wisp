import assert from "node:assert/strict";
import { test } from "node:test";

import { askGhost, SYSTEM_PROMPT } from "../src/cli.js";

test("sends command text to the configured Ollama model", async () => {
  let receivedUrl = "";
  let receivedInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    receivedUrl = String(input);
    receivedInit = init;
    return new Response(JSON.stringify({ response: "The test lantern flickers." }));
  };

  const reply = await askGhost("npm test", {
    exitCode: 1,
    model: "gemma3:4b",
    url: "http://127.0.0.1:11434/",
    fetcher,
  });

  const payload = JSON.parse(String(receivedInit?.body)) as {
    model: string;
    options: { num_predict: number };
    prompt: string;
    system: string;
    stream: boolean;
  };
  assert.equal(reply, "The test lantern flickers.");
  assert.equal(receivedUrl, "http://127.0.0.1:11434/api/generate");
  assert.equal(payload.model, "gemma3:4b");
  assert.match(payload.prompt, /npm test/);
  assert.match(payload.prompt, /Exit code: 1/);
  assert.match(payload.system, /never execute it/);
  assert.equal(payload.system, SYSTEM_PROMPT);
  assert.equal(payload.stream, false);
  assert.equal(payload.options.num_predict, 128);
});

test("reports when Ollama is unavailable", async () => {
  const fetcher: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };

  await assert.rejects(
    askGhost("git status", { fetcher }),
    /cannot reach Ollama.*fetch failed/,
  );
});

test("reports an Ollama timeout distinctly", async () => {
  const fetcher: typeof fetch = async () => {
    throw new DOMException("request timed out", "TimeoutError");
  };

  await assert.rejects(askGhost("git status", { fetcher }), /timed out after 120 seconds/);
});

test("gives a setup hint when the model is missing", async () => {
  const fetcher: typeof fetch = async () => new Response("model not found", { status: 404 });

  await assert.rejects(
    askGhost("git status", { model: "gemma3:4b", fetcher }),
    /ollama pull gemma3:4b/,
  );
});

test("rejects empty or invalid model responses", async () => {
  const emptyFetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ response: "  " }));
  const invalidFetcher: typeof fetch = async () => new Response("not json");
  const missingTextFetcher: typeof fetch = async () => new Response(JSON.stringify({}));

  await assert.rejects(askGhost("git status", { fetcher: emptyFetcher }), /empty response/);
  await assert.rejects(askGhost("git status", { fetcher: invalidFetcher }), /invalid JSON/);
  await assert.rejects(askGhost("git status", { fetcher: missingTextFetcher }), /did not contain text/);
});

test("validates input and endpoint before making a request", async () => {
  let called = false;
  const fetcher: typeof fetch = async () => {
    called = true;
    return new Response(JSON.stringify({ response: "unused" }));
  };

  await assert.rejects(askGhost("   ", { fetcher }), /command text must not be empty/);
  await assert.rejects(askGhost("x".repeat(16_001), { fetcher }), /character limit/);
  await assert.rejects(askGhost("git status", { url: "file:///tmp/ollama", fetcher }), /must use http or https/);
  await assert.rejects(askGhost("git status", { url: "http://user:pass@localhost:11434", fetcher }), /must not contain credentials/);
  assert.equal(called, false);
});

test("does not echo an Ollama error body", async () => {
  const fetcher: typeof fetch = async () => new Response("private command contents", { status: 500 });

  await assert.rejects(
    askGhost("git status", { fetcher }),
    (error: unknown) => error instanceof Error && error.message === "Ollama returned HTTP 500",
  );
});

test("normalizes model output to one bounded line", async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ response: `first line\n${"x".repeat(600)}` }));

  const reply = await askGhost("git status", { fetcher });
  assert.equal(reply.includes("\n"), false);
  assert.equal(reply.length, 500);
  assert.equal(reply.endsWith("..."), true);
});