// Creates the original, silent rare-opening background shipped with the game.
// Developer asset tool; never runs in the application or contacts an external site.
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {});
try {
  const page = await browser.newPage();
  await page.evaluate('globalThis.__name = (fn) => fn');
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d')!;
    const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    const recorder = new MediaRecorder(canvas.captureStream(30), {
      mimeType: type,
      videoBitsPerSecond: 750000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const result = new Promise<string>((resolve) => {
      recorder.onstop = async () => {
        const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        resolve(btoa(binary));
      };
    });
    let frame = 0;
    function draw() {
      const t = frame / 30,
        w = canvas.width,
        h = canvas.height;
      ctx.fillStyle = '#070918';
      ctx.fillRect(0, 0, w, h);
      for (let band = 0; band < 4; band++) {
        const x = w * (0.3 + 0.35 * Math.sin(t * 0.4 + band)),
          y = h * (0.35 + 0.25 * Math.cos(t * 0.5 + band));
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, 600);
        gradient.addColorStop(0, ['#6938a85c', '#156a9b66', '#6f4e9d55', '#ad7a3933'][band]);
        gradient.addColorStop(1, '#00000000');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }
      for (let j = 0; j < 18; j++) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 10) {
          const y =
            h * 0.5 +
            Math.sin(x / 230 + t * 0.7 + j * 0.04) * 110 +
            Math.sin(x / 110 - t * 0.4) * 25 +
            j * 4;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${j % 2 ? '161,108,255' : '71,199,239'},${0.02 + 0.02 * Math.sin(j)})`;
        ctx.lineWidth = 2 + j * 0.25;
        ctx.stroke();
      }
      for (let i = 0; i < 130; i++) {
        const x = (i * 173.19 + t * (5 + (i % 6))) % w,
          y = (i * 93.37) % h,
          alpha = 0.15 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.8 + i));
        ctx.fillStyle = `rgba(235,222,255,${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, i % 13 === 0 ? 2 : 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      frame++;
    }
    draw();
    recorder.start();
    const timer = setInterval(draw, 1000 / 30);
    await new Promise((resolve) => setTimeout(resolve, 4800));
    clearInterval(timer);
    recorder.stop();
    return result;
  });
  await mkdir('apps/web/public/media', { recursive: true });
  const video = Buffer.from(encoded, 'base64');
  await writeFile('apps/web/public/media/rare-reveal.webm', video);
  console.log(`Original rare reveal video created (${video.length} bytes).`);
} finally {
  await browser.close();
}
