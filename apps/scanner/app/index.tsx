import { pack, isProgram } from "../src/packs";
import { ScannerHome } from "../src/components/ScannerHome";
import { ProgramHome } from "../src/components/ProgramHome";

/** The engine ships two kinds of app; the home screen is where they diverge. */
export default function Home() {
  return isProgram(pack) ? <ProgramHome pack={pack} /> : <ScannerHome pack={pack} />;
}
