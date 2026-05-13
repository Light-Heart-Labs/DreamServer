# Setup card generator

`scripts/generate-setup-card.py` produces a printable 4×6 PNG for fulfillment: drop one in the box with each Dream Server unit so the recipient can scan two QR codes and reach the wizard without typing anything.

## What it generates

A portrait card with:

1. **Top band** — "DREAM SERVER" wordmark, the unit's mDNS name (e.g. `dream.local`), and a one-line "Scan to set up. Scan to chat." tagline.
2. **Two QR codes side by side:**
   - **Left — JOIN WI-FI.** Encodes the standard `WIFI:T:WPA;S:<ssid>;P:<password>;;` format that iOS Camera and Android (Chrome / system QR scanner) auto-recognize. Phone joins the AP with one tap.
   - **Right — OPEN SETUP.** Plain URL QR. The user's browser opens straight to the first-boot wizard at e.g. `http://192.168.7.1/setup`.
3. **Plain-text fallback block** — SSID, password, URL printed verbatim for phones that won't scan the QR (older models, scratched cards, scanner permission denied).
4. **Footer** — "DreamServer is open-source — light-heart-labs.com", plus an optional per-unit serial number for fulfillment tracking.

Card is 1200×1800 px at 300 DPI = exactly 4×6 inches. Print on photo cardstock and laminate, or just print on plain paper for prototypes.

## Requirements

`pip install 'qrcode[pil]'` — that's it. `qrcode[pil]` pulls in Pillow as a transitive dep. This is an operator-side tool, not a runtime service, so the deps aren't bundled with any Dream Server container; install them into whatever Python environment you run the script from. (If you've also installed the magic-link auth router from [#1155](https://github.com/Light-Heart-Labs/DreamServer/pull/1155), `qrcode[pil]` is in that service's `requirements.txt` already and you can reuse the same virtualenv — but the setup-card script does not depend on dashboard-api at runtime.)

## Usage

```bash
python3 scripts/generate-setup-card.py \
  --ssid 'Dream-Setup-A4F2' \
  --password 'xxxxxxxx' \
  --setup-url 'http://192.168.7.1/setup' \
  --device-name 'dream-a4f2.local' \
  --serial 'DRM-2026-A4F2' \
  --output cards/card-A4F2.png
```

Flags:

| Flag | Required | Notes |
|---|---|---|
| `--ssid` | yes | Wi-Fi SSID of the device's setup AP |
| `--password` | no | Wi-Fi password. Omit for open networks; the Wi-Fi QR will use `T:nopass` automatically. |
| `--security` | no | `WPA` (default), `WEP`, or `nopass` |
| `--setup-url` | yes | URL the QR opens (e.g. `http://192.168.7.1/setup`) |
| `--device-name` | no | mDNS hostname printed on the card. Defaults to `dream.local`. |
| `--serial` | no | Optional serial / batch ID printed in the footer right corner |
| `--output` / `-o` | yes | Output PNG path. Parent directory is created if missing. |

Exit codes: `0` on success, `2` if Pillow / qrcode isn't installed. Argparse handles bad flags.

## Batch generation

Looping the script over a list of pre-baked AP credentials is the recommended fulfillment flow:

```bash
while IFS=',' read -r ssid password serial; do
  python3 scripts/generate-setup-card.py \
    --ssid "$ssid" \
    --password "$password" \
    --setup-url "http://192.168.7.1/setup" \
    --device-name "dream-$(printf '%s' "$serial" | tr '[:upper:]' '[:lower:]').local" \
    --serial "$serial" \
    --output "cards/$serial.png"
done < unit-credentials.csv
```

(`unit-credentials.csv` line format: `Dream-Setup-A4F2,xxxxxxxx,DRM-2026-A4F2`)

## Design choices

- **PNG, not PDF.** Printers handle PNG fine, batch generation is one library call, and the operator can convert with any tool if they really want PDF. Adding `reportlab` for a one-line save would double the dependency footprint.
- **Pillow for layout, not SVG templates.** A pre-baked template is more flexible visually but harder to maintain (font fallback, variable text wrapping). The Python composition fits the layout to the content rather than the other way around.
- **Best-effort font loading.** The script tries Consolas / DejaVu / Helvetica based on OS, falls back to Pillow's bitmap font if nothing matches. The card always renders — only the typography varies.
- **No on-device generation.** This is an operator-side script. The device doesn't know its own AP credentials (those are baked in during the image-build step) and shouldn't be able to print its own credentials anyway.

## Security notes

- The plaintext password is on the card by design — it's what makes the first-touch flow work. Treat the card as a physical credential. If a unit is sold / resold, the new owner should re-generate the AP credentials and discard the card.
- The setup URL doesn't carry the credential. It points at the device's setup-mode IP; if the recipient hasn't joined the AP yet, the URL just times out.
- Serial / batch identifiers are optional and intended for fulfillment, not authentication. Don't encode anything sensitive in them.

## Limitations / future work

- **No splash logo.** The wordmark is set in the system bold font. Dropping in `dream-logo.svg` (when it exists) is a small change.
- **No multi-language.** Text is English-only. Localizing the QR captions ("JOIN WI-FI" / "OPEN SETUP") would mean accepting `--locale` or per-locale templates.
- **No PDF output.** Add `--format pdf` later if a fulfillment pipeline needs it; Pillow can save as PDF with `card.save(path, format="PDF")`.
- **No Hidden SSID flag.** Standard Wi-Fi QR supports `H:true;`. Today the script hardcodes `H:false`; trivial to expose if a unit's AP is hidden.
