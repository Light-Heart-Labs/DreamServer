#!/usr/bin/env python3
"""
generate-setup-card.py — produce a printable setup card PNG for a Dream Server unit.

Use this when shipping a unit: pre-configure its setup-mode Wi-Fi AP (a unique
SSID + password per device), feed those creds plus the setup URL into this
script, get back a 4×6 portrait card you can print + laminate + drop in the box.

The card carries:
  * Top: "DREAM SERVER" wordmark + the device's mDNS name (e.g. "dream.local")
  * Two big QR codes:
      - Left:  Wi-Fi join QR (Android + iOS recognize the WIFI:T:...;S:...;P:...;; format)
      - Right: setup URL — opens straight to the first-boot wizard
  * Plain-text fallback at the bottom (SSID / password / URL) for the
    inevitable phone that won't auto-detect the QR
  * Optional serial / batch line for fulfillment tracking

This is a tooling artifact, not a runtime feature. It only needs to run on
the operator's machine (or the fulfillment pipeline), not on the device itself.

Usage:
    python3 generate-setup-card.py \\
        --ssid 'Dream-Setup-A4F2'    \\
        --password 'xxxxxxxx'         \\
        --setup-url 'http://192.168.7.1/setup' \\
        --device-name 'dream.local'   \\
        --serial 'DRM-2026-A4F2'      \\
        --output card-A4F2.png

Requires: Pillow + qrcode (both pip-installable, both already in the
dashboard-api requirements). Imports lazily so `--help` works without them.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Card geometry — 4×6 inches @ 300 DPI = 1200×1800px portrait.
CARD_W = 1200
CARD_H = 1800
MARGIN = 80

# Brand-ish palette. Matches the dashboard's dark theme but printable.
COLOR_BG = (15, 15, 19)          # near-black, but not pure black (prints better)
COLOR_FG = (228, 228, 231)        # near-white
COLOR_ACCENT = (167, 139, 250)    # purple, matches --theme-accent
COLOR_MUTED = (140, 140, 150)


def build_wifi_qr_payload(ssid: str, password: str, security: str = "WPA") -> str:
    """Return the standard Wi-Fi join URI Android/iOS will recognize.

    Format: WIFI:T:<security>;S:<ssid>;P:<password>;H:false;;

    Special characters in SSID/password must be escaped (\\:, \\;, \\\\, \\").
    """
    def esc(s: str) -> str:
        return (
            s.replace("\\", "\\\\")
             .replace(";", "\\;")
             .replace(",", "\\,")
             .replace(":", "\\:")
             .replace('"', '\\"')
        )

    payload = f"WIFI:T:{security};S:{esc(ssid)};"
    if password:
        payload += f"P:{esc(password)};"
    payload += "H:false;;"
    return payload


def render_qr(text: str, target_px: int):
    """Return a Pillow Image of the QR sized to ~target_px x target_px."""
    import qrcode  # noqa: PLC0415 — lazy import keeps --help fast
    from qrcode.constants import ERROR_CORRECT_M

    # ERROR_CORRECT_M handles ~15% damage which is fine for a printed card.
    # box_size is the pixel size of each "module" (QR cell); we scale up.
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=10,
        border=1,
    )
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    # qrcode picks the cell size; final image dimensions vary by data length.
    # We rescale to the target so the card layout is predictable.
    return img.resize((target_px, target_px))


def render_card(
    ssid: str,
    password: str,
    setup_url: str,
    device_name: str,
    security: str = "WPA",
    serial: str | None = None,
):
    """Compose the full card image. Returns a Pillow Image."""
    from PIL import Image, ImageDraw, ImageFont  # noqa: PLC0415

    card = Image.new("RGB", (CARD_W, CARD_H), COLOR_BG)
    draw = ImageDraw.Draw(card)

    title_font = _load_font(size=80, bold=True)
    heading_font = _load_font(size=42, bold=True)
    body_font = _load_font(size=32)
    mono_font = _load_font(size=36, monospace=True)
    small_font = _load_font(size=24)

    # --- Header band ---
    draw.text(
        (MARGIN, MARGIN),
        "DREAM SERVER",
        font=title_font,
        fill=COLOR_ACCENT,
    )
    draw.text(
        (MARGIN, MARGIN + 100),
        device_name,
        font=heading_font,
        fill=COLOR_FG,
    )
    draw.text(
        (MARGIN, MARGIN + 160),
        "Scan to set up. Scan to chat.",
        font=body_font,
        fill=COLOR_MUTED,
    )

    # --- QR pair ---
    qr_size = (CARD_W - MARGIN * 3) // 2  # two QRs + margin between
    qr_y = 400
    wifi_qr = render_qr(build_wifi_qr_payload(ssid, password, security), qr_size)
    url_qr = render_qr(setup_url, qr_size)
    card.paste(wifi_qr, (MARGIN, qr_y))
    card.paste(url_qr, (MARGIN * 2 + qr_size, qr_y))

    # QR captions
    draw.text(
        (MARGIN, qr_y + qr_size + 20),
        "1. JOIN WI-FI",
        font=heading_font,
        fill=COLOR_ACCENT,
    )
    draw.text(
        (MARGIN * 2 + qr_size, qr_y + qr_size + 20),
        "2. OPEN SETUP",
        font=heading_font,
        fill=COLOR_ACCENT,
    )

    # --- Plain-text fallback block ---
    fallback_y = qr_y + qr_size + 130
    draw.text(
        (MARGIN, fallback_y),
        "if a QR won't scan:",
        font=small_font,
        fill=COLOR_MUTED,
    )

    rows = [
        ("network", ssid),
        ("password", password if password else "(open)"),
        ("then visit", setup_url),
    ]
    row_y = fallback_y + 50
    for label, value in rows:
        draw.text((MARGIN, row_y), label.upper(), font=small_font, fill=COLOR_MUTED)
        draw.text(
            (MARGIN + 240, row_y - 6),
            value,
            font=mono_font,
            fill=COLOR_FG,
        )
        row_y += 70

    # --- Footer / serial ---
    footer_y = CARD_H - MARGIN - 30
    draw.text(
        (MARGIN, footer_y),
        "DreamServer is open-source — light-heart-labs.com",
        font=small_font,
        fill=COLOR_MUTED,
    )
    if serial:
        bbox = draw.textbbox((0, 0), serial, font=small_font)
        text_w = bbox[2] - bbox[0]
        draw.text(
            (CARD_W - MARGIN - text_w, footer_y),
            serial,
            font=small_font,
            fill=COLOR_MUTED,
        )

    return card


def _load_font(size: int, bold: bool = False, monospace: bool = False):
    """Best-effort font loader. Falls back to Pillow's default bitmap font
    if no truetype font is available — the card still renders, just less
    pretty. The card is meant to be printed, so we look for common system
    fonts first.
    """
    from PIL import ImageFont  # noqa: PLC0415

    candidates: list[str] = []
    if monospace:
        candidates += [
            "C:\\Windows\\Fonts\\consola.ttf",   # Windows Consolas
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
            "/System/Library/Fonts/Menlo.ttc",
        ]
    elif bold:
        candidates += [
            "C:\\Windows\\Fonts\\arialbd.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]
    else:
        candidates += [
            "C:\\Windows\\Fonts\\arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]

    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a printable setup card PNG for a Dream Server unit.",
    )
    parser.add_argument("--ssid", required=True, help="Wi-Fi SSID of the device's setup AP")
    parser.add_argument("--password", default="", help="Wi-Fi password (empty for open network)")
    parser.add_argument("--security", default="WPA", choices=["WPA", "WEP", "nopass"],
                        help="Wi-Fi security type (default WPA)")
    parser.add_argument("--setup-url", required=True,
                        help="URL to open after joining the AP (e.g. http://192.168.7.1/setup)")
    parser.add_argument("--device-name", default="dream.local",
                        help="The mDNS name printed on the card (default dream.local)")
    parser.add_argument("--serial", default=None,
                        help="Optional serial / batch identifier printed in the footer")
    parser.add_argument("--output", "-o", required=True,
                        help="Output PNG path")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    try:
        import PIL  # noqa: F401, PLC0415
        import qrcode  # noqa: F401, PLC0415
    except ImportError as exc:
        print(f"error: missing dependency: {exc.name}. "
              "Install with: pip install 'qrcode[pil]'", file=sys.stderr)
        return 2

    card = render_card(
        ssid=args.ssid,
        password=args.password,
        setup_url=args.setup_url,
        device_name=args.device_name,
        security=args.security,
        serial=args.serial,
    )

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    card.save(out_path, format="PNG", dpi=(300, 300))
    print(f"wrote {out_path} ({CARD_W}×{CARD_H} @ 300 DPI = 4×6 inches)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
