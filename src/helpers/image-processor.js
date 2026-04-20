const sharp = require("sharp");

function getIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getImageConfig() {
  return {
    maxWidth: getIntEnv("IMAGE_MAX_WIDTH", 1920),
    quality: Math.min(100, Math.max(1, getIntEnv("IMAGE_WEBP_QUALITY", 80))),
    effort: Math.min(6, Math.max(0, getIntEnv("IMAGE_WEBP_EFFORT", 4))),
  };
}

async function processImageToWebp(inputBuffer, overrides = {}) {
  if (!inputBuffer || !Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw new Error("processImageToWebp: inputBuffer is empty or invalid");
  }

  const { maxWidth, quality, effort } = { ...getImageConfig(), ...overrides };

  const pipeline = sharp(inputBuffer, { failOn: "none" })
    .rotate()
    .resize({
      width: maxWidth,
      withoutEnlargement: true,
      fit: "inside",
    })
    .webp({ quality, effort });

  const buffer = await pipeline.toBuffer();

  return {
    buffer,
    extension: "webp",
    mimetype: "image/webp",
    size: buffer.length,
  };
}

module.exports = {
  processImageToWebp,
  getImageConfig,
};
