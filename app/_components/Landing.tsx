// What someone who is not signed in sees at "/". Its own component because
// app/page.tsx is now an async server component (it reads the session), and
// those cannot be unit-tested here — this can.
export function Landing() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 px-6 text-center dark:bg-black">
      <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
        SquadLock
      </h1>
      <p className="max-w-xs text-base text-zinc-600 dark:text-zinc-400">
        לתאם מפגשים עם החברים שלך.
      </p>
    </div>
  );
}
