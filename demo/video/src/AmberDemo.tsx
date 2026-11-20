import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { Video } from "@remotion/media";
import { fade } from "@remotion/transitions/fade";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import recording from "../public/scenes.json";

const { fontFamily: serif } = loadFraunces("normal", { weights: ["500", "600"], subsets: ["latin"] });
const { fontFamily: sans } = loadInter("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });

export const INTRO_S = 3.4;
export const OUTRO_S = 5;
export const TRANSITION_S = 0.5;
/** The app recording plays a little faster than it was performed. */
export const RATE = 1.12;

const AMBER = "#c96a0b";
const INK = "#1f1b16";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const outExpo = Easing.bezier(0.16, 1, 0.3, 1);

/** Headline and camera per scene of the recording (positions are 0–1 of the app). */
const SCENES: Record<string, { title: string; shots: { at: number; zoom: number; x: number; y: number }[] }> = {
  open: { title: "Notes that look like a book.", shots: [{ at: 0, zoom: 1, x: 0.5, y: 0.4 }] },
  write: { title: "Just write. Maths renders as you type.", shots: [{ at: 0.4, zoom: 1.5, x: 0.45, y: 0.26 }] },
  slash: { title: "Press / for any block.", shots: [{ at: 0.3, zoom: 1.35, x: 0.48, y: 1 }] },
  pdf: {
    title: "Link straight to page 2 of a PDF.",
    shots: [
      { at: 0, zoom: 1.3, x: 0.38, y: 0.62 },
      { at: 2.4, zoom: 1.25, x: 0.78, y: 0.45 },
    ],
  },
  views: {
    title: "Writing. Source. Rendered.",
    shots: [
      { at: 0.6, zoom: 1.6, x: 0.8, y: 0 },
      { at: 3.4, zoom: 1.12, x: 0.6, y: 0 },
    ],
  },
  files: { title: "Plain files, in folders you own.", shots: [{ at: 0.2, zoom: 1.55, x: 0, y: 0.1 }] },
  end: { title: "Plain files, in folders you own.", shots: [{ at: 0, zoom: 1.55, x: 0, y: 0.1 }] },
};

export const AmberDemo: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1400px 900px at 50% 0%, #fff7ea 0%, #f6e6cc 55%, #ecd3ad 100%)` }}>
      <TransitionSeries name="Demo">
        <TransitionSeries.Sequence name="Intro" durationInFrames={Math.round(INTRO_S * fps)}>
          <Intro />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: Math.round(TRANSITION_S * fps) })} />
        <TransitionSeries.Sequence name="App" durationInFrames={Math.round((recording.duration / RATE) * fps)}>
          <AppShot />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: Math.round(TRANSITION_S * fps) })} />
        <TransitionSeries.Sequence name="Outro" durationInFrames={Math.round(OUTRO_S * fps)}>
          <Outro />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};

const Wordmark: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.28 }}>
    <div
      style={{
        width: size * 0.62,
        height: size * 0.62,
        borderRadius: "50%",
        background: `radial-gradient(circle at 35% 30%, #f7c27a, ${AMBER} 60%, #8a4306)`,
        boxShadow: `0 ${size * 0.08}px ${size * 0.25}px rgb(201 106 11 / 0.35)`,
      }}
    />
    <div style={{ fontFamily: serif, fontWeight: 600, fontSize: size, color: INK, letterSpacing: "-0.02em", lineHeight: 1 }}>Amber</div>
  </div>
);

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 48 }}>
      <div
        style={{
          opacity: interpolate(frame, [0, 0.6 * fps], [0, 1], clamp),
          scale: interpolate(frame, [0, 1.2 * fps], [0.92, 1], { ...clamp, easing: outExpo }),
        }}
      >
        <Wordmark size={190} />
      </div>
      <div
        style={{
          fontFamily: sans,
          fontSize: 54,
          fontWeight: 500,
          color: "#5b4c3a",
          opacity: interpolate(frame, [0.6 * fps, 1.2 * fps], [0, 1], clamp),
          translate: interpolate(frame, [0.6 * fps, 1.4 * fps], ["0px 24px", "0px 0px"], { ...clamp, easing: outExpo }),
        }}
      >
        Write like a notebook. Typeset like a book.
      </div>
    </AbsoluteFill>
  );
};

/** The scene playing at `t` seconds of the recording. */
function sceneAt(t: number) {
  const list = recording.scenes;
  let i = 0;
  while (i + 1 < list.length && list[i + 1].t <= t) i++;
  return { ...list[i], index: i };
}

/** Camera at `t`: eases from the previous shot to the next over 0.9 s. */
function camera(t: number) {
  const shots = recording.scenes.flatMap((s) => SCENES[s.name].shots.map((sh) => ({ ...sh, at: s.t + sh.at })));
  let i = 0;
  while (i + 1 < shots.length && shots[i + 1].at <= t) i++;
  const prev = shots[Math.max(0, i - 1)];
  const cur = shots[i];
  const k = interpolate(t, [cur.at, cur.at + 0.9], [0, 1], { ...clamp, easing: Easing.bezier(0.65, 0, 0.35, 1) });
  const mix = (a: number, b: number) => a + (b - a) * k;
  return i === 0 ? cur : { zoom: mix(prev.zoom, cur.zoom), x: mix(prev.x, cur.x), y: mix(prev.y, cur.y) };
}

const WINDOW_W = 1360;
const VIDEO_H = Math.round((WINDOW_W * recording.height) / recording.width);
const BAR_H = 36;

const AppShot: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (frame / fps) * RATE; // seconds into the recording
  const cam = camera(t);
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <Headline t={t} />
      <div
        style={{
          position: "absolute",
          top: 168,
          width: WINDOW_W,
          borderRadius: 14,
          overflow: "hidden",
          background: "#fbf9f5",
          boxShadow: "0 40px 90px rgb(80 45 10 / 0.28), 0 0 0 1px rgb(80 45 10 / 0.12)",
          translate: interpolate(frame, [0, 0.8 * fps], ["0px 60px", "0px 0px"], { ...clamp, easing: outExpo }),
        }}
      >
        <div style={{ height: BAR_H, display: "flex", alignItems: "center", gap: 9, padding: "0 16px", background: "#f1ebe1", borderBottom: "1px solid #e4dccd" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 13, height: 13, borderRadius: "50%", background: c }} />
          ))}
        </div>
        <div style={{ position: "relative", width: WINDOW_W, height: VIDEO_H, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, transformOrigin: `${cam.x * 100}% ${cam.y * 100}%`, scale: cam.zoom }}>
            <Video name="Amber recording" src={staticFile("app.mp4")} playbackRate={RATE} muted style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Headline: React.FC<{ t: number }> = ({ t }) => {
  const scene = sceneAt(t);
  const title = SCENES[scene.name].title;
  const since = t - scene.t;
  // A repeated title (the last scene) doesn't animate again.
  const fresh = scene.index === 0 || SCENES[recording.scenes[scene.index - 1].name].title !== title;
  const k = fresh ? interpolate(since, [0, 0.55], [0, 1], { ...clamp, easing: outExpo }) : 1;
  return (
    <div
      style={{
        position: "absolute",
        top: 42,
        fontFamily: serif,
        fontWeight: 600,
        fontSize: 76,
        color: INK,
        letterSpacing: "-0.015em",
        opacity: k,
        translate: `0px ${(1 - k) * 22}px`,
      }}
    >
      {title}
    </div>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = (from: number) => ({
    opacity: interpolate(frame, [from * fps, (from + 0.5) * fps], [0, 1], clamp),
    translate: interpolate(frame, [from * fps, (from + 0.8) * fps], ["0px 26px", "0px 0px"], { ...clamp, easing: outExpo }),
  });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
      <div style={rise(0.1)}>
        <Wordmark size={170} />
      </div>
      <div style={{ ...rise(0.5), fontFamily: sans, fontSize: 50, fontWeight: 500, color: "#5b4c3a" }}>
        Free and open source · macOS · Windows · Linux
      </div>
      <div
        style={{
          ...rise(0.9),
          marginTop: 16,
          fontFamily: sans,
          fontSize: 44,
          fontWeight: 600,
          color: "#fff",
          background: AMBER,
          padding: "22px 48px",
          borderRadius: 999,
          boxShadow: "0 18px 40px rgb(201 106 11 / 0.35)",
        }}
      >
        github.com/arshamalh/amber
      </div>
    </AbsoluteFill>
  );
};
