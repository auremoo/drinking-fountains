# App icon — brief for an image-generation AI

Copy the **prompt** below into an image AI (Midjourney, DALL·E, Ideogram,
Stable Diffusion, ChatGPT image, etc.) to generate the app icon. Below it are
the technical specs and the steps to drop the result into this project.

---

## ✂️ Prompt to paste

```
A modern, friendly mobile app icon for an app that finds public drinking-water
fountains on a map. Centered subject: a clean, minimal water-drop merged with a
map location pin, with a small fountain/tap silhouette inside. Flat vector
style, bold simple shapes, smooth gradients in water blues (#0ea5e9 to #0284c7)
on a soft sky-blue background (#f0f9ff). Rounded-square icon with generous
padding, no text, no letters, crisp edges, high contrast, centered composition,
subtle long shadow. Designed to stay legible at very small sizes. App store
icon, 1024x1024, square.
```

### Optional style variations (pick one to append to the prompt)
- `, glassmorphism, soft inner glow` — softer, premium look
- `, sticker style, thick white outline` — playful
- `, duotone, ultra-minimal, single drop only` — most minimal / most legible

---

## Technical specs (give these to the AI too if it asks)

| Property | Value |
| --- | --- |
| Master size | **1024 × 1024 px**, square |
| Format | PNG (transparent) + a solid-background version |
| Brand colors | primary `#0ea5e9`, dark `#0284c7`, background `#f0f9ff` |
| Theme color | `#0ea5e9` |
| Content | water drop + map pin + fountain; **no text** |
| Safe zone | keep all important content within the **centre 80%** (≈ inner 819 px) so it survives "maskable" circular/rounded cropping on Android/iOS |
| Padding | ~12% margin on every side |
| Legibility | must read clearly at 48 px |

## What to actually produce

From the 1024×1024 master, export these files:

| File | Size | Purpose |
| --- | --- | --- |
| `public/icon.svg` | vector | preferred (crisp everywhere) — replace existing |
| `public/pwa-192x192.png` | 192×192 | Android home screen |
| `public/pwa-512x512.png` | 512×512 | splash / install |
| `public/maskable-512x512.png` | 512×512 | Android maskable (extra-safe centre) |
| `public/apple-touch-icon.png` | 180×180 | iOS home screen (no transparency) |
| `public/favicon.svg` | vector | browser tab — replace existing |

> Tip: if the AI only gives you a PNG, vectorize it at
> <https://vectorizer.ai> or <https://www.svgviewer.dev>, or just ship the PNGs
> and skip the SVG.

## How to install the result in this project

1. Drop the files above into the `public/` folder (overwrite the existing
   `icon.svg` / `favicon.svg`).
2. If you added PNGs, update the manifest in
   [`vite.config.js`](../vite.config.js) so the `icons` array lists them, e.g.:

   ```js
   icons: [
     { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
     { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
     {
       src: 'maskable-512x512.png',
       sizes: '512x512',
       type: 'image/png',
       purpose: 'maskable',
     },
   ],
   ```

   and add `'pwa-192x192.png', 'pwa-512x512.png', 'apple-touch-icon.png'` to the
   `includeAssets` array.
3. For iOS, add this line inside `<head>` of [`index.html`](../index.html):

   ```html
   <link rel="apple-touch-icon" href="/drinking-fountains/apple-touch-icon.png" />
   ```

4. Rebuild: `npm run build`. Verify the icon in Chrome DevTools →
   Application → Manifest, and check the maskable version at
   <https://maskable.app/editor>.
