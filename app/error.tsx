"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <section className="nb-state" role="alert">
      <h1 tabIndex={-1}>This view could not be displayed</h1>
      <p>
        Your source content has not been sent anywhere. Retry the view or use
        the workspace navigation.
      </p>
      <button className="nb-button" onClick={reset}>
        Retry view
      </button>
    </section>
  );
}
