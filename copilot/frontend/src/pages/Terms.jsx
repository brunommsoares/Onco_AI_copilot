import React from "react";
import { ArrowLeft } from "lucide-react"; // ícone de seta

export default function Terms() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 text-slate-700">
      {/* Link de voltar */}
      <a href="/register" className="flex items-center text-blue-700 hover:text-blue-900 mb-8 text-sm font-medium">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Voltar para o registo
      </a>

      <h1 className="text-3xl font-bold mb-6 text-blue-950">
        Termos e Condições & Política de Privacidade
      </h1>

      <p className="mb-4">
        Ao criar uma conta na plataforma SILVERCANCER, o utilizador concorda com os seguintes termos de utilização
        e com o tratamento dos seus dados pessoais, de acordo com o Regulamento Geral sobre a Proteção de Dados (RGPD - UE 2016/679).
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">1. Utilização da Plataforma</h2>
      <ul className="list-disc ml-5 space-y-2">
        <li>A plataforma é destinada exclusivamente a profissionais de saúde autorizados.</li>
        <li>O utilizador é responsável por garantir que os dados fornecidos são verdadeiros e atualizados.</li>
        <li>É proibido partilhar credenciais de acesso com terceiros.</li>
        <li>A utilização indevida da plataforma poderá levar à suspensão ou cancelamento da conta.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-6 mb-2">2. Proteção de Dados Pessoais (RGPD)</h2>
      <ul className="list-disc ml-5 space-y-2">
        <li>Recolhemos dados como nome, data de nascimento, email, especialidade e instituição, exclusivamente para fins de registo, autenticação e personalização dos serviços.</li>
        <li>Os dados são armazenados de forma segura e não serão partilhados com terceiros sem o consentimento explícito do utilizador, exceto quando exigido por lei.</li>
        <li>O utilizador pode, a qualquer momento, solicitar acesso, retificação ou eliminação dos seus dados pessoais, em conformidade com o artigo 15.º do RGPD.</li>
        <li>Em caso de violação de dados, os utilizadores serão informados dentro dos prazos legais.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-6 mb-2">3. Cookies e Dados de Navegação</h2>
      <p className="mb-4">
        A plataforma poderá usar cookies estritamente necessários para funcionamento técnico, sem partilha com terceiros. Nenhum dado de navegação é usado para fins publicitários.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">4. Contacto para Exercício de Direitos</h2>
      <p>
        Para exercer os seus direitos ao abrigo do RGPD, pode contactar-nos através do email: <strong>hello@silvercancer.com</strong>
      </p>

      <p className="mt-8 text-sm text-gray-500">Última atualização: Maio de 2025</p>
    </div>
  );
}
