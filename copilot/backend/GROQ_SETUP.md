# 🚀 Groq Integration Setup

## Configuração da API Groq

Para usar o sistema com Groq (ultra-fast responses), siga estes passos:

### 1. Obter Chave API Groq
1. Aceda a [console.groq.com](https://console.groq.com)
2. Crie uma conta gratuita
3. Gere uma chave API

### 2. Configurar Variável de Ambiente
Adicione a sua chave API ao arquivo `.env`:

```bash
GROQ_API_KEY=gsk_your_actual_api_key_here
```

### 3. Modelos Disponíveis
- **Primary**: `llama-3.1-70b-versatile` (melhor qualidade e raciocínio)
- **Fallback**: `mixtral-8x7b-32768` (rápido e eficiente)

### 4. Vantagens do Groq
- ⚡ **Ultra-rápido**: Respostas em milissegundos
- 🎯 **Alta qualidade**: Llama 3.1 70B para oncologia
- 💰 **Custo eficiente**: Preços competitivos
- 🔄 **Fallback automático**: Mixtral se Llama falhar

### 5. Teste
Execute o sistema e teste com:
```
Quais as opções de tratamento para ampuloma irressecável com metástases hepáticas?
```

O sistema agora usa Groq para respostas ultra-rápidas e de alta qualidade!
