/**
 * What a goal clip's file is called: a game id, the goal's place on the
 * scoresheet and an extension — `1335913-3.mp4`, `1335913-3.jpg`. The Worker
 * looks up nothing else in the bucket, so no path a browser sends can reach any
 * other key. Its own file, free of Worker types, so the site's tests can hold
 * `highlights.json` to the same rule.
 */
export const HIGHLIGHT_PATH = /^\/highlights\/(\d+-\d+\.(?:mp4|jpg))$/;

export const isHighlight = (pathname: string) => HIGHLIGHT_PATH.test(pathname);
