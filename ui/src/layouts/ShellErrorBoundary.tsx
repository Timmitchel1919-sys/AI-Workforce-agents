import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, ErrorState } from "../components/ui";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/**
 * Catches render-time failures in a page so the persistent shell (sidebar /
 * topbar) survives. Never shows a stack trace to the user.
 */
export class ShellErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Control Center page error:", error, info.componentStack);
  }

  private reset = () => this.setState({ hasError: false });

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <ErrorState
        title="This page hit an unexpected error"
        detail="The rest of the Control Center is still available. Try reloading the view."
        action={
          <Button variant="primary" onClick={this.reset}>
            Reload view
          </Button>
        }
      />
    );
  }
}
