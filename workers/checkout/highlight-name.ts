/**
 * What a goal clip's file is called: a game id, the goal's place on the
 * scoresheet, eight hex digits of the clip's own hash, and an extension —
 * `1335913-3-9f2c41ab.mp4` and its poster `1335913-3-9f2c41ab.jpg`. The hash
 * makes a replaced clip a new name, which is what lets the Worker cache them
 * for a year. The first five, published before it, have none: `1335913-3.mp4`.
 *
 * The Worker looks up nothing else in the bucket, so no path a browser sends
 * can reach any other key. Its own file, free of Worker types, so the site's
 * tests can hold `highlights.json` to the same rule.
 */
export const HIGHLIGHT_PATH = /^\/highlights\/(\d+-\d+(?:-[0-9a-f]{8})?\.(?:mp4|jpg))$/;

export const isHighlight = (pathname: string) => HIGHLIGHT_PATH.test(pathname);
