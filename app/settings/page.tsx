import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <>
      <h1>Settings</h1>
      <p className="sub">
        Focus sectors, geographies, watchlist and scoring. Changes are saved to the database and change the <b>next run’s</b> search queries and scores.
        Saving requires the admin token.
      </p>
      <SettingsForm />
    </>
  );
}
