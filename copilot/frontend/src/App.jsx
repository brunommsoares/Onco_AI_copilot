import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { SettingsProvider } from "./contexts/SettingsContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import SimpleChat from "./pages/SimpleChat";
import ErrorBoundary from "./components/ErrorBoundary";

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--sc-bg-page)" }}>
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-[var(--sc-accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p style={{ color: "var(--sc-text-tertiary)", fontSize: 14 }}>A carregar...</p>
        </div>
      </div>
    );
  }

  return user ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  return user ? <Navigate to="/" replace /> : children;
}

function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
          <Route path="/*" element={<PrivateRoute><ErrorBoundary><div className="min-h-screen"><SimpleChat /></div></ErrorBoundary></PrivateRoute>} />
        </Routes>
      </SettingsProvider>
    </AuthProvider>
  );
}

export default App;
