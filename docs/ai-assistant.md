# The AI assistant

A chat inside Deja Vu1 that reads what the dashboard knows and works the printer inside fixed
safety limits. You bring the AI: a Claude or ChatGPT plan you already pay for, a model on your own
computer, or an API key. Open it with the **Ask** button at the bottom right, or Ctrl+J (Cmd+J on a
Mac). The **AI** screen in the sidebar holds everything about it in one place.

Deja Vu1 works the same without it. With no AI connected, the only signs of it are the Ask button
and the AI screen. Switch both off in Settings, Optional extras, AI assistant.

## Connect your AI

Listed from most private to least. You can connect several and switch between them at any time.

| Way | What you need | What Deja Vu1 stores |
|---|---|---|
| **Claude plan** (best choice) | [Claude Code](https://code.claude.com/docs/en/setup) installed and signed in on the computer that runs Deja Vu1 | Nothing |
| **ChatGPT plan** (best choice) | [Codex](https://developers.openai.com/codex/cli) installed and signed in on the same computer | Nothing |
| **A model on this computer** | Ollama or LM Studio running, or any address that accepts the chat-completions format | The address |
| **An API key** | A key from one of the 30 services below | The key, in your computer's keyring where there is one |

### How a plan works

Deja Vu1 runs the program you are already signed in to, with that program's own tools switched off,
hands it your message, and reads the answer. It never sees your password or sign-in. Usage counts
against your plan, the same as using the program yourself.

- **Claude:** the Claude desktop app and Claude Code are separate programs. Install Claude Code
  once, run `claude auth login` in a terminal, and sign in with the same account.
- **ChatGPT:** the Codex app and the `codex` command share one sign-in. If the command is not
  installed yet, install it and run `codex login`.

The Connect screen checks for you: it says whether the program is found and signed in, shows the
command to run when it isn't, and has a Check again button.

### Choosing a model

Deja Vu1 keeps no list of models of its own. Each list is read from the service or program when you
connect, newest first, so a model released tomorrow shows up tomorrow. Codex reports its own models.
For a Claude plan you pick a family (`fable`, `opus`, `sonnet`, `haiku`) and Claude Code uses the
newest model of that family, or you leave it empty for your plan's usual model. Two services
(OpenRouter and Vercel AI Gateway) report prices, and the list shows them. Refresh the list
re-reads it. You can also type a model's exact name.

Above the chat are two pickers: the AI in use and its model. Change either between messages.

### API keys

A key works, and it is the least private way: it is a password that spends your money. Use a plan or
a local model when you can. If you use a key, make one only for Deja Vu1 and set a spending limit at
the service.

Key services (30): Anthropic, OpenAI, Google AI Studio (Gemini), xAI (Grok), Mistral, DeepSeek, Groq,
OpenRouter, Together AI, Fireworks AI, Perplexity, Cerebras, SambaNova, DeepInfra, Hyperbolic, Novita
AI, Nebius, Hugging Face, GitHub Models, Moonshot (Kimi), Alibaba Cloud (Qwen), Z.ai (GLM), Cohere,
AI21, NVIDIA NIM, Vercel AI Gateway, MiniMax, Venice, Chutes and Featherless.

**How a key is kept.** Deja Vu1 hands the key to the operating system and tells you which store is
in use:

| Computer | Where the key rests | Encrypted |
|---|---|---|
| Windows | Windows Data Protection (DPAPI): Windows encrypts it with a secret tied to your Windows account | Yes |
| macOS | Your login Keychain | Yes |
| Linux with a desktop keyring | The keyring (Secret Service: GNOME Keyring, KWallet), through `secret-tool` | Yes |
| Anywhere none of those answers | A file in your data folder that only your account can open | No, and the screen says so |

Every save is read back before it counts. If the keyring is locked or missing, the key goes to the
private file and the screen says why. You can also put the key in the computer's environment (each
service's variable name is shown in its form) and Deja Vu1 stores nothing.

**What protects it in use.**

- It is sent only to its own service, over https. An address that is neither https nor on this
  computer or your home network is refused.
- A redirect is never followed, so a key cannot be carried to another site.
- It never reaches the browser, a log, an error message or a backup.
- Deja Vu1 has no login. Anyone who can open it on your network can use the connected AI, but nobody
  can read the key back.

The service you choose receives what you type, the printer's readings, and the results of the steps
the assistant takes. The camera picture goes only when the assistant looks through the camera. A
model on your own computer keeps all of that at home.

## What it can do

- **Read:** the printer's state, temperatures and position, files and what each needs, the queue,
  care tasks, spools, print history, costs, the health score, the console, the logbook and a camera
  picture.
- **Work the printer:** home, move, fans, speed, lights, heat and cool, push or pull filament, change
  heads, feed filament, flow, pressure advance, speed limits, bed probing and saved meshes, runout
  sensors, the printer's own macros, pause and resume, emergency stop.
- **Look after the rest:** add, move and remove queued jobs, record a care task as done or put it
  off, note a problem and its fix in the logbook, add a spool or record its weight, open a screen
  for you.
- **Models:** make a box, cylinder, cone, sphere, tube or prism; build one part from several of
  those placed together (a stand, a bracket); make a scaled, turned or mirrored copy of an STL, 3MF
  or OBJ. The original stays as it was. It cannot cut holes or sculpt.
- **Print settings:** it suggests settings as a list with the reason. One press puts them in the
  profile editor, and nothing changes until you save the profile.
- **Explain:** while an AI is connected, cards such as Needs you, Confirm Print, the console and a
  file's details carry an Ask shortcut that sends what is on the card with your question.

Each step shows in the chat as it happens, with the printer's answer. Under the chat is the number
of tokens the service reported for the conversation; Deja Vu1 estimates nothing.

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

You choose how much it does without asking, on the AI screen or under Connections:

| Setting | What it does by itself |
|---|---|
| Advice only | Reads, explains, suggests settings and opens screens. Sends the printer nothing |
| Ask every time | Nothing. Every change waits for Approve |
| Balanced | Moves, homes, cools and adjusts. Asks before heat, filament, macros and calibration changes |
| Hands-on (the start setting) | Everything inside the limits. Asks only before it ends a print early (cancel, or skip an object) |
| No approvals | Everything inside the limits, without asking |

A step that waits also offers **Approve, and don't ask about this again**. The steps you have
released are listed beside the settings, and one press makes each ask again.

## What has been tested

- **A Claude plan, for real** (Claude Code 2.1.322, Linux, 12 November 2026, demo printer): finding
  the program and its sign-in, connecting, the one-minute glow, a conversation that cancelled a
  print after one Approve, then homed and heated with no approvals, a camera picture sent through
  the plan, a settings suggestion, an Ask shortcut, and the token count.
- **Codex 0.167.2, for real, without a ChatGPT plan:** its options, its model list and its "not
  signed in" answer were read from the program itself. A conversation through a real ChatGPT plan
  is still to try.
- **Every key service's address** answered a request without a key on 12 November 2026
  (`python3 tools/check-ai-services.py`), which shows the address is right. Hyperbolic had moved and
  was corrected. GitHub Models could not be checked from the test computer. No paid key was used, so
  a first real conversation through each service is still to try.
- **Key storage:** the suite runs the Linux keyring and macOS Keychain paths against stand-in
  programs, and the fallback to the private file. Windows Data Protection and the macOS Keychain
  were written from Microsoft's and Apple's documentation and have not been run on those systems;
  if either fails there, the read-back check sends the key to the private file and says so.
- **The suite** covers both wire formats, error messages, redirects, every safety limit and every
  setting with stand-in services and stand-in `claude` and `codex` programs.
- The assistant has not driven a real U1 yet. Its commands go through the same code that has.

## In the online demo

No AI runs on the public demo page. A scripted helper answers a few requests (home, warm up, cool
down, pause, resume, cancel, fan, how the print is going) on the simulated printer, and says what
it is.
