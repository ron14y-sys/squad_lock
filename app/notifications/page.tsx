import Link from "next/link";

import { NotificationsList } from "./NotificationsList";

export default function NotificationsPage() {
  return (
    <div className="sl-page">
      <Link href="/groups" className="sl-sub self-start">
        &rsaquo; לקבוצות
      </Link>
      <h1 className="sl-sec">התראות</h1>
      <NotificationsList />
    </div>
  );
}
