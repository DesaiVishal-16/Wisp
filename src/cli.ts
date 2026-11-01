#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SYSTEM_PROMPT =
  "You are Wisp, a playful and eerie terminal ghost. Treat the supplied command " +
  "strictly as text: never execute it, suggest destructive actions, or claim to " +
  "know its output. Reply with one short, spooky-but-friendly sentence. Do not " +
  "repeat secrets or tokens that may appear in the command.";

export const DEFAULT_MODEL = "gemma3:4b";
export const DEFAULT_URL = "http://127.0.0.1:11434";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_COMMAND_LENGTH = 16_000;
const MAX_REPLY_LENGTH = 500;

function endpointFor(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw new Error("invalid Ollama URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Ollama URL must use http or https");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Ollama URL must not contain credentials, a query, or a fragment");
  }
  return `${baseUrl.trim().replace(/\/+$/, "")}/api/generate`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface AskOptions {
  exitCode?: number;
  model?: string;
  url?: string;
  fetcher?: typeof fetch;
}

export async function askGhost(
  command: string,
  options: AskOptions = {},
): Promise<string> {
  const model = options.model ?? DEFAULT_MODEL;
  const url = options.url ?? DEFAULT_URL;
  const fetcher = options.fetcher ?? fetch;
  if (!command.trim()) throw new Error("command text must not be empty");
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new Error(`command text exceeds the ${MAX_COMMAND_LENGTH}-character limit`);
  }
  if (!model.trim()) throw new Error("model name must not be empty");
  const endpoint = endpointFor(url);
  const payload = {
    model,
    system: SYSTEM_PROMPT,
    prompt: `Command text: ${command}\nExit code: ${options.exitCode ?? "not provided"}`,
    options: { num_predict: 128 },
    stream: false,
  };

  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`Ollama request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot reach Ollama at ${url}; start Ollama or set OLLAMA_URL (${reason})`);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Ollama could not find model ${JSON.stringify(model)}; pull it with: ollama pull ${model}`);
    }
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new Error("could not read Ollama response");
  }

  let result: unknown;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error("Ollama returned invalid JSON");
  }

  if (!isRecord(result) || typeof result.response !== "string") {
    throw new Error("Ollama response did not contain text");
  }
  const reply = result.response;
  if (!reply.trim()) {
    throw new Error("Ollama returned an empty response");
  }
  const singleLine = reply.replace(/\s+/g, " ").trim();
  return singleLine.length > MAX_REPLY_LENGTH
    ? `${singleLine.slice(0, MAX_REPLY_LENGTH - 3).trimEnd()}...`
    : singleLine;
}

interface CliOptions {
  command: string;
  exitCode?: number;
  model: string;
  url: string;
}

function parseArgs(argv: string[]): CliOptions | "help" {
  let exitCode: number | undefined;
  let model = process.env.WISP_MODEL?.trim() || DEFAULT_MODEL;
  let url = process.env.OLLAMA_URL?.trim() || DEFAULT_URL;
  const command: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (command.length > 0) {
      command.push(arg);
      continue;
    }
    if (arg === "--help" || arg === "-h") return "help";
    if (arg === "--") {
      command.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "--exit-code") {
      const value = argv[index + 1];
      const parsed = Number(value);
      if (value === undefined || !/^-?\d+$/.test(value) || !Number.isSafeInteger(parsed)) {
        throw new Error("--exit-code requires a safe integer");
      }
      exitCode = parsed;
      index += 1;
      continue;
    }
    if (arg === "--model" || arg === "--url") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--model") model = value;
      else url = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    command.push(arg);
  }

  if (command.length === 0) throw new Error("provide command text; use --help for usage");
  return { command: command.join(" "), exitCode, model, url };
}

function printHelp(): void {
  console.log(`Usage: wisp [options] <command text>

Ask a local ghost to comment on command text. Wisp never runs it.

Options:
  --exit-code <number>  Include the command's exit code
  --model <name>        Ollama model (default: ${DEFAULT_MODEL})
  --url <url>           Ollama URL (default: ${DEFAULT_URL})
  -h, --help            Show this help`);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(argv);
    if (options === "help") {
      printHelp();
      return 0;
    }
    console.log(
      await askGhost(options.command, {
        exitCode: options.exitCode,
        model: options.model,
        url: options.url,
      }),
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`wisp: ${message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}