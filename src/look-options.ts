/**
 * The look options (themes, message window borders and arrows), with the
 * names shown for them. One list shared by the picker's Style settings, the
 * portrait's Menus sheet and main, so they can't drift apart.
 */

// `as const satisfies` keeps the exact values for TypeScript while checking
// each one is a real option: a typo in a value is an error here.
export const THEMES = [
  ['aokana', 'Aokana'],
  ['kimikano', 'You and Me and Her'],
  ['katawa-shoujo', 'Katawa Shoujo'],
  ['mahoyo', 'Witch on the Holy Night'],
  ['hoshimemo', 'Hoshizora no Memoria'],
  ['steins-gate', 'Steins;Gate'],
  ['ddlc', 'Doki Doki Literature Club!'],
  ['miside', 'MiSide'],
  ['miyuki', "Miyuki's Realm"],
] as const satisfies readonly (readonly [ThemeName, string])[];

export const BORDERS = [
  ['halo', 'Halo'],
  ['rim', 'Turning rim'],
  ['ribbon', 'Ribbon'],
  ['none', 'None'],
] as const satisfies readonly (readonly [MessageBorder, string])[];

export const ARROWS = [
  ['chevron', 'Chevron'],
  ['dots', 'Dots'],
  ['triangle', 'Triangle'],
  ['hearts', 'Hearts'],
  ['ember', 'Ember'],
  ['drop', 'Drop'],
  ['knife', 'Knife'],
  ['none', 'None'],
] as const satisfies readonly (readonly [NextArrow, string])[];

// Themes that come with their own border or arrow, picked along with the
// theme (they can still be changed after). Applied by main, so picking the
// theme in either window does it. `Partial` means "some of".
export const THEME_STYLES: Partial<Record<ThemeName, Partial<MessageStyle>>> = {
  kimikano: { border: 'none', arrow: 'chevron' },
  miside: { arrow: 'hearts' },
  miyuki: { border: 'none', arrow: 'triangle' },
};
