# Directional Token Images

Automatically swaps a Token's artwork based on the direction it is moving.

This module is **not** a token editor, and it is **not** an isometric module. It never rotates,
mirrors or flips a token — it simply replaces the image. Think *Token Flip* or *Mirror Token*, but
fully automatic and using genuinely different artwork instead of a mirrored texture.

- **Foundry VTT**: v13 (verified against 13.351)
- **System**: none required — see the [compatibility matrix](#system-compatibility)
- **Dependencies**: none

`module.json` declares **no system relationship**, reads no system data model, and hard-codes no
system id. Everything it touches is core Foundry: token documents, prototype tokens, the token
movement workflow and the sheet/HUD applications.

---

## Contents

1. [Installation](#installation)
2. [Quick start](#quick-start)
3. [Image set modes](#image-set-modes)
4. [Token configuration](#token-configuration)
5. [World settings](#world-settings)
6. [Token HUD](#token-hud)
7. [API](#api)
8. [Hooks](#hooks)
9. [Isometric and custom projections](#isometric-and-custom-projections)
10. [System compatibility](#system-compatibility)
11. [Performance notes](#performance-notes)
12. [Folder structure](#folder-structure)

---

## Installation

### From a manifest URL

1. In Foundry, open **Add-on Modules → Install Module**.
2. Paste the manifest URL into the *Manifest URL* field and click **Install**.

### Manual installation

1. Copy the entire `directional-token-images` folder into your Foundry `Data/modules` directory.
   The folder name **must** stay `directional-token-images` — it has to match the `id` in
   `module.json`.

   ```text
   <FoundryData>/Data/modules/directional-token-images/
   ```

2. Restart Foundry (or reload the world).
3. In your world, open **Game Settings → Manage Modules** and enable **Directional Token Images**.

No build step is required. The module is plain ES modules and runs as-is.

---

## Quick start

**Configure it once on the actor** (recommended) — open the character sheet and click
**🧭 Directional Images** in the header. The setup is stored on the actor's prototype token, so every
token you place from that actor already has it. You never touch it scene by scene.

1. Open the actor's character sheet and click **Directional Images** in the header.
2. Tick **Enable Directional Images**.
3. Choose an **Image Set** — 1, 2, 4 or 8 images.
4. Fill in the image for each direction.
5. Leave **Also update tokens already placed on scenes** ticked so existing tokens catch up.
6. **Save on Actor**.

To override a single token instead — one goblin in the party needs different art — use the
per-token route below. A token's own configuration always wins over the actor's.

### Per-token setup

1. Select a token on the canvas.
2. Open its **Token Configuration** sheet and switch to the **Directional Images** tab
   (or click the compass button on the Token HUD → **Configure**).
3. Tick **Enable Directional Images**.
4. Choose an **Image Set** — 1, 2, 4 or 8 images.
5. Fill in the image for each direction using the file picker (or paste a URL).
6. Save. The token immediately adopts its **idle pose** (the South / front-facing image), and from
   then on the artwork follows the direction of travel.

> **Step 3 is not optional.** With images filled in but *Enable Directional Images* unticked, nothing
> changes on the canvas. The configuration window keeps that checkbox pinned to the top and warns you
> if you save without it.

> **Leaving a direction empty keeps the token's current artwork** instead of changing it. That is a
> feature, not a limitation — it lets you configure only the directions you actually have art for.

### Nothing changed on the canvas?

| Symptom | Cause |
| --- | --- |
| Token still shows its old image after saving | *Enable Directional Images* is unticked. |
| HUD reports "Detected direction: Unknown" | The token's current image is not one of the configured ones — usually the same cause. |
| Only some directions work | Those slots are empty, so the token keeps its current artwork for them. Fill them in, or tick [Mirror left and right](#mirror-left-and-right). |
| Actor configured, but old tokens on scenes are unchanged | The prototype only applies to tokens created *after* it was saved. Re-save with **Also update tokens already placed on scenes** ticked, or run `api.syncFromPrototype(actor)`. |

To force a re-apply from a macro:

```js
await game.modules.get("directional-token-images").api.refreshToken();  // current selection
```

---

## Image set modes

| Mode | Slots used | Typical use |
| --- | --- | --- |
| **1 image** | `default` | Standard Foundry behaviour; a single override image. |
| **2 images** | `s` (front), `n` (back) | Simple sprite sheets that only distinguish facing towards or away from the camera. |
| **4 images** | `n`, `s`, `e`, `w` | Classic JRPG-style artwork. |
| **8 images** | `n`, `ne`, `e`, `se`, `s`, `sw`, `w`, `nw` | Detailed isometric or pre-rendered tokens. |

All four modes share the **same nine storage slots**, so switching between them never destroys
artwork you already configured. Configure eight directions, drop to four for a session, switch back
— nothing is lost.

**Fallbacks.** When the chosen slot is empty the module walks a fallback chain before giving up:

```text
ne → nw flipped (if mirroring is on) → (n or e, whichever axis dominated) → default → keep current
```

That means an eight-direction token that only has four images configured still behaves sensibly.

### Mirror left and right

Left-facing artwork is usually the exact mirror of right-facing artwork, so the token sheet has a
**Mirror left and right** checkbox. With it ticked you only draw one side:

| You provide | You get |
| --- | --- |
| `e` | `w` — the East drawing, flipped |
| `w` | `e` — the West drawing, flipped |
| `ne`, `se` | `nw`, `sw` — flipped |
| `nw`, `sw` | `ne`, `se` — flipped |

A four-direction token therefore needs **three** images instead of four; an eight-direction token
needs **five** instead of eight. North and South are never mirrored — flipping a front-facing or
back-facing drawing gives you the same view, not the opposite one.

An explicitly configured slot always wins, so you can mirror most directions and still hand-draw the
one where the character's sword or scar has to stay on the correct side.

**What it touches.** Only the *sign* of the token's `texture.scaleX`. The magnitude is preserved, so
a token scaled to 1.4 stays at 1.4 whichever way it faces, and rotation is never involved. A token
that has **not** ticked the box never has `texture.scaleX` written at all — the module's default
promise of "no rotating, no mirroring, no flipping" is intact.

The checkbox is per-token and only appears in the 4- and 8-image modes. To set it in bulk:

```js
await api.setDirectionalImages(canvas.tokens.controlled, {
  n: "tokens/hero_north.png",
  s: "tokens/hero_south.png",
  e: "tokens/hero_east.png"
}, { mode: 4, mirrorHorizontal: true });
```

---

## Token configuration

The **Directional Images** tab (and the identical standalone configurator) is split into three
sections.

### 1. Select Images

- **Enable Directional Images** — the master switch for this token.
- **Image Set** — 1 / 2 / 4 / 8, or *Use world default*.
- **Mirror left and right** — reuse one side's drawing for the other, flipped. See
  [above](#mirror-left-and-right).
- **Load Method** — *File Picker* shows a browse button; *URL* gives a plain path field for remote
  or hand-typed paths.
- **Base (optional)** — a decorative image drawn underneath the token artwork (a pedestal, a shadow,
  a magic circle). Rendered below every token, so it never covers other artwork.
- **Directional Views** — one file field per direction, each with a live thumbnail and a clear
  button. Only the slots relevant to the selected mode are shown.

`PNG`, `JPG`, `WEBP`, **`GIF`** and **`WEBM`** are all supported.

### 2. Position and Scale

These affect only the *artwork*, never the token's grid footprint or the squares it occupies.

- **Position X / Y** — nudge the artwork in pixels (useful for isometric art whose feet should sit
  on the grid intersection).
- **Elevation (Z)** — a depth nudge applied to the token's draw order.
- **Token Scale** — a multiplier on top of the token's own texture scale.
- **Base Scale / Base Rotation** — transform the optional base image.
- **Reset Position** — return every value above to its neutral default.

### 3. Preview

A live compass. Click any direction to preview the artwork that direction would show, including the
fallback chain and the position/scale offsets. The **Preview** button cycles through every direction
in the current mode.

**Reset** restores every field to the last saved value. **Clear All** empties every image field.

---

## World settings

| Setting | Default | Notes |
| --- | --- | --- |
| Default image set | 4 images | Used by tokens set to *Use world default*. |
| Direction provider | Top-down | How movement maps to a facing. See [projections](#isometric-and-custom-projections). |
| Facing offset | 0° | Rotates the detected direction before an image is chosen. |
| Direction sensitivity | 1.0 | Above 1 favours cardinals; below 1 favours diagonals. |
| Movement threshold | 1 px | Minimum travel before an artwork change is considered. |
| Update during drag | on | Swap live while dragging (preview only — nothing is saved until release). |
| Update only after movement ends | off | Swap after the animation instead of at movement start. Costs one extra update per move. |
| Smooth transition | on | Cross-fade instead of cutting. |
| Transition style | Fade | Any of Foundry's texture transition effects. |
| Transition speed | 250 ms | **Never** affects how fast the token moves. |
| Preload textures | on | Warms the texture cache when a scene loads. |
| Show HUD button | on | Adds the compass control to the Token HUD. |
| Debug mode | off | Verbose console logging. |

### How direction sensitivity behaves

- **Four-image mode** — horizontal wins when `|dx| > |dy| × sensitivity`. Raise it to make the token
  prefer North/South artwork, lower it to prefer East/West.
- **Eight-image mode** — the four cardinal sectors are `45° × sensitivity` wide and the diagonals
  absorb the rest. The sectors always sum to exactly 360°.

---

## Token HUD

The compass button on the Token HUD opens a small palette that:

- reports the direction the module currently believes the token is facing,
- lets you **force** any direction for testing (a purely in-memory override — nothing extra is
  written to the document),
- returns to **Automatic** detection,
- opens the standalone **Configure** window.

---

## API

```js
const api = game.modules.get("directional-token-images").api;
```

### Core functions

```js
// Assign artwork. Omitting the first argument targets the currently selected tokens.
await api.setDirectionalImages(null, {
  n: "tokens/hero_north.png",
  s: "tokens/hero_south.png",
  e: "tokens/hero_east.png",
  w: "tokens/hero_west.png"
}, { mode: 4, enabled: true });

// Remove every flag this module wrote. The token keeps whatever image it is showing.
await api.clearDirectionalImages(token);

// Re-apply the correct artwork (after editing images, or to snap to a direction).
await api.refreshToken(token, { direction: "s" });

// Pure geometry: which slot does this movement correspond to?
api.getDirection(120, -10);                        // → "e"
api.getDirection({ dx: 1, dy: 1 }, { mode: 8 });   // → "se"
```

### Everything else

| Member | Purpose |
| --- | --- |
| `openActorConfig(actor)` | Open the configurator bound to an actor's prototype token. |
| `syncFromPrototype(actor, {scope})` | Push an actor's prototype config onto tokens already placed. `scope` is `"all"` (default) or `"current"`. |
| `getDirectionalImages(target)` | Read a token's normalised configuration. |
| `getCurrentDirection(target)` | The slot a token is currently displaying. |
| `forceDirection(target, slot)` | Pin a token to a direction. |
| `clearForcedDirection(target)` | Release the pin. |
| `openConfig(documents?)` | Open the standalone configurator. |
| `registerDirectionProvider(p)` | Add a custom projection. |
| `setDirectionProvider(id)` | Activate a projection and persist the choice. |
| `listDirectionProviders()` | Every registered provider. |
| `DIRECTIONS`, `CARDINALS`, `DIAGONALS`, `MODES`, `MODE_IDS` | The vocabulary. |
| `DirectionProvider` | The base class to extend. |
| `settings` | The cached world settings. |

Every "target" argument accepts a `Token`, a `TokenDocument`, an `Actor`, a token id, a uuid, an
array of any of those, or nothing at all (which means "the current selection").

---

## Hooks

```js
// The API is ready and every provider has been registered.
Hooks.once("directional-token-images.ready", api => { /* … */ });

// Fired before an artwork change. Return false to veto it.
// `mirrored` is true/false when the token manages horizontal mirroring, null when it does not.
Hooks.on("directional-token-images.preDirectionChange", (document, slot, src, mirrored) => {
  if (document.hasStatusEffect?.("paralyzed")) return false;
});

// Fired after an artwork change has been committed.
Hooks.on("directional-token-images.directionChanged", (document, slot, src, mirrored) => {
  console.log(`${document.name} is now facing ${slot}${mirrored ? " (mirrored)" : ""}`);
});
```

---

## Isometric and custom projections

The module never assumes a top-down map. Direction calculation is a replaceable strategy: a
`DirectionProvider` converts a world-space movement vector into facing space, and everything
downstream (quantisation, sensitivity, fallbacks) is shared.

Three providers ship with the module — **Top-down**, **Isometric** and **Isometric (mirrored)** —
and the **Facing offset** setting lets a GM dial in an arbitrary rotation without writing code.

To add your own:

```js
Hooks.once("directional-token-images.ready", api => {
  class HexFlatTopProvider extends api.DirectionProvider {
    static id = "hex-flat-top";
    static labelKey = "MYMODULE.HexFlatTop";

    /** Convert world-space movement into facing space. */
    transformDelta(vector, context) {
      // `super` applies the user's Facing offset setting; call it to stay consistent.
      const { dx, dy } = super.transformDelta(vector, context);
      return { dx, dy: dy * 1.1547 };  // undo the flat-top hex vertical squash
    }
  }

  api.registerDirectionProvider(new HexFlatTopProvider());
});
```

The provider appears in the world settings dropdown immediately — no reload required. The full
`DirectionContext` handed to `resolve()` includes the movement `origin`, `destination` and the whole
`waypoints` path, so a provider can react to multi-leg movement rather than the net displacement if
it wants to.

---

## System compatibility

The module is system-agnostic by construction, but "agnostic" is worth checking rather than
asserting. The following was verified by reading each system's shipped code against Foundry 13.351.

| System | Version | Actor sheet generation | Header control route | Token / prototype tab |
| --- | --- | --- | --- | --- |
| **D&D 5e** | 5.2.5 | ApplicationV2 | `getHeaderControlsActorSheetV2` → appears in the **⋮** menu | `TokenConfig5e` / `PrototypeTokenConfig5e` — inherit core's `PARTS`, so core's patch covers them |
| **Pathfinder 2e** | 7.12.2 | ApplicationV1 | `getActorSheetHeaderButtons` → appears **inline**, next to *Token* and *Configure* | `TokenConfigPF2e` snapshots its own `PARTS`; patched separately via `CONFIG.Token.sheetClasses` |
| **Starfinder 2e** | 0.0.11 | ApplicationV1 (PF2e fork) | as PF2e | as PF2e |
| Anything else | — | either | both hooks are registered | core classes plus whatever the system registered |

Notes on how that coverage is achieved:

- **Both application generations are handled.** Systems migrate to ApplicationV2 at their own pace —
  D&D 5e already has, PF2e has not for actor sheets — so the module registers the V1 *and* V2 header
  hooks. Core dispatches these hooks for every class in a sheet's inheritance chain, so listening on
  the base class names covers system subclasses without naming any of them.
- **Sheet classes are patched at `setup`, not `init`,** because systems register their token sheet
  subclasses during their own `init`.
- **`PARTS` snapshots are handled.** A subclass that copies `PARTS` at class-definition time (PF2e
  does) needs patching separately from one that inherits it (D&D 5e). Each of the tab, the template
  part and the context method is guarded independently for exactly this reason.
- **Horizontal mirroring round-trips through every system's token sheet.** Core derives its *Mirror
  X* checkbox from `texture.scaleX < 0` and recombines it on submit, and all three systems inherit
  that behaviour, so saving a token sheet preserves the module's flip rather than resetting it.
- **Nothing depends on a system's data model.** No `actor.system.*` path is read anywhere.

Even if a system stripped the actor-sheet header entirely, the persistent setup route survives: the
**Token** button on any actor sheet opens the Prototype Token Config, which carries the *Directional
Images* tab. The Token HUD and the API are likewise system-independent.

> Verified by source inspection, not by running each system in a live world.

## Performance notes

The module is designed to sit quietly under hundreds of tokens.

- **No polling, no intervals, no `requestAnimationFrame` loops.** Every swap is driven by the token
  update workflow.
- **One database write per move.** In the default configuration the artwork change is folded into
  the very same update that moves the token, so a move costs exactly one write and one animation.
- **An image is never re-applied.** Both the committed path and the drag path bail out when the
  resolved image already matches the token's current texture, and the drag path additionally bails
  out when the *direction* has not changed.
- **Flags are parsed once.** Normalised data is memoised per document and invalidated only when the
  document's flags actually change.
- **Textures are preloaded** when a scene is drawn, so the first swap of a session does not stutter.
- **The optional visuals cost nothing when unused.** A token with no base image, a scale of 1 and
  zero offsets exits the refresh handler after two property reads.

`preUpdateToken` runs only on the client that initiated the move, so the work is never duplicated
across connected players.

---

## Folder structure

```text
directional-token-images/
├── module.json
├── README.md
├── CHANGELOG.md
├── LICENSE
├── lang/
│   ├── en.json
│   └── es.json
├── styles/
│   └── directional-token-images.css
├── templates/
│   ├── config-app.hbs                 # standalone configurator
│   ├── token-config-tab.hbs           # the Token Configuration tab
│   ├── hud-palette.hbs                # Token HUD direction palette
│   └── partials/
│       ├── image-fields.hbs           # shared by both surfaces
│       ├── transform-fields.hbs
│       └── preview.hbs
└── scripts/
    ├── module.js                      # entry point and wiring
    ├── constants.js
    ├── api/
    │   └── api.js                     # the public API
    ├── apps/
    │   ├── directional-config.js      # standalone ApplicationV2 configurator
    │   ├── token-config-tab.js        # Token Configuration integration
    │   ├── actor-sheet-button.js      # Actor sheet header control (AppV1 + AppV2)
    │   ├── direction-hud.js           # Token HUD palette
    │   ├── field-builder.js           # shared render context
    │   └── form-controller.js         # shared DOM behaviour
    ├── hooks/
    │   ├── index.js                   # every Hooks.on lives here
    │   ├── movement-hooks.js          # movement detection and swapping
    │   └── canvas-hooks.js            # drag previews, visuals, cache lifecycle
    ├── lib/
    │   ├── directions.js              # pure geometry and the mode vocabulary
    │   ├── direction-provider.js      # the pluggable projection strategy
    │   ├── direction-resolver.js      # the single decision point
    │   ├── token-images.js            # the flag data model
    │   ├── prototype-sync.js          # propagate an actor's setup to placed tokens
    │   ├── image-cache.js             # memoisation and preloading
    │   ├── texture-swapper.js         # the three ways artwork is applied
    │   ├── art-renderer.js            # optional offsets and base sprite
    │   └── logger.js
    └── settings/
        └── settings.js
```

---

## Patreon licence

The module ships the shared VNE licence client — the same one Velvet Journals uses, pointed at the
same server and unlocked by the same subscription.

**It is a soft gate.** An unlicensed world keeps **every** feature; it only receives a periodic
free-trial reminder card. Nothing is blocked, degraded, watermarked or time-limited.

- **GM only.** Only the GM's client contacts the licence server. It writes a world-level
  `worldLicensed` flag that every other client reads, so players never talk to the server at all.
- **Asked once.** A successful verification is trusted for 30 days and every successful exchange
  restarts that window, so an active subscriber is never asked a second time. A failing heartbeat or
  an unreachable server is logged but never brings the reminder back inside the window.
- **Manage it** under *Game Settings → Module Settings → Manage licence*: connect, paste a code
  manually if the popup was blocked, or release the installation slot to move it to another machine.
- **Players** see an informational card only, with no call to action.

Each VNE module holds its own installation id and token set, because the server registers each one
as a separate installation.

## Licence

MIT. See [LICENSE](LICENSE).
