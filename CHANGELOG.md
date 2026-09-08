# Changelog

All notable changes to this module are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Giving a token a limited vision or light angle did nothing until somebody next moved it, so a GM
  who set an angle of 190° and watched nothing turn had no way to tell the feature apart from a
  broken one. `updateToken` now re-aims the token as soon as its `sight` or `light` changes.

### Changed

- The "is this cone worth steering?" test now defers to core's own `Token#hasLimitedSourceAngle`
  whenever the placeable exists, instead of running a parallel check. That is the exact condition
  core uses to decide whether a rotation change is worth re-initialising sources for:

  ```js
  const perspectiveChanged = positionChanged || elevationChanged || sizeChanged
    || (rotationChanged && this.hasLimitedSourceAngle);
  ```

  The old check was looser — it accepted a limited *light* angle on a token emitting no light at all
  (`dim` and `bright` both zero), which wrote a rotation and a `lockRotation` that core then ignored:
  a database write and a permanently locked token for no visible result. The document-only check
  remains as the fallback for prototype tokens and documents with no placeable yet.

## [1.1.0] — 2026-09-05

### Added — directional vision

- **Vision cone follows the artwork**, a world setting (off by default) that aims a token's vision
  and light cones along the direction its current drawing is facing. A `190°` cone therefore keeps
  its blind wedge *behind* the character instead of pinned to South, which is where Foundry leaves
  it because nothing in core ever writes `TokenDocument#rotation` on its own.
  - Only tokens whose vision angle — or light angle — is narrower than `360°` are ever written to.
  - The direction used is the centre of the sector the current artwork slot represents, so the cone
    and the drawing can never disagree. Single-image mode carries no direction and is skipped.
  - **Isometric maps are handled properly.** The facing is converted back to scene space through
    whichever `DirectionProvider` is active, so the "South" drawing on a 2:1 isometric map aims the
    cone South-East in scene coordinates — straight down the screen, where the character is looking.
    Providers gained a `untransformAngle()` hook for this, the exact inverse of `transformDelta()`,
    with a working default so existing third-party providers keep working untouched.
  - Every rotation is written together with `lockRotation`, Foundry's own "turn the facing, leave
    the drawing upright" switch, so the module's no-rotation promise is unchanged.
  - The rotation rides inside the update that already carries the artwork change: a move is still
    exactly one database write.
  - A rotation the same update is already carrying — a user turning a token by hand, another module
    steering it — always wins; the module never fights it.
  - Turning the setting on re-aims every token already placed on the scene in one batched update,
    performed by the GM's client only. Turning it off leaves the rotations where they are rather
    than snapping every cone back to South.
- A per-token **Vision cone follows the artwork** dropdown on the *Directional Images* tab —
  *Follow world setting* / *Always* / *Never* — so one scout can be steered in a world that leaves
  the feature off, and one turret can be pinned in a world that has it on.
- **Self-visibility circle**, a world setting (*Off* by default) that widens the circle a steered
  token always sees around itself. Core unions such a circle into every limited cone and sizes it
  from the token's *grid footprint* — right for a top-down token drawn inside its square, far too
  small for isometric artwork stretched to well over a grid unit tall, where a character walking
  towards the camera ended up with their own head and shoulders inside their own blind spot.
  - **Auto** measures the token's own drawn mesh, so it fits the sprite however a projection module
    has sized it, on any projection, without knowing anything about the module that produced it.
    **Auto ×1.5 / ×2 / ×3** add margin to that measurement, and are usually what an isometric map
    wants: the circle lives in *scene* space while the projection compresses scene space vertically
    on the way to the screen, so an exact fit still clips the top of the drawing. Fixed sizes from
    `1` to `8` grid squares are offered for a GM who would rather pin it.
  - Only the `externalRadius` *reported to the vision and light sources* is widened, never
    `Token#externalRadius` itself — core measures light radius from the token's outer edge by adding
    `externalRadius` to the configured distance, so widening the getter would have quietly handed
    every torch-bearing token a bigger torch. Light radius, occlusion and everything else keep
    reading the real value.
  - Walls still block normally, and the cone itself is not changed by a single degree. At the
    default of *Off* nothing is patched at all.
- `api.VisionFacing`, `api.VISION_FACING` and a `visionFacing` option on
  `api.setDirectionalImages()`.

## [1.0.0] — 2026-07-31

### Added

- Automatic artwork swapping based on the direction a token moves in, with no rotation, mirroring or
  flipping of any kind.
- Four image-set modes — **1**, **2** (front/back), **4** (N/S/E/W) and **8** (full compass) — all
  sharing the same nine storage slots so switching modes is lossless.
- A **Directional Images** tab in the Token Configuration sheet, injected the way core injects its
  own tabs. Core's tab switching, form submission and live token preview all work unmodified.
- A standalone configurator application that can be applied to several selected tokens at once.
- An optional decorative **base image** drawn beneath the token artwork, with its own scale and
  rotation.
- Artwork **position (X/Y/Z) and scale** offsets that never affect the token's grid footprint.
- A **Token HUD** palette reporting the detected direction and allowing a GM to force any direction
  for testing.
- **Graceful fallbacks** — diagonals degrade to their dominant cardinal, everything degrades to a
  `default` slot, and an unconfigured direction keeps the token's current artwork.
- An opt-in **Mirror left and right** setting per token: one drawing serves both sides, so a
  four-direction token needs three images and an eight-direction token needs five. Only the *sign*
  of `texture.scaleX` is managed — never its magnitude, and never rotation. Tokens that do not opt
  in never have `texture.scaleX` written at all.
- A pluggable `DirectionProvider` strategy with **Top-down**, **Isometric** and **Isometric
  (mirrored)** implementations, plus a **Facing offset** setting for arbitrary rotations.
- Thirteen world settings covering sensitivity, movement threshold, drag behaviour, transition
  style and speed, preloading, the HUD button and debug logging.
- A documented public API at `game.modules.get("directional-token-images").api`.
- The `directional-token-images.ready`, `.preDirectionChange` and `.directionChanged` hooks.
- Support for `GIF` and `WEBM` artwork.
- English and Spanish localisation.

### Added — persistent, actor-level setup

- A **Directional Images** control in the Actor sheet header, writing to the actor's *prototype*
  token so every token created from that actor inherits the configuration. Supports both application
  generations, since systems migrate at their own pace — PF2e's character sheet is still an
  ApplicationV1 under Foundry 13 while core's sheets are V2.
- An **Also update tokens already placed on scenes** option when saving on an actor, which brings
  existing tokens across every scene up to date in the same action. It reports how many tokens and
  scenes were touched, and names any scene it could not write to rather than failing silently.
- `api.openActorConfig(actor)` and `api.syncFromPrototype(actor, {scope})` for the same operations
  from a macro. `api.openConfig()` is now a documented static rather than an assigned alias.
- Writes to a prototype token are routed through the owning Actor with `prototypeToken.`-prefixed
  keys, because `PrototypeToken#update` forwards its payload verbatim into an Actor update where
  only top-level dotted keys are expanded.

### Added — Patreon soft licence

- The shared VNE licence client: Patreon OAuth, RS256-verified tokens, installation fingerprinting,
  a 15-minute heartbeat and the world-level `worldLicensed` flag that players read instead of
  contacting the server themselves.
- A **soft** gate, matching Velvet Journals: an unlicensed world keeps **every** feature and only
  receives a periodic free-trial reminder card. Nothing in the module is ever blocked or degraded.
- A *Manage licence* entry in the module settings (GM only) for connecting, entering a code manually
  when the popup is blocked, or releasing the installation slot.
- The migration notice was **deliberately left out**: that text explains why a *previous* activation
  stopped validating, and a module that has never been activated anywhere has no such history.

### Fixed

- A token whose artwork had just been configured kept its previous image until somebody moved it,
  which read as "the module did nothing". Saving the configuration — from either the standalone
  window or the Token Configuration tab — now applies the token's idle pose immediately, and a token
  placed from an actor with directional flags lands wearing the right image. An explicit artwork
  change made in the same save is still honoured rather than overwritten.
- The *Enable Directional Images* checkbox could scroll out of sight in the configuration window,
  making it easy to fill in every image and save with the feature switched off. It is now pinned to
  the top of the column, an inline warning appears while images are configured but the switch is
  off, and saving in that state reports a warning instead of a silent success.

### Notes

- Verified against Foundry VTT **13.351**.
- No system dependency; no library dependency. `module.json` declares no system relationship, no
  `actor.system.*` path is read anywhere, and no system id is hard-coded.
- System coverage confirmed by source inspection against **D&D 5e 5.2.5** (ApplicationV2 sheets),
  **Pathfinder 2e 7.12.2** and **Starfinder 2e 0.0.11** (ApplicationV1 sheets). Both application
  generations are supported, subclasses that snapshot `PARTS` are patched separately from those that
  inherit it, and horizontal mirroring round-trips through every system's token sheet because core
  derives its *Mirror X* checkbox from `texture.scaleX < 0`.
- In the default configuration a move produces exactly one database write: the artwork change rides
  inside the same update that moves the token.
