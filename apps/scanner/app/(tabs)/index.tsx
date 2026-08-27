import { pack, isProgram, isAudio } from "../../src/packs";
import { ScannerHome } from "../../src/components/ScannerHome";
import { ProgramHome } from "../../src/components/ProgramHome";
import { AudioHome } from "../../src/components/AudioHome";

/** The engine ships three kinds of app; the home screen is where they diverge. */
export default function Home() {
  if (isProgram(pack)) return <ProgramHome pack={pack} />;
  if (isAudio(pack)) return <AudioHome pack={pack} />;
  return <ScannerHome pack={pack} />;
}
