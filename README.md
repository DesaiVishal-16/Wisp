# Wisp

A small haunted-terminal companion powered by a local open-weight model. Give Wisp a command and, optionally, its exit code; it replies with one eerie line.

Wisp treats commands as text. It never executes them, reads shell history, or installs shell hooks.

## Requirements

- Node.js 22 or newer
- npm
- [Ollama](https://ollama.com/) running locally
- A model pulled in Ollama, such as `gemma3:4b`

## Setup

```bash
npm ci
npm run build
npm link
ollama pull gemma3:4b
```

Ollama must be running locally. If it is not managed as a background service, start it in a separate terminal with `ollama serve`.

## Use

```bash
wisp "git status"
wisp --exit-code 1 "npm test"
```

The model defaults to `gemma3:4b`. Set `WISP_MODEL` to use another Ollama model. The Ollama URL defaults to `http://127.0.0.1:11434`; set `OLLAMA_URL` or pass `--url` to use another endpoint. If you point Wisp at a remote server, the command text will be sent there. Do not pass commands containing secrets unless you are comfortable sending them to that Ollama server.

Wisp sends one request to Ollama's `/api/generate` endpoint and does not keep a command log. It never executes the supplied text. Model output is generated text; review it rather than treating it as an authoritative result. When Ollama is unavailable or the model is missing, Wisp prints a concise setup hint and exits with an error.

## Development

Run the test suite with:

```bash
npm test
```