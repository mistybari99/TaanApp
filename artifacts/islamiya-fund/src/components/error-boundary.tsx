import React from 'react';

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey?: any },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; resetKey?: any }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: any) {
    if (prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-destructive/10 rounded-lg m-4 border border-destructive/20 text-destructive">
          <h2 className="text-lg font-bold mb-2">Something went wrong</h2>
          <p className="text-sm font-mono bg-background/50 p-2 rounded w-full overflow-auto">
            {this.state.error?.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
