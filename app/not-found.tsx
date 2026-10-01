import Link from "next/link";

// #190: without this, Next.js's own bare, English, unstyled not-found page
// is what an unknown URL (a typo, a stale link) actually shows — jarring
// in an app that is otherwise entirely Hebrew/RTL and its own design. Same
// markup `ScreenState`'s "notice" kind already uses elsewhere for "nothing
// here" states; this isn't that component only because it is a client
// component (`usePathname`) this page has no need for.
export default function NotFound() {
  return (
    <div className="sl-page">
      <div className="sl-panel flex flex-col items-start gap-3">
        <p>הדף הזה לא קיים — אולי הקישור שגוי, או שהדף הוזז.</p>
        <Link href="/" className="sl-btn go self-start">
          חזרה למסך הבית
        </Link>
      </div>
    </div>
  );
}
