# To-Do

Planned and completed work for DeathlessWebsite.

## Bug Fixes

- [x] Fix multiple-user concurrency issues
- [x] Fix weird insert block position bugs
- [x] Standardize white space between voice blocks
- [x] Margin disappears immediately on collapse Jump To menu (mobile)

## Wanted for MVP

- [x] Move the "Writing as" dropdown.
- [x] Implement a route for players to change their PIN
- [x] Restore old site layouts
- [x] Test infinite scrolling/jump-to functions on the travelogue.
    - [x] Implement jump-to menu(s) for mobile
    - Will need to first generate tons of placeholder entries for the travelogue
- [x] Refactor the logo as SVG + get favicon files
- [x] Figure out a better method of "simplified" styles for six different voices.
    - Curently they're all just italicized except Lucy.
    - Possibly use some kind of brackets with character name in caps &lt;LUARK: like this, for example&gt;.

## Non-MVP

- [ ] Touch up page intro blurbs
- [ ] Rich-text/WYSIWYG editor while editing
    - At least include functionality for bold/italics/strikethrough
    - [ ] Include undo/redo buttons (primarily for mobile)
- [ ] On a *new branch*, try out pagination instead of infinite scroll on the travelogue page
- [ ] UX for adding new travelogue entries
- [ ] UX for adding new characters
- [x] UX for players to update their own font & color (same place as reset PIN?)
- [ ] "Dirty warnings" on navigation or reload while in Edit mode
- [ ] Allow players to edit/add their own character's stats on the character page

### Style

- [x] Color palette overhaul
- [x] Find a good subheading font
- [x] Persistent header(s)
    - [ ] Sticky headings for travelogue session entries & character list categories
- [x] Box shadow around Deathless title
- [x] Travelogue sidebars:
    - remove/change coloring on format options section
    - Center checkbox vertically for hiding session names
    - Shrink/clamp text on right sidebar to remove the horizontal scroll
    - Add top margin for both so they don't look so high compared to the travelogue content
- [ ] Dark Mode

- [ ] Code practices standardizations:
    - [x] tab width from 2 -> 4
    - [x] COMMENT BLOCKS PLEASE
    - [x] Ensure aria tags are all appropriately assigned
    - [x] reorganize/standardize class selectors, et. al. to provide for more consistent formatting across the whole site
    - [ ] Get rid of dead code, streamline repetitive code
