// What someone who is not signed in sees at "/". Its own component because
// app/page.tsx is now an async server component (it reads the session), and
// those cannot be unit-tested here — this can.
export function Landing() {
  return (
    <div className="sl-page flex-1 items-center justify-center text-center">
      <h1 className="sl-title">SquadLock</h1>
      <p className="sl-sub max-w-xs text-base">לתאם מפגשים עם החברים שלך.</p>
    </div>
  );
}
