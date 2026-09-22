import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '../components/states';

interface ErrorBoundaryProps {
  children: ReactNode;
  resetKey?: number | string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  resetKey: number;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    resetKey: 0,
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return {
      hasError: true,
      resetKey: 0,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled render error in the app shell.', error, errorInfo);
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  reset = () => {
    this.setState((previous) => ({
      hasError: false,
      resetKey: previous.resetKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          title="Something went wrong"
          description="The Control Center encountered a problem. Please refresh or return to Overview."
          onRetry={this.reset}
        />
      );
    }

    const child = React.Children.only(this.props.children);
    if (React.isValidElement(child)) {
      return React.cloneElement(child, { key: this.state.resetKey });
    }

    return child;
  }
}
