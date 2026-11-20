# Demo video

`docs/media/amber-demo.mp4` and the README GIF are made from Amber's real UI, without screen recording:

- `backend.ts` + `mock.ts`: a stand-in for the Rust core (Tauri `mockIPC`) that serves `vault/` and runs the bundled Tinymist, so Typst renders for real.
- `record.mjs`: plays the demo in headless Chrome and captures it with Chrome's screencast → `video/public/app.mp4` and `scenes.json`.
- `video/`: a [Remotion](https://www.remotion.dev) project that adds the titles, window frame and camera moves.

To regenerate (needs Google Chrome and ffmpeg; `npm run fetch-tinymist` first):

```sh
npx vite --config demo/vite.config.ts        # leave running
node demo/record.mjs
cd demo/video && npm install && npx remotion render AmberDemo out/amber-demo.mp4 --license-key=free-license
cp out/amber-demo.mp4 ../../docs/media/
```

The README GIF is a 25-second cut of the video (times match the current take):

```sh
F="[0:v]trim=0.6:2.4,setpts=PTS-STARTPTS[a];[0:v]trim=5.8:13.6,setpts=PTS-STARTPTS[b];[0:v]trim=21.6:26.5,setpts=PTS-STARTPTS[c];[0:v]trim=29.2:35.5,setpts=PTS-STARTPTS[d];[0:v]trim=44.5:48.7,setpts=PTS-STARTPTS[e];[a][b][c][d][e]concat=n=5:v=1:a=0,fps=12,scale=880:-2:flags=lanczos"
ffmpeg -i docs/media/amber-demo.mp4 -filter_complex "$F,split[x][y];[x]palettegen=max_colors=192:stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" docs/media/amber-demo.gif
```

`sources/primer.typ` builds the demo PDF (`vault/Physics/papers/Primer.pdf`).
