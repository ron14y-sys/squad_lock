// What someone who is not signed in sees at "/". Its own component because
// app/page.tsx is now an async server component (it reads the session), and
// those cannot be unit-tested here — this can.
//
// #171: this used to be text with no way to act on it — signing in only
// existed as a small link in the header. `onGoogleSignIn` is a plain prop
// (the server action itself lives in app/page.tsx, which is already
// untested) so this stays a pure, testable form.
//
// Google is the only sign-in method the app has (spec §5.2, §6.3 D13 — no
// password storage at all, deliberately, to keep the OAuth consent screen
// non-sensitive). A username/password field belongs here only once that is
// an actual backend decision, not a styling one.
export function Landing({
  onGoogleSignIn,
}: {
  onGoogleSignIn: () => Promise<void>;
}) {
  return (
    <div className="sl-page flex-1 items-center justify-center text-center">
      <div className="sl-panel flex flex-col items-center gap-4">
        <h1 className="sl-title">SquadLock</h1>
        <p className="sl-sub max-w-xs text-base">לתאם מפגשים עם החברים שלך.</p>
        <form action={onGoogleSignIn} className="w-full">
          <button type="submit" className="sl-btn go w-full">
            התחבר עם Google
          </button>
        </form>
      </div>
    </div>
  );
}
