/* eslint-disable react-refresh/only-export-components -- class error boundaries are not Fast Refresh boundaries. */
import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { useI18n } from "../i18n";
import { ErrorState } from '../components/states';

interface ErrorBoundaryProps {
  children: ReactNode;
  resetKey?: number | string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  resetKey: number;
}

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return <ErrorState title={t("shell.errorTitle")} description={t("shell.errorDescription")} onRetry={onRetry} />;
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
        <ErrorFallback onRetry={this.reset} />
      );
    }

    const child = React.Children.only(this.props.children);
    if (React.isValidElement(child)) {
      return React.cloneElement(child, { key: this.state.resetKey });
    }

    return child;
  }
}
