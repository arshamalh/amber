import { Composition } from "remotion";
import { AmberDemo, INTRO_S, OUTRO_S, RATE, TRANSITION_S } from "./AmberDemo";
import recording from "../public/scenes.json";

const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="AmberDemo"
      component={AmberDemo}
      fps={FPS}
      width={1920}
      height={1080}
      durationInFrames={Math.round((INTRO_S + recording.duration / RATE + OUTRO_S - 2 * TRANSITION_S) * FPS)}
    />
  );
};
