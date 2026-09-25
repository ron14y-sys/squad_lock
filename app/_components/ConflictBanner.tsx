// One of the three places a clash surfaces (spec §5.7): the banner on a feed.
// The other two are the `conflicting` label on the row and the warning strip
// directly above the approve button.
export function ConflictBanner() {
  return (
    <div role="alert" className="sl-warn">
      יש לך פגישות שמתנגשות באותו ערב. אישור של אחת מהן יחזיר את השנייה לשקלול —
      פתח את הפגישה המסומנת &quot;מתנגש&quot; כדי להחליט.
    </div>
  );
}
