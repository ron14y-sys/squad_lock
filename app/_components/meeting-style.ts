// Maps meeting/response state to the theme's CSS class names
// (see globals.css and theme-components.css).
type CardStatus =
  | "waiting_on_you"
  | "waiting_on_others"
  | "reweighing"
  | "conflicting"
  | "stuck"
  | "closed";

export function stickerClass(status: CardStatus): string {
  switch (status) {
    case "waiting_on_you":
      return "you";
    case "conflicting":
      return "conflict";
    case "stuck":
      return "stuck";
    case "closed":
      return "closed";
    default:
      return "";
  }
}

export function avatarClass(
  status: "pending" | "approved" | "cant_make_it" | "doesnt_suit"
): string {
  if (status === "approved") return "approved";
  if (status === "pending") return "";
  return "declined";
}

// Cards tilt left/right alternately; the one waiting on you tilts on its own.
export function tiltClass(index: number): string {
  return index % 2 === 0 ? "tilt-a" : "tilt-b";
}
