# MultiHog Rendering & HUD Syntax Reference

This guide catalogs the State Tracker memo rendering engine implemented in upstream [`renderer.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/renderer.js) and [`memo-processor.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/memo-processor.js). It provides an authoritative specification for MultiHog Companion cartridges (D&D 5e, PbtA, FAE) and state synchronizers to cleanly leverage upstream visual widgets, pills, bars, badges, and layout mechanisms without breaking memo formatting or UI presentation.

---

## 1. Golden Rules & Common Gotchas ("Why Parentheses Matter")

The rendering pipeline in `renderer.js` and `memo-processor.js` applies specific grammatical rules to punctuation. Understanding how parentheses `(...)`, square brackets `[...]`, and commas `,` are treated avoids subtle formatting bugs.

### Rule 1 — Pills Require Parentheses `(...)`, Never Square Brackets `[...]`

* **Hover-Toast Parser (`renderPills()` at `renderer.js:1102`)**:
  `renderPills()` tests each item with `/^(.+?)\s*\((.+)\)$/`.
  - `Name (Hover details)` splits cleanly into `.rt-unit-name` (visible chip label) and `.rt-unit-descr` (hover toast tooltip displayed via CSS `title` or tooltip bubble).
  - `Name [details]` **fails the regex**. The entire string `Name [details]` is treated as the name, outputting a bulky `.rt-unit-pill.no-desc` chip with no tooltip.

* **Comma-Splitting Hazard in `splitSmart()` (`renderer.js:1087`)**:
  When processing a comma-separated list of pills, `splitSmart()` tracks nesting depth **only for parentheses `()`**, deliberately ignoring square brackets `[]` and curly braces `{}`:
  ```javascript
  if (c === '(') depth++; else if (c === ')') depth--;
  if (c === ',' && depth === 0 && !isDigitSeparator) { res.push(cur.trim()); cur = ''; }
  ```
  > [!WARNING]
  > If a pill contains commas inside square brackets, e.g. `Field Mechanic [welding, rigging]`, the comma occurs while `depth === 0`. `splitSmart()` will **shatter the single pill into two malformed pills**:
  > 1. `Field Mechanic [welding`
  > 2. `rigging]`
  >
  > **Mitigation**: Always normalize square bracket qualifiers to parentheses `(...)` before formatting memo pills. In FAE, this is handled via `normalizeFaePill()` in `fae-state-sync.js`.

### Rule 2 — Unknown `Key: Value` Entity Lines Auto-Highlight Parentheses in Gold

* In `renderLineInEntityContext()` (`renderer.js:948`), any line containing a colon `Key: Value` inside `[CHARACTER]`, `[PARTY]`, `[COMBAT]`, or an `((NPC))` card that has no `((MARKER))` token and does not match a known key in `STOCK_FIELD_RULES` falls back to:
  ```javascript
  if (colonIdx !== -1) {
      return renderSubFieldByRule({ renderType: 'highlight' }, line);
  }
  ```
* `{ renderType: 'highlight' }` invokes `highlightParens()` from `memo-processor.js:180`:
  ```javascript
  export function highlightParens(text) {
      return text.replace(/\(([^)]+)\)/g, '<span class="rt-paren-highlight">($1)</span>');
  }
  ```
* In `style.css:3482`, `.rt-paren-highlight` renders with a distinct gold pill tint:
  ```css
  .rt-paren-highlight {
      background: rgba(255, 170, 0, 0.1);
      color: #ffaa00;
      border-radius: 4px;
      padding: 0 4px;
  }
  ```
* **Practical Effect**:
  - `Heroic Domain: Spellblade (short-range blink and arcane ward-breaking)` automatically renders `(short-range blink and arcane ward-breaking)` highlighted in gold.
  - If written with square brackets `Heroic Domain: Spellblade [short-range blink...]`, `highlightParens()` does not match, leaving the qualifier unstyled and unhighlighted.

### Rule 3 — Omit Redundant Fallback Descriptions on Unqualified Pills

* If a tag or capability has no specific descriptive qualifier (e.g. `Ex-Military`, `Service Revolver`), do **not** synthesize boilerplate fallback descriptions like `Ex-Military (Positive Tag)` or `Service Revolver (Boon)`.
* When left without parentheses, `renderPills()` renders a clean chip with `.rt-unit-pill.no-desc`. This keeps the UI uncluttered and avoids showing redundant, non-informative hover tooltips to the player.

### Rule 4 — `((PILLS))` Hygiene (One Marker Per Comma-Separated List)

* Place `((PILLS))` **once** at the start of a comma-separated list:
  ```text
  ((PILLS)) Positive Tags: Tag A (desc), Tag B (desc), Tag C
  ```
* **Never repeat `((PILLS))` before each individual item**:
  ```text
  BAD: ((PILLS)) Tag A (desc), ((PILLS)) Tag B (desc)
  ```
  Repeating `((PILLS))` causes `tokenizeMarkers()` (`renderer.js:718`) to split the line into multiple marker segments. In `tryRenderMarker()` (`renderer.js:900`), this triggers `.rt-multi-marker-row`, laying out each tag in its own flex column rather than wrapping them naturally inside a single `.rt-units-container` flex box.

---

## 2. Universal Inline Markers (`MARKER_TYPE_MAP`)

MultiHog provides 34 universal inline marker tokens registered in `MARKER_TYPE_MAP` (`renderer.js:621`). Any marker token wrapped in double parentheses `((TOKEN))` can be inserted into any memo block (standard or custom).

| Marker Token | Shorthand Aliases | `renderType` | Expected Value Syntax | Visual Widget / HTML Output | `renderer.js` Reference |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `((PILLS))` | `PLS` | `pills` | `Item (desc), Item 2` | Flexible chip group with hover toasts | `renderer.js:622` |
| `((PILL))` | — | `pill_colored` | `Label (desc)` | Single chip with custom color tint support | `renderer.js:623` |
| `((BAR))` | `B`, `HPBAR`, `HPB`, `HP` | `hp_bar` | `cur/max` (e.g. `45/100`) | Colored resource bar with fill percentage | `renderer.js:624` |
| `((BARREL))` | — | `barrel` | `Label: -38/150` or `+20/100` | Signed centre-zero balance bar (bipolar) | `renderer.js:625` |
| `((NPC))` | — | `npc` | `Name: details...` | Freeform NPC card using Lorebook Agent portrait | `renderer.js:626` |
| `((XPBAR))` | `XB` | `xp_bar` | `450/1000 Level 3` | XP progress bar with level indicator | `renderer.js:627` |
| `((TEXT))` | — | `text` | `Some plain text` | Plain text container | `renderer.js:628` |
| `((BADGE))` | `BDG` | `badge` | `Neutral` / `Faction` | Single rounded status badge | `renderer.js:629` |
| `((HIGHLIGHT))` | `HGT` | `highlight` | `Value (note)` | Text with parenthetical gold highlights | `renderer.js:630` |
| `((OBJ))` | — | `objective` | `✓ Done` or `○ In progress` | Quest objective bullet item | `renderer.js:631` |
| `((REWARD))` | — | `reward` | `500 XP` / `150 GP` | Loot reward pill with gold/treasure tint | `renderer.js:632` |
| `((DIFFICULTY))` | — | `difficulty` | `Easy`, `Hard`, `CR 5` | Difficulty tier badge | `renderer.js:633` |
| `((PROGRESS))` | — | `progress` | `3/5` or `60%` | Fractional progress bar | `renderer.js:634` |
| `((WARNING))` | — | `badge_colored` | `Caution text` | Preset amber badge (`#f1c40f`) | `renderer.js:635` |
| `((DANGER))` | — | `badge_colored` | `Hostile text` | Preset red badge (`#e74c3c`) | `renderer.js:636` |
| `((SUCCESS))` | — | `badge_colored` | `Active` / `Safe` | Preset green badge (`#2ecc71`) | `renderer.js:637` |
| `((INFO))` | — | `badge_colored` | `Note` / `Lore` | Preset blue badge (`#3498db`) | `renderer.js:638` |
| `((GOLD))` | — | `coin` | `150` | Gold currency badge with `💰` icon (`#ffd700`) | `renderer.js:639` |
| `((SILVER))` | — | `coin` | `45` | Silver currency badge with `🪙` icon (`#c0c0c0`) | `renderer.js:640` |
| `((BRONZE))` | — | `coin` | `12` | Bronze currency badge with `🪙` icon (`#cd7f32`) | `renderer.js:641` |
| `((DOLLAR))` | — | `coin` | `500` | Cash currency badge with `💵` icon (`#85bb65`) | `renderer.js:642` |
| `((HEART))` | — | `coin` | `3` | Heart/Lives counter with `❤️` icon (`#ff4466`) | `renderer.js:643` |
| `((SKULL))` | — | `coin` | `12` | Kills/Deaths counter with `💀` icon (`#aaaaaa`) | `renderer.js:644` |
| `((SOUL))` | — | `coin` | `42` | Soul counter with `👻` icon (`#aa88ff`) | `renderer.js:645` |
| `((ROLL))` | — | `dice_roll` | `1d20+5 = 18` | Dice roll formula & result badge | `renderer.js:646` |
| `((CLOCK))` | — | `clock` | `4/8` | Segmented countdown/alertness clock | `renderer.js:647` |
| `((STARS))` | — | `stars` | `3/5` | Rating star display | `renderer.js:648` |
| `((WEIGHT))` | `CAPACITY` | `weight` | `45/50 lbs` | Encumbrance / carry weight bar | `renderer.js:649` |
| `((WEATHER))` | — | `weather` | `Heavy Rain (Poor Visibility)` | Weather condition pill with icon | `renderer.js:651` |
| `((ORBS))` | `AP` | `orbs` | `3/5` | Discrete pip counter (Ki/Action Points) | `renderer.js:652` |
| `((SLOTS))` | — | `slots` | `4/10` | Grid inventory slots indicator | `renderer.js:654` |
| `((PHASE))` | `STEP` | `phase` | `2/4` | Multi-step ritual or phase tracker | `renderer.js:655` |
| `((GAUGE))` | `METER` | `gauge` | `75/100` | Percentage meter / gauge widget | `renderer.js:657` |
| `((CHARGE))` | `BATTERY` | `charge` | `2/5` | Battery/charge counter | `renderer.js:659` |

---

## 3. Color Customization, Gradients & Inline Text Styling

### Dynamic Named-Color Suffixes
Any valid CSS named color can be directly suffixed to a base marker name (`MARKER_TOKEN_RE` at `renderer.js:675`).
* Syntax: `((TOKENCOLOR))`
* Examples:
  - `((BARPURPLE))` → Purple HP bar
  - `((BARGOLD))` → Gold HP bar
  - `((BARBLUE))` → Blue HP bar
  - `((PILLPINK))` → Pink pill chip
  - `((BADGEGOLD))` → Gold badge
  - `((PROGRESSGOLDENROD))` → Goldenrod progress bar

> [!CAUTION]
> **The Invalid CSS Color Gotcha (`amber`)**:
> `'amber'` is **not** a recognized standard CSS named color keyword in browsers. Writing `((BARAMBER))` will fail CSS color validation and fall back to the default bar color. MultiHog Companion's `fae-ruleset.js` explicitly maps amber/yellow/gold requests to `((BARGOLD))` via `toMultihogBarMarker()`.

### Single-Color Delimited Override
For arbitrary hex colors or specific CSS color names, use the hyphenated delimiter:
* Syntax: `((TOKEN - color))`
* Examples:
  - `((BAR - #E5FFCC))`
  - `((PILLS - rebeccapurple))`
  - `((BADGE - #336699))`

### Two-Color Gradients & Bipolar Barrel Colors
Upstream supports dual-color declarations for linear gradient fills and bipolar balance widgets (`renderer.js:679–705`):
* **Gradient-Capable Bars** (`hp_bar`, `xp_bar`, `progress`):
  Declaring two colors creates a horizontal linear gradient:
  - Syntax: `((BAR - #color1 #color2))`
  - Example: `((BAR - #ff4444 #ffaa00)) 50/100` generates `linear-gradient(90deg, #ff4444, #ffaa00)`
* **Bipolar Barrels (`((BARREL))` at `renderer.js:696`)**:
  Barrels represent signed zero-centered balances (such as trust or alignment from -100 to +100). Declaring two colors sets distinct positive and negative side fills:
  - Syntax: `((BARREL - #posColor #negColor))`
  - Example: `((BARREL - #2ecc71 #e74c3c)) Reputation: -25/100`

### Label Color Isolation (`renderer.js:139`)
In `renderSubFieldByRule()`, custom color overrides for `badge`, `badge_colored`, `pills`, `pill_colored`, `hp_bar`, `xp_bar`, and `progress` tint **only the widget value**, deliberately keeping the preceding `Label:` text neutral:
```javascript
const colorLabel = rule.color && !['badge', 'badge_colored', 'pills', 'pill_colored', 'hp_bar', 'xp_bar', 'progress'].includes(rule.renderType);
```
This ensures `Hunger: ((BARBLUE)) 75/100` colors only the bar fill, without turning the text `Hunger:` blue.

### Inline Text Styling & Rarity Tags (`escapeHtmlWithColor` at `renderer.js:1043`)
All text passed to tracker cards passes through `escapeHtmlWithColor()`, supporting:
1. **RPG Rarity Tags**: Prefixing text with `[rarity]` strips the bracketed word and wraps all subsequent text in the standard RPG rarity color palette:
   - `[poor]` → Grey (`#9d9d9d`)
   - `[common]` → White (`#ffffff`)
   - `[uncommon]` → Green (`#1eff00`)
   - `[rare]` → Blue (`#0070dd`)
   - `[epic]` → Purple (`#a335ee`)
   - `[legendary]` → Orange (`#ff8000`)
   - `[artifact]` → Heirloom Gold (`#e6cc80`)
   - `[heirloom]` → Cyan (`#00ccff`)
2. **Font Color Tags**: Standard `<font color="...">...</font>` markup is safely sanitized and converted into `<span style="color:...">`.

---

## 4. Multi-Column & Tab-Stop Layouts (`rt-multi-marker-row`)

When a single line in a memo contains multiple `((MARKER))` tokens, `tryRenderMarker()` (`renderer.js:900`) wraps the segments in a flexible layout container: `<div class="rt-multi-marker-row">`.

### Stretchy vs. Fixed Cells
* **Stretchy Types** (`hp_bar`, `xp_bar`, `progress`, `barrel`): Rendered in `.rt-mmc-cell--stretch` with `flex: 1`, expanding to fill available row width.
* **Fixed Types** (`pills`, `badge`, `text`, `coin`, `clock`, etc.): Rendered in `.rt-mmc-cell`, occupying only their natural content width.

### Layout Delimiters (`||` vs. `|x`)
Upstream provides two layout engines for multi-marker lines:
1. **Equal Columns (`||`)**:
   Placing `||` between markers creates equal-width flex columns:
   ```text
   ((PILLGREEN)) Friendly || ((PILLS)) In love
   ```
2. **Numeric Tab Stops (`|x`)**:
   Placing `|x` (where `x` is a percentage from 0 to 100) immediately before a marker positions that marker at an exact percentage grid tab stop across the card (`resolveMarkerTabStops` at `renderer.js:778`):
   ```text
   Health: ((BARRED)) 20/50 |60 Status: ((PILL)) Active
   ```
   This generates a CSS Grid layout with explicit `grid-column` boundaries.

### Marker Placement Rules (`renderMarkerSegment` at `renderer.js:815`)
Markers can be placed anywhere on a line:
* **Start of line**: `((BAR)) 50/100` → Content is `50/100`.
* **Middle after colon**: `Durability: ((GAUGE)) 75/100` → Label is `Durability:`, content is `75/100`.
* **End of line**: `Durability: 75/100 ((GAUGE))` → Automatically recognized as a progress gauge with value `75/100`.
* **Disambiguating `barId` Context**: When multiple bars share a label (e.g. `Charges: 3/5`), `renderMarkerSegment` incorporates sibling content, column index, and line index into the element's recolor ID (`barId`), ensuring each bar maintains its own independent recoloring state.

---

## 5. Pill Mechanics Deep-Dive (`renderPills` & `renderAbilityLine`)

### Buff and Debuff Prefixes (`renderer.js:1108`)
Inside any `pills` field or `((PILLS))` list, items can be prefixed with indicator tokens:
* `(+) ` or `(+)`: Adds CSS class `.rt-pill-buff` (bright green border and tint).
* `(-) ` or `(-)`: Adds CSS class `.rt-pill-debuff` (red border and tint).
* Example: `((PILLS)) Status: (+) Inspired, (-) Poisoned (disadvantage on checks)`

### Resource Fraction Badge Extraction (`renderer.js:1122`)
If a pill description contains a fraction `X/Y` (e.g. `2/3`, `1/1`, `0/4`), `renderPills()` extracts the fraction and renders it in an isolated counter badge inside the pill:
```javascript
const resourceMatch = desc.match(/(\d+)\s*\/\s*(\d+)/);
if (resourceMatch) {
    iconHtml = `<span class="rt-unit-icon">${escapeHtmlWithColor(resourceMatch[0])}</span>`;
}
```
* Example: `Spell Slots (3/3 Level 1)` renders as:
  `[Spell Slots | 3/3 | (Level 1)]`

### Ability Lines vs. Comma Splitting (`renderAbilityLine` at `renderer.js:1147`)
In standard `renderPills()`, any comma `,` at paren depth 0 splits the string into separate pills. This presents an issue for complex abilities such as:
`Rage (2/2): Resistance to bludgeoning, piercing, slashing damage`

To prevent `bludgeoning` and `piercing` from turning into separate pills, upstream provides `renderAbilityLine()` (`renderer.js:1147` and `1933`):
* **Colon-First Detection**: In `[ABILITIES]`, `renderer.js` walks the line checking whether an unparenthesized colon `:` appears before the first unparenthesized comma `,`.
* If a colon comes first:
  1. Everything before the colon is the Ability Name (and optional resource fraction).
  2. Everything after the colon is the entire description.
  3. Commas in the description are preserved contiguously without splitting.
* If a comma comes first: The line falls back to standard `renderPills()` multi-item splitting.

---

## 6. Implicit Stock Field Rules (`STOCK_FIELD_RULES`)

Within entity blocks (`[CHARACTER]`, `[PARTY]`, `[COMBAT]`, and `((NPC))` cards), lines starting with specific keywords automatically trigger structured visual widgets without requiring `((MARKER))` tokens (`renderer.js:105–125`):

| Stock Field Keyword | Trigger Syntax | `renderType` | Visual Rendering Mechanism |
| :--- | :--- | :--- | :--- |
| `combat:` | `Combat: ...` | `numbers` | Numbers wrapped in gold highlight spans |
| `gear:` | `Gear: ...` | `highlight` | Text with `(...)` in gold highlights |
| `attr:` | `Attr: ...` | `highlight` | Primary attributes with parenthetical highlights |
| `attributes:` | `Attributes: ...` | `highlight` | Primary attributes with parenthetical highlights |
| `skills:` | `Skills: ...` | `pills` | Comma-separated pills with hover toasts |
| `key skills:` | `Key Skills: ...` | `pills` | Comma-separated pills with hover toasts |
| `saves:` | `Saves: ...` | `numbers` | Numbers and dice formulas highlighted |
| `status:` | `Status: ...` | `pills` | Status condition pills |
| `traits:` | `Traits: ...` | `pills` | Character trait pills |
| `abilities:` | `Abilities: ...` | `pills` | Ability pills |
| `other:` | `Other: ...` | `pills` | Miscellaneous trait pills |
| `resistances:` | `Resistances: ...` | `pills` | Damage resistance pills |
| `res:` | `Res: ...` | `pills` | Shorthand damage resistance pills |
| `hd:` | `HD: 3/5` | `hd_pips` | Hit Dice pip counter |
| `weapon:` | `Weapon: ...` | `highlight` | Weapon details with parenthetical highlights |
| `att/def:` | `Att/Def: ...` | `numbers` | Attack/Defense modifier numbers highlighted |
| `primary weapon:` | `Primary Weapon: ...` | `highlight` | Weapon details with parenthetical highlights |
| `spells:` | `Spells: ...` | `spell_group` | Spell list with pips and Wikidot links |
| `ac:` | `AC: 15` | `text` | Clean armor class display |

> [!NOTE]
> **Fallback for Custom / Unknown Fields**:
> As detailed in Rule 2, any entity sub-field with a colon `Key: Value` that does not match the 19 keywords above defaults to `{ renderType: 'highlight' }`, wrapping parenthesized text `(...)` in gold `<span class="rt-paren-highlight">`.

---

## 7. Block-Specific Renderers (`blockToItems`)

`blockToItems()` (`renderer.js:1428`) provides specialized parsers for core MultiHog campaign blocks:

### `[CHARACTER]`, `[PARTY]`, and `[COMBAT]`
* **Entity Headers**:
  - `Name: 25/30 HP`: Creates an entity header with an interactive HP bar and recolor menu (`data-recolor-id`).
  - `Name: ???/??? HP`: Unknown HP renders as a neutral grey full-width indicator rather than an empty or dead bar.
  - Plain name headers (`Name: Paladin Level 3`): Decouples portrait rendering from the strict HP requirement, allowing narrative characters without HP bars.
* **Inline Pipe Subfields**:
  - `Name: 20/20 HP | AC: 15 | Status: Blessed, Active | Saves: (+2)` splits into discrete subfields attached to that entity.
* **Combat Headers & Defeat**:
  - `Combat Round N`: Renders a centered banner `.rt-combat-round`.
  - `ENEMIES:` / `ALLIES:`: Renders tactical group headers.
  - `Status: Defeated` / `Unconscious` / `Dead`: Wraps the entire entity card in `.rt-combatant-defeated`, dimming the avatar.

### `[INVENTORY]`
* **Equipped Item Tag**: `[E]` (e.g. `Longsword [E]`) marks the item as equipped, adding `.rt-inventory-item--equipped` (subtle highlight border) and stripping `[E]` from display text.
* **Item Worth Extraction**: Items annotated with `(~15 GP)` or `(Worth: 15 GP)` have their currency parsed into total copper (`totalCp`) to calculate total net worth, displaying a summary header badge (`💰 Total Worth`).
* **Dual Parentheses (Effect + Worth)**:
  `Dagger (+1 to hit) (~50 GP)` parses `(+1 to hit)` as the mechanical effect and `50 GP` as the value, combining them into an informative hover tooltip.

### `[TIME]`
* **Time Progression & Rest Calculation**:
  Parses in-world date/time (e.g. `Day 14, 08:30 AM`).
  - `Last Rest: Day 13, 08:00 PM` computes the elapsed time delta and appends `(12h 30m ago)`.
* **Day/Night Sky Badge**:
  Calculates solar/lunar phases (Dawn, Morning, Noon, Afternoon, Dusk, Night, Midnight) and renders a sky badge with dynamic sun, moon, and stars.

### `[XP]` and `[SPELLS]`
* **XP Tracking**: Matches `Total: 1,200 / 2,700 XP (Level 3)` to build an interactive animated XP bar (`.rt-xp-bar`).
* **Spell Slots**: Formats lines like `Level 1 (2/4): Shield, Magic Missile` into discrete slot pips (`.rt-slot-pip.rt-slot-available` vs `.rt-slot-used`) and generates direct links to D&D 5e Wikidot spell descriptions (`https://dnd5e.wikidot.com/spell:...`).

### `[QUESTS]`
* Handled by `renderQuestLog()` (`renderer.js:3064`).
* **Objective Markers**: `✓` (completed), `✗` (failed), `○` (in progress), and `(Optional)`.
* **NPC Frustration / Mood Bar**: Center-zero gauge tracking deadline pressure (-1 = pleased, 0 = neutral, 1 = frustrated at deadline, >1 = overdue).
* **Completed & Failed Drawers**: Collapsible accordions holding archived quests.

### `[BENCHED PARTY]` & Custom Blocks
* **Camp Roster**: `[BENCHED PARTY]` renders standby companions as expandable camp roster avatars.
* **Custom Tags (`[FACTIONS]`, `[DUNGEON]`, etc.)**: Processed through `renderCustomBlockLine()`, supporting arbitrary key-value pairs and full `((MARKER))` syntax.
* **`((NPC)) Name:` Freeform Cards**: Any block can host embedded NPC cards via `((NPC)) Name:`, which queries the Lorebook Agent for matching portrait artwork.
