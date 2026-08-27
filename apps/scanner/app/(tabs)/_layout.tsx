import { Tabs } from "expo-router";
import { pack, isAudio, isScanner } from "../../src/packs";
import { theme } from "../../src/theme";
import { ScannerNav } from "../../src/components/ScannerNav";
import { TabBar } from "../../src/components/TabBar";

/**
 * The destinations you can move between without losing your place.
 *
 * These used to be plain stack screens that the bottom bars reached with
 * `router.replace()`. On a stack that is not a tab switch — it tears the
 * current screen down and builds the next one from nothing, so every press
 * cost a blank frame, threw away the scroll position, and re-ran the screen's
 * loader. A real tab navigator keeps them mounted, which is the whole
 * difference between "smooth" and "usable".
 *
 * `(tabs)` is a group, so none of the URLs change: `/library`, `/settings`
 * and the rest still resolve exactly as before.
 *
 * One layout serves three archetypes because the engine ships one app tree.
 * A route another archetype does not use is given `href: null`, which keeps it
 * routable — Mahdar still pushes `/settings` — while leaving it out of the bar.
 */

const scanner = isScanner(pack);
const audio = isAudio(pack);

/** Routes that exist for one archetype only. */
const only = (shown: boolean) => (shown ? {} : { href: null as null });

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.bg },
      }}
      /* The bars are already built and carry each app's own language and
         shape, so the navigator borrows them rather than restyling its own.
         The programme apps have no bottom bar at all. */
      tabBar={(props) =>
        scanner ? <ScannerNav {...props} /> : audio ? <TabBar {...props} /> : null
      }
    >
      <Tabs.Screen name="index" />

      {/* Scanner */}
      <Tabs.Screen name="library" options={only(scanner)} />
      <Tabs.Screen name="history" options={only(scanner)} />

      {/* Mahdar */}
      <Tabs.Screen name="lectures" options={only(audio)} />
      <Tabs.Screen name="tasks" options={only(audio)} />
      <Tabs.Screen name="search" options={only(audio)} />
      {/* Reached from Home and from the sidebar rather than the bar, which is
          full — but it has to stay a tab so returning to it is instant. */}
      <Tabs.Screen name="study" options={{ href: null }} />

      {/* Settings is in the scanner bar and off it everywhere else. */}
      <Tabs.Screen name="settings" options={only(scanner)} />
    </Tabs>
  );
}
