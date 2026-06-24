# 🎨 Guia de UI/UX - Oncology Scientific Research Assistant

## 🌟 Visão Geral do Design System

O **Oncology Scientific Research Assistant** implementa um design system moderno e científico, focado na experiência do utilizador para oncologistas e investigadores. O sistema combina princípios de design médico com interfaces intuitivas para pesquisa científica.

## 🎨 Paleta de Cores

### Cores Principais - Científicas
- **Scientific 50-900**: Gradiente de azuis científicos (#f0f9ff → #0c4a6e)
- **Primary**: Azuis tradicionais para elementos principais
- **Neutral**: Escala de cinzas para texto e fundos

### Cores de Qualidade de Evidência
- **Evidence A (Verde)**: #10b981 - Alta qualidade
- **Evidence B (Âmbar)**: #f59e0b - Qualidade média  
- **Evidence C (Laranja)**: #f97316 - Baixa qualidade
- **Evidence D (Vermelho)**: #ef4444 - Muito baixa qualidade

### Cores de Estado
- **Success**: Verde para operações bem-sucedidas
- **Warning**: Âmbar para avisos
- **Error**: Vermelho para erros
- **Info**: Azul para informações

## 🔤 Tipografia

### Famílias de Fontes
- **Primary**: Inter - Para texto do corpo e interface
- **Secondary**: Poppins - Para títulos e cabeçalhos
- **Mono**: JetBrains Mono - Para código e dados técnicos

### Hierarquia de Títulos
- **H1**: 2.5rem - Títulos principais de página
- **H2**: 2rem - Seções principais
- **H3**: 1.75rem - Subseções
- **H4**: 1.5rem - Grupos de conteúdo
- **H5**: 1.25rem - Elementos menores
- **H6**: 1.125rem - Labels e categorias

## 📐 Sistema de Espaçamento

### Escala de Espaçamento
- **XS**: 0.25rem (4px)
- **SM**: 0.5rem (8px)
- **MD**: 1rem (16px)
- **LG**: 1.5rem (24px)
- **XL**: 2rem (32px)
- **2XL**: 3rem (48px)
- **3XL**: 4rem (64px)

### Classes de Espaçamento
```css
.space-scientific-xs { margin-bottom: var(--spacing-xs); }
.space-scientific-sm { margin-bottom: var(--spacing-sm); }
.space-scientific-md { margin-bottom: var(--spacing-md); }
.space-scientific-lg { margin-bottom: var(--spacing-lg); }
.space-scientific-xl { margin-bottom: var(--spacing-xl); }
```

## 🔲 Componentes Base

### Cards Científicos
```css
.scientific-card {
  @apply bg-white rounded-xl border border-neutral-200 shadow-md hover:shadow-lg transition-all duration-300;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
}
```

**Características:**
- Bordas arredondadas (xl)
- Sombras suaves com hover
- Gradiente sutil de fundo
- Transições suaves

### Botões Científicos
```css
.btn-scientific {
  @apply inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200;
  background: linear-gradient(135deg, var(--scientific-500) 0%, var(--scientific-600) 100%);
  color: white;
}
```

**Estados:**
- **Default**: Gradiente azul científico
- **Hover**: Escurecimento + elevação
- **Active**: Retorno à posição
- **Disabled**: Opacidade reduzida

### Botões Secundários
```css
.btn-secondary {
  @apply inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200;
  background: white;
  color: var(--scientific-600);
  border: 2px solid var(--scientific-600);
}
```

## 📝 Componentes de Formulário

### Inputs Científicos
```css
.input-scientific {
  @apply w-full px-4 py-3 rounded-lg border transition-all duration-200;
  border-color: var(--neutral-300);
  background-color: white;
  font-size: 1rem;
}
```

**Estados:**
- **Default**: Borda cinza neutra
- **Focus**: Borda azul científica + sombra azul
- **Disabled**: Fundo cinza + cursor não permitido

### Selects Científicos
```css
.select-scientific {
  @apply w-full px-4 py-3 rounded-lg border transition-all duration-200;
  background-image: url("data:image/svg+xml,...");
  background-position: right 0.5rem center;
  padding-right: 2.5rem;
  appearance: none;
}
```

**Características:**
- Seta personalizada SVG
- Estilo consistente com inputs
- Transições suaves

## 🎯 Componentes Especializados

### Badges de Qualidade de Evidência
```css
.evidence-badge {
  @apply inline-flex items-center px-3 py-1 rounded-full text-xs font-medium;
  transition: var(--transition-fast);
}

.evidence-badge.a { background-color: var(--evidence-a); color: white; }
.evidence-badge.b { background-color: var(--evidence-b); color: white; }
.evidence-badge.c { background-color: var(--evidence-c); color: white; }
.evidence-badge.d { background-color: var(--evidence-d); color: white; }
```

### Indicadores de Status de Pesquisa
```css
.research-status {
  @apply inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium;
}

.research-status.completed { background-color: var(--success-50); color: var(--success-600); }
.research-status.in-progress { background-color: var(--warning-50); color: var(--warning-600); }
.research-status.pending { background-color: var(--info-50); color: var(--info-600); }
```

## 📊 Componentes de Visualização de Dados

### Tabelas de Evidência
```css
.evidence-table {
  @apply w-full border-collapse;
}

.evidence-table th {
  @apply px-4 py-3 text-left text-sm font-semibold;
  background-color: var(--scientific-50);
  color: var(--scientific-900);
  border-bottom: 2px solid var(--scientific-200);
}
```

### Barras de Progresso
```css
.progress-bar {
  @apply w-full bg-neutral-200 rounded-full h-2;
}

.progress-bar .progress-fill {
  @apply h-2 rounded-full transition-all duration-300;
  background: linear-gradient(90deg, var(--scientific-500) 0%, var(--scientific-600) 100%);
}
```

## 🎭 Animações e Transições

### Animações de Entrada
```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}
```

### Transições de Componentes
```css
/* Transições rápidas para interações */
--transition-fast: 150ms ease-in-out;

/* Transições normais para mudanças de estado */
--transition-normal: 250ms ease-in-out;

/* Transições lentas para mudanças significativas */
--transition-slow: 350ms ease-in-out;
```

## 📱 Design Responsivo

### Breakpoints
- **Mobile**: < 640px
- **Tablet**: 640px - 1024px
- **Desktop**: > 1024px

### Grid System
```css
.grid-scientific.cols-1 { @apply grid-cols-1; }
.grid-scientific.cols-2 { @apply grid-cols-1 md:grid-cols-2; }
.grid-scientific.cols-3 { @apply grid-cols-1 md:grid-cols-2 lg:grid-cols-3; }
.grid-scientific.cols-4 { @apply grid-cols-1 md:grid-cols-2 lg:grid-cols-4; }
```

### Adaptações Mobile
- Botões em largura total
- Tamanhos de fonte reduzidos
- Espaçamentos compactos
- Navegação colapsável

## ♿ Acessibilidade

### Indicadores de Foco
```css
*:focus {
  outline: 2px solid var(--scientific-500);
  outline-offset: 2px;
}
```

### Suporte a Screen Readers
```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

### Modo Alto Contraste
```css
@media (prefers-contrast: high) {
  :root {
    --primary-500: #000000;
    --scientific-500: #000000;
    --neutral-500: #000000;
  }
}
```

### Redução de Movimento
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 🌙 Suporte a Modo Escuro

### Variáveis CSS para Modo Escuro
```css
@media (prefers-color-scheme: dark) {
  :root {
    --neutral-50: #171717;
    --neutral-100: #262626;
    --neutral-200: #404040;
    /* ... outras cores */
  }
}
```

### Adaptações de Componentes
- Cards com fundos escuros
- Inputs com cores adaptadas
- Texto com contraste adequado

## 🖨️ Estilos de Impressão

### Ocultação de Elementos
```css
@media print {
  .no-print { display: none !important; }
  .btn-scientific, .btn-secondary { display: none !important; }
}
```

### Adaptações para Impressão
- Remoção de sombras
- Bordas simples
- Cores otimizadas para preto e branco

## 🚀 Componentes de Interface

### Navegação Científica
- **Sticky navigation** com backdrop blur
- **Dropdown menus** para ferramentas de pesquisa
- **Menu mobile** colapsável
- **Indicadores de estado** ativo

### Interface de Pesquisa
- **Barra de pesquisa** com ícones
- **Filtros avançados** expansíveis
- **Pesquisas rápidas** pré-definidas
- **Seleção de bases de dados**

### Exibição de Resultados
- **Cards expansíveis** para detalhes
- **Badges de qualidade** coloridos
- **Ações rápidas** (copiar, partilhar, ver artigo)
- **Distribuição de qualidade** visual

### Dashboard Científico
- **Estatísticas visuais** com ícones
- **Ações rápidas** organizadas
- **Tendências de pesquisa** com métricas
- **Publicações recentes** com impacto

## 📋 Checklist de Implementação

### ✅ Componentes Base
- [ ] Cards científicos
- [ ] Botões primários e secundários
- [ ] Inputs e selects
- [ ] Badges e indicadores

### ✅ Layout e Grid
- [ ] Sistema de espaçamento
- [ ] Grid responsivo
- [ ] Containers científicos
- [ ] Flexbox utilities

### ✅ Animações
- [ ] Transições de entrada
- [ ] Hover effects
- [ ] Loading states
- [ ] Micro-interações

### ✅ Responsividade
- [ ] Breakpoints mobile
- [ ] Adaptações de layout
- [ ] Navegação mobile
- [ ] Touch-friendly

### ✅ Acessibilidade
- [ ] Indicadores de foco
- [ ] Screen reader support
- [ ] Alto contraste
- [ ] Redução de movimento

## 🎯 Princípios de Design

### 1. **Clareza Científica**
- Informação hierárquica clara
- Terminologia médica precisa
- Evidência visual da qualidade

### 2. **Eficiência de Pesquisa**
- Acesso rápido a ferramentas
- Filtros inteligentes
- Resultados organizados

### 3. **Confiança Profissional**
- Design médico respeitável
- Cores científicas apropriadas
- Interface profissional

### 4. **Acessibilidade Universal**
- Suporte a diferentes dispositivos
- Adaptação a necessidades especiais
- Inclusão de todos os utilizadores

## 🔮 Roadmap de Melhorias

### Fase 1 - Base (Atual)
- ✅ Design system completo
- ✅ Componentes base
- ✅ Responsividade básica

### Fase 2 - Avançado
- [ ] Temas personalizáveis
- [ ] Componentes interativos avançados
- [ ] Animações complexas

### Fase 3 - Experiência
- [ ] Onboarding interativo
- [ ] Tutorial contextual
- [ ] Feedback visual avançado

---

**Este guia garante consistência visual e experiência de utilizador otimizada para investigadores em oncologia, combinando design moderno com funcionalidade científica avançada.**
