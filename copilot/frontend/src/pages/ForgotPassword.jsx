import { useState } from "react";
import { Link } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../services/firebase";
import {
  Microscope,
  Mail,
  AlertTriangle,
  CheckCircle,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess(true);
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        setError("Não foi encontrada nenhuma conta com este email.");
      } else if (err.code === "auth/invalid-email") {
        setError("Por favor, introduza um endereço de email válido.");
      } else {
        setError("Ocorreu um erro. Por favor, tente novamente.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="sc-login-page min-h-screen flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm mx-auto">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="sc-login-logo-icon w-11 h-11 rounded-xl flex items-center justify-center">
            <Microscope className="w-5 h-5 text-white" />
          </div>
          <span className="sc-login-brand text-lg font-bold tracking-tight">SilverCancer</span>
        </div>

        <div className="sc-login-form-card rounded-2xl p-8">
          {success ? (
            <div className="text-center">
              <div className="sc-register-success-icon w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5">
                <CheckCircle className="w-8 h-8 text-white" />
              </div>
              <h2 className="sc-login-form-title text-2xl font-bold tracking-tight mb-3">
                Verifique o seu email
              </h2>
              <p className="sc-login-form-subtitle text-sm mb-6">
                Enviámos um link de recuperação de palavra-passe para <strong style={{ color: "var(--sc-text-primary)" }}>{email}</strong>
              </p>
              <Link
                to="/login"
                className="sc-login-register-link inline-flex items-center gap-1 text-sm font-semibold transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Voltar ao início de sessão
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h2 className="sc-login-form-title text-2xl font-bold tracking-tight mb-2">
                  Recuperar palavra-passe
                </h2>
                <p className="sc-login-form-subtitle text-sm">
                  Introduza o seu email e enviaremos um link de recuperação
                </p>
              </div>

              {error && (
                <div className="sc-login-error flex items-center gap-3 p-3 rounded-xl mb-6 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="sc-login-label block text-xs font-semibold mb-1.5">
                    EMAIL
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--sc-text-quaternary)" }} />
                    <input
                      id="email"
                      type="email"
                      placeholder="email@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="sc-input py-3 pl-10"
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="sc-login-submit w-full py-3.5 text-base font-semibold rounded-xl text-white transition-all duration-200"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      A enviar...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      Enviar link de recuperação
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  )}
                </button>
              </form>

              <div className="sc-login-divider mt-8 pt-6 text-center">
                <Link
                  to="/login"
                  className="sc-login-register-link inline-flex items-center gap-1 text-sm font-semibold transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Voltar ao início de sessão
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
