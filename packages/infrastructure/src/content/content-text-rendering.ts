import sharp from "sharp";

let checked: Promise<void> | undefined;

/** A successful image encode does not prove that the active SVG backend renders glyphs. */
export function requireContentTextRendering(): Promise<void> {
  checked ??= checkTextRendering();
  return checked;
}

async function checkTextRendering(): Promise<void> {
  const probe = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="64"><rect width="240" height="64" fill="white"/><text x="8" y="44" font-family="DejaVu Sans,Arial,sans-serif" font-size="32" fill="black">Texte Aa123</text></svg>');
  const { data, info } = await sharp(probe).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let darkPixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset]! < 128 && data[offset + 1]! < 128 && data[offset + 2]! < 128) darkPixels += 1;
  }
  if (darkPixels < 10) throw new Error("CONTENT_MEDIA_TEXT_RENDER_UNAVAILABLE");
}
