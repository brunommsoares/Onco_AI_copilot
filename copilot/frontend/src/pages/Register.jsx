import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, dbSilver } from "../services/firebase";
import {
  Microscope,
  User,
  Mail,
  Lock,
  Calendar,
  Building,
  Stethoscope,
  Eye,
  EyeOff,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Shield,
} from "lucide-react";

const specialties = [
  "Oncologia Médica",
  "Oncologia de Radiação",
  "Hematologia",
  "Medicina Interna",
  "Clínica Geral",
  "Outra",
];

const interestAreas = [
  "Cancro da Mama",
  "Cancros de Origem Primária Desconhecida",
  "Cancros Endócrinos e Neuroendócrinos",
  "Cancros Gastrointestinais",
  "Cancros Geniturinários",
  "Cancros Ginecológicos",
  "Neoplasias Hematológicas",
  "Cancros de Cabeça e Pescoço",
  "Síndromes Hereditárias",
  "Tumores do Pulmão e Tórax",
  "Melanoma e Cancros da Pele",
  "Neuro-Oncologia",
  "Sarcoma e GIST",
  "Cuidados de Suporte e Paliativos",
];

export default function Register() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    fullName: "",
    birthDate: "",
    institution: "",
    specialty: "",
    interests: [],
    email: "",
    username: "",
    password: "",
    terms: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (type === "checkbox" && name === "interests") {
      setForm((f) => ({
        ...f,
        interests: checked
          ? [...f.interests, value]
          : f.interests.filter((i) => i !== value),
      }));
    } else if (type === "checkbox") {
      setForm({ ...form, [name]: checked });
    } else {
      setForm({ ...form, [name]: value });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    if (!form.terms) {
      setError("Deve aceitar os termos e condições.");
      setIsLoading(false);
      return;
    }

    try {
      const { user } = await createUserWithEmailAndPassword(auth, form.email, form.password);

      await setDoc(doc(dbSilver, "users", user.uid), {
        fullName: form.fullName,
        birthDate: form.birthDate,
        institution: form.institution,
        specialty: form.specialty,
        interests: form.interests,
        email: form.email,
        username: form.username,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      setSuccess(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      if (err.code === "auth/email-already-in-use") {
        setError("Este email já está registado.");
      } else if (err.code === "auth/weak-password") {
        setError("A palavra-passe deve ter pelo menos 6 caracteres.");
      } else {
        setError("O registo falhou. Por favor, tente novamente.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="sc-login-page min-h-screen flex items-center justify-center px-5 py-10">
        <div className="max-w-sm w-full">
          <div className="sc-login-form-card rounded-2xl p-8 text-center">
            <div className="sc-register-success-icon w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5">
              <CheckCircle className="w-8 h-8 text-white" />
            </div>
            <h2 className="sc-login-form-title text-2xl font-bold tracking-tight mb-3">
              Conta criada!
            </h2>
            <p className="sc-login-form-subtitle text-sm mb-6">
              A redirecionar para o início de sessão...
            </p>
            <div className="w-6 h-6 border-2 border-[var(--sc-accent)] border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        </div>
      </div>
    );
  }

  const canProceedStep1 = form.fullName && form.birthDate && form.institution && form.specialty;
  const canProceedStep2 = form.interests.length > 0;

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
            {/* Step indicator */}
            <div className="flex items-center justify-center gap-2 mb-6">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={`sc-register-step-dot h-1.5 rounded-full transition-all duration-300 ${
                    s === step ? "w-8" : "w-4"
                  }`}
                  style={{
                    background: s <= step ? "var(--sc-accent)" : "var(--sc-border)",
                  }}
                />
              ))}
            </div>

            <div className="text-center mb-6">
              <h2 className="sc-login-form-title text-2xl font-bold tracking-tight mb-2">
                {step === 1 && "Dados Pessoais"}
                {step === 2 && "Áreas de Interesse"}
                {step === 3 && "Criar Conta"}
              </h2>
              <p className="sc-login-form-subtitle text-sm">
                {step === 1 && "Informação profissional"}
                {step === 2 && "Selecione as suas áreas"}
                {step === 3 && "Credenciais da conta"}
              </p>
            </div>

            {error && (
              <div className="sc-login-error flex items-center gap-3 p-3 rounded-xl mb-5 text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {/* Step 1: Personal Info */}
              {step === 1 && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="fullName" className="sc-login-label block text-xs font-semibold mb-1.5">
                      NOME COMPLETO
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--sc-text-quaternary)" }} />
                      <input
                        id="fullName"
                        type="text"
                        name="fullName"
                        value={form.fullName}
                        onChange={handleChange}
                        required
                        className="sc-input py-3 pl-10"
                        placeholder="Nome completo"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="birthDate" className="sc-login-label block text-xs font-semibold mb-1.5">
                      DATA DE NASCIMENTO
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--sc-text-quaternary)" }} />
                      <input
                        id="birthDate"
                        type="date"
                        name="birthDate"
                        value={form.birthDate}
                        onChange={handleChange}
                        required
                        className="sc-input py-3 pl-10"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="institution" className="sc-login-label block text-xs font-semibold mb-1.5">
                      INSTITUIÇÃO
                    </label>
                    <div className="relative">
                      <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--sc-text-quaternary)" }} />
                      <input
                        id="institution"
                        type="text"
                        name="institution"
                        value={form.institution}
                        onChange={handleChange}
                        required
                        className="sc-input py-3 pl-10"
                        placeholder="Hospital, Universidade, etc."
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="specialty" className="sc-login-label block text-xs font-semibold mb-1.5">
                      ESPECIALIDADE
                    </label>
                    <div className="relative">
                      <Stethoscope className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--sc-text-quaternary)" }} />
                      <select
                        id="specialty"
                        name="specialty"
                        value={form.specialty}
                        onChange={handleChange}
                        required
                        className="sc-input py-3 pl-10"
                      >
                        <option value="">Selecione uma especialidade</option>
                        {specialties.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => { setError(""); setStep(2); }}
                    disabled={!canProceedStep1}
                    className="sc-login-submit w-full py-3.5 text-base font-semibold rounded-xl text-white transition-all duration-200 mt-2"
                  >
                    <span className="flex items-center justify-center gap-2">
                      Continuar
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  </button>
                </div>
              )}

              {/* Step 2: Interests */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="sc-register-interests-grid grid grid-cols-1 gap-2 max-h-[340px] overflow-y-auto pr-1">
                    {interestAreas.map((interest) => {
                      const checked = form.interests.includes(interest);
                      return (
                        <label
                          key={interest}
                          className={`sc-register-interest-chip flex items-center gap-3 px-3.5 py-2.5 rounded-xl cursor-pointer transition-all duration-200 text-sm ${
                            checked ? "active" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            name="interests"
                            value={interest}
                            checked={checked}
                            onChange={handleChange}
                            className="sr-only"
                          />
                          <div
                            className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all duration-200 ${
                              checked
                                ? "border-[var(--sc-accent)] bg-[var(--sc-accent)]"
                                : "border-[var(--sc-border)]"
                            }`}
                          >
                            {checked && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <span className="sc-register-interest-text">{interest}</span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="flex gap-3 mt-2">
                    <button
                      type="button"
                      onClick={() => { setError(""); setStep(1); }}
                      className="sc-register-back-btn flex-1 py-3 text-sm font-semibold rounded-xl transition-all duration-200"
                    >
                      <span className="flex items-center justify-center gap-2">
                        <ArrowLeft className="w-4 h-4" />
                        Voltar
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setError(""); setStep(3); }}
                      disabled={!canProceedStep2}
                      className="sc-login-submit flex-[2] py-3 text-sm font-semibold rounded-xl text-white transition-all duration-200"
                    >
                      <span className="flex items-center justify-center gap-2">
                        Continuar
                        <ArrowRight className="w-4 h-4" />
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Account */}
              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="email" className="sc-login-label block text-xs font-semibold mb-1.5">
                      E-MAIL
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--sc-text-quaternary)" }} />
                      <input
                        id="email"
                        type="email"
                        name="email"
                        value={form.email}
                        onChange={handleChange}
                        required
                        className="sc-input py-3 pl-10"
                        placeholder="email@example.com"
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="username" className="sc-login-label block text-xs font-semibold mb-1.5">
                      NOME DE UTILIZADOR
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--sc-text-quaternary)" }} />
                      <input
                        id="username"
                        type="text"
                        name="username"
                        value={form.username}
                        onChange={handleChange}
                        required
                        className="sc-input py-3 pl-10"
                        placeholder="nome de utilizador"
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="password" className="sc-login-label block text-xs font-semibold mb-1.5">
                      PALAVRA-PASSE
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--sc-text-quaternary)" }} />
                      <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        name="password"
                        value={form.password}
                        onChange={handleChange}
                        required
                        minLength="6"
                        className="sc-input py-3 pl-10 pr-11"
                        placeholder="Mínimo 6 caracteres"
                        disabled={isLoading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="sc-login-eye-btn absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <label className="flex items-start gap-3 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      name="terms"
                      checked={form.terms}
                      onChange={handleChange}
                      className="sc-register-checkbox mt-0.5"
                      disabled={isLoading}
                    />
                    <span className="sc-login-form-subtitle text-xs leading-relaxed">
                      Aceito os{" "}
                      <Link to="/terms" className="sc-login-register-link font-semibold">
                        termos e condições
                      </Link>{" "}
                      e a{" "}
                      <Link to="/privacy" className="sc-login-register-link font-semibold">
                        política de privacidade
                      </Link>
                    </span>
                  </label>

                  <div className="flex gap-3 mt-2">
                    <button
                      type="button"
                      onClick={() => { setError(""); setStep(2); }}
                      disabled={isLoading}
                      className="sc-register-back-btn flex-1 py-3.5 text-sm font-semibold rounded-xl transition-all duration-200"
                    >
                      <span className="flex items-center justify-center gap-2">
                        <ArrowLeft className="w-4 h-4" />
                        Voltar
                      </span>
                    </button>
                    <button
                      type="submit"
                      disabled={isLoading || !form.terms}
                      className="sc-login-submit flex-[2] py-3.5 text-sm font-semibold rounded-xl text-white transition-all duration-200"
                    >
                      {isLoading ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          A criar...
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          Criar conta
                          <ArrowRight className="w-4 h-4" />
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </form>

            {/* Footer */}
            <div className="sc-login-divider mt-7 pt-5 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-3">
                <Shield className="w-3.5 h-3.5" style={{ color: "var(--sc-text-quaternary)" }} />
                <span className="sc-login-terms text-xs">Dados protegidos e encriptados</span>
              </div>
              <p className="sc-login-form-subtitle text-sm mb-2">
                Já tem uma conta?
              </p>
              <Link
                to="/login"
                className="sc-login-register-link inline-flex items-center gap-1 text-sm font-semibold transition-colors"
              >
                Iniciar sessão
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
      </div>
    </div>
  );
}
