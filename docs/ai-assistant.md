# The AI assistant

A chat inside Deja Vu1 that reads what the dashboard knows and works the printer inside fixed
safety limits. You bring the AI: a Claude or ChatGPT plan you already pay for, an API key, or a model
on your own computer. Open it with the **Ask** button at the bottom right, or Ctrl+J (Cmd+J on a Mac).

Deja Vu1 works the same without it. Switch it off in Settings, Optional extras, AI assistant.

## Connect your AI

| Way | What you need | What Deja Vu1 stores |
|---|---|---|
| **Claude plan** | [Claude Code](https://code.claude.com/docs/en/setup) installed and signed in on the computer that runs Deja Vu1 | Nothing. It runs `claude` with that program's own tools switched off and reads the answer |
| **ChatGPT plan** | [Codex](https://developers.openai.com/codex/cli) installed and signed in on the same computer | Nothing. It runs `codex exec`, which is read-only by default |
| **An API key** | A key from one of the services below | The key, in `ai_keys.json` in your data folder, readable only by your user account |
| **A model on this computer** | Ollama or LM Studio running, or any address that accepts the chat-completions format | The address |

Key services (30): Anthropic, OpenAI, Google AI Studio (Gemini), xAI (Grok), Mistral, DeepSeek, Groq,
OpenRouter, Together AI, Fireworks AI, Perplexity, Cerebras, SambaNova, DeepInfra, Hyperbolic, Novita
AI, Nebius, Hugging Face, GitHub Models, Moonshot (Kimi), Alibaba Cloud (Qwen), Z.ai (GLM), Cohere,
AI21, NVIDIA NIM, Vercel AI Gateway, MiniMax, Venice, Chutes and Featherless.

Press **Connect**. Deja Vu1 saves the key, reads the service's own list of models, picks a starting
model (change it by typing another name) and sends one small request to check the connection. A
wrong key, an empty account or a program that isn't signed in shows as a sentence that says what to
do. Then the assistant spends a few seconds reading the printer, your files and the care list, and
the chat opens.

A key never goes to the browser, never appears in a log and is left out of backups. The service you
choose receives what you type, the printer's current readings, and the results of the steps the
assistant takes. The camera picture goes only when the assistant looks through the camera. A model
on your own computer keeps all of that at home.

## What it can do

- **Read:** the printer's state, temperatures and position, files and what each needs, the queue,
  care tasks, spools, print history, costs, the health score, the console and a camera picture.
- **Work the printer:** home, move to a position or by a distance, fan, speed, lights, pause and
  resume, switch every heater off, add a file to the queue, emergency stop.
- **With your yes:** heat a head or the bed, push or pull filament, change flow, nudge Z, change
  heads, feed filament, run one of the printer's own macros, probe the bed, switch the motors off,
  cancel a print.
- **Models:** make a box, cylinder or cone, and make a scaled, turned or mirrored copy of an STL, 3MF
  or OBJ. The original file stays as it was; the copy lands in your files, sitting on the bed.
- **Explain:** a warning or refusal anywhere in the app becomes an "Explain the last warning" button
  in the chat.

Each step shows in the chat as it happens, with the printer's answer. Watch the 3D twin and the
camera beside it while the head moves.

## The limits

The assistant never talks to the printer. It asks Deja Vu1 for a named step, and Deja Vu1 checks the
step with the same code as the Printer page's buttons. These hold in every setting:

- Nozzle targets stop at 300 °C and bed targets at 120 °C. A request for 500 °C is refused.
- Moves stay inside the size the printer reports, and wait until the axis is homed.
- The assistant keeps the nozzle at least 2 mm above the bed.
- Nothing moves the head while a print runs.
- It cannot start a print. It opens Confirm Print for a file, and your tap starts it.
- Typed G-code is read-only (M105, M114, M115, M119 and a few status commands).
- One request carries out at most 12 steps.
- Watch-only mode, the hold during a restart and the Printer control switch stop the assistant like
  any other sender. Emergency stop always goes through.

You choose how much it does without asking, in the assistant's Settings:

| Setting | What it does by itself |
|---|---|
| Advice only | Reads and explains. Sends the printer nothing |
| Ask every time | Nothing. Every change waits for Approve |
| Balanced (the start setting) | Moves, homes, cools and adjusts. Asks before heat, filament, macros and cancelling |
| Hands-on | Everything inside the limits. Still asks before cancelling a print |

## What has been tested

- A full conversation through a Claude plan (Claude Code 2.1.322) on a demo printer, on Linux,
  11 November 2026: reading the printer, setting the fan, an Approve step for heat, and a refused
  500 °C request.
- The address of each of the 30 key services answered a request without a key on 11 November 2026,
  which shows the address is right. No paid key was used, so a first real conversation through each
  service is still to try. The two wire formats, the error messages and the key handling run in the
  test suite against local stand-in services.
- Codex runs in the suite against a stand-in `codex` program built from its documentation. It has not
  been run with a real ChatGPT plan.
- The assistant has not driven a real U1 yet. Its commands go through the same code that has.

## In the online demo

No AI runs on the public demo page. A scripted helper answers a few requests (home, warm up, cool
down, pause, resume, fan, how the print is going) on the simulated printer, and says what it is.
