import React from "react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
          <h3 style={{ color: "#ef4444", marginBottom: "0.5rem" }}>Ocorreu um erro inesperado</h3>
          <p style={{ fontSize: "0.875rem", marginBottom: "1rem" }}>
            {this.state.error?.message || "Erro ao renderizar este componente."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              background: "#fff",
              cursor: "pointer"
            }}
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
