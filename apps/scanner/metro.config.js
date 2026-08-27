const { getDefaultConfig } = require("expo/metro-config");

/**
 * Metro's defaults, plus one thing.
 *
 * The apps ship to iOS and Android only. They are rendered in a browser for
 * one reason: so their screens can be looked at, at several widths, without a
 * device farm — which is the only way most layout faults are ever found.
 * `expo-sqlite` brings a WebAssembly build along for that path and Metro does
 * not treat .wasm as an asset out of the box, so the web bundle fails to
 * resolve it. Native builds never touch this.
 */
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("wasm");

module.exports = config;
