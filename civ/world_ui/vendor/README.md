# Vendored, not fetched

`three.module.min.js` — three.js r160, MIT, from the npm registry
(`npm pack three@0.160.0`, `package/build/three.module.min.js`). Licence text is
beside it in `three.LICENSE`.

**It is checked in on purpose.** The world has to boot with the network
disabled — that is an explicit property of this project, drilled by
`offline_demo.py` and asserted by `OfflineBoot`. A renderer that loads its
engine from a CDN would make the Owner's world depend on somebody else's uptime
and somebody else's permission, which is the whole thing
`OWNERSHIP_AND_INDEPENDENCE.md` exists to prevent.

Nothing here is modified. To update it, pack the new version and replace the
file; the world's own code is in `world_ui/three/`.
