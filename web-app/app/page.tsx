import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <section className="card">
        <h1 className="text-2xl font-semibold mb-2">Welcome 👋</h1>
        <p className="text-gray-700 mb-4">
          This is a personal-use tool. Click the <strong>Find Referral</strong> button in
          the Chrome extension while viewing a LinkedIn job, and it will open
          <code className="mx-1 px-1 bg-gray-100 rounded">/referral</code>
          here with the job data pre-filled.
        </p>
        <div className="flex gap-2">
          <Link href="/referral" className="btn-primary">Open Referral page</Link>
          <Link href="/history" className="btn-secondary">View History</Link>
        </div>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold mb-2">Safety boundary</h2>
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
          <li>Does NOT automate LinkedIn messaging or clicks.</li>
          <li>Does NOT scrape search results at volume.</li>
          <li>Only reads the page you are already viewing.</li>
          <li>Generates search links and message drafts for you to send manually.</li>
        </ul>
      </section>
    </div>
  );
}
