/**
 * One `<script type="application/ld+json">`, escaped so it cannot break out.
 *
 * **`</script>` inside a JSON string ends the script element**, whatever the
 * JSON thinks. Nothing in this catalogue contains one today, but product
 * descriptions and quotes are prose written by people and this is a static
 * export — the failure would be a page that stops rendering, discovered by a
 * reader rather than by a build. Escaping every `<` to its `<` form is the
 * standard defence and is still valid JSON, so a parser reads the same string
 * back.
 *
 * `undefined` members are dropped by `JSON.stringify` on the way out, which is
 * what lets the schema builders write `...(cond ? { x } : {})` and omit a claim
 * rather than state an empty one.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- the payload is escaped above and built from site data, never from user input.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
