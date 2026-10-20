"use client";
import { Component, type ReactNode } from "react";
export class PanelBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section className="nb-state" role="alert">
        <h2>This panel is unavailable</h2>
        <p>
          No operation is reported as complete. Try again or use the library.
        </p>
        <button
          className="nb-button"
          onClick={() => this.setState({ failed: false })}
        >
          Retry panel
        </button>
      </section>
    ) : (
      this.props.children
    );
  }
}
