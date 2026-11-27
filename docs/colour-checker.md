# The colour checker

A small sensor reads the colour of the filament in a spool's tube and Deja Vu1 compares it with the colour your print file expects. A Raspberry Pi Pico W sends the readings to Deja Vu1 over your home Wi-Fi, or down a USB cable.

**Where it stands.** The firmware, the setup window, the holder and the bench report are built and tested against stand-ins (see [What has been tested](#what-has-been-tested)). The two boards passed an arrival test on 25 November 2026. On 27 November 2026 the firmware file also ran under MicroPython (the interpreter CircuitPython is built on) against the real server. A test compared its calls into CircuitPython and into Adafruit's sensor library with their source, and a stand-in Pico reached the server at a network address with the device lock on. The firmware has not run on a real Pico W yet, the holder has not been printed, and no spool has been measured. No accuracy figure exists and Deja Vu1 quotes none.

The checker gives advice. Confirm Print shows the file's colour, the printer's report and the sensor's reading side by side, asks you to look at the spool when they disagree, and never blocks a start.

## What you need

| Part | Notes |
|---|---|
| Waveshare AS7341 spectral colour sensor | The board with a white 6-pin socket and a cable with push-on sockets. It runs on 3.3 V or 5 V and has two white LEDs of its own. |
| Raspberry Pi Pico **W** with pins soldered on | Plain Pico boards have no Wi-Fi. A Pico W only joins 2.4 GHz networks. |
| A micro-USB cable that carries data | A charge-only cable powers the board but no drive appears on your computer. |
| A USB wall charger (5 V) | Any phone charger. It powers the Pico, and the Pico powers the sensor. |
| Black PLA or PETG | For the holder. Light filament lets room light in and changes every reading. |

## Before you start

1. Deja Vu1 has to be running on this computer whenever the Pico sends readings. With the app closed, the Pico blinks twice and waits.
2. Add your printer in Deja Vu1 (Printers). The Pico's settings carry that printer's id, and a demo printer does not work.
3. Switch on **Right colour loaded?** (Maintenance, Filament & colour, **Turn on**, or Settings, Optional extras). The setup window shows a **Turn it on** button at its top while the module is off.
4. Your Wi-Fi needs a 2.4 GHz name. A Pico W cannot join a 5 GHz-only network.
5. Let the Pico reach this computer through its firewall: [the section below](#let-the-pico-reach-this-computer) has the steps and a way to test it with a phone.

## How it is laid out

The sensor sits inside a black block, with the filament strand 1 to 2 mm below it. The Pico sits outside the block, beside it, within the sensor's 20 cm cable. One USB wall charger plugs into the Pico and powers both boards.

Never power the Pico from the printer, and connect nothing to the printer's electronics. The block stands beside the filament path on a table or on a mount you add.

## Step 1: CircuitPython and the firmware

1. Download CircuitPython 10.3.2 for the Raspberry Pi Pico W from circuitpython.org/board/raspberry_pi_pico_w. Hold the white BOOTSEL button, plug the Pico into your computer, let go, and drag the `.uf2` file onto the `RPI-RP2` drive. A drive called `CIRCUITPY` appears.
2. Download the library bundle for CircuitPython 10.x from circuitpython.org/libraries. Copy `adafruit_as7341.mpy` and the `adafruit_bus_device` and `adafruit_register` folders from its `lib` folder into `CIRCUITPY/lib`. (Developers can use `circup install adafruit_as7341` instead.)
3. Copy `code.py` onto `CIRCUITPY`. Two ways to get it: the **Download code.py** button in the setup window, or `hardware/colour-checker/code.py` in the repository. Both are the same file.
4. Wire the sensor with the Pico unplugged. Hold the Pico with the pins up and the USB socket at the top.

| Cable | Pico pin |
|---|---|
| Red VCC | 36, 3V3(OUT) |
| Black GND | 38, GND |
| Blue SDA | 6, GP4 |
| Yellow SCL | 7, GP5 |
| Orange INT, green GPIO | nothing: leave them hanging |

Never put red on pin 39 or 40 (5 V). The sensor board takes 5 V, but its level shifter could then pull the data wires above the 3.3 V the Pico accepts. That is reasoned from the board's "3.3 V/5 V" label and has not been tested.

## Step 2: give the Pico its Wi-Fi details

Open **Right colour loaded?**, press **Set up the colour checker** and type your Wi-Fi name and password. The password stays in that window. It goes into a file you copy, or down the USB cable, and Deja Vu1's server never receives it. The window also lists this computer's home-network addresses and fills in the printer.

There are four ways to hand the details to the Pico. Use whichever suits you.

| Way | What you do |
|---|---|
| A. Download | Press **Download settings.toml**, plug the Pico into your computer, copy the file onto `CIRCUITPY` (replace the old one) and eject the drive. |
| B. Copy the lines | Press **Copy to the clipboard**, open `settings.toml` on `CIRCUITPY` in any text editor, paste and save. In Windows Notepad choose *Save as type: All files*. Without it the file becomes `settings.toml.txt` and the Pico ignores it. |
| C. Over USB | Connect the Pico in the USB cable panel, then press **Send to the Pico now**. The Pico keeps the details in its own memory and joins the Wi-Fi at once. |
| D. By hand | Type the lines shown in the window into `settings.toml` yourself. |

The file looks like this:

```toml
CIRCUITPY_WIFI_SSID = "HomeNet"
CIRCUITPY_WIFI_PASSWORD = "your password"
DV1_SERVER = "192.168.1.23:8000"
DV1_PRINTER = "<printer id from the window>"
```

`DV1_SERVER` takes more than one address, separated by commas. The Pico tries them in turn and keeps the one that works. The window also offers this computer's `name.local` as a spare. CircuitPython documents `.local` lookups through `getaddrinfo`, but nobody has tried it on a Pico W with a Windows computer here, so treat the numeric address as the reliable one. Settings the app sent over USB win over `settings.toml`, key by key. Press **Forget the Wi-Fi saved on the Pico** in the USB cable panel to erase them and fall back to `settings.toml`. `settings.toml` is plain text on the `CIRCUITPY` drive, so anyone who holds the Pico can read the password.

Your router can give this computer a new address after a restart. When readings stop one day, make the file again, or tell your router to always give this computer the same address.

## Let the Pico reach this computer

The Pico calls Deja Vu1 at this computer's address on your home network, so this computer's firewall must let that call in. Deja Vu1 checks the Host name, the Origin and the optional device lock on every request, as it does for the dashboard. It does not check which network a caller is on, so a firewall rule that names your own network (the `netsh` line below does) keeps it off the rest of the internet.

**Test it first with a phone.** Join the phone to the same Wi-Fi and open `http://` followed by this computer's address from the setup window (for example `http://192.168.1.23:8000`). If the dashboard opens, the Pico can reach it too. With the device lock on, the phone has to pair first. If the page does not open, the cause is the firewall or the address.

**Windows.** Microsoft's support page says a network you first join in Windows 11 is set to Public, and recommends keeping it Public. If Windows asked whether Python may use your networks, allow it for the kind of network your Wi-Fi is set to. If the Pico still cannot get through (the phone test fails), use either way:

- Add a rule for Deja Vu1's port, which keeps the network Public. Open Command Prompt as administrator and run the line below (use your port if you changed `PORT`). It lets in only devices on your own network:

```
netsh advfirewall firewall add rule name="Deja Vu1 colour checker" dir=in action=allow protocol=TCP localport=8000 profile=private,public remoteip=localsubnet
```

- Or set the network to Private: Settings, Network & internet, Wi-Fi, the network you are connected to, Network profile type, Private network. Microsoft says a Private network makes your computer discoverable to other devices and allows file and printer sharing, so use it only on a network you trust.

To remove the rule later: `netsh advfirewall firewall delete rule name="Deja Vu1 colour checker"`.

**macOS.** The first start may ask whether Python may accept incoming connections. Choose Allow.

**Linux.** With `ufw`, allow your own network to reach the port, using your network's range: `sudo ufw allow from 192.168.1.0/24 to any port 8000 proto tcp`.

Microsoft's documentation covers the `netsh` line and the Windows setting (read on 27 November 2026): the `add rule` reference lists `localport`, `profile` and `remoteip=localsubnet`, and the support page on public and private networks gives the Settings path. Nobody has checked the macOS and Linux lines, which describe how those systems usually behave, and nobody has tried any of the steps on its own system.

## Step 3: or use the USB cable

Open Deja Vu1 in Chrome or Edge at `http://localhost:8000` on the computer the Pico is plugged into, open the USB cable panel and press **Connect with USB**. Chrome only allows USB on that address. The page reads the Pico's lines and posts the readings, so the page must stay open. When the Pico already sends over Wi-Fi, the cable carries setup and commands only, so every reading arrives once.

This is the better way to find out what is wrong when the Wi-Fi misbehaves: the Pico explains each problem in words.

## Step 4: find the sensor and set it up

1. **Find it.** Power the Pico. Within a minute the window lists a colour checker with its signal strength. Pick a head (T0 to T3) and press **Assign**.
2. **Test the channels.** The window draws the eight bands. Point the sensor into open space, then hold white paper 5 mm from it. Every band should jump, and the window names any that did not.
3. **Set the brightness.** Put the white target where the filament goes and press **Find the right brightness**. The Pico picks the strongest gain that keeps its brightest channel under half of the chip's range, and keeps it across a USB unplug. Over Wi-Fi the answer arrives with the next reading, a few seconds later.
4. **Record the references.** Record white with the white target in place, then dark with the holder empty.
5. **Check a colour.** Put in a strand. The measured colour appears in the window and on the card.

A reference belongs to the sensor settings it was recorded at. When the gain or the light changes, the card says so, shows no colour and asks for the white reference again.

## Step 5: print the holder

`python3 tools/colour-holder.py --out holder` writes four STL files, and the setup window offers the same files to download:

| File | What it is |
|---|---|
| `test-coupon.stl` | A short piece with the board's pocket, the chimney and a piece of the channel. Print this first. |
| `sensor-block.stl` | The black block: the strand channel, a chimney that shuts the chip off from the board's own LEDs, a slit that limits what the chip sees, and sockets for PTFE tube at both ends. |
| `sensor-lid.stl` | The lid, with four ribs that press the board down. |
| `pico-cradle.stl` | A base for the Pico. Its pin rows drop into two grooves, a cable tie holds it, and the antenna end hangs free. |

Suggested starting settings, not yet tried: print the block with the pocket facing up, in black PLA or PETG, 0.2 mm layers and 3 walls. Look at the preview for the cable slot, the longest bridge at 10 mm, and add support there if it sags. Close the seam around the lid with black tape.

**Measure your board before you print the block.** The makers' documents give the board's size (30.5 × 23 mm), the Pico's size and its antenna keep-out. They do not give where the chip sits on the sensor board, how thick the board is or how tall its socket is. The defaults come from a product picture and are estimates. Measure with a ruler or calipers and pass the numbers in:

```bash
python3 tools/colour-holder.py --out holder --chip-x 15.6 --board-t 1.5 --tube-od 4.1
```

`--chip-x` is the distance from the board's left edge to the middle of the black chip, with the white socket on the right. `--tube-od` defaults to 4.0 mm and is a guess: measure the PTFE tube you use. Run the tool with `--help` for every setting. Print the test piece, lay the board in it and check that the chip sits over the slit before you print the block.

The Pico's antenna needs a free 14 × 9 mm area (Raspberry Pi's datasheet), which is why the cradle leaves the board's last 14 mm free. Keep the cradle away from metal. The cradle's pin grooves sit 17.78 mm (0.7 inch) apart. That number is on Raspberry Pi's mechanical drawing but no text labels it, so lay your Pico against the printed cradle and check before you rely on it.

## Step 6: bench test

Open **Bench test** in the setup window. For each spool, say what it is, pick the colour on its label or listing, put the strand in and take three readings. Take the strand out and put it back for each new insertion. Hold a few spools back as **blind** and adjust nothing because of them. Press **Download all readings** and run:

```bash
python3 tools/colour-bench.py report colour-bench.json --out report.md --csv samples.csv
```

The report shows how steady the readings are, how far they sit from each label colour, which near shades get mixed up and how the blind spools did. It quotes no rate from fewer than 10 spools, and it always shows exact counts with a 95 % range. A label colour is the maker's or seller's, not a measurement, so a distance to it shows how far the checker is from what the spool says and is not its accuracy. Try `python3 tools/colour-bench.py synthetic --out test.json` to see a report on invented readings. Every such report carries a banner saying so.

## What the Pico's light means

The Pico W's own LED repeats this pattern after each reading.

| Light | Meaning |
|---|---|
| Steady on | Readings reach Deja Vu1, or Wi-Fi is not set up and USB is in use. |
| 1 blink | Not on the Wi-Fi: wrong name or password, out of range, or a 5 GHz-only network. |
| 2 blinks | On the Wi-Fi but cannot reach Deja Vu1. |
| 3 blinks | Deja Vu1 answered and refused: the sensor has no head yet, the module is off or the device lock is on. |
| 4 blinks | The sensor does not answer. Check its four wires. |

## If something does not work

| What you see | Try this |
|---|---|
| 2 blinks | Deja Vu1 must be running on the computer, on the same Wi-Fi. Test with a phone and follow [Let the Pico reach this computer](#let-the-pico-reach-this-computer) (a Windows firewall that allows Python on Private networks only blocks a Wi-Fi set to Public). Check the address in `DV1_SERVER` against the one in the setup window. The window offers up to three of this computer's addresses and the Pico tries them in turn, so a VPN or a virtual adapter listed first costs a few seconds once. |
| The Pico says "Something answered at that address, but it is not Deja Vu1" | Another program uses that port, or the port in `DV1_SERVER` is wrong. Use the port the setup window shows. |
| The window says **Right colour loaded?** is switched off | Press **Turn it on** at the top of the window. |
| The Pico says "The firmware hit an unexpected problem" | It carries on by itself and starts again after five in a row. Press **Copy the report** (below) and send it with the Pico's console text. |
| 1 blink | Check the name and password (they are case sensitive). The Pico W cannot join a 5 GHz-only network. Some routers hide the 2.4 GHz band behind one shared name: turn on a separate 2.4 GHz name. |
| 3 blinks, "not assigned" | Open the setup window and assign the sensor to a head. |
| 3 blinks, "device lock" | The Pico must pair like a phone. Show a pairing code (Settings, Pair a phone), put it in the setup window's pairing code box, make the file again and give it to the Pico within 10 minutes. This path is tested against canned answers only, not against a locked server. |
| The Pico ignores `settings.toml` | The file may be called `settings.toml.txt`. Unplug the Pico and plug it in again after every change. |
| "No AS7341 answered at 0x39" | Unplug the USB and check red on pin 36, black on pin 38, blue on pin 6 and yellow on pin 7. Blue and yellow swapped is the usual mistake. |
| The USB panel says the port is busy | Close other pages and programs that show the Pico: a serial console, code.circuitpython.org, Mu. |
| The colour disappears after you change something | The white reference belongs to the gain and light it was recorded at. Record it again. |

## If nothing works: send a report

Open the setup window, step 2, **If nothing works: copy a report to send**, and press **Copy the report**. The text names the sensor and how it connects, its signal, its settings and flags, which window steps are done, the firmware on the Pico against the firmware this build offers, and the sentences the Pico and the app say. It holds no Wi-Fi name, no password and no pairing code. Add what the Pico's light does and, if you can read it, the Pico's console text (the USB panel shows the same lines, or use a serial console such as code.circuitpython.org). The console lines mean:

| Line | Meaning |
|---|---|
| `Deja Vu1 colour checker firmware 1.0.1 (protocol 1)` | The program started. Compare the number with the report's. |
| `Wi-Fi "name" (from file), app at 192.168.1.23:8000` | The settings it read. `from usb` means the app saved them on the Pico. |
| `AS7341 found. LEDs on at 10 mA, gain 16x.` | The sensor answered. |
| `#12 nm 415:… 680:… clear:… nir:…` | One reading, raw counts. `<< saturated`, `low_light` or `unstable` follow it when the light, the target or the holder is off. |
| `Wi-Fi: Readings are reaching Deja Vu1.` | The app accepted the reading. Any other `Wi-Fi:` line says what is wrong, in words. |

## Privacy and safety

- The Wi-Fi password never reaches Deja Vu1's server and no route sends it anywhere. The Pico never repeats it in a message.
- The Pico talks to Deja Vu1 on your home network only. Do not expose Deja Vu1 to the internet. Requests pass the same checks as the dashboard (Host name, Origin, optional device lock); no header skips them.
- A Pico on a USB charger sends a reading every two seconds. Its traffic does not count as an open page, so it does not keep Deja Vu1 running after you close the last page. When Deja Vu1 is not running, the Pico blinks twice and waits.
- The sensor board draws 20 mA with its light off and 70 mA with it on (Waveshare). The firmware caps the light's setting at 20 mA because Waveshare does not publish the LEDs' limit.

## What has been tested

| Part | Evidence | Not checked |
|---|---|---|
| Parts arrival (25 November 2026) | A run of the arrival-test program on the real boards: the sensor answered at 0x39, both LEDs lit, all eight bands changed. | Anything with the firmware in this folder. |
| Firmware | The real `code.py` runs on a computer against stand-in hardware modules and a model of the sensor: readings, commands, auto gain, settings kept, Wi-Fi joining, clock, posting to the real server over real sockets, LED patterns, failures, a surprising reply from whatever answers on the port, and surviving an unexpected failure (a restart after five in a row). | A real Pico W, a real router, a real AS7341, Windows. |
| Firmware under MicroPython (27 November 2026) | The same file runs under MicroPython 1.22.1 with stand-in modules, posts to the real server over a real socket and the app accepts the readings: every command, auto gain, saved Wi-Fi settings, the app being unreachable. | CircuitPython itself (its floats are single precision, MicroPython's are double), a real chip. |
| Calls into CircuitPython and the sensor library (27 November 2026) | `wifi.radio.connect(timeout=)`, `socketpool` (`getaddrinfo`, `connect`, `sendall`, `recv_into`, `settimeout`), `supervisor.serial_bytes_available` and `supervisor.reload`, `ConnectionError`, `gc.collect` exist in CircuitPython 10.3.2's source with the signatures the firmware uses. The firmware's gain names, status read (`<BHHHHHH`), bank helpers and LED calls match `adafruit_as7341` 1.2.27's source. | The compiled `.mpy` in the library bundle, the register traffic on a real chip. |
| Network address and device lock (27 November 2026) | A stand-in Pico reaches the real server at this computer's network address (not loopback), with the lock off and on: a Pico pairs with a code in its settings, keeps its key across an unplug, is refused in words with no code or a wrong one, and pairs again after being unpaired. | A real router and a real firewall. |
| Setup window | Chromium on Linux at 1366 and 390 px: both routes, the settings file, the channel test, brightness, references, a colour, Confirm Print, the override record, the bench. | Chrome on Windows 11. A fake USB port stood in for Web Serial. |
| Holder | Closed meshes, a strand channel that runs straight through, a chimney between chip and LEDs, walls over 0.8 mm. | Printing it, fitting a real board, light leaks. |
| Bench report | Hand-made data and the tool's own synthetic data. | Any real spool. |

The tests are `tests/test_colour_firmware.py`, `tests/test_colour_wifi.py`, `tests/test_colour_lan.py` (skips on a computer with no network address besides loopback), `tests/test_colour_micropython.py` (skips without the `micropython` program, `sudo apt install micropython`), `tests/test_colour_library_contract.py` (skips without the Adafruit library's source, see its docstring), `tests/test_sensor_settings.py`, `tests/test_sensor_wifi.py`, `tests/test_colour_holder.py`, `tests/test_colour_bench.py`, `tests/test_colour_checker_files.py` and `tests/test_colour_setup_browser.py` (which runs `node tools/colour-setup-check.js`). [docs/testing.md](testing.md) holds the dated record and the [API](colour-sensor-api.md) describes the messages.
