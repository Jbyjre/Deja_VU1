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
| **Claude plan** (best choice) | [Claude Code](https://code.claude.com/docs/en/setup) installed on the computer that runs Deja Vu1; you sign in from Deja Vu1 | Nothing: Claude Code keeps its own sign-in |
| **ChatGPT plan** (best choice) | A ChatGPT account; you sign in from Deja Vu1. Nothing to install | The sign-in, in your computer's keyring where there is one |
| ChatGPT plan through Codex | [Codex](https://developers.openai.com/codex/cli) installed and signed in, if you already use it | Nothing |
| **A model on this computer** | Ollama or LM Studio running, or any address that accepts the chat-completions format | The address |
| **An API key** | A key from one of the 29 services below | The key, in your computer's keyring where there is one |

Plans and key services run on their makers' computers, so the computer that runs Deja Vu1 needs the
internet for them. A model on this computer works offline, and so does the rest of Deja Vu1.

### How a plan works

- **ChatGPT:** press **Continue with ChatGPT**. Deja Vu1 uses OpenAI's own Sign in with ChatGPT for
  open-source apps: the first time, your ChatGPT account registers Deja Vu1 as an app and you approve
  it in the browser. Requests then count toward your plan's limits through OpenAI's Responses API; you
  can see them, set a weekly cap or disconnect Deja Vu1 in ChatGPT, Settings, Usage. The browser comes
  back to this computer by itself. Signing in from a phone or another computer? Paste the address the
  browser ended on into the box under the button. The sign-in is refreshed before it runs out and
  revoked at OpenAI when you press Sign out. The ChatGPT desktop app itself can't be used by other
  apps, which is why this is the way in.
- **Claude:** the Claude desktop app keeps its own sign-in that other programs can't use, so Claude
  Code signs in once by itself. Press **Sign in with Claude**: Deja Vu1 runs Claude Code's own sign-in
  (`claude auth login`), the page opens in your browser, and if the page shows a code you paste it into
  Deja Vu1. Claude Code's "signed in?" check is sometimes wrong while requests still work, so **I'm
  already signed in** checks with one tiny request instead.

Deja Vu1 runs Claude Code (and Codex) with their own tools switched off, hands them your message and
reads the answer. It never sees your password.

### Choosing a model

Deja Vu1 keeps no list of models of its own. Each list is read from the service or program when you
connect, newest first, so a model released tomorrow shows up tomorrow. Codex reports its own models.
For a Claude plan you pick a family (`fable`, `opus`, `sonnet`, `haiku`) and Claude Code uses the
newest model of that family, or you leave it empty for your plan's usual model. Two services
(OpenRouter and Vercel AI Gateway) report prices, and the list shows them. Refresh the list
re-reads it. You can also type a model's exact name.

The chip at the top of the chat shows the AI in use and its model; press it to change either between
messages. The clock button lists your saved conversations, newest first, so you can pick one up where
you left off; they stay on this computer.

### API keys

A key works, and it is the least private way: it is a password that spends your money. Use a plan or
a local model when you can. If you use a key, make one only for Deja Vu1 and set a spending limit at
the service.

Key services (30): Anthropic, OpenAI, Google AI Studio (Gemini), xAI (Grok), Mistral, DeepSeek, Groq,
OpenRouter, Together AI, Fireworks AI, Perplexity, Cerebras, SambaNova, DeepInfra, Hyperbolic, Novita
AI, Nebius, Hugging Face, Moonshot (Kimi), Alibaba Cloud (Qwen), Z.ai (GLM), Cohere,
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
- **Models:** make a box (with rounded corners if you like), cylinder, cone, sphere, tube, prism,
  wedge (a ramp) or torus (a ring); push any outline up into a solid, with holes and rounded corners
  (draw a shape on paper, send a photo, and it traces the outline); spin a profile around into a
  round part (a cup, a vase, a knob); make a spur gear from its number of teeth and tooth size;
  build one part from several placed together, where each part is added, cut away or kept only where
  it overlaps the rest (a bracket with screw holes, a box with a slot, a pocket for a magnet); use a
  model from your library as one of the parts; drill round holes straight into a library model; make
  a scaled, turned or mirrored copy of an STL, 3MF or OBJ. The original stays as it was. Cutting
  works on a 0.4 mm grid (coarser for a large part, and the answer says the size): flat faces stay
  flat and exact, and edges come out rounded by about one grid step. A model with gaps in its
  surface gets a warning to check the result in the 3D view.
- **Slice:** it slices a model from your library with a saved profile (Files, Slicing, Profiles)
  and reports the time and filament the slicer worked out. To print the result it opens Confirm
  Print, which checks the file first; it cannot start a print itself.
- **Print watch:** on the AI screen, switch on **Print watch** and your AI looks at the camera every
  5 to 60 minutes while a real printer prints. If a picture looks wrong it tells you on screen. If
  you also tick **Pause when it clearly sees a failed print**, it pauses the print through the same
  checks as the Pause button (watch-only mode still blocks it). Each check sends one camera picture
  to your AI; the card counts the checks and their cost. Demo printers have a drawn camera, so print
  watch only runs on real printers.
- **Print settings:** it suggests settings as a list with the reason. One press puts them in the
  profile editor, and nothing changes until you save the profile.
- **Explain:** while an AI is connected, cards such as Needs you, Confirm Print, the console and a
  file's details carry an Ask shortcut that sends what is on the card with your question.

- **Your language:** write in any language and it answers in that language. Screen and button
  names, setting names, file names and G-code stay as they appear in the app.

Each step shows in the chat as it happens, with the printer's answer.

### What a message costs

Under the message box, before you send, the assistant shows about how many tokens the next answer
will read and what that costs. Before the service has answered in a conversation, Deja Vu1 counts
the text at about 4 characters a token and says so; after that it starts from the service's own
count. The price comes from the service's model list where it reports one (OpenRouter and Vercel AI
Gateway), or from a price you type on the AI screen under **Cost and limit**, from the service's
pricing page. With no price known, it shows the tokens and no cost. A plan shows no charge per
message, and a model on your computer costs nothing.

On the same card you can set a limit for one request. A message whose first answer would cost more
is not sent, and a request with several rounds of steps stops before the round that would pass the
limit, and says so. Below the chat, the tokens the service reported for the conversation are added
up, with the cost the service reported or, where it reports none, the cost at the known price.

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
  was corrected. GitHub Models was taken off the list on 12 November 2026: GitHub's documentation
  says GitHub retired it on 30 July 2026. No paid key was used, so a first real conversation through
  each service is still to try.
- **Holes, cost and language, 12 November 2026:** a stand-in chat service on the test computer, set
  up as "Another address", drove the real app in Chromium: the cost line before sending (about 2,100
  tokens, counted from the text), a price and a limit entered on the AI screen, and a conversation
  that built a 60 x 40 x 5 mm plate with four 4 mm holes and a pocket. The saved STL was closed and
  within 0.2% of the exact volume. Through the Claude plan, the assistant answered a question asked
  in Spanish in Spanish, with the demo printer's bed reading, and `tools/translate.py` translated five
  strings into Simplified Chinese with the placeholder, link and `M112` unchanged.
- **Key storage:** the suite runs the Linux keyring and macOS Keychain paths against stand-in
  programs, and the fallback to the private file. Windows Data Protection and the macOS Keychain
  were written from Microsoft's and Apple's documentation and have not been run on those systems;
  if either fails there, the read-back check sends the key to the private file and says so.
- **The suite** covers both wire formats, error messages, redirects, every safety limit and every
  setting with stand-in services and stand-in `claude` and `codex` programs.
- The assistant has not driven a real U1 yet. Its commands go through the same code that has.

An outline, a profile or a gear is built exactly from its points, with flat faces and sharp
corners where you drew them. Only joining, cutting and keeping parts uses the grid described above.

## Translating Deja Vu1

`tools/translate.py` is a tool for whoever translates the app. It sends the words through the AI you
connected in Deja Vu1 and checks every answer before writing it:

```bash
python3 tools/translate.py catalogue strings/en.json --to zh-CN   # fills strings/zh-CN.json
python3 tools/translate.py doc docs/getting-started.md --to ja    # writes docs/ja/getting-started.md
python3 tools/translate.py doc docs/getting-started.md --to de --dry-run   # counts only
```

A catalogue run sends only the keys the translation doesn't have yet. Code blocks, inline code,
placeholders such as `{file}`, HTML tags and link addresses never reach the AI: each is swapped for a
numbered mark and put back afterwards, and an answer that loses a mark is refused. Names in
`tools/translation-glossary.json` under "keep" (Deja Vu1, Klipper, G-code, PLA and others) must come
back as written. Screen names under "fixed" (Confirm Print, Needs you) are translated once, saved
in the glossary and reused. A text that fails the checks twice stays in English and the tool lists
it.

## In the online demo

No AI runs on the public demo page. A scripted helper answers a few requests (home, warm up, cool
down, pause, resume, cancel, fan, how the print is going) on the simulated printer, and says what
it is.
