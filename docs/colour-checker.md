# The colour checker

A small sensor reads the colour of the filament in a spool's tube and Deja Vu1 compares it with the colour your print file expects. A Raspberry Pi Pico W sends the readings to Deja Vu1 over your home Wi-Fi, or down a USB cable.

**Where it stands.** The firmware, the setup window, the holder and the bench report are built and tested against stand-ins (see [What has been tested](#what-has-been-tested)). The two boards passed an arrival test on 25 November 2026. The firmware has not run on a real Pico W yet, the holder has not been printed, and no spool has been measured. No accuracy figure exists and Deja Vu1 quotes none.

The checker gives advice. Confirm Print shows the file's colour, the printer's report and the sensor's reading side by side, asks you to look at the spool when they disagree, and never blocks a start.

## What you need

| Part | Notes |
|---|---|
| Waveshare AS7341 spectral colour sensor | The board with a white 6-pin socket and a cable with push-on sockets. It runs on 3.3 V or 5 V and has two white LEDs of its own. |
| Raspberry Pi Pico **W** with pins soldered on | Plain Pico boards have no Wi-Fi. A Pico W only joins 2.4 GHz networks. |
| A micro-USB cable that carries data | A charge-only cable powers the board but no drive appears on your computer. |
| A USB wall charger (5 V) | Any phone charger. It powers the Pico, and the Pico powers the sensor. |
| Black PLA or PETG | For the holder. Light filament lets room light in and changes every reading. |

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

`DV1_SERVER` takes more than one address, separated by commas. The Pico tries them in turn and keeps the one that works. Settings the app sent over USB win over `settings.toml`, key by key. Press **Forget the Wi-Fi saved on the Pico** in the USB cable panel to erase them and fall back to `settings.toml`. `settings.toml` is plain text on the `CIRCUITPY` drive, so anyone who holds the Pico can read the password.

Your router can give this computer a new address after a restart. When readings stop one day, make the file again, or tell your router to always give this computer the same address.

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

**Measure your board before you print the block.** The makers' documents give the board's size (30.5 × 23 mm) and the Pico's size and pin spacing. They do not give where the chip sits on the sensor board, how thick the board is or how tall its socket is. The defaults come from a product picture and are estimates. Measure with a ruler or calipers and pass the numbers in:

```bash
python3 tools/colour-holder.py --out holder --chip-x 15.6 --board-t 1.5 --tube-od 4.1
```

`--chip-x` is the distance from the board's left edge to the middle of the black chip, with the white socket on the right. `--tube-od` defaults to 4.0 mm and is a guess: measure the PTFE tube you use. Run the tool with `--help` for every setting. Print the test piece, lay the board in it and check that the chip sits over the slit before you print the block.

The Pico's antenna needs a free 14 × 9 mm area (Raspberry Pi's datasheet), which is why the cradle leaves the board's last 14 mm free. Keep the cradle away from metal.

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
| 2 blinks | Deja Vu1 must be running on the computer, on the same Wi-Fi. When Windows asked to let Python use private networks, choose **Allow** and restart Deja Vu1. Check the address in `DV1_SERVER` against the one in the setup window. |
| 1 blink | Check the name and password (they are case sensitive). The Pico W cannot join a 5 GHz-only network. Some routers hide the 2.4 GHz band behind one shared name: turn on a separate 2.4 GHz name. |
| 3 blinks, "not assigned" | Open the setup window and assign the sensor to a head. |
| 3 blinks, "device lock" | The Pico must pair like a phone. Show a pairing code (Settings, Pair a phone), put it in the setup window's pairing code box, make the file again and give it to the Pico within 10 minutes. This path is tested against canned answers only, not against a locked server. |
| The Pico ignores `settings.toml` | The file may be called `settings.toml.txt`. Unplug the Pico and plug it in again after every change. |
| "No AS7341 answered at 0x39" | Unplug the USB and check red on pin 36, black on pin 38, blue on pin 6 and yellow on pin 7. Blue and yellow swapped is the usual mistake. |
| The USB panel says the port is busy | Close other pages and programs that show the Pico: a serial console, code.circuitpython.org, Mu. |
| The colour disappears after you change something | The white reference belongs to the gain and light it was recorded at. Record it again. |

## Privacy and safety

- The Wi-Fi password never reaches Deja Vu1's server and no route sends it anywhere. The Pico never repeats it in a message.
- The Pico talks to Deja Vu1 on your home network only. Do not expose Deja Vu1 to the internet. Requests pass the same checks as the dashboard (Host name, Origin, optional device lock); no header skips them.
- A Pico on a USB charger sends a reading every two seconds. Its traffic does not count as an open page, so it does not keep Deja Vu1 running after you close the last page. When Deja Vu1 is not running, the Pico blinks twice and waits.
- The sensor board draws 20 mA with its light off and 70 mA with it on (Waveshare). The firmware caps the light's setting at 20 mA because Waveshare does not publish the LEDs' limit.

## What has been tested

| Part | Evidence | Not checked |
|---|---|---|
| Parts arrival (25 November 2026) | Owner's photos: the sensor answered at 0x39, both LEDs lit, all eight bands changed. | Anything with the firmware in this folder. |
| Firmware | The real `code.py` runs on a computer against stand-in hardware modules and a model of the sensor: readings, commands, auto gain, settings kept, Wi-Fi joining, clock, posting to the real server over real sockets, LED patterns, failures. | A real Pico W, a real router, a real AS7341, Windows. |
| Setup window | Chromium on Linux at 1366 and 390 px: both routes, the settings file, the channel test, brightness, references, a colour, Confirm Print, the override record, the bench. | Chrome on Windows 11. A fake USB port stood in for Web Serial. |
| Holder | Closed meshes, a strand channel that runs straight through, a chimney between chip and LEDs, walls over 0.8 mm. | Printing it, fitting a real board, light leaks. |
| Bench report | Hand-made data and the tool's own synthetic data. | Any real spool. |

The tests are `tests/test_colour_firmware.py`, `tests/test_colour_wifi.py`, `tests/test_sensor_settings.py`, `tests/test_sensor_wifi.py`, `tests/test_colour_holder.py`, `tests/test_colour_bench.py`, `tests/test_colour_checker_files.py` and `tests/test_colour_setup_browser.py` (which runs `node tools/colour-setup-check.js`). [docs/testing.md](testing.md) holds the dated record and the [API](colour-sensor-api.md) describes the messages.
