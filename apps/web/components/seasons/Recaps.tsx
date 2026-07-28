import type { RecapGame } from "../../../../packages/build/src/types";
import s from "./seasons.module.css";

/**
 * The dispatches off the club's own dead site, and the results underneath them.
 *
 * EVERY ROW IS A RESULT. Fifteen of the thirty-two carry no write-up and were
 * being dropped, which cost the archive ten dated final scores from 2012-13 and
 * all five from Summer 2013 — the only game-by-game record that survives from
 * before 2016. A row with prose behind it opens; a row without one is the same
 * line and does not.
 *
 * The quotation marks are drawn here and stripped from the source first. Several
 * of the stored recaps open with a straight quote of their own, so wrapping
 * unconditionally set `““ Encore is 0-2 against…` at the head of the archive's
 * best copy.
 */
const unquote = (text: string): string =>
  text.trim().replace(/^["“”']+\s*/, "").replace(/\s*["“”']+$/, "");

export default function Recaps({ stories }: { stories: readonly RecapGame[] }) {
  return (
    <div className={s.recaps}>
      {stories.map((story, index) => {
        const head = (
          <>
            <b>{story.grScore}–{story.opScore}</b>
            <span>vs. {story.opponent}</span>
            <span className={s.recapWhen}>{story.date}</span>
          </>
        );

        return story.recap ? (
          <details className={s.recap} key={`${story.number}-${index}`}>
            <summary>{head}</summary>
            <blockquote>“{unquote(story.recap)}”</blockquote>
          </details>
        ) : (
          <div className={`${s.recap} ${s.recapBare}`} key={`${story.number}-${index}`}>
            <div className={s.recapHead}>{head}</div>
          </div>
        );
      })}
    </div>
  );
}
