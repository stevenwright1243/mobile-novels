# Mobile Novels

An app that shows a PC visual novel as a portrait, phone-friendly view, streams it to a phone, and turns taps on the phone back into clicks in the game. These are the words the project uses for its own things; use them in conversation, docs and code names.

## The game

**Game**:
The visual novel being played, a program running on the PC.
_Avoid_: VN (fine in prose, not as a name in code), app

**Picked game**:
The game whose window the app is showing and clicking right now; picking is choosing it, in the picker or the Menus sheet.
_Avoid_: selected game, current source, active game

**Client area**:
The inside of the game's window, without its title bar, borders and menu bar. Every region and spot is a share of it.
_Avoid_: game window, capture, screen

**Profile**:
Everything saved about one game: its regions, spots, sizes, click method and the like.
_Avoid_: config, game settings file

**Game setting**:
A setting stored in the game's profile, kept only when the user saves.
_Avoid_: profile setting

**App setting**:
A setting shared by every game (theme, message style, button size, PC / Phone, Open on), stored apart from the profiles.
_Avoid_: global setting, preference

**Unsaved edits**:
Changes to game settings (and the button size) made since the last save. They apply at once but are lost unless saved.
_Avoid_: dirty state, pending changes

## Regions and spots

**Region**:
A box on the game, as shares of its client area, marking where something is: the background, the text box, the name box or the page.
_Avoid_: zone (that's the portrait's), crop, area

**Text box**:
The box where the game itself draws its lines, and the region marking it.
_Avoid_: message window (that's the portrait's), dialogue box, textbox

**Name box**:
Where the game shows who's speaking, and the region marking it.
_Avoid_: name tag (that's the portrait's), name plate

**Page**:
The region where the game draws full-screen text.
_Avoid_: NVL box, full-screen region

**Full-screen text**:
Text the game draws over the whole screen, paragraph after paragraph, instead of a line at a time in its text box; also the portrait's mode for showing it.
_Avoid_: NVL mode, page mode (in prose)

**Spot**:
A point on the game the app can click for you, such as its quick save and quick load buttons.
_Avoid_: point (the code's name for it), marker, button region

**Click method**:
How the app clicks the game: Messages (posted to the game's window, leaving the real mouse alone) or Mouse (moving and clicking the real cursor).
_Avoid_: input mode

## The app's windows

**Picker**:
The PC window for picking games, placing regions and spots, and changing settings.
_Avoid_: main window, settings window, editor

**Portrait**:
The phone-shaped window that's streamed to the phone.
_Avoid_: portrait window (fine), output, phone view

**Reader**:
The portrait's usual screen: the background picture above, the line in the message window below.
_Avoid_: reader mode, main view

**Menus mode**:
The portrait's other screen, showing the whole game so its own menus can be used, with the Menus sheet under it.
_Avoid_: raw mode (its old name, still in the code)

**Menus sheet**:
The panel under the game in Menus mode, holding the zoom pad, the look, Sizes, Visual Novels and Input Settings.
_Avoid_: settings panel, drawer

**Zoom pad**:
The Menus sheet's buttons for zooming and moving around the game, with q.Save and q.Load beside them.
_Avoid_: d-pad (only its middle part)

**Phone status**:
The picker's display of whether the phone is connected and where the portrait is.
_Avoid_: connection indicator

## The reader

**Zone**:
A part of the portrait's layout: the background zone, which the picture fills, and the text zone over its bottom.
_Avoid_: region (that's the game's), panel

**Background picture**:
The part of the game's background region shown in the background zone, placed by the Portrait height and Portrait width settings.
_Avoid_: crop, background image, art

**Message window**:
The frosted glass window in the text zone where the line is shown.
_Avoid_: text box (that's the game's), dialog, text panel

**Name tag**:
The pill on the message window's corner showing the speaker.
_Avoid_: name box (that's the game's), speaker label

**Next arrow**:
The small moving mark at the end of the line saying a tap moves on.
_Avoid_: cursor, indicator, continue arrow

**Corner buttons**:
The pill buttons in the portrait's top corners: Menus, and Auto (or Log in Menus mode).
_Avoid_: toolbar, HUD

**Text position**:
Whether the message window sits at the screen's bottom (Bottom) or hangs just under the picture (Top).
_Avoid_: text placement, layout mode

**Sample**:
A live miniature of the reader in the Sizes panel, showing the current sizes.
_Avoid_: preview (that's the picker's view of the game)

**History log**:
The last 30 lines with their speakers, opened with the Log button.
_Avoid_: backlog (that's the game's own), history

## Looks

**Theme**:
A complete look for both windows: colours, glass, font and shapes.
_Avoid_: skin, style

**Message style**:
The message window's border and next arrow, picked apart from the theme.
_Avoid_: window style

**Border**:
The message window's edge effect: Halo, Turning rim, Ribbon or None.
_Avoid_: frame, outline

**Glass**:
The frosted, see-through panel look shared by the message window, name tag, buttons and dialogs.
_Avoid_: card, blur panel

## Text

**Line**:
The text currently shown, as one piece, from the game's text box (or one new paragraph of full-screen text).
_Avoid_: dialogue, message, text line (fine in code names)

**Speaker**:
Who says the line, shown in the name tag; none during narration.
_Avoid_: character, name (alone)

**Narration**:
A line with no speaker.
_Avoid_: description, inner monologue

**Read**:
One result of OCR on a region: its text and how sure it is.
_Avoid_: scan, recognition, OCR result (fine in code)

**Confirmed line**:
A read that came out the same twice in a row, so the reader passes it on to be shown.
_Avoid_: final read, stable text

**Clean-up rules**:
The fixes applied to every read for the ways OCR gets visual novel text slightly wrong.
_Avoid_: filters, post-processing

**OCR test**:
A saved frame of a game with the text it really shows, for checking the reader.
_Avoid_: fixture, sample (that's the Sizes panel's)

**OCR bench**:
The tool that runs every OCR test and scores the reads.
_Avoid_: benchmark (fine in prose), test suite

## Text from memory

**Memory text**:
The line taken exactly from the game's memory instead of read from the picture.
_Avoid_: hooked text, memory read

**Copy**:
A place in the game's memory holding the line on screen.
_Avoid_: match, hit, address

**Following**:
Watching copies that change with each new line, so new lines show as soon as the game writes them.
_Avoid_: tracking, hooking

**Matching line by line**:
Finding each line OCR reads in the game's memory and showing memory's exact version, while no copy can be followed yet.
_Avoid_: correcting (fine for what happens to the shown line)

**Script**:
The game's stored text, every line in order, as found in its memory.
_Avoid_: story file, scenario (a game engine's word)

**Alphabet**:
A game's own character codes, learned when it doesn't store text in a standard encoding.
_Avoid_: charset, encoding, font table

## Auto

**Auto**:
The reader moving the game on by itself once you'd have read the line.
_Avoid_: auto-play, auto-advance (the game's own feature)

**Pace**:
How long Auto waits on a line: a pause plus a time per letter, learned from your taps.
_Avoid_: speed, delay

**Reading sample**:
One line you moved on from yourself, with its letters and how long you took, kept for learning the pace.
_Avoid_: timing, data point

## The phone

**Phone display**:
The extra screen Apollo adds the phone's size while streaming, which the portrait moves onto.
_Avoid_: virtual monitor, virtual display (fine in prose), phone screen

**Parking**:
Leaving the real cursor on the game's text box after a tap from the phone, so it isn't seen on the stream and the mouse's next clicks reach the game.
_Avoid_: hiding the cursor

**Open on**:
The monitor the picker, portrait and games started from the app open on.
_Avoid_: target monitor, home display
