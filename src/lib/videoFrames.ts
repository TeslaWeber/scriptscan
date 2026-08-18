/**
 * Extract distinct, sharp frames from a recorded video of exam scripts.
 *
 * Strategy (fast + accurate):
 *  1. Seek through the video at a fixed sampling step.
 *  2. Draw each frame to a work canvas capped at `maxWidth`.
 *  3. Reject frames that are near-identical to the previously accepted frame
 *     (perceptual 16x16 grayscale signature) — avoids re-OCRing the same script.
 *  4. Reject blurry frames (low Laplacian-style edge energy) — a motion-blurred
 *     frame wastes an OCR call and produces mistakes.
 */

export type VideoFrame = {
  time: number;
  blob: Blob;
  preview: string;
};

const SIG = 16;

function signature(ctx: CanvasRenderingContext2D, w: number, h: number): Float32Array {
  const small = document.createElement("canvas");
  small.width = SIG;
  small.height = SIG;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, SIG, SIG);
  const { data } = sctx.getImageData(0, 0, SIG, SIG);
  const out = new Float32Array(SIG * SIG);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return out;
}

function meanAbsDiff(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** Rough sharpness: mean absolute gradient of a downsampled grayscale frame. */
function sharpness(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const S = 96;
  const small = document.createElement("canvas");
  small.width = S;
  small.height = S;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, S, S);
  const { data } = sctx.getImageData(0, 0, S, S);
  const g = new Float32Array(S * S);
  for (let i = 0; i < g.length; i++) {
    const p = i * 4;
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  let sum = 0;
  let n = 0;
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      sum += Math.abs(4 * g[i] - g[i - 1] - g[i + 1] - g[i - S] - g[i + S]);
      n++;
    }
  }
  return sum / n;
}

export async function extractVideoFrames(
  file: File,
  opts: {
    step?: number;
    maxWidth?: number;
    diffThreshold?: number;
    minSharpness?: number;
    maxFrames?: number;
    onProgress?: (pct: number, found: number) => void;
    signal?: { aborted: boolean };
  } = {},
): Promise<VideoFrame[]> {
  const {
    step = 0.5,
    maxWidth = 1280,
    diffThreshold = 7,
    minSharpness = 3,
    maxFrames = 400,
    onProgress,
    signal,
  } = opts;

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Could not read that video file"));
    });

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Video has no readable duration");

    const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
    const w = Math.max(1, Math.round((video.videoWidth || maxWidth) * scale));
    const h = Math.max(1, Math.round((video.videoHeight || maxWidth) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const seekTo = (t: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          video.removeEventListener("seeked", done);
          resolve();
        };
        video.addEventListener("seeked", done);
        video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
      });

    const frames: VideoFrame[] = [];
    let prevSig: Float32Array | null = null;

    for (let t = 0; t < duration && frames.length < maxFrames; t += step) {
      if (signal?.aborted) break;
      await seekTo(t);
      ctx.drawImage(video, 0, 0, w, h);

      const sig = signature(ctx, w, h);
      const isNew = !prevSig || meanAbsDiff(prevSig, sig) > diffThreshold;
      onProgress?.(Math.min(99, Math.round((t / duration) * 100)), frames.length);
      if (!isNew) continue;
      if (sharpness(ctx, w, h) < minSharpness) continue;

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
      if (!blob) continue;
      prevSig = sig;
      frames.push({ time: t, blob, preview: canvas.toDataURL("image/jpeg", 0.4) });
      onProgress?.(Math.min(99, Math.round((t / duration) * 100)), frames.length);
    }

    onProgress?.(100, frames.length);
    return frames;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}
