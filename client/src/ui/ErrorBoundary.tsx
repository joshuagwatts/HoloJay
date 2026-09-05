import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("HoloJay crash", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="boot" style={{ padding: 24, textAlign: "left", maxWidth: 520 }}>
          <p>Something broke in the 3D view.</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.75 }}>
            {this.state.error.message}
          </pre>
          <button type="button" className="prompt-btn" style={{ marginTop: 12 }} onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
